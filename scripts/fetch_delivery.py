"""Fetch NSE delivery percentages and persist daily delivery_data rows."""

from __future__ import annotations

import csv
import io
import sys
import time
import zipfile
from datetime import datetime
from typing import Any

import requests

from db import log_event, upsert, supabase
from symbols import ALL_SYMBOLS

DELIVERY_TABLE = "delivery_data"
REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0"}
TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]


def _normalize(value: Any) -> str:
    return str(value or "").strip().upper()


def _today_ddmmyyyy() -> str:
    return datetime.now().strftime("%d%m%Y")


def _parse_float(value: Any) -> float | None:
    txt = str(value or "").replace(",", "").strip()
    if not txt:
        return None
    try:
        return float(txt)
    except ValueError:
        return None


def _rows_from_csv_text(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    parsed: list[dict[str, str]] = []
    for row in reader:
        parsed.append({str(k).strip().upper(): str(v).strip() for k, v in row.items()})
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
            raise ValueError("No CSV file found inside fallback bhav zip")
        with zf.open(csv_members[0]) as fh:
            return fh.read().decode("utf-8", errors="replace")


def download_bhav_rows(date_code: str) -> tuple[list[dict[str, str]], str]:
    primary_err = None
    try:
        text = _download_primary(date_code)
        return _rows_from_csv_text(text), "primary"
    except Exception as e:
        primary_err = str(e)
        log_event(
            "delivery_download_failed_primary",
            {"date": date_code, "error": primary_err},
        )
        print(f"Primary bhav download failed ({date_code}): {primary_err}")

    try:
        text = _download_fallback_zip_csv(date_code)
        return _rows_from_csv_text(text), "fallback_zip"
    except Exception as e:
        fallback_err = str(e)
        log_event(
            "delivery_download_failed_fallback",
            {"date": date_code, "error": fallback_err, "primary_error": primary_err},
        )
        raise RuntimeError(
            f"Both bhav download paths failed. primary={primary_err}; fallback={fallback_err}",
        ) from e


def _extract_delivery_map(rows: list[dict[str, str]]) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for row in rows:
        symbol = _normalize(row.get("SYMBOL"))
        deliv_qty = _parse_float(row.get("DELIV_QTY"))
        ttl_qty = _parse_float(row.get("TTL_TRD_QNTY"))
        if not symbol or deliv_qty is None or ttl_qty in (None, 0):
            continue
        result[symbol] = {
            "deliv_qty": deliv_qty,
            "ttl_trd_qnty": ttl_qty,
            "delivery_pct": (deliv_qty / ttl_qty) * 100.0,
        }
    return result


def _fetch_last_30_delivery(symbol: str) -> list[float]:
    company_id = None
    upsert(
        "companies",
        {
            "symbol": symbol,
            "name": symbol,
            "tier": 1,
        },
        "symbol",
    )
    q = supabase.table("companies").select("id").eq("symbol", symbol).limit(1).execute()
    data = getattr(q, "data", None) or []
    if data:
        company_id = data[0].get("id") or None
    if not company_id:
        return []

    try:
        res = (
            supabase.table(DELIVERY_TABLE)
            .select("delivery_pct")
            .eq("company_id", company_id)
            .order("date", desc=True)
            .limit(30)
            .execute()
        )
    except Exception as e:
        print(f"[{symbol}] failed to fetch 30d delivery history: {e}")
        return []

    data = getattr(res, "data", None) or []
    vals: list[float] = []
    for row in data:
        v = _parse_float(row.get("delivery_pct"))
        if v is not None:
            vals.append(v)
    return vals


def process_delivery_for_date(date_code: str) -> list[str]:
    started = time.time()
    rows, source = download_bhav_rows(date_code)
    delivery_map = _extract_delivery_map(rows)
    tracked_symbols = set(TEST_SYMBOLS if TEST_MODE else ALL_SYMBOLS)

    unusual_symbols: list[str] = []
    upsert_rows = 0
    considered = 0

    trading_date = datetime.strptime(date_code, "%d%m%Y").date().isoformat()

    for symbol in tracked_symbols:
        row = delivery_map.get(symbol)
        if row is None:
            continue
        company_id = None
        upsert(
            "companies",
            {
                "symbol": symbol,
                "name": symbol,
                "tier": 1,
            },
            "symbol",
        )
        q = supabase.table("companies").select("id").eq("symbol", symbol).limit(1).execute()
        data = getattr(q, "data", None) or []
        if data:
            company_id = data[0].get("id") or None
        if not company_id:
            print(f"[{symbol}] failed to resolve company_id")
            continue
        considered += 1
        today_pct = row["delivery_pct"]

        history = _fetch_last_30_delivery(symbol)
        avg_30d = (sum(history) / len(history)) if history else None
        vs_30d_avg = (today_pct / avg_30d) if avg_30d not in (None, 0) else None

        is_unusual = False
        if vs_30d_avg is not None:
            is_unusual = vs_30d_avg > 1.8 or vs_30d_avg < 0.5

        payload = {
            "company_id": company_id,
            "date": trading_date,
            "delivery_pct": today_pct,
            "total_volume": row["ttl_trd_qnty"],
            "delivery_volume": row["deliv_qty"],
            "deliv_qty": row["deliv_qty"],
            "avg_30d": avg_30d,
            "vs_30d_avg": vs_30d_avg,
            "is_unusual": is_unusual,
            "updated_at": datetime.utcnow().isoformat(),
        }
        res = upsert(DELIVERY_TABLE, payload, "company_id,date")
        if res is not None:
            upsert_rows += 1
        if is_unusual:
            unusual_symbols.append(symbol)

    elapsed = round(time.time() - started, 2)
    print(
        f"delivery done date={date_code} source={source} considered={considered} "
        f"upserted={upsert_rows} unusual={len(unusual_symbols)} elapsed={elapsed}s",
    )
    log_event(
        "delivery_fetch_completed",
        {
            "date": date_code,
            "source": source,
            "symbols_considered": considered,
            "rows_upserted": upsert_rows,
            "unusual_count": len(unusual_symbols),
            "elapsed_sec": elapsed,
        },
    )
    return unusual_symbols


def main() -> None:
    date_code = _today_ddmmyyyy()
    log_event("delivery_fetch_started", {"date": date_code, "test_mode": TEST_MODE})
    if TEST_MODE:
        print("TEST MODE enabled: processing symbols SYRMA, APTUS, TEJASNET")
    unusual = process_delivery_for_date(date_code)
    print("unusual symbols:", unusual)


if __name__ == "__main__":
    main()
