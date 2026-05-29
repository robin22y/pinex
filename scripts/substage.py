"""
substage.py — Refine Weinstein Stage 2 A/B substage classification.

Run AFTER fetch_bhav_daily.py and calc_delivery_signals.py.

Classification uses two independent criteria:

  2A  = within 15% of 30W MA  AND  < 8 consecutive Stage 2 weeks (~39 sessions)
  2B  = beyond 15% of 30W MA   OR  >= 8 consecutive Stage 2 weeks

  +  suffix: vol_ratio >= 1.2 AND rs_vs_nifty >= 5
  -  suffix: otherwise

weeks_in_stage2 is also written to delivery_signals so the frontend can
display it (requires a `weeks_in_stage2 integer` column in that table). The
column is now in ACTUAL WEEKS (rounded from sessions / 5) so the StockDetail
"Week N of uptrend" label reads correctly — it previously stored sessions,
which made "Week 39" actually mean ~7.5 weeks.

Usage:
  python scripts/substage.py              # full run
  python scripts/substage.py --test       # first 10 Stage 2 companies
  python scripts/substage.py --dry-run    # compute + print, no writes
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from db import log_event, supabase

# ── Thresholds ─────────────────────────────────────────────────────────────────
PCT_THRESHOLD   = 15.0   # % above 30W MA → 2B
WEEKS_THRESHOLD = 8      # consecutive Stage-2 weeks → 2B regardless of distance
                         # (was 39 in old session-count units; 39 sessions ≈ 8 weeks)
SESSIONS_PER_WEEK = 5    # NSE trades Mon-Fri; used to convert session count → weeks
VOL_RATIO_MIN   = 1.2    # vol_ratio >= this → vol_ok for '+' suffix
RS_MIN          = 5.0    # rs_vs_nifty >= this → rs_ok for '+' suffix

DRY_RUN = "--dry-run" in sys.argv
TEST    = "--test"    in sys.argv

# ── Helpers ────────────────────────────────────────────────────────────────────

def _f(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def count_consecutive_stage2(company_id: str) -> int:
    """
    Count consecutive price_data rows with stage='Stage 2', newest-first.
    Returns the streak length (0 if the most recent row is not Stage 2).
    """
    res = (
        supabase.table("price_data")
        .select("date, stage")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(60)
        .execute()
    )
    count = 0
    for r in (res.data or []):
        if r.get("stage") == "Stage 2":
            count += 1
        else:
            break  # stop at first non-Stage-2 row
    return count


def classify_substage(
    pct_from_30w: Optional[float],
    weeks_in_s2: int,
    vol_ratio: Optional[float],
    rs_vs_nifty: Optional[float],
) -> str:
    """Return substage string: '2A+', '2A-', '2B+', or '2B-'."""
    # A vs B — time-extended overrides price-distance
    if weeks_in_s2 >= WEEKS_THRESHOLD:
        ab = "2B"   # Extended by time
    elif pct_from_30w is not None and pct_from_30w > PCT_THRESHOLD:
        ab = "2B"   # Extended by price
    else:
        ab = "2A"   # Early / healthy move

    # + vs -
    vol_ok = (vol_ratio is not None) and (float(vol_ratio) >= VOL_RATIO_MIN)
    rs_ok  = (rs_vs_nifty is not None) and (float(rs_vs_nifty) >= RS_MIN)
    suffix = "+" if (vol_ok and rs_ok) else "-"

    return ab + suffix


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    today = date.today().isoformat()
    mode_tag = " [DRY RUN]" if DRY_RUN else (" [TEST]" if TEST else "")
    print(f"substage.py — {today}{mode_tag}")

    # ── Fetch all Stage 2 companies ─────────────────────────────────────────
    print("Fetching Stage 2 companies from price_data...")
    res = (
        supabase.table("price_data")
        .select("company_id, close, ma30w, rs_vs_nifty, weinstein_substage")
        .eq("is_latest", True)
        .eq("stage", "Stage 2")
        .execute()
    )
    stage2_rows = res.data or []

    if TEST:
        stage2_rows = stage2_rows[:10]

    print(f"  {len(stage2_rows)} Stage 2 companies")

    # ── Fetch delivery_signals for vol_ratio + pct_from_30w ────────────────
    latest_sig_res = (
        supabase.table("delivery_signals")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    sig_date = (latest_sig_res.data or [{}])[0].get("date", today)

    ds_res = (
        supabase.table("delivery_signals")
        .select("company_id, vol_ratio, pct_from_30w")
        .eq("date", sig_date)
        .execute()
    )
    ds_map: dict[str, dict] = {r["company_id"]: r for r in (ds_res.data or [])}
    print(f"  Loaded delivery_signals for {len(ds_map)} companies (date={sig_date})")

    # ── Classify ────────────────────────────────────────────────────────────
    price_upsert_rows: list[dict]  = []
    signal_update_rows: list[dict] = []
    changed = 0

    for i, row in enumerate(stage2_rows, start=1):
        cid   = row["company_id"]
        close = _f(row.get("close"))
        ma30w = _f(row.get("ma30w"))
        rs    = _f(row.get("rs_vs_nifty"))

        ds          = ds_map.get(cid, {})
        vol_ratio   = _f(ds.get("vol_ratio"))
        # Prefer delivery_signals pct (computed from delivery history), else compute inline
        pct_from_30w = (
            _f(ds.get("pct_from_30w"))
            if ds.get("pct_from_30w") is not None
            else ((close - ma30w) / ma30w * 100 if (close and ma30w and ma30w > 0) else None)
        )

        # count_consecutive_stage2 returns SESSIONS — convert to weeks so the
        # column actually matches its name (and the StockDetail label).
        sessions_in_s2 = count_consecutive_stage2(cid)
        weeks_in_s2 = round(sessions_in_s2 / SESSIONS_PER_WEEK)
        new_sub     = classify_substage(pct_from_30w, weeks_in_s2, vol_ratio, rs)
        old_sub     = row.get("weinstein_substage", "")

        price_upsert_rows.append({
            "company_id":        cid,
            "weinstein_substage": new_sub,
        })
        signal_update_rows.append({
            "company_id":    cid,
            "weeks_in_stage2": weeks_in_s2,
        })

        if new_sub != old_sub:
            changed += 1

        if TEST or (new_sub != old_sub):
            pct_str = f"{pct_from_30w:+.1f}%" if pct_from_30w is not None else "—"
            print(
                f"  [{i}/{len(stage2_rows)}] {cid}: "
                f"{old_sub or '?'} → {new_sub}  "
                f"(wks={weeks_in_s2}, pct={pct_str})"
            )

    print(f"\nResults: {changed}/{len(stage2_rows)} substages changed")

    if DRY_RUN:
        print("DRY RUN — no writes performed")
        return

    # ── Update price_data.weinstein_substage ────────────────────────────────
    print("\nUpdating price_data.weinstein_substage...")
    ok_p = fail_p = 0
    for u in price_upsert_rows:
        try:
            (
                supabase.table("price_data")
                .update({"weinstein_substage": u["weinstein_substage"]})
                .eq("company_id", u["company_id"])
                .eq("is_latest", True)
                .execute()
            )
            ok_p += 1
        except Exception as e:
            fail_p += 1
            print(f"  price_data update failed ({u['company_id']}): {e}")
    print(f"  price_data: {ok_p} updated, {fail_p} failed")

    # ── Update delivery_signals.weeks_in_stage2 ─────────────────────────────
    # Requires a `weeks_in_stage2 integer` column in delivery_signals.
    # Add it via Supabase dashboard or: ALTER TABLE delivery_signals ADD COLUMN weeks_in_stage2 integer;
    print("\nUpdating delivery_signals.weeks_in_stage2...")
    ok_s = fail_s = skip_s = 0
    for u in signal_update_rows:
        try:
            (
                supabase.table("delivery_signals")
                .update({"weeks_in_stage2": u["weeks_in_stage2"]})
                .eq("company_id", u["company_id"])
                .eq("date", sig_date)
                .execute()
            )
            ok_s += 1
        except Exception as e:
            err = str(e)
            if "column" in err.lower() and "does not exist" in err.lower():
                if skip_s == 0:
                    print(
                        "  Note: weeks_in_stage2 column missing in delivery_signals.\n"
                        "  Run: ALTER TABLE delivery_signals ADD COLUMN weeks_in_stage2 integer;\n"
                        "  in Supabase SQL Editor, then re-run this script."
                    )
                skip_s += 1
            else:
                fail_s += 1
                print(f"  delivery_signals update failed ({u['company_id']}): {e}")
    print(f"  delivery_signals: {ok_s} updated, {fail_s} failed, {skip_s} skipped (missing column)")

    log_event("substage_updated", {
        "date":             today,
        "stage2_companies": len(stage2_rows),
        "substages_changed": changed,
        "dry_run":          DRY_RUN,
    })

    print("\nDone ✅")


if __name__ == "__main__":
    main()
