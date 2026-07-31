/**
 * followThrough.js — the strength half of the market-condition read.
 *
 * distributionDays.js measures institutional selling INSIDE an uptrend.
 * This measures the other pole: whether a decline has been answered by
 * real buying. The two are one state machine, and the app previously
 * showed only the falling half.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────
 * After the index declines CORRECTION_PCT from a peak, the low of that
 * decline starts a rally attempt:
 *
 *   Day 1     the first session after the low that closes higher
 *   Days 2-3  the attempt must hold — undercut the low and it resets
 *   Day 4+    a session gaining FOLLOW_THROUGH_PCT or more on volume
 *             ABOVE the previous session confirms the attempt
 *
 * The day-4 rule is the whole point. A large gain on day 2 or 3 is a
 * bounce off oversold conditions; waiting until day 4 filters for
 * sustained participation rather than one session of short covering.
 *
 * The originator observed that every major advance began with such a
 * day, but that roughly a third of them fail — so `confirmed` here is a
 * description of what the tape did, never a forecast. A confirmation is
 * marked `failed` the moment the rally low is undercut.
 *
 * ── LANGUAGE ─────────────────────────────────────────────────────────
 * Every label in this module is observational. It reports what price and
 * volume did; it does not tell anyone what to do with that. The footer
 * disclaimer on every page states the product gives no trade
 * instructions, and STATE_LABELS is written to keep that true.
 *
 * NOTE: CONDITION_BANDS in distributionDays.js does NOT currently hold to
 * that — it maps counts to "Reduce position size", "Raise cash, tighten
 * stops", "Avoid new swing entries". Left alone here because changing
 * live copy is a product call, but the two halves read inconsistently
 * until it is settled.
 *
 * Pure functions, no I/O, no React. Feed it the same OHLCV rows
 * DistributionDaysCard already fetches.
 */

import { normaliseSeries } from './distributionDays.js'

/**
 * Decline from a peak that qualifies as a correction worth confirming a
 * recovery from.
 *
 * The originator worked with US indices where intermediate corrections
 * run 8-10%. NIFTY's are shallower: across the available NIFTYBEES
 * history the only meaningful decline was 5.43%, and the next largest
 * was 0.89% — noise. 3% sits in that gap, far enough above the noise
 * floor to mean something and low enough to catch a real NIFTY leg.
 */
export const CORRECTION_PCT = 3

/** Earliest session of a rally attempt that can confirm it. */
export const RALLY_MIN_DAY = 4

/**
 * Gain required on the confirming session. The original rule was 1%;
 * the publisher later raised it to ~1.25% as index volatility rose.
 * Configurable per call so both readings are available.
 */
export const FOLLOW_THROUGH_PCT = 1

/** Rolling window for the accumulation-day count, matching the
 *  distribution-day window so the two are directly comparable. */
export const WINDOW_DAYS = 25

/**
 * States are mutually exclusive and ordered by how far the attempt has
 * progressed. `tone` maps to the same semantic colour tokens the
 * distribution card already uses.
 */
export const STATE_LABELS = {
  no_data:       { label: 'Not enough history', detail: 'Needs more sessions to read',       tone: 'neutral' },
  no_correction: { label: 'No correction',      detail: 'No qualifying decline in range',    tone: 'neutral' },
  attempt:       { label: 'Rally attempt',      detail: 'Holding, not yet confirmed',        tone: 'amber'   },
  // 'Confirmed', not 'Follow-through' — the card already heads this row
  // "Follow-through", so the fuller name rendered as
  // "Follow-through Follow-through 12 Jun 2026".
  confirmed:     { label: 'Confirmed',          detail: 'Confirmed on rising participation', tone: 'green'   },
  failed:        { label: 'Undercut',           detail: 'Confirmation lost — low breached',  tone: 'red'     },
  recovered:     { label: 'Recovered',          detail: 'Back above the prior peak',         tone: 'green'   },
}

/** Resolve a state key to its descriptor. Never returns undefined. */
export function labelForState(state) {
  return STATE_LABELS[state] || STATE_LABELS.no_data
}

