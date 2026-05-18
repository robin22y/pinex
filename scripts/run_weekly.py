"""Weekly orchestrator (Saturday) for deep refresh + daily pipeline."""

from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from db import log_event

ROOT = Path(__file__).resolve().parent


def _run(label: str, script: str, args: list[str] | None = None) -> dict[str, Any]:
    path = ROOT / script
    if not path.exists():
        print(f"[weekly] {label} skipped: missing {script}")
        return {"label": label, "ok": False, "skipped": True, "script": script, "elapsed_sec": 0.0}

    cmd = [sys.executable, str(path)] + (args or [])
    start = time.time()
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    elapsed = round(time.time() - start, 2)
    ok = proc.returncode == 0
    if ok:
        print(f"[weekly] {label} ok ({elapsed}s)")
    else:
        print(f"[weekly] {label} failed rc={proc.returncode} ({elapsed}s)")
        if proc.stderr:
            print(proc.stderr.strip()[:1200])
    return {
        "label": label,
        "ok": ok,
        "skipped": False,
        "returncode": proc.returncode,
        "script": script,
        "elapsed_sec": elapsed,
    }


def main() -> None:
    started_iso = datetime.utcnow().isoformat()
    log_event("run_weekly_started", {"start_time": started_iso})
    print(f"[weekly] start {started_iso}")

    steps = [
        ("detect_changes", "detect_changes.py", []),
        ("classify_sectors_new", "classify_sectors_gemini.py", ["--new-only"]),
        ("update_sectors", "update_sectors.py", []),
        ("shareholding_all_tiers", "fetch_indianapi.py", ["--shareholding-only", "--all-tiers"]),
        ("ai_full", "generate_ai_content.py", ["--full"]),
        ("daily_pipeline", "run_daily.py", []),
    ]

    results: list[dict[str, Any]] = []
    start = time.time()
    for label, script, args in steps:
        results.append(_run(label, script, args))

    elapsed = round(time.time() - start, 2)
    ended_iso = datetime.utcnow().isoformat()
    errors = [r for r in results if not r["ok"] and not r.get("skipped")]
    summary = {
        "start_time": started_iso,
        "end_time": ended_iso,
        "elapsed_sec": elapsed,
        "errors_count": len(errors),
        "errors": [{"label": e["label"], "returncode": e.get("returncode")} for e in errors],
        "steps": results,
    }
    print(f"[weekly] end {ended_iso} elapsed={elapsed}s errors={len(errors)}")
    log_event("run_weekly_finished", summary)
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

