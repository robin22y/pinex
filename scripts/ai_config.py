"""
ai_config — DB-driven Gemini model lookup for pipeline scripts.

Reads from the ai_config table. Falls back to a hardcoded default if
the fetch fails (network, RLS, missing row, etc.) so the pipeline
never blocks on a config issue.

Usage:
    from ai_config import get_ai_config
    model = get_ai_config("gemini_pipeline_model", "gemini-2.5-flash-lite")

Per-run lookup — pipeline scripts run once per day so a single Supabase
hit at boot is fine. No process-level cache; if you call this twice in
the same run, two HTTP calls happen (cheap, but uncommon).
"""

from __future__ import annotations

from db import supabase


def get_ai_config(key: str, fallback: str) -> str:
    """
    Fetch a model name from the ai_config table.

    Args:
        key:       config_key column value (e.g. 'gemini_pipeline_model')
        fallback:  string returned when the row is missing, inactive,
                   or the fetch fails. Make this match the previous
                   hardcoded model so behaviour is unchanged when
                   ai_config is unavailable.

    Returns:
        config_value if a matching active row exists, else fallback.
    """
    try:
        res = (
            supabase.table("ai_config")
            .select("config_value")
            .eq("config_key", key)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if rows and rows[0].get("config_value"):
            return rows[0]["config_value"]
    except Exception as e:
        # Non-fatal — log and fall through so the script continues.
        print(f"[ai_config] fetch failed for '{key}': {e}; using fallback '{fallback}'")

    return fallback
