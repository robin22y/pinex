/**
 * Tests for followThrough.js
 *
 * Run: npm test          (or: node --test src/lib/followThrough.test.js)
 *
 * Same conventions as distributionDays.test.js — Node's built-in runner,
 * no new dependencies.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONDITIONS,
  CORRECTION_PCT,
  FOLLOW_THROUGH_PCT,
  PRESSURE_THRESHOLD,
  RALLY_MIN_DAY,
  classifyAccumulationDay,
  combineFollowThrough,
  computeFollowThrough,
  findRallyAttempt,
  labelForState,
  marketCondition,
} from './followThrough.js'

// ── helpers ────────────────────────────────────────────────────────
const row = (date, { close, volume, high, low, open } = {}) => ({
  date,
  open:   open  ?? close,
  high:   high  ?? close,
  low:    low   ?? close,
  close,
  volume: volume ?? 1000,
})

const d = (n) => `2026-01-${String(n).padStart(2, '0')}`

/** Peak at 100, decline to `low`, then a recovery leg the caller shapes. */
function scenario(recovery) {
  const rows = [
    row(d(1), { close: 100, volume: 1000 }),
    row(d(2), { close:  99, volume: 1000 }),
    row(d(3), { close:  97, volume: 1000 }),
    row(d(4), { close:  95, volume: 1000 }),   // -5% low
  ]
  recovery.forEach((r, i) => rows.push(row(d(5 + i), r)))
  return rows
}

// ── accumulation days ──────────────────────────────────────────────
test('accumulation day needs price up AND volume up', () => {
  const prev = row(d(1), { close: 100, volume: 1000 })
  assert.ok(classifyAccumulationDay(row(d(2), { close: 101, volume: 1200 }), prev))
  assert.equal(classifyAccumulationDay(row(d(2), { close: 101, volume: 900 }), prev), null,
    'price up but volume down is not accumulation')
  assert.equal(classifyAccumulationDay(row(d(2), { close: 99, volume: 1200 }), prev), null,
    'volume up but price down is distribution, not accumulation')
})

test('accumulation day reports gain and close position', () => {
  const prev = row(d(1), { close: 100, volume: 1000 })
  const hit = classifyAccumulationDay(
    row(d(2), { close: 102, volume: 1500, high: 103, low: 101 }), prev)
  assert.equal(hit.gainPct, 2)
  assert.equal(hit.closePosition, 0.5)
})

test('accumulation day degrades safely on missing data', () => {
  assert.equal(classifyAccumulationDay(null, null), null)
  assert.equal(classifyAccumulationDay(row(d(2), { close: 101 }), null), null)
  assert.equal(
    classifyAccumulationDay({ date: d(2), close: null, volume: 1 },
                            { date: d(1), close: 100, volume: 1 }), null)
})

// ── rally attempt detection ────────────────────────────────────────
test('no attempt when the decline is shallower than the threshold', () => {
  const rows = [
    row(d(1), { close: 100 }), row(d(2), { close: 99 }), row(d(3), { close: 99.5 }),
  ]
  assert.equal(findRallyAttempt(rows), null)
})

test('attempt anchors on the low of a qualifying decline', () => {
  const a = findRallyAttempt(scenario([{ close: 96, volume: 1000 }]))
  assert.equal(a.lowDate, d(4))
  assert.equal(a.lowClose, 95)
  assert.equal(a.declinePct, 5)
})

test('a lower low moves the anchor rather than starting a second attempt', () => {
  const rows = scenario([
    { close: 96, volume: 1000 },
    { close: 93, volume: 1000 },   // undercuts the old low
    { close: 94, volume: 1000 },
  ])
  const a = findRallyAttempt(rows)
  assert.equal(a.lowClose, 93)
  assert.equal(a.lowDate, d(6))
})

test('clearing the pre-decline peak resolves the attempt', () => {
  const rows = scenario([
    { close: 97, volume: 1000 }, { close: 99, volume: 1000 },
    { close: 101, volume: 1000 },  // back above the 100 peak
  ])
  assert.equal(findRallyAttempt(rows), null,
    'nothing left to confirm once the index exceeds where it fell from')
})