/**
 * Is `row` an accumulation day relative to `prev` — the direct mirror of
 * a distribution day? Up close on heavier volume.
 *
 * Returns null when the pair cannot be evaluated, matching
 * classifyDay's contract in distributionDays.js.
 */
export function classifyAccumulationDay(row, prev) {
  if (!row || !prev) return null
  if (row.close == null || prev.close == null) return null
  if (row.volume == null || prev.volume == null) return null

  const priceUp  = row.close > prev.close
  const volumeUp = row.volume > prev.volume
  if (!priceUp || !volumeUp) return null

  const gainPct = ((row.close - prev.close) / prev.close) * 100

  // Where the close sat in the day's range: 1 = at the high. A close at
  // the top of the range on heavy volume is the strongest version of
  // this; mid-range on heavy volume can be churning.
  let closePosition = null
  if (row.high != null && row.low != null && row.high > row.low) {
    closePosition = (row.close - row.low) / (row.high - row.low)
  }

  return {
    date:          row.date,
    close:         row.close,
    prevClose:     prev.close,
    volume:        row.volume,
    prevVolume:    prev.volume,
    gainPct:       Number(gainPct.toFixed(2)),
    closePosition: closePosition == null ? null : Number(closePosition.toFixed(3)),
  }
}

/**
 * Locate the live rally attempt: the most recent decline of at least
 * `correctionPct` whose low has not since been undercut.
 *
 * Returns null when the index has not corrected that far, or when it has
 * already climbed back above the peak that preceded the decline — in
 * both cases there is nothing awaiting confirmation.
 *
 * A new high above the pre-decline peak clears the attempt rather than
 * leaving it open forever: once the index exceeds where it fell from,
 * the recovery is a fact and no longer needs confirming.
 */
export function findRallyAttempt(series, { correctionPct = CORRECTION_PCT } = {}) {
  if (!series || series.length < 2) return null

  let peakClose = series[0].close
  let peakIndex = 0
  let inCorrection = false
  let lowClose = Infinity
  let lowIndex = -1
  let correctionPeakClose = null
  let correctionPeakIndex = -1

  for (let i = 0; i < series.length; i += 1) {
    const c = series[i].close
    if (c == null) continue

    if (!inCorrection && c > peakClose) {
      peakClose = c
      peakIndex = i
      continue
    }

    if (inCorrection && c > correctionPeakClose) {
      // Exceeded the peak the decline started from — attempt resolved.
      inCorrection = false
      lowClose = Infinity
      lowIndex = -1
      peakClose = c
      peakIndex = i
      correctionPeakClose = null
      correctionPeakIndex = -1
      continue
    }

    const declinePct = ((peakClose - c) / peakClose) * 100
    if (!inCorrection && declinePct >= correctionPct) {
      inCorrection = true
      correctionPeakClose = peakClose
      correctionPeakIndex = peakIndex
      lowClose = c
      lowIndex = i
    } else if (inCorrection && c < lowClose) {
      // Undercut — the attempt restarts from the new low.
      lowClose = c
      lowIndex = i
    }
  }

  if (!inCorrection || lowIndex < 0) return null

  return {
    lowIndex,
    lowDate:   series[lowIndex].date,
    lowClose,
    peakIndex: correctionPeakIndex,
    peakDate:  series[correctionPeakIndex]?.date ?? null,
    peakClose: correctionPeakClose,
    declinePct: Number((((correctionPeakClose - lowClose) / correctionPeakClose) * 100).toFixed(2)),
  }
}

/**
 * Core entry point. Feed it an OHLCV series (~60+ sessions recommended so
 * a correction and its recovery both fit) and get the market-condition
 * read back.
 *
 * Returns:
 *   {
 *     state,              // key into STATE_LABELS
 *     label,              // resolved descriptor
 *     attempt,            // rally-attempt anchor, or null
 *     dayCount,           // sessions since day 1 (1-based), or 0
 *     followThrough,      // the confirming session, or null
 *     laterConfirmations, // any further qualifying sessions
 *     accumulationCount,  // accumulation days in the trailing window
 *     accumulationDays,   // those days, oldest-first
 *     windowStart, windowEnd, sessionsAnalysed,
 *   }
 *
 * Degrades safely: fewer than 2 usable rows returns a zeroed result with
 * state = no_data rather than throwing.
 */
