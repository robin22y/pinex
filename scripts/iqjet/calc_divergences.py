"""IQjet · Pillar 1 — Market Pulse divergence engine.

Reads recent `market_internals` rows, detects when the index is moving
in one direction while the internals underneath are moving the other
way, and writes one row per trading day to `divergence_signals`. That
row drives the /iqjet dashboard card AND the daily IQjet Telegram post.

Detection set (per the IQjet build brief — five signals, severity =
count of how many fired today):

    1. nifty_up_breadth_down   Nifty trend up over the window, but
                               `above_ma30w_pct` trend down. Slope-based
                               (pandas-ta linreg) so a single noisy day
                               can't fire / unfire it on its own.
    2. nifty_up_ad_line_down   Nifty trend up over the window, but
                               `ad_line_cumulative` trend down.
    3. stage2_falling_wow      `stage2_count` slope < 0 over 10 bars.
                               Leadership thinning.
    4. stage3_rising_wow       `stage3_count` slope > 0 over 10 bars.
                               Topping is broadening.
    5. lows_exceeding_highs    `new_52w_lows > new_52w_highs` AND the
                               index held (1-day change > -0.5%). The
                               underside is breaking even though the
                               headline number looks fine. (Direct
                               count comparison — no slope needed, the
                               raw imbalance IS the signal.)

The five trend signals use a pure-numpy linear-regression slope
(`np.polyfit(x, window, 1)`). Normalised "slope per bar as % of mean"
is used as the threshold so the same code works for the breadth scale
(0-100) and the A/D-line scale (thousands+) without ad-hoc constants.
No pandas_ta dependency — aggregated breadth numbers don't need a
TA library's per-stock indicator catalogue, and pandas_ta is
incompatible with Python 3.14 (caps at 3.13) which makes local
iteration painful.

Where applicable, `scipy.signal.argrelextrema` is used to locate the
recent swing peaks/troughs in the index + indicator series. When a
divergence fires, that lets us attach a *classical* divergence label
("Nifty made a higher high at <date> at <px>, but breadth made a lower
high at <date> at <pct>") instead of a generic "trends are diverging"
string. The peak data is decoration on the label only — the firing
decision is the slope read.

Verdict ladder (count of divergences that fired today):

      0  → STRONG       — clean tape
      1  → WATCH        — first crack
      2  → MIXED        — two-sided, no decisive read
      3  → WEAK         — clearly weakening underneath
      4+ → DANGEROUS    — broad divergence; high risk of failure

Idempotent: upserts on `date`, so re-running for the same trading day
overwrites the previous row.

Run from scripts/ dir:   python iqjet/calc_divergences.py
Pipeline integration:    invoked by run_daily.py after swing_conditions.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from scipy.signal import argrelextrema

# Importing `db` and `loguru.logger` from the parent scripts/ dir without
# making scripts/ a package — same trick the existing flat-layout scripts
# (calc_market_internals.py, telegram_broadcast.py, ...) all use.
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from db import bulk_upsert, log_event, supabase  # noqa: E402
from loguru import logger  # noqa: E402


# ── Tunables ─────────────────────────────────────────────────────────────
# How many recent market_internals rows we pull. 30 trading days gives
# 20-bar slope + a margin for the peak-finder's order-band on each side,
# and it's still a tiny Supabase round-trip.
_HISTORY_ROWS = 30

# Slope-window for the "trend over a month" reads — Nifty vs breadth,
# Nifty vs A/D. 20 trading days ≈ one calendar month. Wide enough that
# a single noisy day doesn't flip the verdict; narrow enough to catch
# a regime change inside a month.
_TREND_WINDOW = 20

# Slope-window for the stage counts — leadership thins on 1-2 week
# scales, not month scales, so we read it tighter.
_STAGE_WINDOW = 10

# Normalised slope threshold for "meaningfully moving". The slope is
# divided by the mean of the same window to make it scale-free:
# breadth (0-100), AD-line (thousands), Nifty (24000) all map to a
# comparable number. 0.0005 ≈ 0.05% per bar after normalisation = 1%
# over a 20-bar window. Lower = more sensitive (fires sooner, more
# false positives), higher = stricter.
_SLOPE_THRESHOLD_NORM = 0.0005

# `argrelextrema` neighbourhood. order=3 means a point is a local
# maximum only if it's strictly greater than the 3 points on each side
# of it. Smaller = more peaks (including noise); larger = fewer, more
# decisive peaks. 3 is a reasonable middle for daily bars.
_PEAK_ORDER = 3

# "Index held" tolerance for divergence #5 — the 1-day Nifty change
# must be > this threshold for us to say the index is "holding" while
# 52W lows expand underneath. A -2% Nifty day with lows > highs is just
# a sell-off, not a divergence.
_INDEX_HELD_MIN_PCT = -0.5


# ── Severity table ──────────────────────────────────────────────────────
def _verdict_for(n_fired: int) -> str:
    if n_fired <= 0:
        return "STRONG"
    if n_fired == 1:
        return "WATCH"
    if n_fired == 2:
        return "MIXED"
    if n_fired == 3:
        return "WEAK"
    return "DANGEROUS"


# ── Reads ───────────────────────────────────────────────────────────────
def _fetch_recent_rows(limit: int) -> list[dict[str, Any]]:
    """Last `limit` trading days of market_internals, newest first."""
    try:
        res = (
            supabase.table("market_internals")
            .select("*")
            .order("date", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        logger.error(f"market_internals fetch failed: {exc}")
        return []
    rows = getattr(res, "data", None) or []
    return rows


# ── DataFrame helpers ───────────────────────────────────────────────────
def _to_ascending_df(rows: list[dict[str, Any]]) -> pd.DataFrame:
    """Convert the DESC-sorted Supabase rows into an ASC-sorted DataFrame
    keyed on `date`. pandas-ta and scipy peak-finding both want ASC time
    series; DESC was just the convenient query order."""
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    return df


# ── Linear-regression slope (pure numpy) ────────────────────────────────
def _slope(series: pd.Series, length: int) -> Optional[float]:
    """Return the linear-regression slope of the LAST `length` values of
    `series`, or None when there aren't enough numeric points.

    Implementation: ``np.polyfit(x, y, deg=1)`` returns ``[slope,
    intercept]``. We fit against ``x = 0, 1, 2, ..., length-1`` so the
    slope's units are "indicator-units per bar". Identical math to
    scipy.stats.linregress / pandas-ta's linreg — we just don't need a
    library for a single least-squares fit on 10–20 points."""
    if series is None:
        return None
    window = series.dropna().iloc[-length:]
    if len(window) < length:
        return None
    y = window.to_numpy(dtype=float)
    x = np.arange(length, dtype=float)
    try:
        slope, _intercept = np.polyfit(x, y, 1)
    except (np.linalg.LinAlgError, ValueError) as exc:
        logger.warning(f"polyfit failed (len={length}): {exc}")
        return None
    if not np.isfinite(slope):
        return None
    return float(slope)


def _normalised_slope(series: pd.Series, length: int) -> Optional[float]:
    """Slope per bar, normalised by the window's absolute mean. Scale-free.
    Returns None when slope or mean can't be computed (sparse data or
    near-zero mean).

    Why normalised: breadth pct lives in 0-100, the AD-line lives in
    thousands+, Nifty close lives at ~24000. A single absolute slope
    threshold can't possibly work across all three. Dividing by the
    mean of the same window converts each into "fractional move per
    bar", letting us reuse one threshold for everything."""
    slope = _slope(series, length)
    if slope is None:
        return None
    window = series.dropna().iloc[-length:]
    if window.empty:
        return None
    denom = float(window.abs().mean())
    if denom < 1e-9:
        return None
    return slope / denom