// ── the day-4 rule ─────────────────────────────────────────────────
test('a big gain before day 4 does NOT confirm', () => {
  // day1 = first up close after the low, then a 2% pop on day 2
  const res = computeFollowThrough(scenario([
    { close: 95.5, volume: 1000 },              // day 1
    { close: 97.5, volume: 5000 },              // day 2 — +2.1% heavy
    { close: 97.6, volume: 1000 },
  ]))
  assert.equal(res.state, 'attempt')
  assert.equal(res.followThrough, null)
})

test('the same gain on day 4 confirms', () => {
  const res = computeFollowThrough(scenario([
    { close: 95.5, volume: 1000 },              // day 1
    { close: 95.6, volume: 1000 },              // day 2
    { close: 95.7, volume: 1000 },              // day 3
    { close: 97.5, volume: 5000 },              // day 4 — +1.9% heavy
  ]))
  assert.equal(res.state, 'confirmed')
  assert.equal(res.followThrough.dayNumber, RALLY_MIN_DAY)
  assert.ok(res.followThrough.gainPct >= FOLLOW_THROUGH_PCT)
})

test('a day-4 gain on LIGHTER volume does not confirm', () => {
  const res = computeFollowThrough(scenario([
    { close: 95.5, volume: 2000 },
    { close: 95.6, volume: 2000 },
    { close: 95.7, volume: 2000 },
    { close: 97.5, volume: 900 },               // big gain, thin volume
  ]))
  assert.equal(res.state, 'attempt')
})

test('a day-4 volume surge on too small a gain does not confirm', () => {
  const res = computeFollowThrough(scenario([
    { close: 95.5, volume: 1000 }, { close: 95.6, volume: 1000 },
    { close: 95.7, volume: 1000 },
    { close: 96.0, volume: 9000 },              // +0.3% only
  ]))
  assert.equal(res.state, 'attempt')
})

test('the threshold is configurable', () => {
  const rows = scenario([
    { close: 95.5, volume: 1000 }, { close: 95.6, volume: 1000 },
    { close: 95.7, volume: 1000 },
    { close: 96.8, volume: 5000 },              // +1.15%
  ])
  assert.equal(computeFollowThrough(rows, { gainPct: 1 }).state, 'confirmed')
  assert.equal(computeFollowThrough(rows, { gainPct: 1.25 }).state, 'attempt',
    'the stricter 1.25% reading rejects what 1% accepts')
})

// ── failure ────────────────────────────────────────────────────────
test('undercutting the rally low voids a confirmation', () => {
  const res = computeFollowThrough(scenario([
    { close: 95.5, volume: 1000 }, { close: 95.6, volume: 1000 },
    { close: 95.7, volume: 1000 },
    { close: 97.5, volume: 5000 },              // confirms
    { close: 94.0, volume: 1000 },              // below the 95 low
  ]))
  assert.equal(res.state, 'failed')
  assert.ok(res.followThrough, 'the confirming day is still reported')
})

test('a dip that stays above the low keeps the confirmation', () => {
  const res = computeFollowThrough(scenario([
    { close: 95.5, volume: 1000 }, { close: 95.6, volume: 1000 },
    { close: 95.7, volume: 1000 },
    { close: 97.5, volume: 5000 },
    { close: 95.4, volume: 1000 },              // above 95
  ]))
  assert.equal(res.state, 'confirmed')
})

// ── degradation ────────────────────────────────────────────────────
test('too little history returns no_data, not a throw', () => {
  const res = computeFollowThrough([row(d(1), { close: 100 })])
  assert.equal(res.state, 'no_data')
  assert.equal(res.followThrough, null)
})

test('empty and malformed input are safe', () => {
  assert.equal(computeFollowThrough([]).state, 'no_data')
  assert.equal(computeFollowThrough(null).state, 'no_data')
  assert.equal(computeFollowThrough([{}, {}]).state, 'no_data')
})

test('rows missing volume are dropped rather than treated as zero', () => {
  const res = computeFollowThrough([
    row(d(1), { close: 100, volume: 1000 }),
    { date: d(2), close: 95, volume: null },
    row(d(3), { close: 96, volume: 1000 }),
  ])
  assert.equal(res.sessionsAnalysed, 2)
})

