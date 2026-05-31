"""Reclassify the cached `stage` for stocks already in price_data,
WITHOUT refetching from yfinance.

Use this any time the `classify_stage_weinstein` rules change — the
classifier is pure given the per-row inputs we already stored, so we
can re-run it in seconds against every company instead of waiting
for the next daily price_data refresh.

Usage:
  python scripts/reclassify_stages.py              # all symbols
  python scripts/reclassify_stages.py AMARAJABAT   # just one
  python scripts/reclassify_stages.py --dry        # report changes,
                                                   # don't write

Behaviour:
  - Only updates rows where `is_latest = TRUE` (one row per company).
  - Skips companies with an active `stage_override` (manual overrides
    win — same as the daily pipeline).
  - Prints a one-line summary per stock that changed, e.g.
        AMARAJABAT  Stage 3  →  Stage 1
  - At the end prints totals: scanned / changed / overridden / errors.
"""
from __future__ import annotations
import sys
from datetime import datetime, timezone

from db import supabase
from fetch_price_data import classify_stage_weinstein


def _to_float(v):
    try:
        return float(v) if v is not None else None
    except (ValueError, TypeError):
        return None


def reclassify_one(company: dict, dry_run: bool) -> str:
    """Recompute stage for one company. Returns a status string."""
    company_id = company["id"]
    symbol = company.get("symbol") or company_id

    # Active override? Skip — manual override wins.
    override = company.get("stage_override")
    expires = company.get("stage_override_expires_at")
    if override and expires:
        if isinstance(expires, str):
            exp = datetime.fromisoformat(expires.replace("Z", "+00:00"))
        else:
            exp = expires
        if datetime.now(timezone.utc) < exp:
            return "OVERRIDE"

    # Pull the latest row's inputs.
    q = (
        supabase.table("price_data")
        .select(
            "id, date, close, ma30w, ma30w_slope, obv_slope, "
            "rs_vs_nifty, high_52w, low_52w, stage"
        )
        .eq("company_id", company_id)
        .eq("is_latest", True)
        .limit(1)
        .execute()
    )
    rows = getattr(q, "data", None) or []
    if not rows:
        return "NO_LATEST_ROW"
    row = rows[0]

    # Also pull the close from ~63 trading days ago (≈3 months) and
    # volume history for vol_ratio_2w, so the classifier sees the
    # same inputs the daily pipeline does. We fall back to None if
    # the history is short — classifier handles that case.
    close_3m_ago = None
    vol_ratio_2w = None
    try:
        latest_date = row["date"]
        hist = (
            supabase.table("price_data")
            .select("date, close, volume")
            .eq("company_id", company_id)
            .lte("date", latest_date)
            .order("date", desc=True)
            .limit(63)
            .execute()
        )
        hist_rows = getattr(hist, "data", None) or []
        if len(hist_rows) >= 63:
            close_3m_ago = _to_float(hist_rows[62]["close"])
        vols = [_to_float(r.get("volume")) for r in hist_rows]
        vols = [v for v in vols if v is not None and v > 0]
        if len(vols) >= 50:
            vol_10d = sum(vols[:10]) / 10
            vol_50d = sum(vols[:50]) / 50
            if vol_50d > 0:
                vol_ratio_2w = round(vol_10d / vol_50d, 3)
    except Exception:
        pass  # best-effort — classifier handles missing inputs

    new_stage = classify_stage_weinstein(
        close=_to_float(row["close"]),
        ma30w=_to_float(row["ma30w"]),
        ma30w_slope=_to_float(row["ma30w_slope"]) or 0.0,
        obv_slope=_to_float(row["obv_slope"]),
        rs_vs_nifty=_to_float(row["rs_vs_nifty"]),
        high_52w=_to_float(row["high_52w"]),
        low_52w=_to_float(row["low_52w"]),
        close_3m_ago=close_3m_ago,
        vol_ratio_2w=vol_ratio_2w,
    )

    old_stage = row.get("stage") or "—"
    if new_stage == old_stage:
        return "UNCHANGED"

    print(f"  {symbol:<14}  {old_stage:<10}  ->  {new_stage}")

    if not dry_run:
        supabase.table("price_data").update(
            {"stage": new_stage, "updated_at": datetime.utcnow().isoformat()}
        ).eq("id", row["id"]).execute()

    return "CHANGED"


def main(argv):
    dry_run = "--dry" in argv
    args = [a for a in argv if not a.startswith("--")]
    symbol_filter = args[0].upper() if args else None

    # Pull the companies list. If a single symbol was passed, filter.
    q = supabase.table("companies").select(
        "id, symbol, stage_override, stage_override_expires_at"
    )
    if symbol_filter:
        q = q.eq("symbol", symbol_filter)
    res = q.execute()
    companies = getattr(res, "data", None) or []

    if not companies:
        print("No companies found.")
        return 1

    if dry_run:
        print(f"[DRY RUN] scanning {len(companies)} companies — no writes\n")
    else:
        print(f"Reclassifying {len(companies)} companies...\n")

    counts = {"CHANGED": 0, "UNCHANGED": 0, "OVERRIDE": 0,
              "NO_LATEST_ROW": 0, "ERROR": 0}
    for c in companies:
        try:
            result = reclassify_one(c, dry_run)
            counts[result] = counts.get(result, 0) + 1
        except Exception as exc:
            counts["ERROR"] += 1
            print(f"  ! {c.get('symbol')} ERROR: {exc}")

    print(
        f"\nDone. "
        f"changed={counts['CHANGED']} "
        f"unchanged={counts['UNCHANGED']} "
        f"override={counts['OVERRIDE']} "
        f"no_latest={counts['NO_LATEST_ROW']} "
        f"errors={counts['ERROR']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