export function computeFollowThrough(rows, {
  correctionPct = CORRECTION_PCT,
  minDay = RALLY_MIN_DAY,
  gainPct = FOLLOW_THROUGH_PCT,
  windowDays = WINDOW_DAYS,
} = {}) {
  const series = normaliseSeries(rows)

  const base = {
    state: 'no_data',
    label: labelForState('no_data'),
    attempt: null,
    dayCount: 0,
    followThrough: null,
    laterConfirmations: [],
    accumulationCount: 0,
    accumulationDays: [],
    windowStart: null,
    windowEnd: null,
    sessionsAnalysed: series.length,
  }

  if (series.length < 2) return base

  // ── Accumulation days over the trailing window ────────────────────
  const windowRows = series.slice(-windowDays)
  const accumulationDays = []
  for (let i = 0; i < windowRows.length; i += 1) {
    // Reach back into the full series for the previous session so the
    // first row of the window is still comparable.
    const absolute = series.length - windowRows.length + i
    const prev = series[absolute - 1]
    const hit = classifyAccumulationDay(windowRows[i], prev)
    if (hit) accumulationDays.push(hit)
  }

  const withWindow = {
    ...base,
    accumulationCount: accumulationDays.length,
    accumulationDays,
    windowStart: windowRows[0]?.date ?? null,
    windowEnd: windowRows[windowRows.length - 1]?.date ?? null,
  }

  const attempt = findRallyAttempt(series, { correctionPct })
  if (!attempt) {
    return { ...withWindow, state: 'no_correction', label: labelForState('no_correction') }
  }

  // ── Walk the whole correction episode ─────────────────────────────
  // Not just the current low. Undercutting the low does TWO things: it
  // voids any confirmation the previous attempt earned, AND it starts a
  // fresh attempt from the new low. Anchoring only on the latest low
  // reports the fresh attempt and silently loses the breakage, which is
  // the more important half — "the recovery just broke" beats "day 0 of
  // something new".
  const startIndex = attempt.peakIndex >= 0 ? attempt.peakIndex : 0

  let qualified = false          // decline has reached correctionPct
  let lowIndex = -1
  let lowClose = Infinity
  let day1 = -1
  let confirmations = []
  let brokenConfirmation = null  // a confirmation a later low undercut

  for (let i = startIndex; i < series.length; i += 1) {
    const c = series[i].close
    if (c == null) continue

    if (!qualified) {
      const decline = ((attempt.peakClose - c) / attempt.peakClose) * 100
      if (decline >= correctionPct) qualified = true
      else continue
    }

    if (c < lowClose) {
      // New low. Anything the previous attempt earned is void.
      if (confirmations.length) brokenConfirmation = confirmations[0]
      lowClose = c
      lowIndex = i
      day1 = -1
      confirmations = []
      continue
    }

    if (lowIndex < 0) continue

    if (day1 < 0) {
      const prev = series[i - 1]
      if (i > lowIndex && prev && prev.close != null && c > prev.close) day1 = i
      continue   // day 1 itself can never satisfy the day-4 rule
    }

    const day = i - day1 + 1
    if (day < minDay) continue

    const prev = series[i - 1]
    if (!prev || prev.close == null || prev.volume == null) continue
    if (series[i].volume == null) continue

    const gain = ((c - prev.close) / prev.close) * 100
    if (gain < gainPct) continue
    if (!(series[i].volume > prev.volume)) continue

    confirmations.push({
      date:       series[i].date,
      dayNumber:  day,
      close:      c,
      prevClose:  prev.close,
      gainPct:    Number(gain.toFixed(2)),
      volume:     series[i].volume,
      prevVolume: prev.volume,
    })
  }

  const dayCount = day1 < 0 ? 0 : series.length - day1

  if (confirmations.length) {
    const [followThrough, ...laterConfirmations] = confirmations
    return {
      ...withWindow,
      state: 'confirmed',
      label: labelForState('confirmed'),
      attempt, dayCount, followThrough, laterConfirmations,
    }
  }

  // A confirmation that was undercut is reported as failed even though a
  // new attempt is already under way — the breakage is the news.
  if (brokenConfirmation) {
    return {
      ...withWindow,
      state: 'failed',
      label: labelForState('failed'),
      attempt, dayCount,
      followThrough: brokenConfirmation,
      laterConfirmations: [],
    }
  }

  return {
    ...withWindow, state: 'attempt', label: labelForState('attempt'),
    attempt, dayCount,
  }
}

