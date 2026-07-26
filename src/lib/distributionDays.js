/**
 * distributionDays.js — O'Neil / Minervini institutional-selling gauge,
 * adapted for NSE.
 *
 * PURE CALC MODULE. No React, no Supabase, no I/O. Every export is a
 * deterministic function of its inputs so the logic is unit-testable
 * in isolation (see distributionDays.test.js).
 *
 * ── WHAT A DISTRIBUTION DAY IS ────────────────────────────────────
 * A trading day counts as ONE distribution day when BOTH hold:
 *   1. Index close < previous day's close
 *   2. Volume > previous day's volume
 * That combination is the classic footprint of institutions
 * distributing (selling into) a market — price down on rising
 * participation, i.e. size changing hands on the way down.
 *
 * A day is additionally flagged STRONG when:
 *   - the fall exceeds STRONG_FALL_PCT (1%), AND
 *   - the close sits in the bottom third of the day's range
 * Strong days carry more weight in the read but still count as ONE
 * in the rolling total — the strong count is surfaced separately so
 * the UI can say "5 distribution days, 2 of them heavy".
 *
 * ── EXCLUSIONS ───────────────────────────────────────────────────
 * A previously-counted day drops out when either:
 *   - it falls outside the trailing WINDOW_DAYS (25) trading-day
 *     window — handled naturally by slicing the series, not by
 *     calendar arithmetic, so holidays and weekend gaps never
 *     distort the count; or
 *   - the index has since closed RALLY_EXPIRY_PCT (5%) or more
 *     ABOVE that day's close. A market that has rallied through
 *     the level where the selling happened has absorbed it; the
 *     day no longer describes current conditions.
 *
 * A down day on LOWER volume is not distribution at all — that's
 * ordinary drift, and rule 2 already excludes it.
 *
 * ── VOLUME PROXY ─────────────────────────────────────────────────
 * NSE does not publish reliable index-level volume. The caller
 * passes an ETF's OHLCV (NIFTYBEES for Nifty 50) as the volume
 * proxy while price comes from the index itself — or, in the
 * simplest configuration, the ETF supplies both. Either way this
 * module just consumes {date, open, high, low, close, volume} rows;
 * where they came from is the caller's business.
 */

/** Trailing window, in TRADING days (not calendar days). */
export const WINDOW_DAYS = 25

/** A distribution day expires once the index closes this much above it. */
export const RALLY_EXPIRY_PCT = 5

/** Fall steeper than this (%) qualifies a day as STRONG. */
export const STRONG_FALL_PCT = 1

/**
 * Close must sit within the bottom this-fraction of the day's range
 * to qualify as STRONG. 1/3 => bottom third.
 */
export const STRONG_CLOSE_POSITION = 1 / 3

/**
 * Count → condition → action. Ordered ascending by `min`; look-up
 * walks from the end so the highest matching band wins.
 *
 * `tone` maps to the semantic colour tokens in src/styles/tokens.js
 * (green / amber / red) — the component picks the actual C.* value so
 * this module stays free of styling concerns.
 */
export const CONDITION_BANDS = [
  { min: 0, max: 2,        key: 'healthy',   label: 'Healthy',   action: 'Full exposure',              tone: 'green'    },
  { min: 3, max: 4,        key: 'warning',   label: 'Warning',   action: 'Reduce position size',       tone: 'amber'    },
  { min: 5, max: 5,        key: 'caution',   label: 'Caution',   action: 'Raise cash, tighten stops',  tone: 'orange'   },
  { min: 6, max: 6,        key: 'high_risk', label: 'High risk', action: 'Avoid new swing entries',    tone: 'red'      },
  { min: 7, max: Infinity, key: 'defensive', label: 'Defensive', action: 'Preserve capital',           tone: 'deep_red' },
]

/** Resolve a raw count to its condition band. Never returns null. */
export function bandForCount(count) {
  const n = Number(count)
  const safe = Number.isFinite(n) && n >= 0 ? n : 0
  for (let i = CONDITION_BANDS.length - 1; i >= 0; i--) {
    if (safe >= CONDITION_BANDS[i].min) return CONDITION_BANDS[i]
  }
  return CONDITION_BANDS[0]
}

