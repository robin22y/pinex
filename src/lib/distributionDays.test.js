/**
 * Tests for distributionDays.js
 *
 * Run: npm test          (or: node --test src/lib/distributionDays.test.js)
 *
 * Uses Node's built-in test runner + assert — no new dependencies.
 * The repo has no test framework configured; node:test ships with
 * Node 18+ and the project is already "type": "module", so these
 * run as-is.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONDITION_BANDS,
  RALLY_EXPIRY_PCT,
  WINDOW_DAYS,
  bandForCount,
  classifyDay,
  combineIndexReads,
  computeDistributionDays,
  isExpiredByRally,
  normaliseSeries,
} from './distributionDays.js'

// ── helpers ────────────────────────────────────────────────────────
/** Build one OHLCV row. Defaults give a flat, non-distribution day. */
const row = (date, { close, volume, high, low, open } = {}) => ({
  date,
  open:   open  ?? close,
  high:   high  ?? close,
  low:    low   ?? close,
  close,
  volume,
})

/** N sessions of a flat, rising-volume market — never distribution. */
function flatSeries(n, startDate = '2026-01-01') {
  const out = []
  const d = new Date(startDate)
  for (let i = 0; i < n; i++) {
    d.setDate(d.getDate() + 1)
    out.push(row(d.toISOString().slice(0, 10), { close: 100, volume: 1000 }))
  }
  return out
}

// ── bandForCount ───────────────────────────────────────────────────
test('bandForCount maps every documented boundary', () => {
  assert.equal(bandForCount(0).key, 'healthy')
  assert.equal(bandForCount(2).key, 'healthy')
  assert.equal(bandForCount(3).key, 'warning')
  assert.equal(bandForCount(4).key, 'warning')
  assert.equal(bandForCount(5).key, 'caution')
  assert.equal(bandForCount(6).key, 'high_risk')
  assert.equal(bandForCount(7).key, 'defensive')
  assert.equal(bandForCount(99).key, 'defensive')
})

test('bandForCount never throws on junk input', () => {
  assert.equal(bandForCount(null).key,      'healthy')
  assert.equal(bandForCount(undefined).key, 'healthy')
  assert.equal(bandForCount(NaN).key,       'healthy')
  assert.equal(bandForCount(-5).key,        'healthy')
  assert.equal(bandForCount('3').key,       'warning')  // numeric string coerces
})

test('CONDITION_BANDS covers 0..Infinity with no gaps', () => {
  for (let n = 0; n <= 20; n++) {
    assert.ok(bandForCount(n), `no band for count ${n}`)
  }
  assert.equal(CONDITION_BANDS[CONDITION_BANDS.length - 1].max, Infinity)
})

// ── normaliseSeries ────────────────────────────────────────────────
test('normaliseSeries sorts oldest-first and drops unusable rows', () => {
  const input = [
    row('2026-01-03', { close: 102, volume: 1200 }),
    row('2026-01-01', { close: 100, volume: 1000 }),
    { date: '2026-01-02', close: null, volume: 900 },   // no close -> dropped
    { date: null,        close: 99,   volume: 900 },    // no date  -> dropped
    { date: '2026-01-04', close: 98,  volume: null },   // no volume-> dropped
  ]
  const out = normaliseSeries(input)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((r) => r.date), ['2026-01-01', '2026-01-03'])
})

test('normaliseSeries truncates timestamps to YYYY-MM-DD', () => {
  const out = normaliseSeries([
    { date: '2026-01-01T18:30:00+00:00', close: 100, volume: 1000 },
  ])
  assert.equal(out[0].date, '2026-01-01')
})

// ── classifyDay ────────────────────────────────────────────────────
test('classifyDay: price down + volume up = distribution', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1000 })
  const day  = row('2026-01-02', { close:  99, volume: 1500 })
  const v = classifyDay(day, prev)
  assert.ok(v, 'expected a distribution verdict')
  assert.equal(v.date, '2026-01-02')
  assert.equal(v.fallPct, 1)
})

test('classifyDay: price down on LOWER volume is not distribution', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1500 })
  const day  = row('2026-01-02', { close:  99, volume: 1000 })
  assert.equal(classifyDay(day, prev), null)
})

test('classifyDay: price UP on higher volume is not distribution', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1000 })
  const day  = row('2026-01-02', { close: 101, volume: 1500 })
  assert.equal(classifyDay(day, prev), null)
})

test('classifyDay: flat close is not distribution (strict <)', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1000 })
  const day  = row('2026-01-02', { close: 100, volume: 1500 })
  assert.equal(classifyDay(day, prev), null)
})

test('classifyDay: equal volume is not distribution (strict >)', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1000 })
  const day  = row('2026-01-02', { close:  99, volume: 1000 })
  assert.equal(classifyDay(day, prev), null)
})

