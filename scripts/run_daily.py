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
        ("indianapi", "fetch_indianapi.py", []),
        ("delivery_signals", "calc_delivery_signals.py", ["--full"]),
        ("swing_conditions", "calc_swing_conditions.py", []),
        ("ai_daily", "generate_ai_content.py", ["--daily-only"]),
        ("telegram_channel", "telegram_broadcast.py", ["channel"]),
        ("sheets_tracker", "sheets_signal_tracker.py", []),
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