function num(v) {
  // Explicit null/undefined/'' guard BEFORE Number(): Number(null) is 0
  // and Number('') is 0, both of which pass Number.isFinite. Without
  // this, a row with a missing close would normalise to close = 0 and
  // register as a fake -100% distribution day.
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalise + sort an OHLCV series oldest-first, dropping rows that
 * can't participate in the calc (missing date, close, or volume).
 *
 * Accepts the shape price_data returns: {date, open, high, low,
 * close, volume}. Extra keys pass through untouched.
 */
export function normaliseSeries(rows) {
  return (rows || [])
    .map((r) => ({
      ...r,
      date:   r?.date ? String(r.date).slice(0, 10) : null,
      open:   num(r?.open),
      high:   num(r?.high),
      low:    num(r?.low),
      close:  num(r?.close),
      volume: num(r?.volume),
    }))
    .filter((r) => r.date && r.close != null && r.volume != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * Is `row` a distribution day relative to `prev`?
 * Returns null when the pair can't be evaluated (missing prev, or
 * either side lacks close/volume).
 *
 * The STRONG determination needs high+low; when the range is missing
 * or degenerate (high === low) we fall back to "not strong" rather
 * than guessing.
 */
export function classifyDay(row, prev) {
  if (!row || !prev) return null
  if (row.close == null || prev.close == null) return null
  if (row.volume == null || prev.volume == null) return null

  const priceDown  = row.close < prev.close
  const volumeUp   = row.volume > prev.volume
  if (!priceDown || !volumeUp) return null

  const fallPct = ((prev.close - row.close) / prev.close) * 100

  // Close position within the day's range: 0 = at the low, 1 = at the
  // high. Requires a real range to be meaningful.
  let closePosition = null
  if (row.high != null && row.low != null && row.high > row.low) {
    closePosition = (row.close - row.low) / (row.high - row.low)
  }

  const isStrong =
    fallPct > STRONG_FALL_PCT &&
    closePosition != null &&
    closePosition <= STRONG_CLOSE_POSITION

  return {
    date:          row.date,
    close:         row.close,
    prevClose:     prev.close,
    volume:        row.volume,
    prevVolume:    prev.volume,
    fallPct:       Number(fallPct.toFixed(2)),
    closePosition: closePosition == null ? null : Number(closePosition.toFixed(3)),
    isStrong,
  }
}

/**
 * Has the market rallied far enough past `day` to expire it?
 * `laterRows` are the rows strictly AFTER the day in question.
 */
export function isExpiredByRally(day, laterRows) {
  if (!day || !laterRows?.length) return false
  const threshold = day.close * (1 + RALLY_EXPIRY_PCT / 100)
  for (const r of laterRows) {
    if (r.close != null && r.close >= threshold) return true
  }
  return false
}

/**
 * Core entry point. Feed it an OHLCV series (any length ≥ 2; ~60
 * trading days recommended so the rally-expiry rule has room) and
 * get back the rolling-window verdict.
 *
 * Returns:
 *   {
 *     count,            // active distribution days in the window
 *     strongCount,      // how many of those are STRONG
 *     band,             // CONDITION_BANDS entry for `count`
 *     days: [...],      // the active days, oldest-first
 *     expired: [...],   // days excluded by the rally rule
 *     timeline: [...],  // WINDOW_DAYS entries for the dot strip
 *     windowStart,      // first date in the window
 *     windowEnd,        // last date in the window
 *     sessionsAnalysed, // how many trading days the window actually held
 *   }
 *
 * Degrades safely: a series shorter than 2 rows returns a zeroed
 * result with band = healthy rather than throwing.
 */
export function computeDistributionDays(rows, { windowDays = WINDOW_DAYS } = {}) {
  const series = normaliseSeries(rows)

  const empty = {
    count: 0,
    strongCount: 0,
    band: bandForCount(0),
    days: [],
    expired: [],
    timeline: [],
    windowStart: null,
    windowEnd: null,
    sessionsAnalysed: 0,
  }
  if (series.length < 2) return empty

  // The window is the last `windowDays` TRADING sessions. Slicing the
  // sorted series is what makes holidays and weekends a non-issue —
  // we never touch calendar math.
  const windowRows = series.slice(-windowDays)
  const windowStart = windowRows[0]?.date ?? null
  const windowEnd   = windowRows[windowRows.length - 1]?.date ?? null

  const active = []
  const expired = []
  const timeline = []

  for (let i = 0; i < windowRows.length; i++) {
    const row = windowRows[i]
    // The comparison day is the immediately-preceding session in the
    // FULL series, so the first row of the window still gets a valid
    // predecessor (it exists as long as the caller sent > windowDays
    // rows — which the 60-day fetch guarantees).
    const globalIdx = series.findIndex((s) => s.date === row.date)
    const prev = globalIdx > 0 ? series[globalIdx - 1] : null

    const verdict = classifyDay(row, prev)
    if (!verdict) {
      timeline.push({ date: row.date, kind: 'normal' })
      continue
    }

    // Everything after this day, within the full series, decides
    // whether a rally has since absorbed it.
    const laterRows = series.slice(globalIdx + 1)
    if (isExpiredByRally(verdict, laterRows)) {
      expired.push(verdict)
      timeline.push({ date: row.date, kind: 'expired' })
      continue
    }

    active.push(verdict)
    timeline.push({ date: row.date, kind: verdict.isStrong ? 'strong' : 'distribution' })
  }

  const count = active.length
  return {
    count,
    strongCount: active.filter((d) => d.isStrong).length,
    band: bandForCount(count),
    days: active,
    expired,
    timeline,
    windowStart,
    windowEnd,
    sessionsAnalysed: windowRows.length,
  }
}

/**
 * Combine two index reads (e.g. Nifty 50 + Nifty 500) into the
 * headline verdict.
 *
 * The headline count is the HIGHER of the two — the more cautious
 * read wins, matching how the methodology is used in practice. We
 * also surface the set of dates where BOTH indices distributed on
 * the same session; simultaneous distribution across a narrow and a
 * broad index is the higher-significance signal.
 *
 * Either argument may be null (e.g. the 500 proxy isn't wired yet);
 * the function then just mirrors whichever read it has.
 */
export function combineIndexReads(primary, secondary) {
  if (!primary && !secondary) {
    return { count: 0, strongCount: 0, band: bandForCount(0), sharedDates: [], leader: null }
  }
  if (!secondary) {
    return { ...primary, sharedDates: [], leader: 'primary' }
  }
  if (!primary) {
    return { ...secondary, sharedDates: [], leader: 'secondary' }
  }

  const primaryDates   = new Set(primary.days.map((d) => d.date))
  const secondaryDates = new Set(secondary.days.map((d) => d.date))
  const sharedDates = [...primaryDates].filter((d) => secondaryDates.has(d)).sort()

  const leader = primary.count >= secondary.count ? 'primary' : 'secondary'
  const winner = leader === 'primary' ? primary : secondary

  return {
    ...winner,
    sharedDates,
    leader,
    primaryCount:   primary.count,
    secondaryCount: secondary.count,
  }
}