test('classifyDay: STRONG needs >1% fall AND close in bottom third', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1000 })
  // -2%, closes at the very low  -> strong
  const strong = classifyDay(
    row('2026-01-02', { close: 98, volume: 1500, high: 100.5, low: 98 }),
    prev,
  )
  assert.equal(strong.isStrong, true)
  assert.equal(strong.closePosition, 0)

  // -2% but closes at the HIGH of the range -> not strong
  const topClose = classifyDay(
    row('2026-01-02', { close: 98, volume: 1500, high: 98, low: 95 }),
    prev,
  )
  assert.equal(topClose.isStrong, false)
  assert.equal(topClose.closePosition, 1)

  // closes at the low but only -0.5% -> not strong (fall too shallow)
  const shallow = classifyDay(
    row('2026-01-02', { close: 99.5, volume: 1500, high: 100.2, low: 99.5 }),
    prev,
  )
  assert.equal(shallow.isStrong, false)
})

test('classifyDay: degenerate range (high === low) is never STRONG', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1000 })
  const day  = row('2026-01-02', { close: 95, volume: 1500, high: 95, low: 95 })
  const v = classifyDay(day, prev)
  assert.equal(v.isStrong, false)
  assert.equal(v.closePosition, null)
})

test('classifyDay returns null on missing inputs', () => {
  const prev = row('2026-01-01', { close: 100, volume: 1000 })
  assert.equal(classifyDay(null, prev), null)
  assert.equal(classifyDay(prev, null), null)
  assert.equal(classifyDay({ date: 'x', close: null, volume: 1 }, prev), null)
  assert.equal(classifyDay({ date: 'x', close: 1, volume: null }, prev), null)
})

// ── isExpiredByRally ───────────────────────────────────────────────
test(`isExpiredByRally fires at exactly +${RALLY_EXPIRY_PCT}%`, () => {
  const day = { date: '2026-01-02', close: 100 }
  // 104.99 -> not yet
  assert.equal(isExpiredByRally(day, [row('2026-01-03', { close: 104.99, volume: 1 })]), false)
  // 105.00 -> expired (>= threshold)
  assert.equal(isExpiredByRally(day, [row('2026-01-03', { close: 105, volume: 1 })]), true)
})

test('isExpiredByRally scans every later row, not just the last', () => {
  const day = { date: '2026-01-02', close: 100 }
  const later = [
    row('2026-01-03', { close: 106, volume: 1 }),  // spike above threshold
    row('2026-01-04', { close:  99, volume: 1 }),  // then back below
  ]
  assert.equal(isExpiredByRally(day, later), true)
})

test('isExpiredByRally is false with no later rows', () => {
  assert.equal(isExpiredByRally({ close: 100 }, []),   false)
  assert.equal(isExpiredByRally({ close: 100 }, null), false)
})

// ── computeDistributionDays ────────────────────────────────────────
test('computeDistributionDays: empty / too-short input degrades safely', () => {
  for (const input of [null, undefined, [], [row('2026-01-01', { close: 100, volume: 10 })]]) {
    const r = computeDistributionDays(input)
    assert.equal(r.count, 0)
    assert.equal(r.strongCount, 0)
    assert.equal(r.band.key, 'healthy')
    assert.deepEqual(r.days, [])
  }
})

test('computeDistributionDays: flat market yields zero', () => {
  const r = computeDistributionDays(flatSeries(40))
  assert.equal(r.count, 0)
  assert.equal(r.band.key, 'healthy')
})

test('computeDistributionDays counts a simple 3-day distribution run', () => {
  // Base then three consecutive down-on-higher-volume days.
  const series = [
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),  // DD 1
    row('2026-01-03', { close:  98, volume: 1200 }),  // DD 2
    row('2026-01-06', { close:  97, volume: 1300 }),  // DD 3 (note: weekend gap)
  ]
  const r = computeDistributionDays(series)
  assert.equal(r.count, 3)
  assert.equal(r.band.key, 'warning')
  assert.equal(r.band.note, 'Selling starting to register')
  assert.deepEqual(r.days.map((d) => d.date), ['2026-01-02', '2026-01-03', '2026-01-06'])
})

test('computeDistributionDays: weekend/holiday gaps do not affect the count', () => {
  // Dates jump Fri -> Mon and skip a holiday; the calc is index-based
  // so only session ORDER matters.
  const series = [
    row('2026-01-02', { close: 100, volume: 1000 }),  // Fri
    row('2026-01-05', { close:  99, volume: 1100 }),  // Mon  DD 1
    row('2026-01-09', { close:  98, volume: 1200 }),  // Fri (Wed holiday) DD 2
  ]
  const r = computeDistributionDays(series)
  assert.equal(r.count, 2)
  assert.equal(r.sessionsAnalysed, 3)
})

test('computeDistributionDays expires a day after a 5% rally', () => {
  const series = [
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),  // DD — close 99
    // rally to 104: 99 * 1.05 = 103.95, so 104 clears the threshold
    row('2026-01-03', { close: 104, volume:  900 }),
  ]
  const r = computeDistributionDays(series)
  assert.equal(r.count, 0, 'the DD should have been expired by the rally')
  assert.equal(r.expired.length, 1)
  assert.equal(r.expired[0].date, '2026-01-02')
})

