"""fetch_corporate_actions.py — daily sweep of NSE corporate actions.

    python scripts/fetch_corporate_actions.py              # -7d .. +30d
    python scripts/fetch_corporate_actions.py --back 30 --ahead 60
    python scripts/fetch_corporate_actions.py --dry-run    # fetch, print, write nothing

Writes split/bonus/consolidation/dividend/rights rows into corporate_actions
and sends the operator a Telegram digest when a RESCALING action (one that
moves the price scale) is seen for the first time.

════════════════════════════════════════════════════════════════════════
WHY THIS SCRIPT EXISTS
════════════════════════════════════════════════════════════════════════
The screener's moving averages are computed from UNADJUSTED closes. NSE
publishes the bhav copy unadjusted, so after a 1:10 split every close
before the ex-date is still on the old scale and a "200-day average"
silently averages two different currencies. scripts/fix_split_adjustments.py
repairs that — but only for an action it can identify, and it refuses to
guess a ratio it cannot snap to a clean fraction.

On 2026-08-05 TEMBO split 1:10. Nothing recorded it. Its DMAs came out
around 550 against a close of 62, validate_static_data correctly refused
to publish, and the static screener sat frozen on 4 Aug for six days while
the rest of the site moved on. This script closes that hole at the source.

════════════════════════════════════════════════════════════════════════
WHY NOT ONE OF THE TWO PARSERS THAT ALREADY EXISTED
════════════════════════════════════════════════════════════════════════
fetch_bhav_daily.parse_corporate_actions reads a "bc" sub-file from the old
  PR zip. That zip is gone — NSE's replacement UDiFF BhavCopy carries no
  corporate-actions file at all, so `pr["bc"]` is never populated and the
  parser has not run in a long time. Its writer also targets ex_date /
  record_date / data_source, none of which are columns on this table, so
  it could not have written a row even when it did run.

fetch_indianapi._extract_corporate_actions works and is the right tool for
  a per-symbol backfill, but it costs one API call per symbol against a
  50-calls-a-day quota. It was retired from the daily cron for exactly that
  reason, and every remaining scheduled invocation passes --news-only,
  --financials-only or --shareholding-only, each of which switches
  corporate actions off entirely.

This endpoint returns the whole market in ONE request — 543 rows for a
two-month window — so it can run daily for free.
"""
from __future__ import annotations

import re
import sys
from datetime import date, datetime, timedelta
from typing import Any

import requests

from admin_alert import esc, preflight, send_admin_telegram
from db import bulk_upsert, supabase

BASE = "https://www.nseindia.com"
API = f"{BASE}/api/corporates-corporateActions?index=equities"
# NSE serves the JSON only to something that looks like it arrived from the
# corporate-filings page, and only once that page has handed out a cookie.
WARMUP = f"{BASE}/companies-listing/corporate-filings-actions"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": WARMUP,
}
TIMEOUT = 40

DEFAULT_BACK_DAYS = 7
# Ex-dates are announced weeks ahead. Reaching forward is the whole point:
# the alert should land before the closes go bad, not after.
DEFAULT_AHEAD_DAYS = 30

# Actions that move the price scale. Only these can corrupt a moving
# average, and only these are worth waking someone up for.
RESCALING_ACTIONS = ("split", "bonus", "consolidation")


# ── Subject decoding ────────────────────────────────────────────────────
# `subject` is free text written by a human at the exchange. These are the
# real forms, taken from live responses:
#
#   "Face Value Split (Sub-Division) - From Rs 10/- Per Share To Re 1/- Per Share"
#   "Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share"
#   "Bonus 1:3"
#   "Rs.6.0000 per share(60%)Final Dividend"
#
# Rs vs Re tracks singular/plural rupees and carries no meaning; both
# spellings appear in the same sentence.
_SPLIT_RE = re.compile(
    r"from\s+rs?e?\.?\s*([\d.]+)\s*/?-?\s*per\s+share\s*to\s*rs?e?\.?\s*([\d.]+)",
    re.I,
)
_BONUS_RE = re.compile(r"bonus\s+(\d+)\s*:\s*(\d+)", re.I)