# ── scipy peak/trough labels ────────────────────────────────────────────
def _last_peak(series: pd.Series, order: int = _PEAK_ORDER) -> Optional[int]:
    """Index (positional, not date) of the most recent local maximum,
    or None if none in the visible window."""
    if series is None or series.empty:
        return None
    arr = series.to_numpy()
    if len(arr) < 2 * order + 1:
        return None
    idxs = argrelextrema(arr, np.greater, order=order)[0]
    if len(idxs) == 0:
        return None
    return int(idxs[-1])


def _last_trough(series: pd.Series, order: int = _PEAK_ORDER) -> Optional[int]:
    if series is None or series.empty:
        return None
    arr = series.to_numpy()
    if len(arr) < 2 * order + 1:
        return None
    idxs = argrelextrema(arr, np.less, order=order)[0]
    if len(idxs) == 0:
        return None
    return int(idxs[-1])


def _peak_divergence_label(
    df: pd.DataFrame,
    index_col: str,
    indicator_col: str,
    pretty_indicator: str,
) -> Optional[str]:
    """Attach a classical higher-high / lower-high label if peaks exist
    in both the index and the indicator series. Returns None when peaks
    can't be located cleanly (e.g. monotonic series, too few bars).

    The detection is: find the LAST clean peak in the index. Find the
    indicator's value at that same date. Compare to the most recent
    indicator peak — if the index peak is later AND the index peak
    value is the higher of two index peaks AND the indicator at that
    later date is lower than at the earlier index peak, we have the
    classical bearish divergence pattern. We don't gate on this — the
    slope read above already decided to fire — we just attach the
    label when it's available so the user sees concrete numbers."""
    idx_peaks = argrelextrema(df[index_col].to_numpy(), np.greater,
                              order=_PEAK_ORDER)[0]
    if len(idx_peaks) < 2:
        return None
    p_now, p_prev = int(idx_peaks[-1]), int(idx_peaks[-2])
    idx_now, idx_prev = df[index_col].iloc[p_now], df[index_col].iloc[p_prev]
    ind_now, ind_prev = df[indicator_col].iloc[p_now], df[indicator_col].iloc[p_prev]
    if any(pd.isna([idx_now, idx_prev, ind_now, ind_prev])):
        return None
    # Bearish classical divergence: index higher high, indicator lower high
    if idx_now > idx_prev and ind_now < ind_prev:
        d_now = df["date"].iloc[p_now].strftime("%d %b")
        d_prev = df["date"].iloc[p_prev].strftime("%d %b")
        return (
            f"Nifty peak {d_prev} {idx_prev:,.0f} → {d_now} {idx_now:,.0f} "
            f"(higher high); {pretty_indicator} {ind_prev:.0f} → "
            f"{ind_now:.0f} (lower high)"
        )
    return None


