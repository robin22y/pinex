"""
sheets_signal_tracker.py — Daily SwingX signal logger to Google Sheets.

Run AFTER calc_delivery_signals.py and calc_swing_conditions.py.

Env vars (in scripts/.env):
  SHEETS_SPREADSHEET_ID      — Google Sheet ID from the URL
  SHEETS_SERVICE_ACCOUNT     — path to service account JSON
                               (default: scripts/service_account.json)
  SUPABASE_URL               — already in scripts/.env
  SUPABASE_SERVICE_KEY       — already in scripts/.env

One-time Google setup:
  1. Create a Service Account in Google Cloud → APIs & Services → Credentials
  2. Enable Google Sheets API + Google Drive API for the project
  3. Download the JSON key → save as scripts/service_account.json
  4. Share your Google Sheet with the service account email (Editor access)
  5. Copy the Sheet ID from the URL into SHEETS_SPREADSHEET_ID

Usage:
  python scripts/sheets_signal_tracker.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

# Load .env before importing db
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    print("ERROR: Missing dependencies. Run: pip install gspread google-auth")
    sys.exit(1)

from db import supabase

# ── Config ────────────────────────────────────────────────────────────────────

SPREADSHEET_ID = os.environ.get("SHEETS_SPREADSHEET_ID", "")
SA_FILE        = os.environ.get(
    "SHEETS_SERVICE_ACCOUNT",
    str(Path(__file__).resolve().parent / "service_account.json"),
)
TOP_N          = 10
BELOW_THRESHOLD = 2   # consecutive closes below exit MA to trigger exit
COOLOFF_DAYS   = 5    # trading days before a symbol can re-enter after exit

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── Column indices (0-based) ──────────────────────────────────────────────────
# Any change here must also update the matching _*_header() function.

# SwingX Log
SX_DATE, SX_SYMBOL, SX_COMPANY, SX_SECTOR, SX_TYPE  =  0,  1,  2,  3,  4
SX_ENTRY, SX_MA50, SX_MA150, SX_CONDS, SX_RS        =  5,  6,  7,  8,  9
SX_STAGE                                             = 10
SX_R5,  SX_R10,  SX_R20,  SX_R60,  SX_R90           = 11, 12, 13, 14, 15
SX_A5,  SX_A10,  SX_A20,  SX_A60,  SX_A90           = 16, 17, 18, 19, 20
SX_STATUS, SX_EXIT_DATE, SX_EXIT_PX, SX_EXIT_RET     = 21, 22, 23, 24
SX_EXIT_REASON, SX_NOTES                             = 25, 26
SX_BELOW_CTR, SX_COOLOFF                             = 27, 28   # internal state
SX_WIDTH                                             = 29

# Weak Stocks Log
WK_DATE, WK_SYMBOL, WK_COMPANY, WK_SECTOR, WK_STAGE =  0,  1,  2,  3,  4
WK_CLOSE, WK_MA150, WK_PCT_BELOW, WK_OBV, WK_RS     =  5,  6,  7,  8,  9
WK_STATUS, WK_VINDICATED, WK_WRONG_CALL, WK_NOTES   = 10, 11, 12, 13
WK_ABOVE_CTR                                        = 14   # internal state
WK_WIDTH                                            = 15

# Exits
EX_DATE, EX_SYMBOL, EX_TYPE, EX_ENTRY_DATE          =  0,  1,  2,  3
EX_ENTRY_PX, EX_EXIT_PX, EX_REASON                  =  4,  5,  6
EX_RETURN, EX_ALPHA, EX_HOLD_DAYS                   =  7,  8,  9
EX_WIDTH                                            = 10

# ── Google Sheets helpers ─────────────────────────────────────────────────────

def _sheets_client():
    if not Path(SA_FILE).exists():
        raise FileNotFoundError(
            f"Service account file not found: {SA_FILE}\n"
            "See module docstring for setup instructions."
        )
    creds = Credentials.from_service_account_file(SA_FILE, scopes=GOOGLE_SCOPES)
    return gspread.authorize(creds)

def _a1(row: int, col: int) -> str:
    """1-based row + col → A1 notation (e.g. row=2, col=3 → 'C2')."""
    col_str = ""
    c = col
    while c > 0:
        c, rem = divmod(c - 1, 26)
        col_str = chr(ord("A") + rem) + col_str
    return f"{col_str}{row}"

def _batch_set(ws: gspread.Worksheet, updates: list[tuple[int, int, Any]]) -> None:
    """Batch-update cells. Each item: (1-based row, 1-based col, value)."""
    if not updates:
        return
    ws.batch_update(
        [{"range": _a1(r, c), "values": [[v]]} for r, c, v in updates],
        value_input_option="USER_ENTERED",
    )

# ── Sheet initialisation ──────────────────────────────────────────────────────

def _swingx_header() -> list[str]:
    return [
        "Date", "Symbol", "Company", "Sector", "Signal Type",
        "Entry Price", "MA50", "MA150", "Conditions Met", "RS vs Nifty", "Stage",
        "5D %", "10D %", "20D %", "60D % (■)", "90D % (■)",
        "5D Alpha", "10D Alpha", "20D Alpha", "60D Alpha (■)", "90D Alpha (■)",
        "Status", "Exit Date", "Exit Price", "Exit Return %", "Exit Reason", "Notes",
        "_below_ctr", "_cooloff_until",
    ]

def _weak_header() -> list[str]:
    return [
        "Date", "Symbol", "Company", "Sector", "Stage",
        "Close", "MA150", "% Below MA150", "OBV Trend", "RS vs Nifty",
        "Status", "Vindicated Date", "Wrong Call Date", "Notes",
        "_above_ctr",
    ]

def _exits_header() -> list[str]:
    return [
        "Exit Date", "Symbol", "Signal Type", "Entry Date", "Entry Price",
        "Exit Price", "Exit Reason", "Return %", "Alpha vs Nifty", "Hold Days",
    ]

def setup_spreadsheet(gc: gspread.Client) -> gspread.Spreadsheet:
    if not SPREADSHEET_ID:
        raise ValueError("SHEETS_SPREADSHEET_ID not set in scripts/.env")
    sh = gc.open_by_key(SPREADSHEET_ID)
    existing = {ws.title for ws in sh.worksheets()}
    for title, rows in [
        ("SwingX Log", 2000), ("Weak Stocks Log", 1000),
        ("Dashboard", 50),    ("Exits", 1000),
    ]:
        if title not in existing:
            sh.add_worksheet(title=title, rows=rows, cols=32)
            print(f"  Created tab: {title}")
    for title, header_fn in [
        ("SwingX Log",      _swingx_header),
        ("Weak Stocks Log", _weak_header),
        ("Exits",           _exits_header),
    ]:
        ws = sh.worksheet(title)
        if not ws.row_values(1):
            ws.insert_row(header_fn(), 1)
            print(f"  Added header to: {title}")
    return sh

# ── Supabase data helpers ─────────────────────────────────────────────────────

def _f(v: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default

def _r(v: Any, d: int = 2) -> Any:
    n = _f(v)
    return round(n, d) if n is not None else ""

def _trading_days_between(d1: str, d2: str) -> int:
    """Weekday-count only (no NSE holiday calendar — close enough for 5/10/20/60/90d windows)."""
    a, b = date.fromisoformat(d1), date.fromisoformat(d2)
    if b <= a:
        return 0
    n, cur = 0, a + timedelta(days=1)
    while cur <= b:
        if cur.weekday() < 5:
            n += 1
        cur += timedelta(days=1)
    return n

def _add_trading_days(start: str, n: int) -> str:
    d = date.fromisoformat(start)
    added = 0
    while added < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d.isoformat()

def fetch_price_on(symbol: str, target: str) -> Optional[float]:
    """Closest close on or before target date."""
    res = (
        supabase.table("price_data")
        .select("close")
        .eq("symbol", symbol)
        .lte("date", target)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _f(rows[0]["close"]) if rows else None

def fetch_nifty_on(target: str) -> Optional[float]:
    res = (
        supabase.table("market_internals")
        .select("nifty_close")
        .lte("date", target)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _f(rows[0]["nifty_close"]) if rows else None

def fetch_latest_prices(symbols: list[str]) -> dict[str, dict]:
    """Batch-fetch current price_data rows for all symbols."""
    if not symbols:
        return {}
    res = (
        supabase.table("price_data")
        .select("symbol,close,ma50,ma150,date")
        .in_("symbol", symbols)
        .eq("is_latest", True)
        .execute()
    )
    return {r["symbol"]: r for r in (res.data or [])}

# ── Today's signals ───────────────────────────────────────────────────────────

def fetch_swingx_today(today: str) -> list[dict]:
    """Top N SwingX signals for today, enriched with price + company data."""
    # swing_conditions uses 'date' column (frontend-confirmed)
    sc_res = (
        supabase.table("swing_conditions")
        .select("symbol,conditions_met,breakout_52w,condition_stage2")
        .eq("date", today)
        .gte("conditions_met", 3)
        .order("conditions_met", desc=True)
        .limit(TOP_N * 3)
        .execute()
    )
    sc_rows = sc_res.data or []
    if not sc_rows:
        # Fall back to most recent available date (script may run before calc)
        fallback = (
            supabase.table("swing_conditions")
            .select("date")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if fallback.data:
            latest = fallback.data[0]["date"]
            if latest != today:
                print(f"  Warning: no swing_conditions for {today}, using {latest}")
                sc_res = (
                    supabase.table("swing_conditions")
                    .select("symbol,conditions_met,breakout_52w,condition_stage2")
                    .eq("date", latest)
                    .gte("conditions_met", 3)
                    .order("conditions_met", desc=True)
                    .limit(TOP_N * 3)
                    .execute()
                )
                sc_rows = sc_res.data or []

    if not sc_rows:
        return []

    symbols = [r["symbol"] for r in sc_rows]

    price_res = (
        supabase.table("price_data")
        .select("symbol,close,ma50,ma150,stage,rs_vs_nifty")
        .in_("symbol", symbols)
        .eq("is_latest", True)
        .execute()
    )
    price_map = {r["symbol"]: r for r in (price_res.data or [])}

    co_res = (
        supabase.table("companies")
        .select("symbol,name,sector")
        .in_("symbol", symbols)
        .execute()
    )
    co_map = {r["symbol"]: r for r in (co_res.data or [])}

    out = []
    for sc in sc_rows:
        sym  = sc["symbol"]
        p    = price_map.get(sym, {})
        co   = co_map.get(sym, {})
        if not p.get("close"):
            continue
        # LongTerm = all 5 conditions met OR near 52W breakout
        signal_type = "LongTerm" if (sc.get("breakout_52w") or sc.get("conditions_met", 0) >= 5) else "Swing"
        out.append({
            "date":        today,
            "symbol":      sym,
            "company":     co.get("name", ""),
            "sector":      co.get("sector", ""),
            "signal_type": signal_type,
            "entry_price": _r(p.get("close"), 2),
            "ma50":        _r(p.get("ma50"),  2),
            "ma150":       _r(p.get("ma150"), 2),
            "conditions":  sc.get("conditions_met", 0),
            "rs":          _r(p.get("rs_vs_nifty"), 1),
            "stage":       p.get("stage", ""),
        })
        if len(out) >= TOP_N:
            break
    return out

def fetch_weak_today(today: str) -> list[dict]:
    """Top N weak stocks: Stage 3/4, below MA150, OBV falling."""
    res = (
        supabase.table("price_data")
        .select("symbol,close,ma150,stage,rs_vs_nifty,obv_slope")
        .in_("stage", ["Stage 3", "Stage 4"])
        .eq("is_latest", True)
        .execute()
    )
    candidates = []
    for r in (res.data or []):
        close = _f(r.get("close"))
        ma150 = _f(r.get("ma150"))
        if not close or not ma150 or ma150 == 0:
            continue
        pct_below = (close - ma150) / ma150 * 100
        if pct_below >= 0:
            continue
        obv = _f(r.get("obv_slope"), 0)
        if (obv or 0) >= -0.02:   # only include falling OBV
            continue
        candidates.append({**r, "_pct_below": pct_below})

    candidates.sort(key=lambda x: x["_pct_below"])  # most bearish first

    syms = [c["symbol"] for c in candidates[:TOP_N * 2]]
    co_map = {}
    if syms:
        co_res = (
            supabase.table("companies")
            .select("symbol,name,sector")
            .in_("symbol", syms)
            .execute()
        )
        co_map = {r["symbol"]: r for r in (co_res.data or [])}

    out = []
    for c in candidates:
        sym = c["symbol"]
        co  = co_map.get(sym, {})
        out.append({
            "date":      today,
            "symbol":    sym,
            "company":   co.get("name", ""),
            "sector":    co.get("sector", ""),
            "stage":     c.get("stage", ""),
            "close":     _r(c.get("close"), 2),
            "ma150":     _r(c.get("ma150"), 2),
            "pct_below": round(c["_pct_below"], 1),
            "obv":       "falling",
            "rs":        _r(c.get("rs_vs_nifty"), 1),
        })
        if len(out) >= TOP_N:
            break
    return out

# ── Append new rows ───────────────────────────────────────────────────────────

def append_swingx(ws: gspread.Worksheet, signals: list[dict], existing: set) -> None:
    new_rows = []
    for s in signals:
        if (s["date"], s["symbol"]) in existing:
            continue
        row = [""] * SX_WIDTH
        row[SX_DATE]      = s["date"]
        row[SX_SYMBOL]    = s["symbol"]
        row[SX_COMPANY]   = s["company"]
        row[SX_SECTOR]    = s["sector"]
        row[SX_TYPE]      = s["signal_type"]
        row[SX_ENTRY]     = s["entry_price"]
        row[SX_MA50]      = s["ma50"]
        row[SX_MA150]     = s["ma150"]
        row[SX_CONDS]     = s["conditions"]
        row[SX_RS]        = s["rs"]
        row[SX_STAGE]     = s["stage"]
        row[SX_R60]       = "■"   # not ready for ~3 months
        row[SX_R90]       = "■"
        row[SX_A60]       = "■"
        row[SX_A90]       = "■"
        row[SX_STATUS]    = "open"
        row[SX_BELOW_CTR] = 0
        row[SX_COOLOFF]   = ""
        new_rows.append(row)

    if new_rows:
        ws.append_rows(new_rows, value_input_option="USER_ENTERED")
        print(f"  SwingX Log: +{len(new_rows)} new signals")
    else:
        print("  SwingX Log: no new signals today (already logged or none found)")

def append_weak(ws: gspread.Worksheet, signals: list[dict], existing: set) -> None:
    new_rows = []
    for s in signals:
        if (s["date"], s["symbol"]) in existing:
            continue
        row = [""] * WK_WIDTH
        row[WK_DATE]      = s["date"]
        row[WK_SYMBOL]    = s["symbol"]
        row[WK_COMPANY]   = s["company"]
        row[WK_SECTOR]    = s["sector"]
        row[WK_STAGE]     = s["stage"]
        row[WK_CLOSE]     = s["close"]
        row[WK_MA150]     = s["ma150"]
        row[WK_PCT_BELOW] = s["pct_below"]
        row[WK_OBV]       = s["obv"]
        row[WK_RS]        = s["rs"]
        row[WK_STATUS]    = "pending"
        row[WK_ABOVE_CTR] = 0
        new_rows.append(row)

    if new_rows:
        ws.append_rows(new_rows, value_input_option="USER_ENTERED")
        print(f"  Weak Stocks Log: +{len(new_rows)} new entries")
    else:
        print("  Weak Stocks Log: no new entries today")

# ── Update open SwingX positions (exits + performance) ────────────────────────

def update_swingx_positions(
    ws: gspread.Worksheet,
    ex_ws: gspread.Worksheet,
    today: str,
) -> None:
    all_rows = ws.get_all_values()
    if len(all_rows) <= 1:
        return

    open_rows = [
        (i + 2, row)                                    # i+2 = 1-based sheet row
        for i, row in enumerate(all_rows[1:])
        if len(row) > SX_STATUS and row[SX_STATUS] == "open"
    ]
    if not open_rows:
        print("  SwingX Log: no open positions to update")
        return

    # Batch-fetch current prices for all open symbols
    open_syms  = list({row[SX_SYMBOL] for _, row in open_rows if len(row) > SX_SYMBOL})
    price_now  = fetch_latest_prices(open_syms)
    nifty_today = fetch_nifty_on(today)

    updates: list[tuple[int, int, Any]] = []
    exit_append: list[list] = []

    PERF = [
        (5,  SX_R5,  SX_A5),
        (10, SX_R10, SX_A10),
        (20, SX_R20, SX_A20),
        (60, SX_R60, SX_A60),
        (90, SX_R90, SX_A90),
    ]

    for sheet_row, row in open_rows:
        sym         = row[SX_SYMBOL]       if len(row) > SX_SYMBOL    else ""
        entry_date  = row[SX_DATE]         if len(row) > SX_DATE      else ""
        signal_type = row[SX_TYPE]         if len(row) > SX_TYPE      else "Swing"
        entry_price = _f(row[SX_ENTRY]     if len(row) > SX_ENTRY     else "")
        below_ctr   = int(_f(row[SX_BELOW_CTR] if len(row) > SX_BELOW_CTR else "0") or 0)
        cooloff     = row[SX_COOLOFF]      if len(row) > SX_COOLOFF   else ""

        if not sym or not entry_date or not entry_price:
            continue
        if cooloff and today <= cooloff:
            continue

        p = price_now.get(sym, {})
        close_now = _f(p.get("close"))
        if not close_now:
            continue

        trade_days = _trading_days_between(entry_date, today)

        # ── Performance columns ───────────────────────────────────────────────
        for days, ret_col, alpha_col in PERF:
            if trade_days < days:
                continue
            current_val = row[ret_col] if len(row) > ret_col else ""
            if current_val not in ("", "■", None):
                continue  # already filled
            target_date = _add_trading_days(entry_date, days)
            px = fetch_price_on(sym, target_date)
            if px and entry_price:
                ret = round((px - entry_price) / entry_price * 100, 2)
                updates.append((sheet_row, ret_col + 1, ret))
                n_entry  = fetch_nifty_on(entry_date)
                n_target = fetch_nifty_on(target_date)
                if n_entry and n_target:
                    n_ret  = round((n_target - n_entry) / n_entry * 100, 2)
                    updates.append((sheet_row, alpha_col + 1, round(ret - n_ret, 2)))

        # ── Exit check ────────────────────────────────────────────────────────
        # Swing exits on 2 consecutive closes below MA50
        # LongTerm exits on 2 consecutive closes below MA150
        exit_ma_key = "ma50" if signal_type == "Swing" else "ma150"
        exit_ma     = _f(p.get(exit_ma_key))
        exit_label  = "MA50" if signal_type == "Swing" else "MA150"

        if exit_ma and close_now < exit_ma:
            below_ctr += 1
        else:
            below_ctr = 0  # reset counter if price recovers
        updates.append((sheet_row, SX_BELOW_CTR + 1, below_ctr))

        if below_ctr >= BELOW_THRESHOLD:
            exit_ret   = round((close_now - entry_price) / entry_price * 100, 2)
            reason     = f"below_{exit_label.lower()}_{BELOW_THRESHOLD}d"
            cooloff_dt = _add_trading_days(today, COOLOFF_DAYS)

            updates += [
                (sheet_row, SX_STATUS + 1,      "closed"),
                (sheet_row, SX_EXIT_DATE + 1,   today),
                (sheet_row, SX_EXIT_PX + 1,     close_now),
                (sheet_row, SX_EXIT_RET + 1,    exit_ret),
                (sheet_row, SX_EXIT_REASON + 1, reason),
                (sheet_row, SX_BELOW_CTR + 1,   0),
                (sheet_row, SX_COOLOFF + 1,     cooloff_dt),
            ]

            alpha_exit = ""
            if nifty_today:
                n_entry = fetch_nifty_on(entry_date)
                if n_entry:
                    n_ret      = round((nifty_today - n_entry) / n_entry * 100, 2)
                    alpha_exit = round(exit_ret - n_ret, 2)

            hold_days = _trading_days_between(entry_date, today)
            exit_append.append([
                today, sym, signal_type, entry_date, entry_price,
                close_now, reason, exit_ret, alpha_exit, hold_days,
            ])
            print(f"  EXIT: {sym} ({signal_type}) — {reason}  ret={exit_ret:+.1f}%")

    _batch_set(ws, updates)
    if exit_append:
        ex_ws.append_rows(exit_append, value_input_option="USER_ENTERED")
        print(f"  Exits: logged {len(exit_append)} closed position(s)")

    print(f"  SwingX Log: updated {len(open_rows)} open position(s)")

# ── Update Weak Stock positions (vindication check) ───────────────────────────

def update_weak_positions(ws: gspread.Worksheet, today: str) -> None:
    all_rows = ws.get_all_values()
    if len(all_rows) <= 1:
        return

    pending = [
        (i + 2, row)
        for i, row in enumerate(all_rows[1:])
        if len(row) > WK_STATUS and row[WK_STATUS] == "pending"
    ]
    if not pending:
        return

    syms      = list({row[WK_SYMBOL] for _, row in pending if len(row) > WK_SYMBOL})
    price_now = fetch_latest_prices(syms)
    updates: list[tuple[int, int, Any]] = []

    for sheet_row, row in pending:
        sym       = row[WK_SYMBOL]   if len(row) > WK_SYMBOL   else ""
        above_ctr = int(_f(row[WK_ABOVE_CTR] if len(row) > WK_ABOVE_CTR else "0") or 0)
        if not sym:
            continue

        p     = price_now.get(sym, {})
        close = _f(p.get("close"))
        ma150 = _f(p.get("ma150"))
        if not close or not ma150:
            continue

        if close > ma150:
            above_ctr += 1
        else:
            above_ctr = 0
        updates.append((sheet_row, WK_ABOVE_CTR + 1, above_ctr))

        if above_ctr >= BELOW_THRESHOLD:
            # Price recovered above MA150 for 2 consecutive days → wrong call
            updates += [
                (sheet_row, WK_STATUS + 1,     "wrong_call"),
                (sheet_row, WK_WRONG_CALL + 1, today),
                (sheet_row, WK_ABOVE_CTR + 1,  0),
            ]
            print(f"  WEAK WRONG CALL: {sym} closed above MA150 for {BELOW_THRESHOLD} days")

    _batch_set(ws, updates)
    if pending:
        print(f"  Weak Stocks Log: checked {len(pending)} pending entries")

# ── Dashboard ─────────────────────────────────────────────────────────────────

def update_dashboard(sh: gspread.Spreadsheet, today: str) -> None:
    dash = sh.worksheet("Dashboard")
    sx   = sh.worksheet("SwingX Log").get_all_values()[1:]
    ex   = sh.worksheet("Exits").get_all_values()[1:]
    wk   = sh.worksheet("Weak Stocks Log").get_all_values()[1:]

    total_logged = len(sx)
    open_cnt     = sum(1 for r in sx if len(r) > SX_STATUS and r[SX_STATUS] == "open")
    closed_cnt   = len(ex)

    exit_rets = [_f(r[EX_RETURN]) for r in ex if len(r) > EX_RETURN and _f(r[EX_RETURN]) is not None]
    win_rate  = (
        f"{round(sum(1 for r in exit_rets if r > 0) / len(exit_rets) * 100, 1)}%"
        if exit_rets else "—"
    )
    avg_gain  = f"{round(sum(exit_rets) / len(exit_rets), 2)}%" if exit_rets else "—"

    alphas    = [_f(r[EX_ALPHA]) for r in ex if len(r) > EX_ALPHA and _f(r[EX_ALPHA]) is not None]
    avg_alpha = f"{round(sum(alphas) / len(alphas), 2)}%" if alphas else "—"

    rets_20d  = [_f(r[SX_R20]) for r in sx if len(r) > SX_R20 and r[SX_R20] not in ("", "■", None) and _f(r[SX_R20]) is not None]
    win_20d   = (
        f"{round(sum(1 for r in rets_20d if r > 0) / len(rets_20d) * 100, 1)}%"
        if rets_20d else "—"
    )

    swing_total  = sum(1 for r in sx if len(r) > SX_TYPE and r[SX_TYPE] == "Swing")
    lt_total     = sum(1 for r in sx if len(r) > SX_TYPE and r[SX_TYPE] == "LongTerm")

    weak_pending   = sum(1 for r in wk if len(r) > WK_STATUS and r[WK_STATUS] == "pending")
    weak_wrongcall = sum(1 for r in wk if len(r) > WK_STATUS and r[WK_STATUS] == "wrong_call")

    rows = [
        ["StockIQ — SwingX Signal Tracker", ""],
        ["Last updated", today],
        ["", ""],
        ["── SwingX Log ──────────────────────────", ""],
        ["Total signals logged",  total_logged],
        ["  → Swing",             swing_total],
        ["  → LongTerm",          lt_total],
        ["Currently open",        open_cnt],
        ["Exited positions",      closed_cnt],
        ["", ""],
        ["── Performance (closed positions) ─────", ""],
        ["Win rate (exits)",      win_rate],
        ["Avg gain (exits)",      avg_gain],
        ["Avg alpha vs Nifty",    avg_alpha],
        ["20D win rate",          win_20d],
        ["", ""],
        ["── Weak Stocks Log ─────────────────────", ""],
        ["Total logged",          len(wk)],
        ["Currently pending",     weak_pending],
        ["Wrong calls (recovered above MA150)", weak_wrongcall],
        ["", ""],
        ["── Notes ───────────────────────────────", ""],
        ["60D/90D columns", "Fill automatically after 3–4.5 months of data"],
        ["Exit rule (Swing)",    f"2 consecutive closes below MA50 → exit"],
        ["Exit rule (LongTerm)", f"2 consecutive closes below MA150 → exit"],
        ["Re-entry cooloff",     f"{COOLOFF_DAYS} trading days after exit"],
        ["Internal columns", "_below_ctr and _cooloff_until are state trackers — do not edit"],
    ]

    dash.clear()
    dash.update("A1", rows)
    print("  Dashboard updated")

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    today = date.today().isoformat()
    print(f"sheets_signal_tracker.py — {today}")

    if not SPREADSHEET_ID:
        print("ERROR: SHEETS_SPREADSHEET_ID not set in scripts/.env")
        sys.exit(1)

    print("Connecting to Google Sheets...")
    gc = _sheets_client()
    sh = setup_spreadsheet(gc)

    sx_ws = sh.worksheet("SwingX Log")
    wk_ws = sh.worksheet("Weak Stocks Log")
    ex_ws = sh.worksheet("Exits")

    # Read existing keys to guard against duplicates
    sx_all  = sx_ws.get_all_values()
    sx_keys = {
        (r[SX_DATE], r[SX_SYMBOL])
        for r in sx_all[1:]
        if len(r) > SX_SYMBOL
    }
    wk_all  = wk_ws.get_all_values()
    wk_keys = {
        (r[WK_DATE], r[WK_SYMBOL])
        for r in wk_all[1:]
        if len(r) > WK_SYMBOL
    }

    # 1. Update existing open positions (perf columns + exit checks)
    print("Updating open SwingX positions...")
    update_swingx_positions(sx_ws, ex_ws, today)

    print("Updating Weak Stocks statuses...")
    update_weak_positions(wk_ws, today)

    # 2. Append today's new signals
    print("Fetching today's SwingX signals from Supabase...")
    swingx = fetch_swingx_today(today)
    print(f"  Found {len(swingx)} signals")
    append_swingx(sx_ws, swingx, sx_keys)

    print("Fetching today's weak stocks from Supabase...")
    weak = fetch_weak_today(today)
    print(f"  Found {len(weak)} weak stocks")
    append_weak(wk_ws, weak, wk_keys)

    # 3. Refresh dashboard stats
    print("Updating Dashboard...")
    update_dashboard(sh, today)

    print(f"Done ✅  signals={len(swingx)}  weak={len(weak)}")


if __name__ == "__main__":
    main()
