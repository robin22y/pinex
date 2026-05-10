"""Fetch NSE delivery percentages for recent trading days into delivery_data."""

from __future__ import annotations

import csv
import io
import sys
import zipfile
from datetime import date, datetime, timedelta
from typing import Any

import requests

from db import get_active_symbols, log_event, supabase, upsert
from nse_holidays import NSE_HOLIDAYS_2026
from symbols import ALL_SYMBOLS

DELIVERY_TABLE = "delivery_data"
REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0"}
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]
TEST_MODE = "--test" in sys.argv


def get_yf_ticker(symbol: str) -> str:
    """Get correct yfinance ticker for symbol."""
    try:
        res = (
            supabase.table("companies")
            .select("exchange, bse_code, yf_symbol")
            .eq("symbol", symbol)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if rows:
            row = rows[0]
            ys = row.get("yf_symbol")
            if ys is not None and str(ys).strip():
                return str(ys).strip()
            exchange = str(row.get("exchange") or "").strip().upper()
            bc_raw = row.get("bse_code")
            bc = str(bc_raw).strip() if bc_raw not in (None, "") else None
            if exchange == "BSE" and bc:
                return f"{bc}.BO"
            if exchange == "BOTH" and bc:
                return f"{symbol}.NS"
        return f"{symbol}.NS"
    except Exception:
        return f"{symbol}.NS"


def get_exchange(symbol: str) -> str:
    """Return companies.exchange normalized to upper-case; default NSE."""
    try:
        res = (
            supabase.table("companies")
            .select("exchange")
            .eq("symbol", symbol)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if rows:
            raw = rows[0].get("exchange")
            if raw is not None and str(raw).strip():
                return str(raw).strip().upper()
    except Exception:
        pass
    return "NSE"


def _skip_reason_for_daily_update() -> str | None:
    if TEST_MODE:
        return None
    if "--force" in sys.argv:
        print("FORCE MODE — skipping market closed check")
        return None
    today = date.today()
    if today.weekday() >= 5:
        return "Market closed — skipping daily update"
    if today.isoformat() in NSE_HOLIDAYS_2026:
        return "NSE holiday — skipping daily update"
    return None


def _normalize(value: Any) -> str:
    return str(value or "").strip().upper()


def _parse_float(value: Any) -> float | None:
    txt = str(value or "").replace(",", "").strip()
    if not txt:
        return None
    try:
        return float(txt)
    except ValueError:
        return None


def _parse_days_arg(default_days: int = 30) -> int:
    if "--days" not in sys.argv:
        return default_days
    idx = sys.argv.index("--days")
    if idx + 1 >= len(sys.argv):
        raise ValueError("--days requires a value, e.g. --days 30")
    raw = sys.argv[idx + 1]
    try:
        days = int(raw)
    except ValueError as exc:
        raise ValueError(f"Invalid --days value: {raw}") from exc
    if days <= 0:
        raise ValueError("--days must be > 0")
    return days


def _recent_weekdays(days_count: int) -> list[date]:
    out: list[date] = []
    cursor = datetime.now().date()
    while len(out) < days_count:
        if cursor.weekday() < 5:  # 0=Mon ... 4=Fri
            out.append(cursor)
        cursor -= timedelta(days=1)
    out.reverse()  # oldest -> newest for rolling averages
    return out


def _rows_from_csv_text(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    parsed: list[dict[str, str]] = []
    for row in reader:
        normalized: dict[str, str] = {}
        for k, v in row.items():
            key = str(k or "").strip().upper()
            normalized[key] = str(v or "").strip()
        parsed.append(normalized)
    return parsed


def _download_primary(date_code: str) -> str:
    url = f"https://archives.nseindia.com/products/content/sec_bhavdata_full_{date_code}.csv"
    res = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
    res.raise_for_status()
    return res.text


def _download_fallback_zip_csv(date_code: str) -> str:
    url = f"https://archives.nseindia.com/content/equities/bhav_{date_code}.zip"
    res = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
    res.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        csv_members = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_members:
            raise ValueError("No CSV found in fallback zip")
        with zf.open(csv_members[0]) as fh:
            return fh.read().decode("utf-8", errors="replace")


def download_bhav_rows(date_code: str) -> tuple[list[dict[str, str]], str]:
    try:
        text = _download_primary(date_code)
        return _rows_from_csv_text(text), "primary"
    except Exception as primary_err:
        log_event("delivery_download_failed_primary", {"date": date_code, "error": str(primary_err)})

    text = _download_fallback_zip_csv(date_code)
    return _rows_from_csv_text(text), "fallback_zip"


def _extract_delivery_map(rows: list[dict[str, str]]) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for row in rows:
        symbol = _normalize(row.get("SYMBOL"))
        deliv_qty = _parse_float(row.get("DELIV_QTY"))
        ttl_qty = _parse_float(row.get("TTL_TRD_QNTY"))
        close_price = _parse_float(row.get("CLOSE_PRICE"))
        if not symbol or deliv_qty is None or ttl_qty in (None, 0):
            continue
        result[symbol] = {
            "deliv_qty": deliv_qty,
            "ttl_trd_qnty": ttl_qty,
            "close_price": close_price if close_price is not None else 0.0,
            "delivery_pct": (deliv_qty / ttl_qty) * 100.0,
        }
    return result


def _load_company_id_map(symbols: list[str]) -> dict[str, str]:
    if not symbols:
        return {}
    try:
        res = (
            supabase.table("companies")
            .select("id,symbol")
            .in_("symbol", symbols)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        return {_normalize(r.get("symbol")): r.get("id") for r in rows if r.get("id") and r.get("symbol")}
    except Exception as exc:
        print(f"warning: failed company lookup for symbols: {exc}")
        return {}


def _format_vs(vs_30d_avg: float | None) -> str:
    if vs_30d_avg is None:
        return "NA"
    return f"{vs_30d_avg:.2f}x"


def process_dates(days: int, symbols: list[str]) -> None:
    trading_days = _recent_weekdays(days)
    symbol_set = {_normalize(s) for s in symbols}
    company_id_by_symbol = _load_company_id_map(list(symbol_set))
    rolling_history: dict[str, list[float]] = {s: [] for s in symbol_set}
    exchange_by_symbol: dict[str, str] = {s: get_exchange(s) for s in symbol_set}

    for d in trading_days:
        date_code = d.strftime("%d%m%Y")
        trading_date = d.isoformat()
        try:
            rows, source = download_bhav_rows(date_code)
        except Exception as exc:
            print(f"[{trading_date}] warning: bhav copy unavailable, skipping date ({exc})")
            log_event("delivery_date_skipped", {"date": trading_date, "error": str(exc)})
            continue

        delivery_map = _extract_delivery_map(rows)
        found_count = 0

        for symbol in sorted(symbol_set):
            if exchange_by_symbol.get(symbol) == "BSE":
                print(f"[{symbol}] BSE-only — skipping NSE delivery data")
                continue
            row = delivery_map.get(symbol)
            if row is None:
                print(f"[{trading_date}] warning: {symbol} not found in bhav copy")
                continue

            company_id = company_id_by_symbol.get(symbol)
            if not company_id:
                print(f"[{trading_date}] warning: company_id missing for {symbol}, skipping")
                continue

            found_count += 1
            today_pct = row["delivery_pct"]
            history = rolling_history[symbol]
            avg_30d = (sum(history) / len(history)) if history else None
            vs_30d_avg = (today_pct / avg_30d) if avg_30d not in (None, 0) else None
            is_unusual = bool(vs_30d_avg is not None and (vs_30d_avg > 1.8 or vs_30d_avg < 0.5))

            payload = {
                "company_id": company_id,
                "date": trading_date,
                "delivery_pct": today_pct,
                "total_volume": row["ttl_trd_qnty"],
                "delivery_volume": row["deliv_qty"],
                "deliv_qty": row["deliv_qty"],
                "close_price": row["close_price"],
                "avg_30d": avg_30d,
                "vs_30d_avg": vs_30d_avg,
                "is_unusual": is_unusual,
                "updated_at": datetime.utcnow().isoformat(),
            }
            upsert(DELIVERY_TABLE, payload, "company_id,date")
            history.append(today_pct)
            if len(history) > 30:
                history.pop(0)

            print(f"[{symbol}] delivery_pct={today_pct:.1f}% vs_avg={_format_vs(vs_30d_avg)}")

        print(f"[{trading_date}] fetched {len(delivery_map)} symbols, {found_count} found in our list")
        log_event(
            "delivery_date_processed",
            {
                "date": trading_date,
                "source": source,
                "fetched_symbols": len(delivery_map),
                "found_in_list": found_count,
                "tracked_symbols": len(symbol_set),
            },
        )


def main() -> None:
    skip = _skip_reason_for_daily_update()
    if skip:
        print(skip)
        log_event(
            "delivery_fetch_skipped",
            {"reason": skip, "iso_date": date.today().isoformat()},
        )
        return

    days = _parse_days_arg(default_days=30)
    symbols = TEST_SYMBOLS if TEST_MODE else get_active_symbols(ALL_SYMBOLS)
    if TEST_MODE:
        days = 7
        print("TEST MODE enabled: symbols=SYRMA,APTUS,TEJASNET days=7")

    print(f"Starting delivery fetch for {days} trading days, symbols={len(symbols)}")
    log_event(
        "delivery_fetch_started",
        {
            "days": days,
            "test_mode": TEST_MODE,
            "symbols": len(symbols),
            "force": "--force" in sys.argv,
        },
    )
    process_dates(days=days, symbols=symbols)
    print("Delivery fetch completed.")


if __name__ == "__main__":
    main()

