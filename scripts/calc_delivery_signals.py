"""
Compute delivery / volume / price-divergence signals and upsert into delivery_signals.

Run after fetch_bhav_daily.py (uses delivery_data rows up to today's date).

Usage:
  python scripts/calc_delivery_signals.py --full
  python scripts/calc_delivery_signals.py --test
Requires --full or --test.

Requires: numpy (see scripts/requirements.txt)
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np

from db import get_active_symbols, log_event, supabase, upsert
from nse_holidays import NSE_HOLIDAYS_2026
from symbols import ALL_SYMBOLS

SIGNAL_TABLE = "delivery_signals"
DELIVERY_TABLE = "delivery_data"
PRICE_TABLE = "price_data"
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]

SLOPE_RISING = 0.5
SLOPE_FALLING = -0.5
PRICE_FLAT_PCT = 3.0
VOLUME_SURGE_RATIO = 1.3
# Compare rolling averages of total_volume (turnover) for delivery_volume_trend_* + frontend.
VOLUME_AVG_TREND_HIGH = 1.15
VOLUME_AVG_TREND_LOW = 0.85

ACCUM_DELIVERY_MULT_TYPE1 = 1.3
ACCUM_DELIVERY_MIN_TYPE1 = 45.0
ACCUM_PRICE_FLAT_PCT = 5.0
ACCUM_VOL_RATIO_TYPE2 = 1.3
ACCUM_DELIVERY_MULT_TYPE2 = 1.2

DIST_VOL_RATIO_TYPE1 = 1.5
DIST_DELIVERY_MULT_TYPE1 = 0.7
DIST_PRICE_MAX_CHANGE_TYPE1 = 2.0
DIST_DELIVERY_MAX_TYPE2 = 30.0

BREAKOUT_30W_PC_7_MIN = 3.0
BREAKOUT_30W_MA_SLOPE_MIN = -1.0
BREAKOUT_30W_PCT_FROM_MA_MAX = 10.0

BREAKDOWN_30W_PC_7_MAX = -3.0
BREAKDOWN_30W_PCT_FROM_MA_MIN = -10.0

BREAKOUT_50D_PC_7_MIN = 2.0
BREAKOUT_50D_VOL_RATIO_MIN = 1.2
BREAKOUT_50D_AVG_DELIVERY_MIN = 45.0
BREAKDOWN_50D_PC_7_MAX = -2.0
BREAKDOWN_50D_VOL_RATIO_MIN = 1.2

WEAK_DELIVERY_AVG_MAX = 35.0

# Optional columns added by scripts/sql/add_delivery_signal_detection_flags.sql.
EXTENSION_PAYLOAD_KEYS = (
    "delivery_pct_today",
    "vol_ratio",
    "is_accumulation",
    "is_distribution",
    "breakout_30wma",
    "breakdown_30wma",
    "breakout_50dma",
    "breakdown_50dma",
)

# Newer optional columns checked individually so a missing migration doesn't
# accidentally strip the older flags above. Add to this tuple whenever a new
# column ships in its own follow-up migration.
PER_KEY_OPTIONAL_COLUMNS = ("weak_delivery", "high_conviction", "pct_from_30w", "price_change_90d", "price_change_180d", "price_change_365d", "weeks_in_stage2")

_extension_columns_enabled: bool | None = None
_per_key_extension_cache: dict[str, bool] = {}


def _parse_flags() -> str:
    if "--test" in sys.argv:
        return "test"
    if "--full" in sys.argv:
        return "full"
    if "--backfill" in sys.argv:
        return "backfill"
    print("Error: specify --test (SYRMA, APTUS, TEJASNET), --full (all active companies), or --backfill [--days=N].")
    sys.exit(1)


def _skip_reason_for_daily_update(mode: str) -> str | None:
    if mode == "test":
        return None
    if "--force" in sys.argv:
        print("FORCE MODE — skipping market closed check")
        return None
    today = date.today()
    if today.weekday() >= 5:
        return "Market closed — skipping calc_delivery_signals"
    if today.isoformat() in NSE_HOLIDAYS_2026:
        return "NSE holiday — skipping calc_delivery_signals"
    return None


def _schema_extension_error(exc: BaseException) -> bool:
    parts = [str(exc), repr(exc)]
    for attr in ("message", "details", "hint", "code"):
        val = getattr(exc, attr, None)
        if val is not None:
            parts.append(str(val))
    if hasattr(exc, "args"):
        parts.extend(str(a) for a in exc.args)

    msg = " ".join(parts).lower()
    if any(token in msg for token in ("pgrst204", "schema cache", "does not exist", "42703")):
        return True

    for arg in getattr(exc, "args", ()):
        if isinstance(arg, dict):
            code = str(arg.get("code", "")).lower()
            message = str(arg.get("message", "")).lower()
            if code in ("pgrst204", "42703") or "does not exist" in message:
                return True

    return False


def _delivery_signal_extension_columns_enabled() -> bool:
    global _extension_columns_enabled
    if _extension_columns_enabled is not None:
        return _extension_columns_enabled

    select_cols = ",".join(EXTENSION_PAYLOAD_KEYS)
    try:
        supabase.table(SIGNAL_TABLE).select(select_cols).limit(1).execute()
        _extension_columns_enabled = True
    except Exception as exc:
        if _schema_extension_error(exc):
            _extension_columns_enabled = False
            print(
                "WARN: delivery_signals extension columns missing in Supabase — "
                "run scripts/sql/add_delivery_signal_detection_flags.sql, then re-run. "
                "Upserting legacy columns only.",
            )
        else:
            raise

    return _extension_columns_enabled


def _optional_column_present(key: str) -> bool:
    """Per-column existence probe. Caches result so we only round-trip once per key."""
    if key in _per_key_extension_cache:
        return _per_key_extension_cache[key]
    try:
        supabase.table(SIGNAL_TABLE).select(key).limit(1).execute()
        _per_key_extension_cache[key] = True
    except Exception as exc:
        if _schema_extension_error(exc):
            _per_key_extension_cache[key] = False
            print(
                f"WARN: {SIGNAL_TABLE}.{key} missing in Supabase — "
                f"apply the matching migration in scripts/sql/, then re-run. "
                f"{key} will be omitted from upserts.",
            )
        else:
            raise
    return _per_key_extension_cache[key]


def _payload_for_upsert(payload: dict[str, Any]) -> dict[str, Any]:
    if not _delivery_signal_extension_columns_enabled():
        payload = {k: v for k, v in payload.items() if k not in EXTENSION_PAYLOAD_KEYS}
    if any(k in payload for k in PER_KEY_OPTIONAL_COLUMNS):
        payload = {
            k: v for k, v in payload.items()
            if k not in PER_KEY_OPTIONAL_COLUMNS or _optional_column_present(k)
        }
    return payload


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    s = str(v).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _stage_key(stage: Any) -> str:
    """Normalize 'Stage 2' / 'stage 2' → 'stage2'."""
    return str(stage or "").strip().lower().replace(" ", "").replace("-", "")


def _pct_from_ma(close: float | None, ma: float | None) -> float | None:
    if close is None or ma in (None, 0):
        return None
    return (close - ma) / ma * 100.0


def _vol_ratio(today_volume: float | None, avg_volume_30d: float | None) -> float | None:
    if today_volume is None or avg_volume_30d in (None, 0):
        return None
    return today_volume / avg_volume_30d


def _price_change_within_pct(price_change_7d: float | None, max_abs_pct: float) -> bool:
    return price_change_7d is not None and abs(price_change_7d) < max_abs_pct


def _is_high_delivery_accumulation(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
) -> bool:
    if not _price_change_within_pct(price_change_7d, ACCUM_PRICE_FLAT_PCT):
        return False
    if (
        delivery_pct_today is None
        or avg_delivery_30d is None
        or avg_delivery_30d <= 0
    ):
        return False
    return (
        delivery_pct_today > avg_delivery_30d * ACCUM_DELIVERY_MULT_TYPE1
        and delivery_pct_today > ACCUM_DELIVERY_MIN_TYPE1
    )


def _is_volume_delivery_accumulation(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    if not _price_change_within_pct(price_change_7d, ACCUM_PRICE_FLAT_PCT):
        return False
    if (
        vol_ratio is None
        or delivery_pct_today is None
        or avg_delivery_30d is None
        or avg_delivery_30d <= 0
    ):
        return False
    return (
        vol_ratio > ACCUM_VOL_RATIO_TYPE2
        and delivery_pct_today > avg_delivery_30d * ACCUM_DELIVERY_MULT_TYPE2
    )


def _is_accumulation(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    return _is_high_delivery_accumulation(
        delivery_pct_today,
        avg_delivery_30d,
        price_change_7d,
    ) or _is_volume_delivery_accumulation(
        delivery_pct_today,
        avg_delivery_30d,
        price_change_7d,
        vol_ratio,
    )


def _is_high_volume_low_delivery_distribution(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    if (
        vol_ratio is None
        or delivery_pct_today is None
        or avg_delivery_30d is None
        or avg_delivery_30d <= 0
        or price_change_7d is None
    ):
        return False
    return (
        vol_ratio > DIST_VOL_RATIO_TYPE1
        and delivery_pct_today < avg_delivery_30d * DIST_DELIVERY_MULT_TYPE1
        and price_change_7d <= DIST_PRICE_MAX_CHANGE_TYPE1
    )


def _is_falling_delivery_price_stalling_distribution(
    delivery_pct_today: float | None,
    delivery_trend_30d: str,
    price_change_7d: float | None,
) -> bool:
    if delivery_pct_today is None or price_change_7d is None:
        return False
    return (
        delivery_trend_30d == "falling"
        and delivery_pct_today < DIST_DELIVERY_MAX_TYPE2
        and price_change_7d < 0
    )


def _is_distribution(
    delivery_pct_today: float | None,
    avg_delivery_30d: float | None,
    delivery_trend_30d: str,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    return _is_high_volume_low_delivery_distribution(
        delivery_pct_today,
        avg_delivery_30d,
        price_change_7d,
        vol_ratio,
    ) or _is_falling_delivery_price_stalling_distribution(
        delivery_pct_today,
        delivery_trend_30d,
        price_change_7d,
    )


def _is_breakout_30wma(
    close: float | None,
    ma30w: float | None,
    price_change_7d: float | None,
    ma30w_slope: float | None,
) -> bool:
    pct_from_ma = _pct_from_ma(close, ma30w)
    if close is None or ma30w is None or price_change_7d is None or ma30w_slope is None:
        return False
    if pct_from_ma is None:
        return False
    return (
        close > ma30w
        and price_change_7d > BREAKOUT_30W_PC_7_MIN
        and ma30w_slope > BREAKOUT_30W_MA_SLOPE_MIN
        and 0 < pct_from_ma < BREAKOUT_30W_PCT_FROM_MA_MAX
    )


def _is_breakdown_30wma(
    close: float | None,
    ma30w: float | None,
    price_change_7d: float | None,
) -> bool:
    pct_from_ma = _pct_from_ma(close, ma30w)
    if close is None or ma30w is None or price_change_7d is None or pct_from_ma is None:
        return False
    return (
        close < ma30w
        and price_change_7d < BREAKDOWN_30W_PC_7_MAX
        and BREAKDOWN_30W_PCT_FROM_MA_MIN < pct_from_ma < 0
    )


def _is_breakout_50dma(
    close: float | None,
    ma50: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
    avg_delivery_30d: float | None,
) -> bool:
    """Breakout above 50DMA confirmed by both volume surge AND sticky delivery.

    Tightened in May 2026: previously this signal only required close>ma50 +
    price_change_7d>2 + vol_ratio>1.2. Now also requires avg_delivery_30d>45
    so we don't flag intraday-trader-driven breakouts that lack real ownership.
    """
    if (
        close is None
        or ma50 is None
        or price_change_7d is None
        or vol_ratio is None
        or avg_delivery_30d is None
    ):
        return False
    return (
        close > ma50
        and price_change_7d > BREAKOUT_50D_PC_7_MIN
        and vol_ratio > BREAKOUT_50D_VOL_RATIO_MIN
        and avg_delivery_30d > BREAKOUT_50D_AVG_DELIVERY_MIN
    )


def _is_weak_delivery(
    delivery_trend_30d: str,
    avg_delivery_30d: float | None,
    price_change_7d: float | None,
) -> bool:
    """Distribution warning: delivery trend is falling, delivery is already low,
    and price is leaking. Catches names that retail is exiting while traders
    keep volume up."""
    if avg_delivery_30d is None or price_change_7d is None:
        return False
    return (
        delivery_trend_30d == "falling"
        and avg_delivery_30d < WEAK_DELIVERY_AVG_MAX
        and price_change_7d < 0
    )


def _is_breakdown_50dma(
    close: float | None,
    ma50: float | None,
    price_change_7d: float | None,
    vol_ratio: float | None,
) -> bool:
    if close is None or ma50 is None or price_change_7d is None or vol_ratio is None:
        return False
    return (
        close < ma50
        and price_change_7d < BREAKDOWN_50D_PC_7_MAX
        and vol_ratio > BREAKDOWN_50D_VOL_RATIO_MIN
    )


def classify_delivery_signal(
    pct_trend: str,
    vol_trend: str,
    stage: Any,
    price_change: float | None,
) -> str:
    """
    Combined interpretation of % delivery slope vs absolute delivery qty slope.

    pct_trend / vol_trend: 'rising' | 'falling' | 'flat'
    """
    pk = _stage_key(stage)

    if pct_trend == "falling" and vol_trend == "rising" and pk == "stage2":
        return "breakout_signature"

    if pct_trend == "rising" and vol_trend == "rising":
        return "strong_accumulation"

    if pct_trend == "rising" and vol_trend == "flat":
        return "accumulation"

    if pct_trend == "falling" and vol_trend == "falling" and pk in ("stage3", "stage4"):
        return "distribution"

    if pct_trend == "falling" and price_change is not None and price_change < -5:
        return "weakness"

    return "neutral"


def _trend_and_avg(values: list[float]) -> tuple[str, float | None]:
    """Linear slope on delivery_pct (oldest → newest); thresholds are in %-points per step."""
    if not values:
        return "flat", None
    avg = sum(values) / len(values)
    if len(values) < 2:
        return "flat", avg
    x = np.arange(len(values), dtype=float)
    ys = np.array(values, dtype=float)
    coef = np.polyfit(x, ys, 1)
    slope = float(coef[0])
    if slope > SLOPE_RISING:
        return "rising", avg
    if slope < SLOPE_FALLING:
        return "falling", avg
    return "flat", avg


def _avg_total_volume_trend(
    avg_short: float | None,
    avg_long: float | None,
) -> str:
    """
    Trend from average total turnover: short window vs longer baseline.
    Same thresholds as DeliveryPanel (1.15 / 0.85).
    """
    if avg_short is None or avg_long is None or avg_long <= 0:
        return "flat"
    if avg_short > avg_long * VOLUME_AVG_TREND_HIGH:
        return "rising"
    if avg_short < avg_long * VOLUME_AVG_TREND_LOW:
        return "falling"
    return "flat"


def _window_rows(
    rows_asc: list[dict[str, Any]],
    signal_date: date,
    calendar_days: int,
) -> list[dict[str, Any]]:
    """Rows with date in [signal_date - calendar_days, signal_date] (calendar days)."""
    cutoff = signal_date - timedelta(days=calendar_days)
    out: list[dict[str, Any]] = []
    for r in rows_asc:
        d = _parse_date(r.get("date"))
        if d is None:
            continue
        if cutoff <= d <= signal_date:
            out.append(r)
    return out


def _fetch_latest_delivery_snapshot(company_id: str) -> dict[str, Any] | None:
    res = (
        supabase.table(DELIVERY_TABLE)
        .select("delivery_pct,total_volume,date")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _fetch_delivery_rows(company_id: str, signal_date: date) -> list[dict[str, Any]]:
    lookback = signal_date - timedelta(days=120)
    res = (
        supabase.table(DELIVERY_TABLE)
        .select("date,delivery_pct,delivery_volume,total_volume")
        .eq("company_id", company_id)
        .gte("date", lookback.isoformat())
        .lte("date", signal_date.isoformat())
        .order("date", desc=False)
        .execute()
    )
    return getattr(res, "data", None) or []


def _fetch_price_rows(company_id: str, signal_date: date) -> list[dict[str, Any]]:
    res = (
        supabase.table(PRICE_TABLE)
        .select("date,close")
        .eq("company_id", company_id)
        .lte("date", signal_date.isoformat())
        .order("date", desc=True)
        .limit(260)
        .execute()
    )
    return getattr(res, "data", None) or []


def _close_on_or_before(rows_desc: list[dict[str, Any]], boundary: date) -> float | None:
    for r in rows_desc:
        d = _parse_date(r.get("date"))
        if d is None:
            continue
        if d <= boundary:
            return _safe_float(r.get("close"))
    return None


def _price_change_pct(latest_close: float | None, past_close: float | None) -> float | None:
    if latest_close is None or past_close is None or past_close == 0:
        return None
    return (latest_close - past_close) / past_close * 100.0


def _company_ids_test() -> list[str]:
    sym_set = {s.strip().upper() for s in TEST_SYMBOLS}
    res = (
        supabase.table("companies")
        .select("id,symbol")
        .in_("symbol", list(sym_set))
        .limit(5000)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    out: list[str] = []
    for r in rows:
        cid = str(r.get("id") or "").strip()
        if cid:
            out.append(cid)
    return out


def _fetch_latest_price_snapshots_batch(company_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Latest price_data row per company (is_latest=true)."""
    out: dict[str, dict[str, Any]] = {}
    if not company_ids:
        return out
    chunk_size = 200
    for i in range(0, len(company_ids), chunk_size):
        chunk = company_ids[i : i + chunk_size]
        res = (
            supabase.table(PRICE_TABLE)
            .select("company_id,stage,close,ma50,ma30w,ma30w_slope,rs_vs_nifty,weinstein_substage")
            .eq("is_latest", True)
            .in_("company_id", chunk)
            .execute()
        )
        for r in getattr(res, "data", None) or []:
            cid = str(r.get("company_id") or "").strip()
            if cid:
                out[cid] = r
    return out