# ── AD-line direction (separate from the divergence flag) ───────────────
def _ad_line_direction(df: pd.DataFrame) -> str:
    """Three-bucket label for the dashboard. Uses the normalised slope
    over a short 5-bar window so the label is responsive day-to-day,
    independent of the wider 20-bar trend used for divergence #2."""
    n = _normalised_slope(df["ad_line_cumulative"], length=5)
    if n is None:
        return "unknown"
    if n > _SLOPE_THRESHOLD_NORM:
        return "rising"
    if n < -_SLOPE_THRESHOLD_NORM:
        return "falling"
    return "flat"


# ── Detection ───────────────────────────────────────────────────────────
def _detect(df: pd.DataFrame, rows_desc: list[dict[str, Any]]
            ) -> list[dict[str, str]]:
    """Return the list of divergence dicts that fired today.

    `df` is the ASC-sorted DataFrame (used by slope + peak finders);
    `rows_desc` is the original DESC-sorted dict list (used only for
    the direct-count divergence #5 which doesn't need a series).
    """
    fired: list[dict[str, str]] = []
    if df.empty:
        return fired

    nifty_slope_n   = _normalised_slope(df["nifty_close"],         _TREND_WINDOW)
    breadth_slope_n = _normalised_slope(df["above_ma30w_pct"],     _TREND_WINDOW)
    ad_slope_n      = _normalised_slope(df["ad_line_cumulative"],  _TREND_WINDOW)
    s2_slope_n      = _normalised_slope(df["stage2_count"],        _STAGE_WINDOW)
    s3_slope_n      = _normalised_slope(df["stage3_count"],        _STAGE_WINDOW)

    # Helpful diagnostic so the daily log shows WHY signals fired or
    # didn't. Pipeline log is grep-friendly.
    logger.info(
        f"[iqjet] slopes (norm/bar): "
        f"nifty={nifty_slope_n!s:>8}  breadth={breadth_slope_n!s:>8}  "
        f"ad={ad_slope_n!s:>8}  s2={s2_slope_n!s:>8}  s3={s3_slope_n!s:>8}"
    )

    up = _SLOPE_THRESHOLD_NORM
    dn = -_SLOPE_THRESHOLD_NORM

    # ── #1 nifty up, breadth down (trend over 20 bars) ────────────────
    if (nifty_slope_n is not None and breadth_slope_n is not None
            and nifty_slope_n > up and breadth_slope_n < dn):
        label = _peak_divergence_label(
            df, "nifty_close", "above_ma30w_pct", "% above 30W MA",
        )
        if not label:
            b_then = float(df["above_ma30w_pct"].iloc[-_TREND_WINDOW])
            b_now  = float(df["above_ma30w_pct"].iloc[-1])
            n_then = float(df["nifty_close"].iloc[-_TREND_WINDOW])
            n_now  = float(df["nifty_close"].iloc[-1])
            label = (
                f"Nifty trend up ({n_then:,.0f} → {n_now:,.0f}) but "
                f"% above 30-week MA trend down ({b_then:.0f}% → "
                f"{b_now:.0f}%) over {_TREND_WINDOW} bars"
            )
        fired.append({"key": "nifty_up_breadth_down", "label": label})

    # ── #2 nifty up, A/D line down (trend over 20 bars) ──────────────
    if (nifty_slope_n is not None and ad_slope_n is not None
            and nifty_slope_n > up and ad_slope_n < dn):
        label = _peak_divergence_label(
            df, "nifty_close", "ad_line_cumulative", "A/D line",
        )
        if not label:
            label = (
                f"Nifty trend up but A/D line trend down over "
                f"{_TREND_WINDOW} bars — narrowing participation"
            )
        fired.append({"key": "nifty_up_ad_line_down", "label": label})

    # ── #3 stage 2 count thinning over 10 bars ────────────────────────
    if s2_slope_n is not None and s2_slope_n < dn:
        s2_then = int(df["stage2_count"].iloc[-_STAGE_WINDOW])
        s2_now  = int(df["stage2_count"].iloc[-1])
        fired.append({
            "key": "stage2_falling_wow",
            "label": (
                f"Stage 2 count {s2_then} → {s2_now} ({s2_now-s2_then:+d} "
                f"over {_STAGE_WINDOW} bars) — leadership thinning"
            ),
        })

    # ── #4 stage 3 count rising over 10 bars ─────────────────────────
    if s3_slope_n is not None and s3_slope_n > up:
        s3_then = int(df["stage3_count"].iloc[-_STAGE_WINDOW])
        s3_now  = int(df["stage3_count"].iloc[-1])
        fired.append({
            "key": "stage3_rising_wow",
            "label": (
                f"Stage 3 count {s3_then} → {s3_now} ({s3_now-s3_then:+d} "
                f"over {_STAGE_WINDOW} bars) — topping broadening"
            ),
        })

    # ── #5 new 52W lows exceed new 52W highs while index holds ──────
    # Uses today's row directly (counts, not a trend). rows_desc[0] is
    # today.
    today = rows_desc[0]
    nh = today.get("new_52w_highs")
    nl = today.get("new_52w_lows")
    nifty_chg = today.get("nifty_change_1d")
    if (nh is not None and nl is not None and nifty_chg is not None
            and nl > nh and nifty_chg > _INDEX_HELD_MIN_PCT):
        fired.append({
            "key": "lows_exceeding_highs",
            "label": (
                f"{nl} new 52W lows vs only {nh} new highs — index "
                f"holding ({nifty_chg:+.1f}%) but underside breaking"
            ),
        })

    return fired


