"""IQjet · Desktop morning brief — local Gemini orchestrator.

Reads the latest data from stockiq's Supabase (divergence_signals,
market_internals, swingx_entries), packages it into the context dict
Robin specified, sends it to Gemini with the Desktop IQjet system
prompt, and prints the resulting brief to stdout (also archived to
`scripts/iqjet/logs/`).

Local-only. NOT in run_daily.py. NOT deployed to Railway. Runs on
Robin's laptop against the production Supabase. To promote to the web
pipeline later, the prompt swaps for an observation-only variant and
the deploy story changes — that's a separate task.

Usage:
    cd C:\\Users\\robin\\Desktop\\stockiq\\scripts
    python iqjet/run_morning_brief.py

Optional:
    --model gemini-2.5-flash    # override default Gemini model
    --dry-run                   # print the context + system prompt,
                                 # do NOT call Gemini. Useful when
                                 # iterating on the prompt without
                                 # burning API quota.

Env vars required:
    GEMINI_API_KEY   — Robin's BYOK key in scripts/.env (same pattern
                       as CLAUDE_API_KEY already used by
                       generate_ai_content.py)
    SUPABASE_URL, SUPABASE_SERVICE_KEY — already required by db.py

Optional env:
    GEMINI_MODEL     — default 'gemini-2.5-flash'
    IQJET_LOG_DIR    — default 'scripts/iqjet/logs'
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Make `db` importable from the parent scripts/ dir — same trick the
# rest of the iqjet scripts use.
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from db import supabase  # noqa: E402
from loguru import logger  # noqa: E402

from iqjet_prompts import DESKTOP_PROMPT  # noqa: E402


# ── Tunables ────────────────────────────────────────────────────────────
_DEFAULT_MODEL = "gemini-2.5-flash"
_LOG_DIR = Path(os.environ.get("IQJET_LOG_DIR",
                               str(Path(__file__).resolve().parent / "logs")))


# ── Data loaders ────────────────────────────────────────────────────────
def _latest_divergence_row() -> dict[str, Any] | None:
    res = (
        supabase.table("divergence_signals")
        .select("*")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _latest_market_internals_row() -> dict[str, Any] | None:
    res = (
        supabase.table("market_internals")
        .select("*")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _active_swingx_entries() -> list[dict[str, Any]]:
    """Active SwingX positions. Each row carries the company-level
    fields the brief's SWINGX WATCH section needs (symbol, sector,
    entry_date, entry_price, warning_level). is_active filter mirrors
    what calc_delivery_signals.py uses."""
    try:
        res = (
            supabase.table("swingx_entries")
            .select(
                "id,company_id,symbol,sector,entry_date,entry_price,"
                "entry_substage,warning_level"
            )
            .eq("is_active", True)
            .order("entry_date", desc=True)
            .limit(50)
            .execute()
        )
    except Exception as exc:                                  # noqa: BLE001
        logger.warning(f"swingx_entries fetch failed: {exc}")
        return []
    return getattr(res, "data", None) or []


# ── Context builder ─────────────────────────────────────────────────────
def build_context(
    div_row:    dict[str, Any] | None,
    mi_row:     dict[str, Any] | None,
    swingx:     list[dict[str, Any]],
) -> dict[str, Any]:
    """Compose the dict Gemini will receive. Mirrors Robin's exact
    shape — fields that don't have live collectors yet pass the literal
    string 'unavailable'. The Desktop system prompt explicitly tells
    Gemini to note missing inputs and work with what exists."""

    def _get(row: dict[str, Any] | None, key: str, default: Any = None) -> Any:
        return row.get(key) if row else default

    # ── NSE side — wired from Supabase ──────────────────────────────
    nse = {
        "above_30wma_pct":   _get(mi_row, "above_ma30w_pct"),
        "ad_line_direction": _get(div_row, "ad_line_direction"),
        "stage2_count":      _get(mi_row, "stage2_count"),
        "stage3_count":      _get(mi_row, "stage3_count"),
        "india_vix":         _get(mi_row, "india_vix"),
        "india_vix_level":   _get(mi_row, "vix_level"),
        "nifty_close":       _get(mi_row, "nifty_close"),
        "nifty_change_1d":   _get(mi_row, "nifty_change_1d"),
        "new_52w_highs":     _get(mi_row, "new_52w_highs"),
        "new_52w_lows":      _get(mi_row, "new_52w_lows"),
        # Pillar 1 divergence-engine output Gemini should respect ─
        "pillar1_verdict":           _get(div_row, "verdict"),
        "pillar1_divergences":       _get(div_row, "divergences_detected") or [],
        "pillar1_notes":             _get(div_row, "notes"),
        # Sentiment fields with collectors pending ─
        "mmi":               "unavailable",
        "community_poll":    "unavailable",
        "news_sentiment":    "unavailable",
    }

    # ── US side — entirely pending. Lives in pinex_desktop's local DB ─
    us = {
        "sp500_breadth":     "unavailable",
        "sp500_close":       "unavailable",
        "us_vix":            "unavailable",
        "put_call_ratio":    "unavailable",
        "cnn_fear_greed":    "unavailable",
        "finbert_sentiment": "unavailable",
        "reddit_mentions":   "unavailable",
    }

    swingx_compact = [
        {
            "symbol":         e.get("symbol"),
            "sector":         e.get("sector"),
            "entry_date":     e.get("entry_date"),
            "entry_price":    e.get("entry_price"),
            "entry_substage": e.get("entry_substage"),
            "warning_level":  e.get("warning_level"),
        }
        for e in swingx
    ]

    return {
        "as_of":          _get(div_row, "date") or _get(mi_row, "date"),
        "nse":            nse,
        "us":             us,
        "swingx_active":  swingx_compact,
        "robins_desk":    "unavailable",      # Pillar 3 not built yet
    }


# ── Gemini call ─────────────────────────────────────────────────────────
def _build_user_message(context: dict[str, Any]) -> str:
    """The user-turn message we send to Gemini after the system prompt.
    Asks specifically for the COMBINED DAILY BRIEF format defined in
    the prompt and provides the structured context as JSON."""
    return (
        "Generate today's IQJET DAILY brief using the format defined in "
        "your system prompt. Use the following data:\n\n"
        "```json\n"
        + json.dumps(context, indent=2, default=str)
        + "\n```\n\n"
        "Notes on missing data:\n"
        "- Any field with value 'unavailable' has no live collector "
        "yet. Briefly acknowledge the gap if it matters; do NOT make up "
        "values.\n"
        "- The US market collectors are entirely pending — for the US "
        "row, say so plainly rather than fabricating a verdict.\n"
        "- robins_desk is 'unavailable' until that pillar ships; skip "
        "the ROBIN'S DESK section if there's nothing to show.\n"
    )


def call_gemini(
    context:   dict[str, Any],
    model:     str,
    api_key:   str,
) -> str:
    """Send the prompt + context to Gemini and return the brief text.

    Uses the google-genai SDK (the current unified Gemini Python SDK).
    Falls back to google-generativeai if the new SDK isn't installed —
    same call shape, just the older module name."""
    try:
        from google import genai                              # noqa: WPS433
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=model,
            contents=_build_user_message(context),
            config={
                "system_instruction": DESKTOP_PROMPT,
                "temperature":        0.2,
            },
        )
        return resp.text or ""
    except ImportError:
        pass

    # Fallback to legacy SDK
    import google.generativeai as genai_legacy                # noqa: WPS433
    genai_legacy.configure(api_key=api_key)
    m = genai_legacy.GenerativeModel(
        model_name=model,
        system_instruction=DESKTOP_PROMPT,
        generation_config={"temperature": 0.2},
    )
    resp = m.generate_content(_build_user_message(context))
    return getattr(resp, "text", "") or ""


# ── Output / archiving ──────────────────────────────────────────────────
def _archive(brief_text: str, context: dict[str, Any]) -> Path | None:
    """Save the brief + the input context to a dated file. Easy to
    grep later for 'what did IQjet say last Wednesday'."""
    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        out = _LOG_DIR / f"iqjet_brief_{ts}.md"
        out.write_text(
            f"# IQjet brief — {datetime.now().isoformat()}\n\n"
            f"## Input context\n\n```json\n"
            + json.dumps(context, indent=2, default=str)
            + "\n```\n\n## Gemini output\n\n"
            + brief_text + "\n",
            encoding="utf-8",
        )
        return out
    except Exception as exc:                                  # noqa: BLE001
        logger.warning(f"failed to archive brief: {exc}")
        return None


# ── Entry point ─────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("GEMINI_MODEL", _DEFAULT_MODEL))
    ap.add_argument("--dry-run", action="store_true",
                    help="Build + print context, skip Gemini call.")
    args = ap.parse_args()

    div_row = _latest_divergence_row()
    mi_row  = _latest_market_internals_row()
    if not div_row and not mi_row:
        logger.error(
            "No data — both divergence_signals and market_internals are "
            "empty. Run the daily pipeline first."
        )
        return 1
    swingx = _active_swingx_entries()

    context = build_context(div_row, mi_row, swingx)

    if args.dry_run:
        print("=== IQjet · run_morning_brief.py · DRY RUN ===")
        print(f"as_of:               {context['as_of']}")
        print(f"swingx_active count: {len(context['swingx_active'])}")
        print(f"NSE fields:          {sorted(context['nse'].keys())}")
        print(f"US fields:           {sorted(context['us'].keys())}")
        print()
        print("=== Context payload ===")
        print(json.dumps(context, indent=2, default=str))
        print()
        print("=== System prompt (first 400 chars) ===")
        print(DESKTOP_PROMPT[:400] + "…")
        return 0

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        logger.error(
            "GEMINI_API_KEY not set. Add it to scripts/.env (same "
            "pattern as CLAUDE_API_KEY)."
        )
        return 2

    logger.info(f"calling Gemini ({args.model})…")
    try:
        brief = call_gemini(context, args.model, api_key)
    except ImportError as exc:
        logger.error(
            "Gemini SDK not installed. Run: pip install google-genai "
            f"(error: {exc})"
        )
        return 3
    except Exception as exc:                                  # noqa: BLE001
        logger.error(f"Gemini call failed: {exc}")
        return 4

    if not brief.strip():
        logger.error("Gemini returned empty text.")
        return 5

    out_path = _archive(brief, context)
    print("\n" + "=" * 72)
    print(brief.rstrip())
    print("=" * 72 + "\n")
    if out_path:
        logger.info(f"archived to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