test('computeDistributionDays keeps a day when the rally falls just short', () => {
  const series = [
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),  // DD — threshold 103.95
    row('2026-01-03', { close: 103, volume:  900 }),  // short of it
  ]
  const r = computeDistributionDays(series)
  assert.equal(r.count, 1)
  assert.equal(r.expired.length, 0)
})

test(`computeDistributionDays honours the ${WINDOW_DAYS}-session window`, () => {
  // One DD, then WINDOW_DAYS quiet sessions push it out of range.
  const series = [
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),  // the DD
  ]
  // Append exactly WINDOW_DAYS flat sessions AFTER it. Keep closes
  // below the rally threshold so only the window rule can drop it.
  for (let i = 0; i < WINDOW_DAYS; i++) {
    series.push(row(`2026-02-${String(i + 1).padStart(2, '0')}`, { close: 99, volume: 500 }))
  }
  const r = computeDistributionDays(series)
  assert.equal(r.count, 0, 'DD older than the window must drop out')
  assert.equal(r.sessionsAnalysed, WINDOW_DAYS)
})

test('computeDistributionDays separates strong from normal days', () => {
  const series = [
    row('2026-01-01', { close: 100,  volume: 1000 }),
    // -2%, closes at the low -> STRONG
    row('2026-01-02', { close:  98,  volume: 1500, high: 100.2, low: 98 }),
    // -0.5%, closes mid-range -> normal
    row('2026-01-05', { close:  97.5, volume: 1600, high: 98.3, low: 97.2 }),
  ]
  const r = computeDistributionDays(series)
  assert.equal(r.count, 2)
  assert.equal(r.strongCount, 1)
  assert.equal(r.days.filter((d) => d.isStrong)[0].date, '2026-01-02')
})

test('computeDistributionDays emits a timeline entry per window session', () => {
  const series = [
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),
    row('2026-01-05', { close: 100, volume:  900 }),
  ]
  const r = computeDistributionDays(series)
  assert.equal(r.timeline.length, r.sessionsAnalysed)
  const kinds = r.timeline.map((t) => t.kind)
  assert.ok(kinds.includes('distribution'))
  assert.ok(kinds.includes('normal'))
})

test('computeDistributionDays reports the window bounds', () => {
  const series = flatSeries(5, '2026-03-01')
  const r = computeDistributionDays(series)
  assert.equal(r.windowStart, series[0].date)
  assert.equal(r.windowEnd,   series[series.length - 1].date)
})

test('computeDistributionDays escalates through every band', () => {
  const build = (ddCount) => {
    const s = [row('2026-01-01', { close: 200, volume: 1000 })]
    let close = 200
    let vol   = 1000
    for (let i = 0; i < ddCount; i++) {
      close -= 0.5   // small steps keep every DD inside the 5% rally rule
      vol   += 100
      s.push(row(`2026-01-${String(i + 2).padStart(2, '0')}`, { close, volume: vol }))
    }
    return s
  }
  assert.equal(computeDistributionDays(build(1)).band.key, 'healthy')
  assert.equal(computeDistributionDays(build(3)).band.key, 'warning')
  assert.equal(computeDistributionDays(build(5)).band.key, 'caution')
  assert.equal(computeDistributionDays(build(6)).band.key, 'high_risk')
  assert.equal(computeDistributionDays(build(8)).band.key, 'defensive')
})

// ── combineIndexReads ──────────────────────────────────────────────
test('combineIndexReads takes the higher-concern count', () => {
  const a = computeDistributionDays([
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),
  ])
  const b = computeDistributionDays([
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),
    row('2026-01-05', { close:  98, volume: 1200 }),
  ])
  const combined = combineIndexReads(a, b)
  assert.equal(combined.count, 2)
  assert.equal(combined.leader, 'secondary')
  assert.equal(combined.primaryCount, 1)
  assert.equal(combined.secondaryCount, 2)
})

test('combineIndexReads surfaces dates both indices distributed', () => {
  const mk = () => computeDistributionDays([
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),
  ])
  const combined = combineIndexReads(mk(), mk())
  assert.deepEqual(combined.sharedDates, ['2026-01-02'])
})

test('combineIndexReads tolerates a missing second index', () => {
  const a = computeDistributionDays([
    row('2026-01-01', { close: 100, volume: 1000 }),
    row('2026-01-02', { close:  99, volume: 1100 }),
  ])
  const only = combineIndexReads(a, null)
  assert.equal(only.count, 1)
  assert.equal(only.leader, 'primary')
  assert.deepEqual(only.sharedDates, [])

  const flipped = combineIndexReads(null, a)
  assert.equal(flipped.count, 1)
  assert.equal(flipped.leader, 'secondary')
})

test('combineIndexReads with two nulls is a zeroed healthy read', () => {
  const c = combineIndexReads(null, null)
  assert.equal(c.count, 0)
  assert.equal(c.band.key, 'healthy')
  assert.deepEqual(c.sharedDates, [])
})
