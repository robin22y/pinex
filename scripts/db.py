"""Shared Supabase client for maintenance scripts."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from dotenv import load_dotenv
from supabase import Client, create_client

_SCRIPT_DIR = Path(__file__).resolve().parent
load_dotenv(_SCRIPT_DIR / ".env")

_url = (
    os.environ.get("SUPABASE_URL")
    # Fallback: same URL with the Vite frontend prefix. The two
    # env vars hold identical values; we accept either so Railway
    # users who only set the VITE_ name (because that's what the
    # frontend uses) don't have to duplicate it for the bot.
    or os.environ.get("VITE_SUPABASE_URL")
)
_service_key = os.environ.get("SUPABASE_SERVICE_KEY")

if not _url or not _service_key:
    # Diagnostic: print which Supabase-related keys ARE present (just
    # the names, never the values) plus the lengths of what we got
    # for the two we needed. Makes the difference between "variable
    # not present" / "variable present but empty" / "wrong name" /
    # "leading whitespace in name" visible in the log instead of
    # forcing a Railway-vs-local guessing game.
    import sys as _sys
    _supa_keys = sorted([k for k in os.environ if "SUPA" in k.upper()])
    print(
        f"[db.py] DIAGNOSTIC — env keys containing 'SUPA': {_supa_keys}",
        file=_sys.stderr, flush=True,
    )
    print(
        f"[db.py] DIAGNOSTIC — SUPABASE_URL length: "
        f"{len(_url or '')} (None={_url is None})",
        file=_sys.stderr, flush=True,
    )
    print(
        f"[db.py] DIAGNOSTIC — SUPABASE_SERVICE_KEY length: "
        f"{len(_service_key or '')} (None={_service_key is None})",
        file=_sys.stderr, flush=True,
    )
    raise ValueError(
        "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in scripts/.env",
    )

supabase: Client = create_client(_url, _service_key)


def fetch_companies_paginated(
    select: str = "*",
    *,
    only_active: bool = True,
    order_by: str = "symbol",
    page_size: int = 1000,
) -> list[dict[str, Any]]:
    """Page through ``companies`` to bypass PostgREST's default 1000-row cap.

    PostgREST hard-caps each request at 1000 rows regardless of the Range header.
    page_size must be <= 1000 so that len(page) < page_size correctly signals the
    final page. A page_size > 1000 would break after the first 1000-row batch.
    """
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        try:
            query = supabase.table("companies").select(select)
            if only_active:
                query = query.or_("is_suspended.is.null,is_suspended.eq.false")
            res = query.order(order_by).range(start, start + page_size - 1).execute()
        except Exception as exc:
            print(f"fetch_companies_paginated error: {exc}")
            return rows
        page = getattr(res, "data", None) or []
        rows.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    return rows


def get_active_symbols(
    fallback: Sequence[str],
    *,
    tier_equal: int | None = None,
) -> list[str]:
    """Fetch symbols for companies where is_suspended is not true (null counts as active).

    Optionally restrict to ``companies.tier`` (e.g. ``tier_equal=1`` for Tier‑1-only jobs).
    """
    try:
        rows = fetch_companies_paginated("symbol,tier")
        symbols: list[str] = []
        seen: set[str] = set()
        for r in rows:
            if tier_equal is not None:
                try:
                    row_tier = int(r.get("tier") if r.get("tier") is not None else 0)
                except (TypeError, ValueError):
                    row_tier = 0
                if row_tier != tier_equal:
                    continue
            s = str(r.get("symbol") or "").strip().upper()
            if s and s not in seen:
                seen.add(s)
                symbols.append(s)
        tier_note = f" tier={tier_equal}" if tier_equal is not None else ""
        print(f"Fetched {len(symbols)} active symbols from DB{tier_note}")
        return symbols
    except Exception as e:
        print(f"DB symbol fetch failed: {e}")
        print("Falling back to symbols.py list")
        return list(fallback)


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
):
    """
    Upsert rows in batches of 50.

    Returns dict {"success": int, "failed": int, "errors": list[str]}.
    Previously returned just an int success_count; callers that did
    `written = bulk_upsert(...)` and printed it will now print a dict.
    Cosmetic — no behavioural breakage; the dict is truthy and indexable.

    WHY the rewrite: the old version delegated to upsert() which swallowed
    every exception and returned None. Batch failures (e.g. PGRST204 from
    a schema-drift column) were silent, so callers couldn't tell the
    difference between "wrote 2000 rows" and "wrote 0 rows of 2000 because
    every batch failed". Now each batch is tried inside bulk_upsert and
    failures are counted + the exception string captured so the caller
    can decide what to do (e.g. skip the is_latest clear step).
    """
    rows_list = list(rows)
    success_count = 0
    failed_count = 0
    errors: list[str] = []
    batch_size = 50

    for chunk_start in range(0, len(rows_list), batch_size):
        chunk = rows_list[chunk_start : chunk_start + batch_size]
        try:
            if on_conflict_column:
                supabase.table(table).upsert(
                    chunk, on_conflict=on_conflict_column
                ).execute()
            else:
                supabase.table(table).upsert(chunk).execute()
            success_count += len(chunk)
        except Exception as e:
            print(f"upsert error [{table}] batch={chunk_start}-"
                  f"{chunk_start+len(chunk)} error={e}")
            failed_count += len(chunk)
            errors.append(str(e))

    return {"success": success_count, "failed": failed_count, "errors": errors}


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