/**
 * Selling pressure and buying participation resolved into ONE condition.
 *
 * WHY THIS HAS TO EXIST
 *   The card used to headline the distribution count alone. That count
 *   only rises as selling accumulates, so a market whose recovery had
 *   just broken — no time yet to rack up distribution days — displayed
 *   as "0 · Healthy · Full exposure" while the follow-through row
 *   directly beneath it read "Undercut". The two halves contradicted
 *   each other, in the least helpful direction.
 *
 *   Neither number is sufficient alone:
 *     distribution   says how hard institutions are selling INTO a trend
 *     follow-through says whether a decline has been answered at all
 *
 *   A count of zero means "nobody is selling" — which is equally true of
 *   a healthy advance and of a market that has already fallen and has no
 *   trend left to sell into.
 *
 * THE MAPPING
 *                        distribution 0-4      distribution 5+
 *   confirmed / none     uptrend               under pressure
 *   attempt / failed     correction            correction
 *
 *   Follow-through decides WHETHER there is a trend; distribution decides
 *   how much strain it is under. A broken or unconfirmed rally is a
 *   correction no matter how little selling has registered yet.
 *
 * Pure, no I/O. `distributionCount` comes from computeDistributionDays,
 * `followThroughState` from computeFollowThrough.
 */
export const PRESSURE_THRESHOLD = 5

export const CONDITIONS = {
  uptrend:        { key: 'uptrend',        label: 'Uptrend',        detail: 'Recovery confirmed, selling light',       tone: 'green'   },
  under_pressure: { key: 'under_pressure', label: 'Under pressure', detail: 'Trend intact, institutions selling into it', tone: 'amber' },
  correction:     { key: 'correction',     label: 'In correction',  detail: 'No confirmed recovery from the last low',  tone: 'red'     },
  unknown:        { key: 'unknown',        label: 'Unread',         detail: 'Not enough history to judge',             tone: 'neutral' },
}

export function marketCondition(distributionCount, followThroughState) {
  // Explicit null/undefined/'' guard BEFORE Number(), the same trap
  // distributionDays.js documents in its num() helper: Number(null) and
  // Number('') are both 0, and 0 passes Number.isFinite. Without this a
  // MISSING count reads as "no selling" and resolves to `uptrend` — the
  // most favourable possible reading of data we do not have.
  if (distributionCount == null || distributionCount === '') return CONDITIONS.unknown
  const count = Number(distributionCount)
  if (!Number.isFinite(count) || !followThroughState) return CONDITIONS.unknown
  if (followThroughState === 'no_data') return CONDITIONS.unknown

  // An unconfirmed or broken rally is a correction regardless of how
  // quiet the selling has been — there is no trend to be pressuring.
  if (followThroughState === 'attempt' || followThroughState === 'failed') {
    return CONDITIONS.correction
  }
  return count >= PRESSURE_THRESHOLD ? CONDITIONS.under_pressure : CONDITIONS.uptrend
}

/**
 * Merge two index reads the way combineIndexReads does for distribution
 * days: the stronger claim wins, so a confirmation on either index shows
 * as confirmed, and an undercut on either shows as undercut.
 *
 * Undercut outranks confirmed deliberately — a broken low on one index
 * is information the other index confirming does not erase.
 */
export function combineFollowThrough(primary, secondary) {
  if (!primary) return secondary || null
  if (!secondary) return primary
  const rank = { no_data: 0, no_correction: 1, attempt: 2, confirmed: 3, recovered: 4, failed: 5 }
  return (rank[secondary.state] ?? 0) > (rank[primary.state] ?? 0) ? secondary : primary
}
