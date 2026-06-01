// StockDetailChartColumn — the main price chart on the stock detail
// page. Built on TradingView's Lightweight Charts (MIT licensed,
// the open-source library that powers the lite charts on
// tradingview.com itself). Two panes:
//
//   PANE 0 (top, ~280px): Candlestick + 2 moving averages
//                         Daily   → 50 DMA  (blue)  + 150 DMA (amber)
//                         Weekly  → 10 WMA  (blue)  + 30 WMA  (amber)
//
//   PANE 1 (bottom, ~90px): Mansfield-style Mansfield RS (rs_vs_nifty
//                           value from the cached pipeline). Crosses
//                           above zero = outperforming the index;
//                           below = lagging. Time axis synced with
//                           the candle pane.
//
// Below the chart: the existing volume + delivery histogram (kept
// as a custom React component because the delivery-on-top-of-volume
// overlay isn't easily expressible in Lightweight Charts).

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
} from 'lightweight-charts'

// ── Theme colours ───────────────────────────────────────────────
// All resolved at render time from CSS vars so the chart honours
// the active app theme (dark / sepia / light).
function readCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const UP_COLOR    = '#10B981'   // emerald  — bullish candle
const DOWN_COLOR  = '#EF4444'   // red      — bearish candle
const MA_SHORT    = '#60A5FA'   // blue     — 10W / 50D
const MA_LONG     = '#F59E0B'   // amber    — 30W / 150D
const RS_LINE     = '#FBBF24'   // gold     — Mansfield RS line
const RS_POS_BG   = 'rgba(16,185,129,0.08)'
const RS_NEG_BG   = 'rgba(239,68,68,0.08)'

function valueNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** ISO week + year for bucketing (UTC). */
function isoWeekYear(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7)
  return { y: date.getUTCFullYear(), w: week }
}

/** Daily rows (any order) → ascending by date → weekly OHLCV. */
function buildWeeklyBarsFromDaily(rows) {
  if (!rows?.length) return []
  const asc = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const buckets = new Map()

  for (const r of asc) {
    const ds = String(r.date || '').slice(0, 10)
    if (!ds) continue
    const d = new Date(`${ds}T12:00:00Z`)
    if (Number.isNaN(d.getTime())) continue
    const { y, w } = isoWeekYear(d)
    const key = `${y}-W${String(w).padStart(2, '0')}`

    const o = valueNum(r.open)
    const h = valueNum(r.high)
    const l = valueNum(r.low)
    const c = valueNum(r.close)
    const v = valueNum(r.volume)

    let b = buckets.get(key)
    if (!b) {
      b = { time: ds, open: o, high: h, low: l, close: c, volume: v }
      buckets.set(key, b)
    } else {
      b.high = Math.max(b.high, h)
      b.low = Math.min(b.low, l)
      b.close = c
      b.volume = valueNum(b.volume) + v
      b.time = ds
    }
  }

  return [...buckets.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)))
}

/** Daily rows (newest-first) → ascending OHLC for Lightweight Charts. */
function buildDailyBars(rowsNewestFirst) {
  if (!rowsNewestFirst?.length) return []
  return [...rowsNewestFirst]
    .reverse()
    .map((r) => ({
      time: String(r.date || '').slice(0, 10),
      open: valueNum(r.open),
      high: valueNum(r.high),
      low: valueNum(r.low),
      close: valueNum(r.close),
    }))
    .filter((b) => b.time && b.close > 0)
}

/** Simple moving average over bar.close. Both daily and weekly safe. */
function smaOnCloses(bars, period) {
  if (!bars?.length || period <= 0) return []
  const out = []
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue
    let s = 0
    for (let j = 0; j < period; j++) s += valueNum(bars[i - j].close)
    out.push({ time: bars[i].time, value: s / period })
  }
  return out
}