def _company_ids_full() -> list[str]:
    """Company IDs for active (non-suspended) tracked symbols only."""
    symbols = get_active_symbols(ALL_SYMBOLS)
    if not symbols:
        return []
    out: list[str] = []
    chunk = 500
    for i in range(0, len(symbols), chunk):
        batch = symbols[i : i + chunk]
        res = supabase.table("companies").select("id").in_("symbol", batch).limit(5000).execute()
        for r in getattr(res, "data", None) or []:
            cid = str(r.get("id") or "").strip()
            if cid:
                out.append(cid)
    return out


def _fetch_company_info() -> dict[str, dict[str, Any]]:
    """All companies with sector/industry/parent_sector, keyed by string id."""
    res = (
        supabase.table("companies")
        .select("id,symbol,sector,industry,parent_sector")
        .limit(5000)
        .execute()
    )
    return {
        str(r["id"]): r
        for r in (getattr(res, "data", None) or [])
        if r.get("id")
    }


def _backfill_days() -> int:
    for a in sys.argv:
        if a.startswith("--days="):
            try:
                return int(a.split("=", 1)[1])
            except ValueError:
                pass
    return 90


def _backfill_dates(days: int) -> list[date]:
    """Trading days in the last `days` calendar days (weekdays, no NSE holidays)."""
    today = date.today()
    cutoff = today - timedelta(days=days)
    result: list[date] = []
    d = cutoff
    while d <= today:
        if d.weekday() < 5 and d.isoformat() not in NSE_HOLIDAYS_2026:
            result.append(d)
        d += timedelta(days=1)
    return result


