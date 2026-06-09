"""Calculate daily swing conditions from price + delivery data."""

from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta
from typing import Any

from db import log_event, supabase, upsert
from nse_holidays import is_nse_holiday
from symbols import ALL_SYMBOLS, COMPANY_META

SWING_TABLE = "swing_conditions"
SECTORS_TABLE = "sectors"
CRITERIA_CHANGES_TABLE = "criteria_changes"

# Mapping from the swing_conditions boolean columns to the plain-
# English phrase the stock page will render. Tuple shape:
#   (column_name, gained_phrase, lost_phrase)
# When today_row[col]=True and yesterday_row[col]=False we emit the
# gained_phrase; when it flips the other way we emit the lost_phrase.
# Keep these phrases neutral and descriptive — they appear under the
# criteria dots as "Changed today: <phrases>" and must read as data
# classifications, not recommendations.
CRITERIA_CHANGE_PHRASES: list[tuple[str, str, str]] = [
    (
        "condition_stage2",
        "Price moved above 30-week trend line",
        "Price moved below 30-week trend line",
    ),
    (
        "condition_delivery_above_avg",
        "Delivery volume turned above average",
        "Delivery volume dropped below average",
    ),
    (
        "condition_near_ma20",
        "Price moved near 20-period average",
        "Price moved away from 20-period average",
    ),
    (
        "condition_rsi_healthy",
        "Momentum indicator turned healthy",
        "Momentum indicator turned overextended",
    ),
    (
        "condition_volume_contracting",
        "Volume contraction began",
        "Volume expansion began",
    ),
]

TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = [
    "RELIANCE",
    "HDFCBANK",
    "INFY",
    "TATAMOTORS",
    "SUNPHARMA",
    "WIPRO",
    "AXISBANK",
    "NESTLEIND",
    "BAJFINANCE",
    "MARUTI",
]  # Nifty 50 — guaranteed daily price/delivery rows for --test runs.


def _today_iso() -> str:
    return datetime.now().date().isoformat()


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _is_stage2(stage: str | None) -> bool:
    if not stage:
        return False
    s = stage.strip().lower().replace(" ", "")
    return s == "stage2"


def _get_company_data_by_symbol() -> dict[str, dict[str, str]]:
    """Symbol → {id, sector} for the full live universe.

    Replaces the prior _get_company_ids_by_symbol. We now carry the
    live `companies.sector` column alongside the id so the sector
    aggregation loop downstream stops consulting the static
    COMPANY_META seed dict.

    Why this matters: COMPANY_META is a ~375-entry hard-coded seed.
    The live companies table has ~2125 rows. Every stock NOT in
    COMPANY_META (1700+ of them) was getting bucketed into the
    "Unknown" sector, and sectors that exist on the live companies
    table but never in COMPANY_META (Oil & Gas, Real Estate, etc.)
    never got a row in the sectors table at all. Downstream:
    generate_descriptions.fetch_sector_breadth_map silently defaulted
    those sectors to 0% breadth and Gemini wrote misleading
    "less than half / none participating" narratives.

    page=1000 matches PostgREST's hard max-rows cap.
    """
    out: dict[str, dict[str, str]] = {}
    page = 1000
    start = 0
    while True:
        res = (
            supabase.table("companies")
            .select("id,symbol,sector")
            .range(start, start + page - 1)
            .execute()
        )
        data = getattr(res, "data", None) or []
        if not data:
            break
        for row in data:
            sym = str(row.get("symbol") or "").strip()
            cid = str(row.get("id") or "").strip()
            sec = str(row.get("sector") or "").strip() or "Unknown"
            if sym and cid:
                out[sym] = {"id": cid, "sector": sec}
        if len(data) < page:
            break
        start += page
    return out


def _paginated_fetch_for_date(
    table: str,
    today: str,
    columns: str = "*, companies(symbol)",
) -> list[dict[str, Any]]:
    """Fetch every row for one date from `table`, with PostgREST 1000-row pagination.

    Without .range() these queries silently returned only the first ~1000 of
    ~2125 stocks, so the swing-condition map was missing nearly half the
    universe and many stocks were silently skipped.
    """
    out: list[dict[str, Any]] = []
    start = 0
    page = 1000
    while True:
        res = (
            supabase.table(table)
            .select(columns)
            .eq("date", today)
            .range(start, start + page - 1)
            .execute()
        )
        batch = getattr(res, "data", None) or []
        out.extend(batch)
        if len(batch) < page:
            break
        start += page
    return out