/** Daily RS points → one value per ISO week (last value seen). */
function resampleRsToWeekly(dailyPoints) {
  const buckets = new Map()
  for (const p of dailyPoints) {
    const d = new Date(`${p.time}T12:00:00Z`)
    if (Number.isNaN(d.getTime())) continue
    const { y, w } = isoWeekYear(d)
    const key = `${y}-W${String(w).padStart(2, '0')}`
    buckets.set(key, { time: p.time, value: p.value })
  }
  return [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time))
}

/** Last 60 trading days ascending: volume + delivery overlay. */
function buildVolumeDeliverySeries(priceRowsNewestFirst, deliveryByDate) {
  const slice = (priceRowsNewestFirst || []).slice(0, 60)
  const asc = [...slice].reverse()
  return asc.map((r) => {
    const ds = String(r.date || '').slice(0, 10)
    const total = valueNum(r.volume)
    const delRow = deliveryByDate[ds]
    const dpct = delRow != null ? valueNum(delRow.delivery_pct) : null
    let delVol = null
    if (delRow && delRow.delivery_volume != null && valueNum(delRow.delivery_volume) > 0) {
      delVol = valueNum(delRow.delivery_volume)
    } else if (dpct != null && total > 0) {
      delVol = (total * dpct) / 100
    }
    return { date: ds, total, deliveryPct: dpct, deliveryVol: delVol }
  })
}

