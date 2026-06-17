"""Daily orchestrator for market data + swing + AI delta generation."""

from __future__ import annotations

import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from db import log_event

ROOT = Path(__file__).resolve().parent


def _run_step(label: str, script: str, args: list[str] | None = None) -> dict[str, Any]:
    script_path = ROOT / script
    started = time.time()
    if not script_path.exists():
        msg = f"{script} not found"
        print(f"[daily] {label} skipped: {msg}")
        return {
            "label": label,
            "script": script,
            "ok": False,
            "skipped": True,
            "error": msg,
            "elapsed_sec": 0.0,
            "symbols_processed": 0,
        }

    cmd = [sys.executable, str(script_path)] + (args or [])
    print(f"[daily] running {label}: {' '.join(cmd)}")
    proc = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    elapsed = round(time.time() - started, 2)
    out = (proc.stdout or "") + "\n" + (proc.stderr or "")

    # Best-effort extraction for "symbols processed" metric.
    symbols_processed = 0
    m = re.search(r"processed(?:_symbols)?\s*=\s*(\d+)", out, flags=re.I)
    if m:
        symbols_processed = int(m.group(1))
    else:
        # fallback: count progress lines like [x/total]
        hits = re.findall(r"\[(\d+)\/(\d+)\]", out)
        if hits:
            symbols_processed = max(int(x[0]) for x in hits)

    ok = proc.returncode == 0
    if ok:
        print(f"[daily] {label} ok ({elapsed}s)")
    else:
        print(f"[daily] {label} failed rc={proc.returncode} ({elapsed}s)")
        if proc.stderr:
            print(proc.stderr.strip()[:1200])

    return {
        "label": label,
        "script": script,
        "ok": ok,
        "skipped": False,
        "returncode": proc.returncode,
        "elapsed_sec": elapsed,
        "symbols_processed": symbols_processed,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
    }


