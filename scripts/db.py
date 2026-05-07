"""Shared Supabase client for maintenance scripts."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from dotenv import load_dotenv
from supabase import Client, create_client

_SCRIPT_DIR = Path(__file__).resolve().parent
load_dotenv(_SCRIPT_DIR / ".env")

_url = os.environ.get("SUPABASE_URL")
_service_key = os.environ.get("SUPABASE_SERVICE_KEY")

if not _url or not _service_key:
    raise ValueError(
        "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in scripts/.env",
    )

supabase: Client = create_client(_url, _service_key)


def _symbol_from_row(row: Mapping[str, Any]) -> str:
    return str(
        row.get("symbol")
        or row.get("ticker")
        or row.get("company_id")
        or "?",
    )


def _extract_symbol(data: Any) -> str:
    if isinstance(data, Mapping):
        return _symbol_from_row(data)
    if isinstance(data, Sequence) and not isinstance(data, (str, bytes)):
        if len(data) == 0:
            return "?"
        first = data[0]
        if isinstance(first, Mapping):
            return _symbol_from_row(first)
    return "?"


def upsert(
    table: str,
    data: Any,
    on_conflict_column: str | None,
) -> Any | None:
    """
    Upsert a row or list of rows. On failure, prints table + symbol and returns None.
    """
    sym = _extract_symbol(data)
    try:
        if on_conflict_column:
            return (
                supabase.table(table)
                .upsert(data, on_conflict=on_conflict_column)
                .execute()
            )
        return supabase.table(table).upsert(data).execute()
    except Exception as e:
        print(f"upsert error [{table}] symbol={sym}: {e}")
        return None


def bulk_upsert(
    table: str,
    rows: Iterable[Mapping[str, Any]],
    on_conflict_column: str | None,
) -> int:
    """
    Upsert rows in batches of 50. Returns row count processed in successful batches.
    """
    rows_list = list(rows)
    success_count = 0
    batch_size = 50

    for i in range(0, len(rows_list), batch_size):
        batch = rows_list[i : i + batch_size]
        res = upsert(table, batch, on_conflict_column)
        if res is not None:
            success_count += len(batch)

    return success_count


def log_event(
    event_type: str,
    metadata: Mapping[str, Any] | None = None,
    *,
    user_id: str | None = None,
    company_id: str | None = None,
) -> None:
    """
    Insert a row into usage_events for API cost / script run tracking.

    Never raise: logging must not break main scripts.
    Columns expected:
      event_type (text)
      user_id (uuid, nullable)
      company_id (uuid, nullable)
      metadata (jsonb)
      created_at (timestamptz)
    """
    payload: dict[str, Any] = {
        "event_type": event_type,
        "user_id": user_id,
        "company_id": company_id,
        "metadata": dict(metadata or {}),
        "created_at": __import__("datetime").datetime.utcnow().isoformat(),
    }
    try:
        res = supabase.table("usage_events").insert(payload).execute()
        err = getattr(res, "error", None)
        if err:
            print(f"log_event error [{event_type}]: {err}")
    except Exception as e:
        print(f"log_event error [{event_type}]: {e}")