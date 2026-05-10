"""Realtime-ish results monitor (run every 15m in work hours on weekdays)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

from db import log_event, supabase
from fetch_indianapi import process_symbol

ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / ".results_monitor_state.json"
IST = timezone(timedelta(hours=5, minutes=30))
BSE_RESULTS_URL = os.environ.get(
    "BSE_RESULTS_API_URL",
    "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
    "?strCat=-1&strPrevDate=&strScrip=&strSearch=P&strToDate=&strType=C",
)
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
}


def _safe_log(event_type: str, meta: dict[str, Any]) -> None:
    try:
        log_event(event_type, meta)
    except Exception as exc:
        print(f"warning: log_event failed [{event_type}] -> {exc}")


def _is_business_window_ist(now_ist: datetime) -> bool:
    # Weekdays only, 09:00-19:00 IST
    if now_ist.weekday() >= 5:
        return False
    hhmm = now_ist.hour * 100 + now_ist.minute
    return 900 <= hhmm <= 1900


def _load_state() -> dict[str, str]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict[str, str]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def _fetch_results_announcements() -> list[dict[str, Any]]:
    res = requests.get(BSE_RESULTS_URL, headers=HEADERS, timeout=30)
    res.raise_for_status()
    payload = res.json()

    # Normalize to a list of dict rows.
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = None
        for key in ("Table", "table", "Data", "data", "results", "Result", "Items", "items"):
            if isinstance(payload.get(key), list):
                rows = payload[key]
                break
        if rows is None:
            rows = []
    else:
        rows = []
    return [r for r in rows if isinstance(r, dict)]


def _pick(d: dict[str, Any], candidates: list[str]) -> Any:
    key_map = {str(k).lower(): k for k in d.keys()}
    for c in candidates:
        if c in key_map:
            return d.get(key_map[c])
    for lk, rk in key_map.items():
        for c in candidates:
            if c in lk:
                return d.get(rk)
    return None


def _canonical_timestamp(row: dict[str, Any]) -> str:
    raw = _pick(
        row,
        [
            "dt_tm",
            "datetime",
            "announcedate",
            "announce_date",
            "newsdatetime",
            "date",
            "time",
        ],
    )
    txt = str(raw or "").strip()
    if not txt:
        return ""
    # Keep raw string as canonical marker if parse uncertain.
    return txt


def _is_results_category(row: dict[str, Any]) -> bool:
    blob = " ".join(
        str(_pick(row, [k]) or "")
        for k in ["categoryname", "category", "subject", "headline", "news", "subcategory"]
    ).lower()
    return "result" in blob


def _extract_bse_code(row: dict[str, Any]) -> str:
    raw = _pick(row, ["scrip_cd", "scripcode", "securitycode", "code", "sc_code"])
    txt = str(raw or "").strip()
    m = re.search(r"\d+", txt)
    return m.group(0) if m else txt


def _symbol_for_bse_code(bse_code: str) -> str | None:
    if not bse_code:
        return None
    res = (
        supabase.table("companies")
        .select("symbol")
        .eq("bse_code", bse_code)
        .limit(1)
        .execute()
    )
    data = getattr(res, "data", None) or []
    if not data:
        return None
    sym = str(data[0].get("symbol") or "").strip()
    return sym or None


def _queue_ai_for_symbol(symbol: str) -> None:
    # If generate_ai_content.py exists, call symbol-scoped run.
    script = ROOT / "generate_ai_content.py"
    if not script.exists():
        _safe_log("results_ai_queue_skipped", {"symbol": symbol, "reason": "generate_ai_content.py missing"})
        return
    try:
        subprocess.run(
            [sys.executable, str(script), "--symbol", symbol],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except Exception as exc:
        _safe_log("results_ai_queue_failed", {"symbol": symbol, "error": str(exc)})


def main() -> None:
    now_ist = datetime.now(IST)
    if not _is_business_window_ist(now_ist):
        print("results monitor skipped: outside 09:00-19:00 IST weekdays")
        _safe_log("results_monitor_skipped_window", {"now_ist": now_ist.isoformat()})
        return

    _safe_log("results_monitor_started", {"now_ist": now_ist.isoformat()})
    rows = _fetch_results_announcements()
    state = _load_state()
    new_events = 0

    for row in rows:
        if not _is_results_category(row):
            continue
        bse_code = _extract_bse_code(row)
        ts_marker = _canonical_timestamp(row)
        if not bse_code or not ts_marker:
            continue

        prev = state.get(bse_code)
        if prev == ts_marker:
            continue

        symbol = _symbol_for_bse_code(bse_code)
        if not symbol:
            # Track marker anyway to avoid repeated processing noise.
            state[bse_code] = ts_marker
            continue

        try:
            process_symbol(symbol)  # immediate per-symbol refresh
            _queue_ai_for_symbol(symbol)
            _safe_log(
                "results_filed",
                {
                    "symbol": symbol,
                    "bse_code": bse_code,
                    "filing_timestamp": ts_marker,
                },
            )
            new_events += 1
            state[bse_code] = ts_marker
        except Exception as exc:
            _safe_log(
                "results_monitor_symbol_failed",
                {"symbol": symbol, "bse_code": bse_code, "error": str(exc)},
            )

    _save_state(state)
    print(f"results monitor complete, new filings handled={new_events}")
    _safe_log("results_monitor_finished", {"new_filings_handled": new_events})


if __name__ == "__main__":
    main()