def get_sector_health(trading_date: str) -> dict[str, Any]:
    """
    Returns stage2 % for each sector / industry / parent_sector on trading_date.
    Result keys: 'sector', 'industry', 'parent' — each a dict of name → stats.
    """
    price_res = (
        supabase.table(PRICE_TABLE)
        .select("company_id,stage")
        .eq("date", trading_date)
        .limit(3000)
        .execute()
    )
    price_by_cid: dict[str, str] = {
        r["company_id"]: r["stage"]
        for r in (getattr(price_res, "data", None) or [])
        if r.get("company_id") and r.get("stage")
    }

    companies_res = (
        supabase.table("companies")
        .select("id,sector,industry,parent_sector")
        .limit(5000)
        .execute()
    )

    sector_counts:   dict[str, dict] = {}
    industry_counts: dict[str, dict] = {}
    parent_counts:   dict[str, dict] = {}

    for c in (getattr(companies_res, "data", None) or []):
        cid   = str(c.get("id") or "")
        stage = price_by_cid.get(cid)
        if not stage:
            continue
        is_s2 = stage == "Stage 2"

        for bucket, key in (
            (sector_counts,   c.get("sector", "")),
            (industry_counts, c.get("industry", "")),
            (parent_counts,   c.get("parent_sector", "")),
        ):
            if not key:
                continue
            if key not in bucket:
                bucket[key] = {"total": 0, "stage2": 0}
            bucket[key]["total"] += 1
            if is_s2:
                bucket[key]["stage2"] += 1

    def _calc_pct(counts: dict) -> dict:
        result = {}
        for name, data in counts.items():
            if data["total"] >= 3:
                result[name] = {
                    "total":      data["total"],
                    "stage2":     data["stage2"],
                    "stage2_pct": round(data["stage2"] / data["total"] * 100, 1),
                }
        return result

    return {
        "sector":   _calc_pct(sector_counts),
        "industry": _calc_pct(industry_counts),
        "parent":   _calc_pct(parent_counts),
    }