def main() -> None:
    run_started = datetime.utcnow().isoformat()
    print(f"[daily] start {run_started}")
    log_event("run_daily_started", {"start_time": run_started})

    steps = [
        ("bhav_daily", "fetch_bhav_daily.py", []),
        # calc_market_internals — MUST run immediately after bhav so
        # the breadth / stage / nifty rows it writes are fresh for
        # every downstream step that reads market_internals
        # (calc_divergences, calc_market_context, telegram broadcast).
        # Previously this step lived only in .github/workflows/daily.yml
        # (step 4/7), meaning a direct invocation of run_daily.py would
        # skip it and downstream consumers would read yesterday's row.
        # Adding it here makes run_daily.py self-contained; if the
        # workflow still invokes calc_market_internals.py separately,
        # the SECOND call is a same-day no-op (existing row gets
        # upserted in place with the same data).
        ("market_internals", "calc_market_internals.py", []),
        # Historical Conditions — nightly snapshot pass. Adds one row
        # per company for the trading date that just aged out of the
        # 90-day forward-window cutoff (i.e. today − 90 trading days).
        # That date's price_data row + its forward window now exist
        # (the bhav step above wrote today's data, which is row #90
        # after that snapshot date), so build_pattern_snapshots can
        # compute the forward returns + 30-day event flags and upsert.
        #
        # --nightly mode skips dates already in pattern_snapshots, so
        # re-runs are no-ops. The per-company vol_ratio backfill pass
        # runs but finds nothing to update once the one-time
        # --backfill has been completed across history; the cost is
        # an in-memory rolling-average walk (~0.5s per company).
        #
        # Whole step is typically ~30 min for a fully-backfilled
        # universe of ~2000 stocks. A future smarter impl could check
        # only the 90-day-old date directly; for now the simple loop
        # is fine.
        ("pattern_snapshots_nightly", "backtest/build_pattern_snapshots.py", ["--nightly"]),
        ("indianapi", "fetch_indianapi.py", []),
        # IQjet · extended yfinance fundamentals — populates
        # key_metrics' cashflow + balance-sheet columns
        # (operating_cashflow / free_cashflow / total_debt / receivables
        # / inventory / goodwill / total_assets) so the /iqjet-desk
        # Stock Lookup card reads them from Supabase. Runs AFTER
        # indianapi so the key_metrics rows already exist for upsert
        # to merge into. ~15-20 min for the full universe at the
        # default 0.3s sleep.
        ("fundamentals_extended", "iqjet/fetch_stock_fundamentals_extended.py", []),
        ("delivery_signals", "calc_delivery_signals.py", ["--full"]),
        ("swing_conditions", "calc_swing_conditions.py", []),
        # IQjet · Pillar 1 — compute today's divergences from the
        # market_internals row that the upstream pipeline has just
        # refreshed. Writes one row to divergence_signals (keyed on
        # date) which both the /iqjet web card and the IQjet Telegram
        # post then consume. Cheap (~1s, two Supabase queries).
        #
        # ORDER — runs BEFORE market_context per the pipeline spec
        # so divergence_signals is fresh by the time market_context
        # builds the "today in context" comparison row.
        ("iqjet_divergences", "iqjet/calc_divergences.py", []),
        # daily_market_context — pre-bakes the "Today in Market
        # Context" row the homepage TodayVsHistory section reads.
        # Pulls market_internals history, finds similar past days
        # (breadth / stage2 / VIX bucket), buckets the 10-trading-day
        # Nifty forwards, and upserts one row keyed on today's date.
        # Runs AFTER iqjet_divergences so any context surface that
        # joins on today's divergence row sees fresh values.
        ("market_context", "calc_market_context.py", []),
        ("ai_daily", "generate_ai_content.py", ["--daily-only"]),
        ("telegram_channel", "telegram_broadcast.py", ["channel"]),
        # IQjet daily Telegram post — runs AFTER the existing daily
        # pulse goes out so the two messages stack in the channel:
        # PineX pulse first, IQjet observation second. Skipped silently
        # if no divergence_signals row exists for today.
        ("iqjet_telegram", "iqjet/post_iqjet_telegram.py", []),
        # Per-user Morning Brief cards. Runs after telegram so the
        # market summary / sector picks / swing_conditions used by
        # the brief generator reflect today's pipeline outputs.
        ("morning_briefs", "generate_morning_briefs.py", []),
        # Nightly classification confirmation pass — reads
        # user_classifications WHERE confirmed_at IS NULL, evaluates
        # against fresh swing_conditions, writes was_correct +
        # days_to_confirmation, and inserts pending_wow_moments rows
        # for the frontend to celebrate on the user's next visit.
        ("check_classifications", "check_classifications.py", []),
        # Per-user Telegram DMs — reads today's morning_briefs rows,
        # DMs each user with telegram_chat_id set IF their watchlist
        # had a criteria-score change. Silent on quiet days. Must
        # run AFTER morning_briefs so the brief rows exist.
        ("telegram_watchlist_alerts", "send_telegram_watchlist_alerts.py", []),
        ("sheets_tracker", "sheets_signal_tracker.py", []),
        # Self-healing pass — repairs is_latest = true on the
        # most-recent price_data row per company and refreshes
        # mv_home_stocks. Runs LAST so it cleans up anything
        # earlier in the pipeline left half-finished. Idempotent;
        # ~2 sec when nothing's broken.
        ("repair_is_latest", "repair_is_latest_and_refresh_view.py", []),
    ]

    results: list[dict[str, Any]] = []
    started = time.time()
    for label, script, args in steps:
        results.append(_run_step(label, script, args))

    end_time = datetime.utcnow().isoformat()
    elapsed = round(time.time() - started, 2)
    errors = [r for r in results if not r["ok"] and not r.get("skipped")]
    total_symbols = sum(int(r.get("symbols_processed") or 0) for r in results)

    summary = {
        "start_time": run_started,
        "end_time": end_time,
        "elapsed_sec": elapsed,
        "errors_count": len(errors),
        "errors": [{"label": e["label"], "returncode": e.get("returncode")} for e in errors],
        "symbols_processed": total_symbols,
        "steps": [
            {
                "label": r["label"],
                "ok": r["ok"],
                "skipped": r["skipped"],
                "elapsed_sec": r["elapsed_sec"],
                "symbols_processed": r["symbols_processed"],
            }
            for r in results
        ],
    }

    print(f"[daily] end {end_time} elapsed={elapsed}s errors={len(errors)}")
    log_event("run_daily_finished", summary)

    # Non-zero if any real step failed.
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