// ── Volume + delivery bars (unchanged) ──────────────────────────
function VolumeDeliveryBars({ series }) {
  const [tip, setTip] = useState(null)
  const maxV = useMemo(() => Math.max(1, ...series.map((s) => s.total)), [series])
  const BG = readCssVar('--bg-primary', '#0B0E14')
  const GRID = readCssVar('--border', '#1E2530')
  const VOL_GREY = GRID
  const DEL_GREEN = readCssVar('--accent', '#10B981')
  const MUTED = readCssVar('--text-muted', '#94A3B8')
  const TEXT = readCssVar('--text-primary', '#E2E8F0')

  if (!series.length) {
    return (
      <div style={{ height: 120, background: BG, border: `1px solid ${GRID}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: MUTED }}>
        No volume data
      </div>
    )
  }

  return (
    <div
      style={{ height: 120, background: BG, border: `1px solid ${GRID}`, borderRadius: 6, padding: '8px 8px 4px', position: 'relative' }}
      onMouseLeave={() => setTip(null)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 92 }}>
        {series.map((row, idx) => {
          const barH = (row.total / maxV) * 88
          const delH = row.deliveryVol != null && row.total > 0 ? (valueNum(row.deliveryVol) / row.total) * barH : 0
          return (
            <button
              type="button"
              key={`${row.date}-${idx}`}
              className="min-w-0 flex-1 border-0 bg-transparent p-0"
              style={{ height: barH || 2, cursor: 'default' }}
              onMouseEnter={() => setTip({ x: idx, date: row.date, pct: row.deliveryPct, vol: row.total })}
            >
              <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', background: VOL_GREY, borderRadius: 2, height: '100%', minHeight: 2, position: 'relative' }}>
                  <div
                    style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: `${Math.min(100, (delH / (barH || 1)) * 100)}%`,
                      minHeight: delH > 0 ? 1 : 0,
                      background: DEL_GREEN, borderRadius: 2, opacity: 0.92,
                    }}
                  />
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {tip ? (
        <div style={{ position: 'absolute', bottom: 4, left: 8, right: 8, fontSize: 11, color: TEXT, background: 'var(--bg-surface)', border: `1px solid ${GRID}`, borderRadius: 4, padding: '4px 8px' }}>
          {tip.date} · Del {tip.pct != null && Number.isFinite(tip.pct) ? `${tip.pct.toFixed(1)}%` : '—'} · Vol{' '}
          {tip.vol != null && Number.isFinite(tip.vol) ? tip.vol.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: MUTED }}>Volume (grey) + delivery (green) · last {series.length} sessions</div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────
export default function StockDetailChartColumn({ priceHistoryNewestFirst, deliveryRows }) {
  const hostRef = useRef(null)

  // Daily / Weekly toggle. Persisted across visits so power users
  // who prefer daily candles don't have to switch every time.
  const [tf, setTf] = useState(() => {
    try { return localStorage.getItem('pinex_chart_tf') === 'daily' ? 'daily' : 'weekly' }
    catch { return 'weekly' }
  })
  const setTimeframe = (next) => {
    setTf(next)
    try { localStorage.setItem('pinex_chart_tf', next) } catch { /* ignore */ }
  }

  const deliveryByDate = useMemo(() => {
    const m = {}
    for (const r of deliveryRows || []) {
      const ds = String(r.date || '').slice(0, 10)
      if (ds) m[ds] = r
    }
    return m
  }, [deliveryRows])

  // Bars for the selected timeframe.
  const bars = useMemo(() => {
    if (tf === 'daily') return buildDailyBars(priceHistoryNewestFirst || [])
    return buildWeeklyBarsFromDaily(priceHistoryNewestFirst || [])
  }, [priceHistoryNewestFirst, tf])

  // Two moving averages per timeframe.
  const maShortPeriod = tf === 'daily' ? 50 : 10
  const maLongPeriod  = tf === 'daily' ? 150 : 30
  const maShortLabel  = tf === 'daily' ? '50 DMA' : '10 WMA'
  const maLongLabel   = tf === 'daily' ? '150 DMA' : '30 WMA'

  const maShortData = useMemo(() => smaOnCloses(bars, maShortPeriod), [bars, maShortPeriod])
  const maLongData  = useMemo(() => smaOnCloses(bars, maLongPeriod),  [bars, maLongPeriod])

  // Mansfield Relative Strength (per-row time series, populated by
  // scripts/compute_mansfield_rs.py). Falls back to the older
  // rs_vs_nifty scalar field if mansfield_rs isn't there yet —
  // useful during the pipeline rollout when only newer rows have
  // the new column populated.
  const rsBars = useMemo(() => {
    const dailyRs = (priceHistoryNewestFirst || [])
      .map((r) => {
        // Prefer mansfield_rs (textbook 252-day RP/SMA(RP)−1×100);
        // fall back to the legacy rs_vs_nifty (1Y stock-minus-nifty
        // return) only when mansfield_rs is null.
        const m = Number(r?.mansfield_rs)
        if (Number.isFinite(m)) {
          return { time: String(r.date || '').slice(0, 10), value: m }
        }
        const legacy = Number(r?.rs_vs_nifty)
        if (Number.isFinite(legacy)) {
          return { time: String(r.date || '').slice(0, 10), value: legacy }
        }
        return null
      })
      .filter(Boolean)
      .sort((a, b) => a.time.localeCompare(b.time))
    if (tf === 'daily') return dailyRs
    return resampleRsToWeekly(dailyRs)
  }, [priceHistoryNewestFirst, tf])

  // Volume bars — last 60 daily sessions regardless of selected
  // timeframe. Daily granularity is the right frame for delivery
  // analysis even when looking at weekly candles above.
  const volSeries = useMemo(
    () => buildVolumeDeliverySeries(priceHistoryNewestFirst || [], deliveryByDate),
    [priceHistoryNewestFirst, deliveryByDate],
  )

  // ── Chart lifecycle ───────────────────────────────────────────
  useEffect(() => {
    const el = hostRef.current
    if (!el || bars.length === 0) return undefined

    const BG_RESOLVED   = readCssVar('--bg-primary', '#0B0E14')
    const GRID_RESOLVED = readCssVar('--border', '#1E2530')
    const MUTED_RESOLVED = readCssVar('--text-muted', '#94A3B8')

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: BG_RESOLVED },
        textColor: MUTED_RESOLVED,
        fontSize: 11,
        // Hide the TradingView attribution badge (allowed for the
        // MIT-licensed open-source build of Lightweight Charts).
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID_RESOLVED, style: 1 },
        horzLines: { color: GRID_RESOLVED, style: 1 },
      },
      width: el.clientWidth,
      height: 420,
      rightPriceScale: {
        borderColor: GRID_RESOLVED,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: GRID_RESOLVED,
        rightOffset: 4,
        barSpacing: tf === 'daily' ? 4 : 6,
      },
      crosshair: { mode: 1 }, // magnet to data
    })

    // ── PANE 0: Candles + MAs ──────────────────────────────────
    const cand = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      borderVisible: false,
      priceLineVisible: false,
    })
    cand.setData(bars)

    const maShort = chart.addSeries(LineSeries, {
      color: MA_SHORT,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: maShortLabel,
    })
    maShort.setData(maShortData)

    const maLong = chart.addSeries(LineSeries, {
      color: MA_LONG,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: maLongLabel,
    })
    maLong.setData(maLongData)

    // ── PANE 1: Mansfield Mansfield RS ──────────────────────────
    // Lightweight Charts v5 accepts pane index as the third arg
    // to addSeries; the new pane is created lazily.
    if (rsBars.length > 0) {
      const rs = chart.addSeries(LineSeries, {
        color: RS_LINE,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'Mansfield RS',
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      }, 1)
      rs.setData(rsBars)

      // Zero reference line in the RS pane.
      const zero = chart.addSeries(LineSeries, {
        color: 'rgba(148,163,184,0.5)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: false,
      }, 1)
      zero.setData(rsBars.map((p) => ({ time: p.time, value: 0 })))

      // Size the RS pane smaller than the main pane.
      try {
        const panes = chart.panes()
        if (panes.length >= 2 && typeof panes[1].setHeight === 'function') {
          panes[1].setHeight(90)
        }
      } catch { /* older API or panes not yet ready — ignore */ }
    }

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (!hostRef.current) return
      chart.applyOptions({ width: hostRef.current.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [bars, maShortData, maLongData, rsBars, maShortLabel, maLongLabel, tf])

  const noBars = bars.length === 0
  const BG = readCssVar('--bg-primary', '#0B0E14')
  const GRID = readCssVar('--border', '#1E2530')
  const MUTED = readCssVar('--text-muted', '#94A3B8')
  const ACCENT = readCssVar('--accent', '#10B981')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {/* Header — title + timeframe toggle + MA legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>
            {tf === 'daily' ? 'Daily' : 'Weekly'} chart
          </span>
          {/* Legend chips */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: MUTED }}>
            <span style={{ width: 12, height: 2, background: MA_SHORT, display: 'inline-block' }} />
            {maShortLabel}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: MUTED }}>
            <span style={{ width: 12, height: 2, background: MA_LONG, display: 'inline-block' }} />
            {maLongLabel}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: MUTED }}>
            <span style={{ width: 12, height: 2, background: RS_LINE, display: 'inline-block' }} />
            Mansfield RS
          </span>
        </div>

        {/* Daily / Weekly toggle */}
        <div
          role="tablist"
          aria-label="Chart timeframe"
          style={{
            display: 'inline-flex',
            background: 'var(--bg-elevated)',
            border: `1px solid ${GRID}`,
            borderRadius: 999,
            padding: 2,
          }}
        >
          {['daily', 'weekly'].map((t) => {
            const active = tf === t
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTimeframe(t)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  border: 'none',
                  background: active ? ACCENT : 'transparent',
                  color: active ? '#000' : MUTED,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chart host (two panes: candles + MAs on top, Mansfield RS below) */}
      <div
        ref={hostRef}
        style={{
          width: '100%',
          height: 420,
          borderRadius: 8,
          overflow: 'hidden',
          border: `1px solid ${GRID}`,
          position: 'relative',
          ...(noBars
            ? { display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, fontSize: 11, color: MUTED }
            : {}),
        }}
      >
        {noBars ? `Not enough history for ${tf} candles` : null}
      </div>

      {/* Volume + delivery (60 daily sessions, independent of timeframe) */}
      <VolumeDeliveryBars series={volSeries} />
    </div>
  )
}