test('labelForState never returns undefined', () => {
  assert.ok(labelForState('confirmed').label)
  assert.ok(labelForState('nonsense').label)
  assert.ok(labelForState(undefined).label)
})

// ── combining two indices ──────────────────────────────────────────
test('combine prefers the more advanced state', () => {
  const attempt   = { state: 'attempt' }
  const confirmed = { state: 'confirmed' }
  assert.equal(combineFollowThrough(attempt, confirmed), confirmed)
  assert.equal(combineFollowThrough(confirmed, attempt), confirmed)
})

test('an undercut on either index outranks a confirmation on the other', () => {
  const confirmed = { state: 'confirmed' }
  const failed    = { state: 'failed' }
  assert.equal(combineFollowThrough(confirmed, failed), failed,
    'a broken low is not erased by the other index confirming')
})

test('combine tolerates a missing side', () => {
  const only = { state: 'attempt' }
  assert.equal(combineFollowThrough(only, null), only)
  assert.equal(combineFollowThrough(null, only), only)
  assert.equal(combineFollowThrough(null, null), null)
})

// ── accumulation counting ──────────────────────────────────────────
test('accumulation days are counted over the trailing window', () => {
  const rows = [
    row(d(1), { close: 100, volume: 1000 }),
    row(d(2), { close: 101, volume: 1200 }),   // accumulation
    row(d(3), { close: 102, volume: 900 }),    // up, thin — no
    row(d(4), { close: 103, volume: 1500 }),   // accumulation
  ]
  const res = computeFollowThrough(rows)
  assert.equal(res.accumulationCount, 2)
  assert.deepEqual(res.accumulationDays.map((a) => a.date), [d(2), d(4)])
})

test('the window boundary still compares against the prior session', () => {
  const rows = [
    row(d(1), { close: 100, volume: 1000 }),
    row(d(2), { close: 101, volume: 1200 }),
    row(d(3), { close: 102, volume: 1300 }),
  ]
  // window of 2 covers d(2)+d(3); d(2) must still see d(1) as its prev
  const res = computeFollowThrough(rows, { windowDays: 2 })
  assert.equal(res.accumulationCount, 2)
})

test('CORRECTION_PCT is exported and sane', () => {
  assert.ok(CORRECTION_PCT > 0 && CORRECTION_PCT < 20)
})

// ── combined market condition ──────────────────────────────────────
test('light selling plus a confirmed recovery reads as an uptrend', () => {
  assert.equal(marketCondition(0, 'confirmed').key, 'uptrend')
  assert.equal(marketCondition(4, 'confirmed').key, 'uptrend')
  assert.equal(marketCondition(2, 'no_correction').key, 'uptrend')
})

test('heavy selling into a confirmed trend reads as under pressure', () => {
  assert.equal(marketCondition(PRESSURE_THRESHOLD, 'confirmed').key, 'under_pressure')
  assert.equal(marketCondition(9, 'no_correction').key, 'under_pressure')
})

test('THE BUG THIS FIXES: a broken rally is a correction even at zero selling', () => {
  // Previously the card headlined "0 · Healthy · Full exposure" here,
  // directly above a follow-through row reading "Undercut".
  assert.equal(marketCondition(0, 'failed').key, 'correction')
  assert.equal(marketCondition(0, 'attempt').key, 'correction')
})

test('a broken rally stays a correction however much selling has registered', () => {
  assert.equal(marketCondition(9, 'failed').key, 'correction')
})

test('condition degrades to unknown rather than guessing', () => {
  assert.equal(marketCondition(0, 'no_data').key, 'unknown')
  assert.equal(marketCondition(null, 'confirmed').key, 'unknown')
  assert.equal(marketCondition(undefined, undefined).key, 'unknown')
  assert.equal(marketCondition(NaN, 'confirmed').key, 'unknown')
})

test('every condition carries a label, detail and tone', () => {
  for (const c of Object.values(CONDITIONS)) {
    assert.ok(c.label && c.detail && c.tone, `${c.key} is incomplete`)
  }
})