def classify(subject: str) -> tuple[str | None, float | None]:
    """(action_type, price factor) for one subject line.

    The factor multiplies every close BEFORE the ex-date to put it on the
    current scale — the convention fix_split_adjustments expects.

    A face-value change from X to Y scales the price by Y/X: 10 -> 1 gives
    0.1, and the reverse (a consolidation) gives 10. Both come out of the
    same regex, and which one it is follows from whether the factor is
    below or above 1 rather than from trusting the wording.

    A bonus of a:b hands out a new shares for every b held, so the holding
    grows from b to a+b and the price factor is b/(a+b). 1:3 -> 0.75.

    Returns (None, None) for anything not recognised, and (type, None) when
    the type is clear but no ratio can be read — a caller must be able to
    tell "not a rescaling action" from "rescaling, ratio unknown", because
    the second one needs a human and the first does not.
    """
    text = str(subject or "").strip()
    if not text:
        return None, None
    low = text.lower()

    match = _SPLIT_RE.search(text)
    if match:
        try:
            old, new = float(match.group(1)), float(match.group(2))
        except ValueError:
            old = new = 0.0
        if old > 0 and new > 0:
            factor = new / old
            # Consolidation (reverse split) raises the price; a sub-division
            # lowers it. Naming them apart keeps the alert honest.
            return ("consolidation" if factor > 1 else "split"), factor
        return ("consolidation" if "consolidat" in low else "split"), None

    match = _BONUS_RE.search(text)
    if match:
        a, b = int(match.group(1)), int(match.group(2))
        if a > 0 and b > 0:
            return "bonus", b / (a + b)
        return "bonus", None

    if "bonus" in low:
        return "bonus", None
    if "consolidat" in low:
        return "consolidation", None
    if "split" in low or "sub-division" in low:
        return "split", None
    if "dividend" in low:
        return "dividend", None
    if "rights" in low:
        return "rights", None
    return None, None


def parse_ex_date(value: Any) -> str | None:
    """'05-Aug-2026' -> '2026-08-05'. Returns None on anything else."""
    text = str(value or "").strip()
    if not text or text == "-":
        return None
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


# ── Fetch ───────────────────────────────────────────────────────────────
def fetch(back_days: int, ahead_days: int) -> list[dict[str, Any]]:
    today = date.today()
    frm = (today - timedelta(days=back_days)).strftime("%d-%m-%Y")
    to = (today + timedelta(days=ahead_days)).strftime("%d-%m-%Y")
    url = f"{API}&from_date={frm}&to_date={to}"

    session = requests.Session()
    # Warm-up establishes the cookie; without it the API answers 401.
    session.get(WARMUP, headers=HEADERS, timeout=TIMEOUT)
    response = session.get(url, headers=HEADERS, timeout=TIMEOUT)
    response.raise_for_status()

    payload = response.json()
    if not isinstance(payload, list):
        raise ValueError(f"expected a list, got {type(payload).__name__}")
    print(f"  NSE returned {len(payload):,} actions for {frm} .. {to}")
    return payload


def build_rows(payload: list[dict[str, Any]]) -> tuple[list[dict], list[str]]:
    """(rows ready to upsert, warnings). Unmapped symbols are dropped."""
    symbols = sorted({str(a.get("symbol", "")).strip() for a in payload if a.get("symbol")})
    symbol_to_id: dict[str, str] = {}
    for i in range(0, len(symbols), 500):
        chunk = symbols[i:i + 500]
        found = (
            supabase.table("companies").select("id,symbol")
            .in_("symbol", chunk).execute().data
        ) or []
        symbol_to_id.update({r["symbol"]: r["id"] for r in found})

    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen: set[tuple[str, str, str]] = set()

    for action in payload:
        symbol = str(action.get("symbol", "")).strip()
        company_id = symbol_to_id.get(symbol)
        if not company_id:
            continue

        subject = str(action.get("subject", "")).strip()
        kind, ratio = classify(subject)
        if not kind:
            warnings.append(f"{symbol}: unrecognised subject — {subject!r}")
            continue

        ex_date = parse_ex_date(action.get("exDate")) or parse_ex_date(action.get("recDate"))
        if not ex_date:
            warnings.append(f"{symbol}: no usable ex-date for {subject!r}")
            continue

        if kind in RESCALING_ACTIONS and ratio is None:
            warnings.append(
                f"{symbol} {ex_date}: {kind} with no readable ratio — {subject!r}"
            )

        # The upsert key is (symbol, action_type, action_date); a duplicate
        # inside one payload would make PostgREST reject the whole batch.
        key = (symbol, kind, ex_date)
        if key in seen:
            continue
        seen.add(key)

        rows.append({
            "company_id": company_id,
            "symbol": symbol,
            "action_type": kind,
            "action_date": ex_date,
            "ratio": ratio,
            "notes": subject,
        })

    return rows, warnings