def _rows_to_symbol_map(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        company = r.get("companies")
        symbol = ""
        if isinstance(company, dict):
            symbol = str(company.get("symbol") or "")
        elif isinstance(company, list) and company:
            symbol = str((company[0] or {}).get("symbol") or "")
        symbol = symbol.strip()
        if symbol:
            out[symbol] = r
    return out


def _fetch_today_price_map(today: str) -> dict[str, dict[str, Any]]:
    return _rows_to_symbol_map(_paginated_fetch_for_date("price_data", today))


def _fetch_recent_price_rows(company_id: str, n: int = 30) -> list[dict[str, Any]]:
    res = (
        supabase.table("price_data")
        .select("date,stage,volume")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(n)
        .execute()
    )
    return getattr(res, "data", None) or []


def _volume_contracting_from_rows(recent_rows: list[dict[str, Any]]) -> bool:
    if len(recent_rows) < 30:
        return False
    vols = [_safe_float(r.get("volume")) for r in recent_rows]
    vols = [v for v in vols if v is not None]
    if len(vols) < 30:
        return False
    last_3_avg = sum(vols[:3]) / 3.0
    avg_30 = sum(vols[:30]) / 30.0
    if avg_30 <= 0:
        return False
    return last_3_avg < avg_30 * 0.75


def _stage2_new_this_week_from_rows(recent_rows: list[dict[str, Any]]) -> bool:
    # rows are newest-first; convert to oldest-first for transition checks.
    if not recent_rows:
        return False
    parsed: list[tuple[datetime, str | None]] = []
    for r in recent_rows:
        dt_txt = str(r.get("date") or "")
        try:
            dt = datetime.fromisoformat(dt_txt)
        except ValueError:
            continue
        parsed.append((dt, r.get("stage")))
    if len(parsed) < 2:
        return False
    parsed.sort(key=lambda x: x[0])

    cutoff = datetime.now() - timedelta(days=7)
    for i in range(1, len(parsed)):
        dt, stage_now = parsed[i]
        _, stage_prev = parsed[i - 1]
        if dt < cutoff:
            continue
        if _is_stage2(stage_now) and not _is_stage2(stage_prev):
            return True
    return False


def _fetch_yesterday_conditions(
    company_id: str, today: str,
) -> dict[str, Any] | None:
    """Fetch the most recent swing_conditions row STRICTLY before today.

    Schema note: the user-facing spec for this function used a `symbol`
    + `trading_date` query, but the live swing_conditions table uses
    `company_id` + `date`. The function signature here takes the
    company_id directly (already resolved in the caller via
    company_data_by_symbol) so we don't pay an extra companies-table
    round-trip per stock.
    """
    try:
        res = (
            supabase.table(SWING_TABLE)
            .select(
                "date,condition_stage2,condition_delivery_above_avg,"
                "condition_near_ma20,condition_rsi_healthy,"
                "condition_volume_contracting,conditions_met",
            )
            .eq("company_id", company_id)
            .lt("date", today)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        return rows[0] if rows else None
    except Exception as exc:  # noqa: BLE001
        # Defensive — a flaky read never blocks the main pipeline. The
        # reason field just lands empty for this stock today.
        print(f"[swing] yesterday fetch failed for {company_id}: {exc}")
        return None


# Plain-English labels for each condition column. "condition_stage2"
# renders as "Above long-term trend" (more accessible than the
# academic "Stage 2 active" wording) per the perception audit. Keep
# every label phrased as a neutral data-classification — no prescriptive
# language slips into criteria_change_reason because the UI renders
# this text directly without further sanitisation.
CONDITION_LABELS: dict[str, str] = {
    "condition_stage2": "Above long-term trend",
    "condition_delivery_above_avg": "delivery above average",
    "condition_near_ma20": "near 20-day MA",
    "condition_rsi_healthy": "RSI healthy (40-65)",
    "condition_volume_contracting": "volume contracting on pullback",
}


def _generate_criteria_change_reason(
    today_row: dict[str, Any],
    yesterday_row: dict[str, Any] | None,
) -> str:
    """Compare today's 5 boolean conditions against yesterday's.

    Returns a plain-English string describing what changed. Empty
    string means "no history" OR "nothing changed" — both cases are
    treated the same by the UI (no badge rendered).

    Format:
      "Strengthening - Added: X, Y"          (score went up + gained)
      "Weakening - Lost: X"                  (score went down + lost)
      "Added: X . Lost: Y"                   (score unchanged but mix)

    The strengthening/weakening prefix is computed from the score delta,
    not from the count of gained vs lost — so a stock that gained one
    criterion AND lost one (net zero) reads as a sideways mix rather
    than a directional move.
    """
    if yesterday_row is None:
        return ""

    today_score = int(today_row.get("conditions_met") or 0)
    yest_score = int(yesterday_row.get("conditions_met") or 0)

    # Early exit: identical scores AND identical individual flags = no
    # change at all. Don't write criteria_change_reason for stocks that
    # had a quiet day; the UI's "Changed today" badge stays hidden.
    if today_score == yest_score:
        all_same = all(
            bool(today_row.get(k)) == bool(yesterday_row.get(k))
            for k in CONDITION_LABELS
        )
        if all_same:
            return ""

    gained: list[str] = []
    lost: list[str] = []

    for key, label in CONDITION_LABELS.items():
        was = bool(yesterday_row.get(key))
        now = bool(today_row.get(key))
        if now and not was:
            gained.append(label)
        elif was and not now:
            lost.append(label)

    if not gained and not lost:
        return ""

    parts: list[str] = []
    if gained:
        parts.append(f"Added: {', '.join(gained)}")
    if lost:
        parts.append(f"Lost: {', '.join(lost)}")
    body = " . ".join(parts)

    # Directional prefix based on score delta. Equal scores with a
    # gained/lost mix get no prefix — that's a sideways shift, not a
    # directional move.
    if today_score > yest_score:
        return f"Strengthening - {body}"
    if today_score < yest_score:
        return f"Weakening - {body}"
    return body


def _sector_health_label(pct: float) -> str:
    if pct >= 60:
        return "strong"
    if pct >= 35:
        return "moderate"
    return "weak"


def _fetch_prior_swing_map(today: str) -> dict[str, dict[str, Any]]:
    """company_id → most-recent swing_conditions row STRICTLY before `today`.

    One paginated query gets us every row across the universe; we
    keep the newest pre-today entry per company_id. Used by the
    criteria-change diff so we can label "what flipped" without an
    N-query per-stock fetch in the main loop.

    PostgREST gotcha: gte/lte work on string-typed date columns just
    fine, but to avoid pulling the entire history we cap the lookback
    at 14 days. Stocks that haven't traded for 14 days are rare; if
    one slips through, the diff just doesn't fire and we fall back to
    "no change reason" — defensive.
    """
    out: dict[str, dict[str, Any]] = {}
    try:
        # Lookback window. 14 days covers weekends + a long-weekend
        # holiday cluster without dragging the whole history.
        cutoff = (
            datetime.fromisoformat(today).date() - timedelta(days=14)
        ).isoformat()
        start = 0
        page = 1000
        while True:
            res = (
                supabase.table(SWING_TABLE)
                .select(
                    "company_id,date,conditions_met,condition_stage2,"
                    "condition_delivery_above_avg,condition_near_ma20,"
                    "condition_rsi_healthy,condition_volume_contracting,"
                    "breakout_52w",
                )
                .gte("date", cutoff)
                .lt("date", today)
                .order("date", desc=True)
                .range(start, start + page - 1)
                .execute()
            )
            data = getattr(res, "data", None) or []
            if not data:
                break
            for row in data:
                cid = str(row.get("company_id") or "").strip()
                if not cid or cid in out:
                    continue
                out[cid] = row
            if len(data) < page:
                break
            start += page
    except Exception as exc:  # noqa: BLE001
        # Defensive — if the table is unreachable for any reason we
        # just skip the criteria_changes write. Never block the main
        # swing_conditions pipeline on this side-effect.
        print(f"[swing] prior-swing fetch failed: {exc}")
        return {}
    return out


def _compute_change_reason(
    today_row: dict[str, Any],
    prior_row: dict[str, Any] | None,
) -> tuple[list[str], list[str], str | None]:
    """Diff today's swing row against the prior row.

    Returns (gained, lost, reason):
      gained — list of column names that flipped False → True
      lost   — list of column names that flipped True  → False
      reason — plain-English summary, " · "-joined; None when no diff
               OR when there's no prior row to compare against.

    breakout_52w is treated as a one-direction flag: we emit a phrase
    only on the False → True transition (stocks "losing" 52W-high
    status the next day isn't a user-facing event worth labelling).
    """
    if not prior_row:
        return [], [], None

    gained: list[str] = []
    lost: list[str] = []
    phrases: list[str] = []

    for col, gained_phrase, lost_phrase in CRITERIA_CHANGE_PHRASES:
        was = bool(prior_row.get(col))
        now = bool(today_row.get(col))
        if now and not was:
            gained.append(col)
            phrases.append(gained_phrase)
        elif was and not now:
            lost.append(col)
            phrases.append(lost_phrase)

    # 52W high — one-direction; only the "hit a new 52W high today"
    # transition is interesting copy.
    if bool(today_row.get("breakout_52w")) and not bool(prior_row.get("breakout_52w")):
        gained.append("breakout_52w")
        phrases.append("Stock hit a 52-week high")

    reason = " · ".join(phrases) if phrases else None
    return gained, lost, reason


def main() -> None:
    today = _today_iso()

    # Holiday early-exit. TEST_MODE bypasses so dev runs against a
    # specific snapshot still work on a holiday. Otherwise the
    # nightly run would happily overwrite swing_conditions for a
    # holiday date using stale or empty price_data.
    if not TEST_MODE and is_nse_holiday(today):
        print(f"NSE holiday today ({today}). Skipping.")
        log_event("pipeline_skipped", {
            "reason": "nse_holiday",
            "date": today,
            "script": "calc_swing_conditions",
        })
        return

    log_event("calc_swing_conditions_started", {"trading_date": today, "test_mode": TEST_MODE})
    if TEST_MODE:
        print("TEST MODE enabled: processing symbols SYRMA, APTUS, TEJASNET")

    company_data_by_symbol = _get_company_data_by_symbol()
    price_today = _fetch_today_price_map(today)
    # Delivery dropped from SwingX criteria. The condition_delivery_above_avg
    # column is still written (as False) to keep downstream readers happy,
    # but no delivery_data / delivery_signals fetch happens here any more.

    # Pre-fetch the most-recent swing_conditions row STRICTLY before
    # today, per company_id, in one batched paginated query. Used by
    # the criteria-change diff so we don't hit N extra queries inside
    # the per-symbol loop. Empty dict on any failure → diff silently
    # no-ops, main pipeline keeps running.
    prior_swing_by_company = _fetch_prior_swing_map(today)

    sector_totals: dict[str, int] = {}
    sector_stage2: dict[str, int] = {}
    processed = 0
    criteria_changes_written = 0

    # ALL_SYMBOLS (from symbols.py) is a static ~375-entry seed list
    # — too narrow for today's universe. Iterate the live companies
    # table instead so processed≈2125 (matches bhav scope).
    symbols = TEST_SYMBOLS if TEST_MODE else sorted(company_data_by_symbol.keys())
    for symbol in symbols:
        p = price_today.get(symbol)
        if not p:
            continue
        company_data = company_data_by_symbol.get(symbol) or {}
        company_id = company_data.get("id")
        if not company_id:
            continue

        close = _safe_float(p.get("close"))
        ma20 = _safe_float(p.get("ma20"))
        rsi = _safe_float(p.get("rsi14")) or _safe_float(p.get("rsi"))
        high_52w = _safe_float(p.get("high_52w"))
        stage = p.get("stage")

        if close is None or ma20 in (None, 0) or rsi is None:
            continue

        recent_rows = _fetch_recent_price_rows(company_id, n=30)

        cond_stage2 = _is_stage2(stage)
        # Delivery condition deliberately dropped from SwingX criteria.
        # We persist the column as False (not None — Postgres boolean
        # column likely NOT NULL) so other readers don't break.
        cond_delivery = False
        cond_near_ma20 = abs(close - ma20) / ma20 < 0.03
        cond_rsi = 40 <= rsi <= 65
        cond_volume_contracting = _volume_contracting_from_rows(recent_rows)

        breakout_52w = high_52w is not None and close >= high_52w * 0.99
        stage2_new_this_week = _stage2_new_this_week_from_rows(recent_rows)

        conditions_met = sum(
            [
                cond_stage2,
                cond_delivery,
                cond_near_ma20,
                cond_rsi,
                cond_volume_contracting,
            ],
        )

        # ── criteria_change_reason ──────────────────────────────────
        # Diff vs yesterday → plain-English summary stored alongside
        # today's conditions row. The 0.1 s sleep is a defensive pace
        # to keep Supabase disk IO comfortable over a 2,000+ symbol
        # nightly run.
        yesterday_cond = _fetch_yesterday_conditions(company_id, today)
        time.sleep(0.1)
        today_cond_row = {
            "condition_stage2": cond_stage2,
            "condition_delivery_above_avg": cond_delivery,
            "condition_near_ma20": cond_near_ma20,
            "condition_rsi_healthy": cond_rsi,
            "condition_volume_contracting": cond_volume_contracting,
            "conditions_met": conditions_met,
        }
        criteria_change_reason = _generate_criteria_change_reason(
            today_cond_row, yesterday_cond,
        )

        row = {
            # Schema-aligned: swing_conditions has company_id + date
            # (NOT symbol + trading_date). Writing the wrong names
            # silently failed every nightly run because db.upsert()
            # swallowed exceptions to None. Now using the real schema.
            "company_id": company_id,
            "date": today,
            "condition_stage2": cond_stage2,
            "condition_delivery_above_avg": cond_delivery,
            "condition_near_ma20": cond_near_ma20,
            "condition_rsi_healthy": cond_rsi,
            "condition_volume_contracting": cond_volume_contracting,
            "conditions_met": conditions_met,
            "breakout_52w": breakout_52w,
            "stage2_new_this_week": stage2_new_this_week,
            # Day-over-day change reason ("Strengthening - Added: X" etc.)
            # Empty string when nothing changed vs yesterday — the UI
            # ("Changed today" badge in SwingConditions.jsx) keys off
            # truthiness so empty strings produce no badge.
            "criteria_change_reason": criteria_change_reason,
            # updated_at column doesn't exist on the live swing_conditions
            # table — Supabase has only `created_at` (set by DEFAULT now()).
            # Writing updated_at = PGRST204 silently fails every row.
        }
        upsert(SWING_TABLE, row, "company_id,date")
        processed += 1

        # ── criteria_changes upsert ──────────────────────────────────
        # Diff today's row against the most-recent prior row. We only
        # write to criteria_changes when at least one condition flipped
        # (gained / lost is non-empty). The reason string is what the
        # stock page renders below the criteria dots.
        #
        # Existing schema: (symbol, trading_date, gained[], lost[],
        # criteria_change_reason). The conflict key is (symbol,
        # trading_date) — see scripts/sql/criteria_changes_reason.sql.
        # Failure here is swallowed: criteria_changes is a side-effect
        # table; we never want it to break the main swing pipeline.
        try:
            prior_row = prior_swing_by_company.get(str(company_id))
            gained, lost, reason = _compute_change_reason(row, prior_row)
            if gained or lost:
                upsert(
                    CRITERIA_CHANGES_TABLE,
                    {
                        "symbol": symbol,
                        "trading_date": today,
                        "gained": gained,
                        "lost": lost,
                        "criteria_change_reason": reason,
                    },
                    "symbol,trading_date",
                )
                criteria_changes_written += 1
        except Exception as exc:  # noqa: BLE001
            # Don't let one bad diff abort the whole loop — log and
            # continue. Most likely causes: criteria_changes table
            # missing, or a row schema mismatch on the upsert.
            print(f"[swing] criteria_changes upsert failed for {symbol}: {exc}")

        # Live sector from companies.sector (carried on company_data).
        # The previous COMPANY_META lookup was the upstream root cause
        # for Oil & Gas / Real Estate / Metals etc. never reaching the
        # sectors table. See _get_company_data_by_symbol for context.
        sector = (company_data.get("sector") or "").strip() or "Unknown"
        sector_totals[sector] = sector_totals.get(sector, 0) + 1
        if cond_stage2:
            sector_stage2[sector] = sector_stage2.get(sector, 0) + 1

    # Sector health update
    for sector, total_count in sector_totals.items():
        stage2_count = sector_stage2.get(sector, 0)
        health_pct = (stage2_count / total_count * 100.0) if total_count else 0.0
        health_label = _sector_health_label(health_pct)
        # Schema-aligned. The live sectors table uses `name` + `date`
        # (not `sector` + `trading_date`) and `stage2_pct` (not
        # `health_pct`). The UNIQUE constraint is on `name` alone
        # (sectors_name_key) — table is a single-row-per-sector
        # snapshot, not a per-day history. ON CONFLICT name does the
        # right thing: the `date` field acts as a last-updated marker
        # within the same row.
        sector_row = {
            "name": sector,
            "date": today,
            "stage2_count": stage2_count,
            "total_companies": total_count,
            "stage2_pct": health_pct,
            "health": health_label,
            "updated_at": datetime.utcnow().isoformat(),
        }
        upsert(SECTORS_TABLE, sector_row, "name")

    print(
        f"swing conditions done: processed={processed} sectors={len(sector_totals)} "
        f"criteria_changes={criteria_changes_written} date={today}",
    )
    log_event(
        "calc_swing_conditions_finished",
        {
            "trading_date": today,
            "processed_symbols": processed,
            "sectors_updated": len(sector_totals),
            "criteria_changes_written": criteria_changes_written,
        },
    )


if __name__ == "__main__":
    main()