def calc_high_conviction(
    stock: dict[str, Any],
    sector_health: dict[str, Any],
    company_info: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    """
    Returns (is_high_conviction, reasons).

    All 8 conditions must be true:
      1. Stage 2
      2. ma30w_slope > 0  (MA rising)
      3. vol_ratio >= 2.0  (volume surge)
      4. rs_vs_nifty > 5%  (outperforming)
      5. 0 < pct_from_30w < 15%  (not extended)
      6. sector  stage2_pct >= 40%
      7. industry stage2_pct >= 50%  (if >= 5 stocks in industry)
      8. parent_sector stage2_pct >= 35%
    """
    reasons: dict[str, Any] = {}

    stage       = stock.get("stage", "")
    close       = float(stock.get("close")       or 0)
    ma30w       = float(stock.get("ma30w")       or 0)
    ma30w_slope = float(stock.get("ma30w_slope") or 0)
    rs          = float(stock.get("rs_vs_nifty") or 0)
    vol_ratio   = float(stock.get("vol_ratio")   or 0)

    pct_from_30w: float | None = None
    if ma30w > 0 and close > 0:
        pct_from_30w = (close - ma30w) / ma30w * 100

    c1 = stage == "Stage 2"
    c2 = ma30w_slope > 0
    c3 = vol_ratio >= 2.0
    c4 = rs > 5.0
    c5 = pct_from_30w is not None and 0 < pct_from_30w < 15

    reasons.update({
        "stage2":       c1,
        "ma_rising":    c2,
        "volume_2x":    c3,
        "rs_positive":  c4,
        "not_extended": c5,
        "pct_from_30w": pct_from_30w,
        "rs_value":     rs,
    })

    sector   = company_info.get("sector",        "")
    industry = company_info.get("industry",      "")
    parent   = company_info.get("parent_sector", "")

    sector_data = sector_health["sector"].get(sector, {})
    sector_pct  = sector_data.get("stage2_pct", 0)
    c6 = sector_pct >= 40
    reasons["sector_stage2_pct"] = sector_pct
    reasons["sector_ok"]         = c6

    industry_data  = sector_health["industry"].get(industry, {})
    industry_total = industry_data.get("total", 0)
    industry_pct   = industry_data.get("stage2_pct", 0)
    if industry_total >= 5:
        c7 = industry_pct >= 50
        reasons["industry_checked"] = True
    else:
        c7 = True
        reasons["industry_checked"] = False
    reasons["industry_stage2_pct"] = industry_pct
    reasons["industry_ok"]         = c7

    parent_data = sector_health["parent"].get(parent, {})
    parent_pct  = parent_data.get("stage2_pct", 0)
    c8 = parent_pct >= 35
    reasons["parent_stage2_pct"] = parent_pct
    reasons["parent_ok"]         = c8

    return c1 and c2 and c3 and c4 and c5 and c6 and c7 and c8, reasons


def update_swingx_entries(
    trading_date: str,
    high_conviction_map: dict[str, tuple[bool, dict[str, Any]]],
    price_map: dict[str, dict[str, Any]],
    company_map: dict[str, dict[str, Any]],
) -> None:
    """
    Maintain swingx_entries table:
      - Insert new entries for newly qualifying stocks
      - Update current_price / return_pct / days_in_swingx for active entries
      - Exit stocks no longer qualifying (stage change, below 30W MA, sector weakened)
    Requires swingx_entries table — create it in Supabase before first run.
    """
    try:
        active_res = (
            supabase.table("swingx_entries")
            .select("company_id,entry_date,entry_price")
            .eq("is_active", True)
            .execute()
        )
        active_entries: dict[str, dict] = {
            r["company_id"]: r
            for r in (getattr(active_res, "data", None) or [])
        }
    except Exception as exc:
        print(f"  swingx_entries fetch failed: {exc}")
        print("  (table may not exist — create it in Supabase first)")
        return

    trading_dt = date.fromisoformat(trading_date)
    new_upserts: list[dict[str, Any]] = []
    new_count = exit_count = 0

    for company_id, (is_hc, reasons) in high_conviction_map.items():
        price   = price_map.get(company_id, {})
        company = company_map.get(company_id, {})
        symbol  = company.get("symbol", "")
        close   = float(price.get("close") or 0)

        if is_hc:
            if company_id not in active_entries:
                # New entry
                new_upserts.append({
                    "company_id":               company_id,
                    "symbol":                   symbol,
                    "sector":                   company.get("sector"),
                    "industry":                 company.get("industry"),
                    "parent_sector":            company.get("parent_sector"),
                    "entry_date":               trading_date,
                    "entry_price":              close,
                    "entry_substage":           price.get("weinstein_substage"),
                    "entry_rs":                 reasons.get("rs_value"),
                    "entry_vol_ratio":          float(price.get("vol_ratio") or 0),
                    "entry_pct_from_30w":       reasons.get("pct_from_30w"),
                    "sector_stage2_pct":        reasons.get("sector_stage2_pct"),
                    "industry_stage2_pct":      reasons.get("industry_stage2_pct"),
                    "parent_sector_stage2_pct": reasons.get("parent_stage2_pct"),
                    "is_active":                True,
                    "current_price":            close,
                    "current_substage":         price.get("weinstein_substage"),
                    "return_pct":               0.0,
                    "days_in_swingx":           0,
                    "updated_at":               trading_date,
                })
                new_count += 1
                print(f"  NEW SwingX: {symbol}")
            else:
                # Update existing active entry
                entry = active_entries[company_id]
                ep    = float(entry.get("entry_price") or close)
                ret   = round((close - ep) / ep * 100, 2) if ep > 0 else 0.0
                days  = (trading_dt - date.fromisoformat(entry["entry_date"])).days
                try:
                    (
                        supabase.table("swingx_entries")
                        .update({
                            "current_price":   close,
                            "current_substage": price.get("weinstein_substage"),
                            "return_pct":      ret,
                            "days_in_swingx":  days,
                            "updated_at":      trading_date,
                        })
                        .eq("company_id", company_id)
                        .eq("is_active", True)
                        .execute()
                    )
                except Exception as exc:
                    print(f"  swingx update error ({symbol}): {exc}")

        elif company_id in active_entries:
            # Exit: determine reason
            stage  = price.get("stage", "")
            ma30w  = float(price.get("ma30w") or 0)
            if stage in ("Stage 3", "Stage 4"):
                reason = "stage_change"
            elif ma30w > 0 and close < ma30w:
                reason = "below_30w"
            elif not reasons.get("sector_ok"):
                reason = "sector_weakened"
            else:
                reason = "conditions_lost"

            entry = active_entries[company_id]
            ep    = float(entry.get("entry_price") or close)
            ret   = round((close - ep) / ep * 100, 2) if ep > 0 else 0.0
            try:
                (
                    supabase.table("swingx_entries")
                    .update({
                        "is_active":   False,
                        "exit_date":   trading_date,
                        "exit_price":  close,
                        "exit_reason": reason,
                        "return_pct":  ret,
                        "updated_at":  trading_date,
                    })
                    .eq("company_id", company_id)
                    .eq("is_active", True)
                    .execute()
                )
                exit_count += 1
                print(f"  EXIT SwingX: {symbol} ({reason}) {ret:+.1f}%")
            except Exception as exc:
                print(f"  swingx exit error ({symbol}): {exc}")

    if new_upserts:
        try:
            (
                supabase.table("swingx_entries")
                .upsert(new_upserts, on_conflict="company_id,entry_date")
                .execute()
            )
        except Exception as exc:
            print(f"  swingx new entries upsert error: {exc}")

    print(f"  SwingX: +{new_count} new, -{exit_count} exits, "
          f"{len(active_entries)} previously active")


def _calculate_signal_from_snapshot(
    company_id: str,
    signal_date: date,
    price: dict[str, Any],
    delivery: dict[str, Any],
) -> dict[str, Any] | None:
    """
    Build a delivery_signals record from single-date price + delivery snapshots.

    Rolling-window trend fields (avg_delivery_30d, price_change_7d, etc.) cannot
    be computed from a single row and are left as None. Price-vs-MA position flags
    and high_conviction are computed from pre-calculated MA columns in price_data.
    """
    if not delivery:
        return None

    close        = _safe_float(price.get("close"))
    stage_raw    = price.get("stage")
    ma50         = _safe_float(price.get("ma50"))
    ma30w        = _safe_float(price.get("ma30w"))
    ma30w_slope  = _safe_float(price.get("ma30w_slope"))
    rs_vs_nifty  = _safe_float(price.get("rs_vs_nifty"))

    delivery_pct_today = _safe_float(delivery.get("delivery_pct"))
    total_volume       = _safe_float(delivery.get("total_volume"))

    pct_from_30w = _pct_from_ma(close, ma30w)
    pct_from_50d = _pct_from_ma(close, ma50)

    above_30w = bool(close is not None and ma30w is not None and close > ma30w)
    above_50d = bool(close is not None and ma50 is not None and close > ma50)

    breakout_30wma = bool(
        above_30w
        and ma30w_slope is not None
        and ma30w_slope > BREAKOUT_30W_MA_SLOPE_MIN
        and pct_from_30w is not None
        and 0 < pct_from_30w < BREAKOUT_30W_PCT_FROM_MA_MAX
    )
    breakdown_30wma = bool(
        not above_30w
        and pct_from_30w is not None
        and BREAKDOWN_30W_PCT_FROM_MA_MIN < pct_from_30w < 0
    )
    breakout_50dma  = above_50d
    breakdown_50dma = bool(close is not None and ma50 is not None and close < ma50)

    # Simplified high_conviction: Stage 2, above both MAs, slope up, RS positive.
    # avg_delivery_30d and vol_ratio omitted — no rolling history available.
    high_conviction = bool(
        str(stage_raw or "").strip() == "Stage 2"
        and close is not None
        and ma30w is not None and ma50 is not None
        and above_30w and above_50d
        and ma30w_slope is not None and ma30w_slope > 0
        and rs_vs_nifty is not None and rs_vs_nifty > 0
        and pct_from_30w is not None and pct_from_30w < 15
        and pct_from_50d is not None and pct_from_50d < 20
    )

    return {
        "company_id": company_id,
        "date": signal_date.isoformat(),
        "delivery_trend_7d": "flat",
        "delivery_trend_30d": "flat",
        "delivery_volume_trend_7d": "flat",
        "delivery_volume_trend_30d": "flat",
        "delivery_signal_7d": "neutral",
        "delivery_signal_30d": "neutral",
        "delivery_trend_60d": "flat",
        "delivery_trend_90d": "flat",
        "avg_delivery_7d": None,
        "avg_delivery_30d": None,
        "avg_delivery_60d": None,
        "avg_delivery_90d": None,
        "avg_volume_7d": None,
        "avg_volume_30d": None,
        "avg_volume_60d": None,
        "avg_volume_90d": None,
        "total_traded_volume_today": total_volume,
        "delivery_pct_today": delivery_pct_today,
        "vol_ratio": None,
        "price_change_7d": None,
        "price_change_30d": None,
        "price_change_90d": None,
        "price_change_180d": None,
        "price_change_365d": None,
        "is_accumulation": False,
        "is_distribution": False,
        "breakout_30wma": breakout_30wma,
        "breakdown_30wma": breakdown_30wma,
        "breakout_50dma": breakout_50dma,
        "breakdown_50dma": breakdown_50dma,
        "weak_delivery": False,
        "delivery_rising_price_flat_7d": False,
        "delivery_rising_price_flat_30d": False,
        "volume_rising_price_flat_7d": False,
        "volume_rising_price_flat_30d": False,
        "unusual_accumulation": False,
        "high_conviction": high_conviction,
        "pct_from_30w": round(pct_from_30w, 2) if pct_from_30w is not None else None,
    }


def _run_backfill_for_date(trading_date: date) -> int:
    """
    2 bulk queries for one trading date → all companies → batch upsert.
    Returns number of records successfully upserted.
    """
    price_res = (
        supabase.table(PRICE_TABLE)
        .select("company_id,close,stage,ma30w,ma30w_slope,ma50,ma150,rs_vs_nifty")
        .eq("date", trading_date.isoformat())
        .limit(3000)
        .execute()
    )
    price_by_company: dict[str, dict[str, Any]] = {
        r["company_id"]: r
        for r in (getattr(price_res, "data", None) or [])
        if r.get("company_id")
    }

    delivery_res = (
        supabase.table(DELIVERY_TABLE)
        .select("company_id,delivery_pct,delivery_volume,total_volume")
        .eq("date", trading_date.isoformat())
        .limit(3000)
        .execute()
    )
    delivery_by_company: dict[str, dict[str, Any]] = {
        r["company_id"]: r
        for r in (getattr(delivery_res, "data", None) or [])
        if r.get("company_id")
    }

    records: list[dict[str, Any]] = []
    for company_id, price in price_by_company.items():
        delivery = delivery_by_company.get(company_id, {})
        record = _calculate_signal_from_snapshot(company_id, trading_date, price, delivery)
        if record:
            records.append(_payload_for_upsert(record))

    BATCH = 500
    ok = 0
    for i in range(0, len(records), BATCH):
        chunk = records[i : i + BATCH]
        res = upsert(SIGNAL_TABLE, chunk, "company_id,date")
        if res is not None:
            ok += len(chunk)
    return ok


def _run_backfill(days: int) -> None:
    """
    Date-outer backfill: 2 bulk queries per trading day (all companies at once).

    Old approach: ~2126 companies × 2 fetches = ~4900 DB calls
    New approach: N dates × 2 bulk queries  = ~180 DB calls for 90 days
    Trade-off: rolling-window fields (avg_delivery_30d, price_change_7d, etc.)
    are not populated; run --full afterwards to enrich today's signals.
    """
    dates = _backfill_dates(days)
    if not dates:
        print("No trading days found in the specified range.")
        return

    print(f"BACKFILL mode: {len(dates)} trading days (last {days} calendar days)")
    print(f"Date range: {dates[0].isoformat()} to {dates[-1].isoformat()}")
    print(f"Strategy: 2 bulk queries/date = {len(dates) * 2} total DB calls")
    _delivery_signal_extension_columns_enabled()

    total_ok = 0
    dates_empty = 0

    for i, d in enumerate(dates, start=1):
        ok = _run_backfill_for_date(d)
        total_ok += ok
        if ok == 0:
            dates_empty += 1
        print(f"  {d.isoformat()}: upserted={ok}")

    print()
    print("Backfill summary:")
    print(f"  Dates processed: {len(dates)}")
    print(f"  Total upserted: {total_ok}")
    print(f"  Dates with no price data: {dates_empty}")
    log_event(
        "calc_delivery_signals_backfill_finished",
        {
            "days": days,
            "dates": len(dates),
            "upserted": total_ok,
            "skipped": dates_empty,
            "failures": 0,
        },
    )


def _build_payload(
    company_id: str,
    signal_date: date,
    deliveries_asc: list[dict[str, Any]],
    prices_desc: list[dict[str, Any]],
    price_snapshot: dict[str, Any] | None,
    latest_delivery: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not deliveries_asc:
        return None

    def period_metrics(days: int) -> tuple[list[float], list[float]]:
        rows = _window_rows(deliveries_asc, signal_date, days)
        pcts = [
            float(v)
            for v in (_safe_float(r.get("delivery_pct")) for r in rows)
            if v is not None
        ]
        vols = [
            float(v)
            for v in (_safe_float(r.get("total_volume")) for r in rows)
            if v is not None
        ]
        return pcts, vols

    p7, v7 = period_metrics(7)
    p30, v30 = period_metrics(30)
    p60, v60 = period_metrics(60)
    p90, v90 = period_metrics(90)

    trend_7, avg_d7 = _trend_and_avg(p7)
    trend_30, avg_d30 = _trend_and_avg(p30)
    trend_60, avg_d60 = _trend_and_avg(p60)
    trend_90, avg_d90 = _trend_and_avg(p90)

    # Averages of total_volume (traded quantity) over last N calendar-window rows.
    avg_v7 = sum(v7) / len(v7) if v7 else None
    avg_v30 = sum(v30) / len(v30) if v30 else None
    avg_v60 = sum(v60) / len(v60) if v60 else None
    avg_v90 = sum(v90) / len(v90) if v90 else None

    vol_trend_7 = _avg_total_volume_trend(avg_v7, avg_v30)
    vol_trend_30 = _avg_total_volume_trend(avg_v30, avg_v90)

    delivery_pct_today = _safe_float((latest_delivery or {}).get("delivery_pct"))
    today_vol = _safe_float((latest_delivery or {}).get("total_volume"))

    snap = price_snapshot or {}
    stage_latest = snap.get("stage")
    latest_close = _safe_float(snap.get("close")) or _close_on_or_before(prices_desc, signal_date)
    ma50 = _safe_float(snap.get("ma50"))
    ma30w = _safe_float(snap.get("ma30w"))
    ma30w_slope = _safe_float(snap.get("ma30w_slope"))
    rs_vs_nifty = _safe_float(snap.get("rs_vs_nifty"))
    close_7   = _close_on_or_before(prices_desc, signal_date - timedelta(days=7))
    close_30  = _close_on_or_before(prices_desc, signal_date - timedelta(days=30))
    close_90  = _close_on_or_before(prices_desc, signal_date - timedelta(days=90))
    close_180 = _close_on_or_before(prices_desc, signal_date - timedelta(days=180))
    close_365 = _close_on_or_before(prices_desc, signal_date - timedelta(days=365))

    pc_7   = _price_change_pct(latest_close, close_7)
    pc_30  = _price_change_pct(latest_close, close_30)
    pc_90  = _price_change_pct(latest_close, close_90)
    pc_180 = _price_change_pct(latest_close, close_180)
    pc_365 = _price_change_pct(latest_close, close_365)

    delivery_signal_7d = classify_delivery_signal(trend_7, vol_trend_7, stage_latest, pc_7)
    delivery_signal_30d = classify_delivery_signal(trend_30, vol_trend_30, stage_latest, pc_30)

    deliv_rising_price_flat_7 = bool(
        trend_7 == "rising" and pc_7 is not None and abs(pc_7) < PRICE_FLAT_PCT,
    )
    deliv_rising_price_flat_30 = bool(
        trend_30 == "rising" and pc_30 is not None and abs(pc_30) < PRICE_FLAT_PCT,
    )

    vol_rising_7 = bool(
        avg_v7 is not None
        and avg_v30 not in (None, 0)
        and avg_v7 > avg_v30 * VOLUME_AVG_TREND_HIGH,
    )
    vol_rising_price_flat_7 = bool(
        vol_rising_7 and pc_7 is not None and abs(pc_7) < PRICE_FLAT_PCT,
    )
    vol_rising_price_flat_30 = bool(
        avg_v30 is not None
        and avg_v60 not in (None, 0)
        and avg_v30 > avg_v60 * VOLUME_SURGE_RATIO
        and pc_30 is not None
        and abs(pc_30) < PRICE_FLAT_PCT,
    )

    unusual = bool(deliv_rising_price_flat_7 and trend_30 in ("rising", "flat"))

    vol_ratio = _vol_ratio(today_vol, avg_v30)
    is_accumulation = _is_accumulation(delivery_pct_today, avg_d30, pc_7, vol_ratio)
    is_distribution = _is_distribution(
        delivery_pct_today,
        avg_d30,
        trend_30,
        pc_7,
        vol_ratio,
    )
    breakout_30wma = _is_breakout_30wma(latest_close, ma30w, pc_7, ma30w_slope)
    breakdown_30wma = _is_breakdown_30wma(latest_close, ma30w, pc_7)
    breakout_50dma = _is_breakout_50dma(latest_close, ma50, pc_7, vol_ratio, avg_d30)
    breakdown_50dma = _is_breakdown_50dma(latest_close, ma50, pc_7, vol_ratio)
    weak_delivery = _is_weak_delivery(trend_30, avg_d30, pc_7)

    pct_from_30w = _pct_from_ma(latest_close, ma30w)
    pct_from_50d = _pct_from_ma(latest_close, ma50)

    # HIGH CONVICTION — "Buyable" Stage 2: must be Stage 2, above both MAs with
    # rising MA slope, RS vs Nifty positive (outperforming the index), good delivery,
    # above-average volume, positive momentum, and not extended (< 15% from 30W MA).
    high_conviction = bool(
        str(stage_latest or "").strip() == "Stage 2"
        and latest_close is not None
        and ma30w is not None
        and ma50 is not None
        and latest_close > ma30w
        and latest_close > ma50
        # MA must be pointing upward — declining MA invalidates the setup
        and ma30w_slope is not None
        and ma30w_slope > 0
        # RS vs Nifty must be positive — stock outperforming the index
        and rs_vs_nifty is not None
        and rs_vs_nifty > 0
        and avg_d30 is not None
        and avg_d30 > 40
        and vol_ratio is not None
        and vol_ratio > 1.0
        and pc_7 is not None
        and pc_7 > 0
        # Entry zone: < 15% extended from 30W MA, < 20% from 50D MA
        and pct_from_30w is not None
        and pct_from_30w < 15
        and pct_from_50d is not None
        and pct_from_50d < 20
    )

    return {
        "company_id": company_id,
        "date": signal_date.isoformat(),
        "delivery_trend_7d": trend_7,
        "delivery_trend_30d": trend_30,
        "delivery_volume_trend_7d": vol_trend_7,
        "delivery_volume_trend_30d": vol_trend_30,
        "delivery_signal_7d": delivery_signal_7d,
        "delivery_signal_30d": delivery_signal_30d,
        "delivery_trend_60d": trend_60,
        "delivery_trend_90d": trend_90,
        "avg_delivery_7d": avg_d7,
        "avg_delivery_30d": avg_d30,
        "avg_delivery_60d": avg_d60,
        "avg_delivery_90d": avg_d90,
        "avg_volume_7d": avg_v7,
        "avg_volume_30d": avg_v30,
        "avg_volume_60d": avg_v60,
        "avg_volume_90d": avg_v90,
        "total_traded_volume_today": today_vol,
        "delivery_pct_today": delivery_pct_today,
        "vol_ratio": vol_ratio,
        "price_change_7d": pc_7,
        "price_change_30d": pc_30,
        "price_change_90d": pc_90,
        "price_change_180d": pc_180,
        "price_change_365d": pc_365,
        "is_accumulation": is_accumulation,
        "is_distribution": is_distribution,
        "breakout_30wma": breakout_30wma,
        "breakdown_30wma": breakdown_30wma,
        "breakout_50dma": breakout_50dma,
        "breakdown_50dma": breakdown_50dma,
        "weak_delivery": weak_delivery,
        "delivery_rising_price_flat_7d": deliv_rising_price_flat_7,
        "delivery_rising_price_flat_30d": deliv_rising_price_flat_30,
        "volume_rising_price_flat_7d": vol_rising_price_flat_7,
        "volume_rising_price_flat_30d": vol_rising_price_flat_30,
        "unusual_accumulation": unusual,
        "high_conviction": high_conviction,
        "pct_from_30w": round(pct_from_30w, 2) if pct_from_30w is not None else None,
    }


def main() -> None:
    mode = _parse_flags()

    if mode == "backfill":
        _run_backfill(_backfill_days())
        return

    skip = _skip_reason_for_daily_update(mode)
    if skip:
        print(skip)
        log_event(
            "calc_delivery_signals_skipped",
            {"reason": skip, "iso_date": date.today().isoformat(), "mode": mode},
        )
        return

    signal_date = date.today()

    if mode == "test":
        company_ids = _company_ids_test()
        print(f"TEST mode: processing {len(company_ids)} companies for symbols {TEST_SYMBOLS}")
    else:
        company_ids = _company_ids_full()
        print(f"FULL mode: {len(company_ids)} companies (active symbols from DB, by company id).")

    print(f"Signal date: {signal_date.isoformat()}")
    log_event(
        "calc_delivery_signals_started",
        {
            "mode": mode,
            "companies": len(company_ids),
            "date": signal_date.isoformat(),
            "force": "--force" in sys.argv,
        },
    )

    price_by_company = _fetch_latest_price_snapshots_batch(company_ids)
    print(f"Loaded latest price_data snapshots for {len(price_by_company)} companies.")
    _delivery_signal_extension_columns_enabled()

    ok = 0
    skipped_no_delivery = 0
    failures = 0
    payloads_map: dict[str, dict[str, Any]] = {}

    total = len(company_ids)
    for i, cid in enumerate(company_ids, start=1):
        try:
            del_rows = _fetch_delivery_rows(cid, signal_date)
            latest_delivery = _fetch_latest_delivery_snapshot(cid)
            price_rows = _fetch_price_rows(cid, signal_date)
            payload = _build_payload(
                cid,
                signal_date,
                del_rows,
                price_rows,
                price_by_company.get(cid),
                latest_delivery,
            )
            if not payload:
                skipped_no_delivery += 1
                continue
            payloads_map[cid] = payload
            res = upsert(SIGNAL_TABLE, _payload_for_upsert(payload), "company_id,date")
            if res is not None:
                ok += 1
            else:
                failures += 1
            if i % 50 == 0 or i == total:
                print(f"  Progress: {i}/{total} processed (upsert ok so far={ok})")
        except Exception as exc:
            failures += 1
            print(f"  WARN company_id={cid}: {exc}")

    print()
    print("Summary:")
    print(f"  Companies in run: {total}")
    print(f"  Upserted: {ok}")
    print(f"  Skipped (no delivery rows in window): {skipped_no_delivery}")
    print(f"  Failed: {failures}")
    log_event(
        "calc_delivery_signals_finished",
        {
            "date": signal_date.isoformat(),
            "mode": mode,
            "companies_total": total,
            "upserted": ok,
            "skipped": skipped_no_delivery,
            "failures": failures,
        },
    )

    # ── Phase 2: SwingX entry/exit system ──────────────────────────────────────
    print("\nPhase 2: SwingX entry/exit system...")
    try:
        company_map   = _fetch_company_info()
        sector_health = get_sector_health(signal_date.isoformat())

        hc_map: dict[str, tuple[bool, dict[str, Any]]] = {}
        for cid in company_ids:
            price_snap   = price_by_company.get(cid, {})
            payload_snap = payloads_map.get(cid, {})
            # Merge vol_ratio from delivery payload — not in the price snapshot batch
            stock_data   = {**price_snap, "vol_ratio": payload_snap.get("vol_ratio")}
            is_hc, reasons = calc_high_conviction(
                stock_data, sector_health, company_map.get(cid, {})
            )
            hc_map[cid] = (is_hc, reasons)

        update_swingx_entries(
            signal_date.isoformat(), hc_map, price_by_company, company_map
        )

        # Get active SwingX ids → batch-update delivery_signals.high_conviction
        active_res = (
            supabase.table("swingx_entries")
            .select("company_id")
            .eq("is_active", True)
            .execute()
        )
        active_swingx_ids = {
            r["company_id"] for r in (getattr(active_res, "data", None) or [])
        }
        print(f"  Active SwingX entries: {len(active_swingx_ids)}")

        BATCH = 200
        true_ids  = [cid for cid in company_ids if cid     in active_swingx_ids]
        false_ids = [cid for cid in company_ids if cid not in active_swingx_ids]
        date_iso  = signal_date.isoformat()

        for i in range(0, len(true_ids), BATCH):
            chunk = true_ids[i : i + BATCH]
            supabase.table(SIGNAL_TABLE).update({"high_conviction": True}).eq("date", date_iso).in_("company_id", chunk).execute()
        for i in range(0, len(false_ids), BATCH):
            chunk = false_ids[i : i + BATCH]
            supabase.table(SIGNAL_TABLE).update({"high_conviction": False}).eq("date", date_iso).in_("company_id", chunk).execute()

        print(f"  delivery_signals.high_conviction: {len(true_ids)} true, {len(false_ids)} false")

        # Step 9: update price_data.high_conviction on is_latest rows
        for i in range(0, len(true_ids), BATCH):
            chunk = true_ids[i : i + BATCH]
            supabase.table(PRICE_TABLE).update({"high_conviction": True}).eq("is_latest", True).in_("company_id", chunk).execute()
        for i in range(0, len(false_ids), BATCH):
            chunk = false_ids[i : i + BATCH]
            supabase.table(PRICE_TABLE).update({"high_conviction": False}).eq("is_latest", True).in_("company_id", chunk).execute()
        print(f"  price_data.high_conviction: {len(true_ids)} true, {len(false_ids)} false")

    except Exception as exc:
        print(f"  Phase 2 SwingX error: {exc}")


if __name__ == "__main__":
    main()