def find_new_rescaling(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rescaling rows not already in corporate_actions, checked before write."""
    candidates = [r for r in rows if r["action_type"] in RESCALING_ACTIONS]
    if not candidates:
        return []

    known: set[tuple[str, str, str]] = set()
    symbols = sorted({r["symbol"] for r in candidates})
    for i in range(0, len(symbols), 200):
        chunk = symbols[i:i + 200]
        existing = (
            supabase.table("corporate_actions")
            .select("symbol,action_type,action_date")
            .in_("symbol", chunk)
            .in_("action_type", list(RESCALING_ACTIONS))
            .execute().data
        ) or []
        known.update(
            (r["symbol"], r["action_type"], str(r["action_date"])[:10]) for r in existing
        )

    return [
        r for r in candidates
        if (r["symbol"], r["action_type"], r["action_date"]) not in known
    ]


def alert(new_rows: list[dict[str, Any]]) -> None:
    if not new_rows:
        return
    today = date.today().isoformat()
    ordered = sorted(new_rows, key=lambda r: (r["action_date"], r["symbol"]))

    lines = [
        f"<b>Corporate action detected — {len(ordered)}</b>",
        "New rescaling event(s). Closes are unadjusted, so any moving "
        "average spanning the ex-date is wrong until repaired.",
        "",
    ]
    for row in ordered:
        ratio = row.get("ratio")
        factor = f"price x{ratio:.4g}" if ratio else "NO RATIO — needs one by hand"
        when = "upcoming" if row["action_date"] > today else "effective"
        lines.append(
            f"• <b>{esc(row['symbol'])}</b> {esc(row['action_type'])} "
            f"{when} {esc(row['action_date'])} — {factor}"
        )
        lines.append(f"  <i>{esc(row['notes'])}</i>")

    lines += [
        "",
        "<code>python scripts/fix_split_adjustments.py</code>  (dry run)",
        "<code>python scripts/fix_split_adjustments.py --apply</code>",
        "<code>python scripts/calc_moving_averages.py</code>",
    ]

    if send_admin_telegram("\n".join(lines), source="fetch_corporate_actions"):
        print(f"  admin alert sent — {len(ordered)} rescaling action(s)")
    else:
        print(f"  admin alert NOT delivered — {len(ordered)} rescaling action(s):")
        for row in ordered:
            print(f"    {row['symbol']} {row['action_type']} {row['action_date']}")


def _int_arg(flag: str, default: int) -> int:
    for i, arg in enumerate(sys.argv):
        if arg == flag and i + 1 < len(sys.argv):
            return int(sys.argv[i + 1])
        if arg.startswith(f"{flag}="):
            return int(arg.split("=", 1)[-1])
    return default


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    back = _int_arg("--back", DEFAULT_BACK_DAYS)
    ahead = _int_arg("--ahead", DEFAULT_AHEAD_DAYS)

    print("=" * 62)
    print("NSE CORPORATE ACTIONS")
    print("=" * 62)

    # Checked up front, every run — including runs with nothing to report.
    # A split turns up a couple of times a year; if the channel is only
    # exercised on those days, it will be broken on one of them.
    preflight("fetch_corporate_actions")

    try:
        payload = fetch(back, ahead)
    except Exception as exc:  # noqa: BLE001
        # Non-fatal on purpose. This is a detection aid, not a data
        # dependency — the publish gate still catches an unadjusted split,
        # just later and more bluntly. Failing the build here would trade a
        # missed alert for a missed pipeline run.
        print(f"::warning::corporate actions fetch failed: {exc}")
        return 0

    rows, warnings = build_rows(payload)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["action_type"]] = counts.get(row["action_type"], 0) + 1
    print(f"  parsed {len(rows):,} rows for known companies: "
          + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    for warning in warnings[:20]:
        print(f"  ! {warning}")
    if len(warnings) > 20:
        print(f"  ! … and {len(warnings) - 20} more")

    new_rescaling = find_new_rescaling(rows)
    for row in new_rescaling:
        print(f"  NEW {row['action_type']}: {row['symbol']} {row['action_date']} "
              f"ratio={row['ratio']}")

    if dry_run:
        print(f"DRY RUN — would upsert {len(rows):,} rows, "
              f"alert on {len(new_rescaling)}")
        return 0

    if rows:
        result = bulk_upsert("corporate_actions", rows, "symbol,action_type,action_date")
        print(f"  upsert: {result}")

    alert(new_rescaling)
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