# ── Compose + upsert row ────────────────────────────────────────────────
def build_payload(rows_desc: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Return the divergence_signals row payload for today, or None when
    there's no usable market_internals data."""
    if not rows_desc:
        logger.error("market_internals is empty — cannot compute divergences")
        return None

    df = _to_ascending_df(rows_desc)
    if df.empty:
        return None
    today = rows_desc[0]

    fired = _detect(df, rows_desc)
    verdict = _verdict_for(len(fired))
    ad_dir  = _ad_line_direction(df)

    notes_bits: list[str] = []
    if not fired:
        notes_bits.append("No divergences detected — internals match the index.")
    elif len(fired) >= 4:
        notes_bits.append(
            "Multiple divergences active — the tape is telling a different "
            "story from the index print."
        )
    else:
        notes_bits.append(f"{len(fired)} divergence(s) detected.")
    notes_bits.append(f"A/D line direction (5-bar slope): {ad_dir}.")

    return {
        "date":                  today["date"],
        "verdict":               verdict,
        "divergences_detected":  fired,
        "breadth_pct":           today.get("above_ma30w_pct"),
        "ad_line_direction":     ad_dir,
        "stage2_count":          today.get("stage2_count"),
        "stage3_count":          today.get("stage3_count"),
        "nifty_close":           today.get("nifty_close"),
        "notes":                 " ".join(notes_bits),
    }


def main() -> int:
    started = datetime.utcnow().isoformat()
    logger.info(f"[iqjet] calc_divergences start {started}")

    rows = _fetch_recent_rows(_HISTORY_ROWS)
    if not rows:
        logger.error("[iqjet] no market_internals rows — aborting")
        log_event("iqjet_divergences_failed", {"reason": "no_internals_rows"})
        return 1

    if len(rows) < _TREND_WINDOW:
        logger.warning(
            f"[iqjet] only {len(rows)} rows of market_internals available; "
            f"trend window is {_TREND_WINDOW}. Some divergences will be "
            f"skipped until more history accumulates."
        )

    payload = build_payload(rows)
    if payload is None:
        log_event("iqjet_divergences_failed", {"reason": "payload_none"})
        return 1

    res = bulk_upsert("divergence_signals", [payload], on_conflict_column="date")
    if res.get("failed"):
        logger.error(f"[iqjet] upsert failed: {res}")
        log_event("iqjet_divergences_failed",
                  {"reason": "upsert_failed", "errors": res.get("errors")})
        return 1

    n_fired = len(payload["divergences_detected"])
    logger.info(
        f"[iqjet] date={payload['date']}  verdict={payload['verdict']}  "
        f"divergences={n_fired}  ad_line={payload['ad_line_direction']}"
    )
    if n_fired:
        for d in payload["divergences_detected"]:
            logger.info(f"[iqjet]   · {d['key']}: {d['label']}")

    log_event("iqjet_divergences_done", {
        "date":            payload["date"],
        "verdict":         payload["verdict"],
        "n_divergences":   n_fired,
        "divergence_keys": [d["key"] for d in payload["divergences_detected"]],
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
