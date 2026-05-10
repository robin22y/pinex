import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
} from 'lightweight-charts'

const BG = '#0B0E11'
const GRID = '#1E2530'
const UP = '#00C805'
const DOWN = '#FF3B30'
const MA_COLOR = '#FBBF24'
const VOL_GREY = '#1E2530'
const DEL_GREEN = '#00C805'
const MUTED = '#64748B'
const TEXT = '#E2E8F0'

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

/** Daily rows (any order) → ascending by date → weekly OHLCV, time = last session YYYY-MM-DD in week. */
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
      b = {
        time: ds,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      }
      buckets.set(key, b)
    } else {
      b.high = Math.max(b.high, h)
      b.low = Math.min(b.low, l)
      b.close = c
      b.volume = valueNum(b.volume) + v
      b.time = ds
    }
  }

  const list = [...buckets.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)))
  return list
}

function smaWeeklyCloses(weeklies, period) {
  const out = []
  for (let i = 0; i < weeklies.length; i++) {
    if (i < period - 1) continue
    let s = 0
    for (let j = 0; j < period; j++) {
      s += valueNum(weeklies[i - j].close)
    }
    out.push({ time: weeklies[i].time, value: s / period })
  }
  return out
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
    return {
      date: ds,
      total,
      deliveryPct: dpct,
      deliveryVol: delVol,
    }
  })
}

function RsVsNiftySparkline({ points }) {
  const w = 400
  const h = 80
  const pad = { t: 6, r: 6, b: 18, l: 6 }

  const { segments, zeroY } = useMemo(() => {
    const valid = (points || []).filter((p) => p.rs != null && Number.isFinite(p.rs))
    if (!valid.length) {
      return { segments: [], zeroY: h / 2 }
    }
    const vals = valid.map((p) => p.rs)
    let min = Math.min(...vals, 0)
    let max = Math.max(...vals, 0)
    if (min === max) {
      min -= 1
      max += 1
    }
    const iw = w - pad.l - pad.r
    const ih = h - pad.t - pad.b
    const zy = pad.t + ih - ((0 - min) / (max - min)) * ih

    const px = (i) => pad.l + (valid.length <= 1 ? iw / 2 : (i / (valid.length - 1)) * iw)
    const py = (v) => pad.t + ih - ((v - min) / (max - min)) * ih

    const segs = []
    for (let i = 0; i < valid.length - 1; i++) {
      const v1 = valid[i].rs
      const v2 = valid[i + 1].rs
      const mid = (v1 + v2) / 2
      const d = `M ${px(i).toFixed(1)} ${py(v1).toFixed(1)} L ${px(i + 1).toFixed(1)} ${py(v2).toFixed(1)}`
      segs.push({ d, color: mid >= 0 ? UP : DOWN })
    }

    return { segments: segs, zeroY: zy }
  }, [points, h, w, pad.b, pad.l, pad.r, pad.t])

  if (!points?.length) {
    return (
      <div style={{ height: h, background: BG, border: `1px solid ${GRID}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: MUTED }}>
        No RS vs Nifty history
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: h, background: BG, border: `1px solid ${GRID}`, borderRadius: 6 }}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1={pad.l} y1={zeroY} x2={w - pad.r} y2={zeroY} stroke={GRID} strokeWidth={1} />
        {segments.map((s, idx) => (
          <path
            key={`rs-${idx}`}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div style={{ fontSize: 10, color: MUTED, padding: '0 8px 4px' }}>RS vs Nifty</div>
    </div>
  )
}

function VolumeDeliveryBars({ series }) {
  const [tip, setTip] = useState(null)
  const maxV = useMemo(() => Math.max(1, ...series.map((s) => s.total)), [series])

  if (!series.length) {
    return (
      <div style={{ height: 120, background: BG, border: `1px solid ${GRID}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: MUTED }}>
        No volume data
      </div>
    )
  }

  return (
    <div
      style={{
        height: 120,
        background: BG,
        border: `1px solid ${GRID}`,
        borderRadius: 6,
        padding: '8px 8px 4px',
        position: 'relative',
      }}
      onMouseLeave={() => setTip(null)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 92 }}>
        {series.map((row, idx) => {
          const barH = (row.total / maxV) * 88
          const delH =
            row.deliveryVol != null && row.total > 0 ? (valueNum(row.deliveryVol) / row.total) * barH : 0
          return (
            <button
              type="button"
              key={`${row.date}-${idx}`}
              className="min-w-0 flex-1 border-0 bg-transparent p-0"
              style={{ height: barH || 2, cursor: 'default' }}
              onMouseEnter={() =>
                setTip({
                  x: idx,
                  date: row.date,
                  pct: row.deliveryPct,
                  vol: row.total,
                })
              }
            >
              <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div
                  style={{
                    width: '100%',
                    background: VOL_GREY,
                    borderRadius: 2,
                    height: '100%',
                    minHeight: 2,
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: `${Math.min(100, (delH / (barH || 1)) * 100)}%`,
                      minHeight: delH > 0 ? 1 : 0,
                      background: DEL_GREEN,
                      borderRadius: 2,
                      opacity: 0.92,
                    }}
                  />
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {tip ? (
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            left: 8,
            right: 8,
            fontSize: 11,
            color: TEXT,
            background: '#0F1217',
            border: `1px solid ${GRID}`,
            borderRadius: 4,
            padding: '4px 8px',
          }}
        >
          {tip.date} · Del {tip.pct != null && Number.isFinite(tip.pct) ? `${tip.pct.toFixed(1)}%` : '—'} · Vol{' '}
          {tip.vol != null && Number.isFinite(tip.vol)
            ? tip.vol.toLocaleString('en-IN', { maximumFractionDigits: 0 })
            : '—'}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: MUTED }}>Volume (grey) + delivery (green) · last {series.length} sessions</div>
      )}
    </div>
  )
}

export default function StockDetailChartColumn({ priceHistoryNewestFirst, deliveryRows }) {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const roRef = useRef(null)

  const deliveryByDate = useMemo(() => {
    const m = {}
    for (const r of deliveryRows || []) {
      const ds = String(r.date || '').slice(0, 10)
      if (ds) m[ds] = r
    }
    return m
  }, [deliveryRows])

  const weeklies = useMemo(() => buildWeeklyBarsFromDaily(priceHistoryNewestFirst || []), [priceHistoryNewestFirst])

  const ma30w = useMemo(() => smaWeeklyCloses(weeklies, 30), [weeklies])

  const volSeries = useMemo(
    () => buildVolumeDeliverySeries(priceHistoryNewestFirst || [], deliveryByDate),
    [priceHistoryNewestFirst, deliveryByDate],
  )

  const rsPoints = useMemo(() => {
    const asc = [...(priceHistoryNewestFirst || [])].reverse()
    return asc
      .map((r) => {
        const raw = r?.rs_vs_nifty
        if (raw == null || raw === '') return null
        const rs = Number(raw)
        if (!Number.isFinite(rs)) return null
        return { date: String(r.date || '').slice(0, 10), rs }
      })
      .filter(Boolean)
  }, [priceHistoryNewestFirst])

  useEffect(() => {
    const el = hostRef.current
    if (!el || weeklies.length === 0) return undefined

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: MUTED,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      width: el.clientWidth,
      height: 320,
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID },
    })

    chartRef.current = chart

    const cand = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    })
    cand.setData(
      weeklies.map((b) => ({
        time: b.time,
        open: valueNum(b.open),
        high: valueNum(b.high),
        low: valueNum(b.low),
        close: valueNum(b.close),
      })),
    )

    const maSer = chart.addSeries(LineSeries, {
      color: MA_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    maSer.setData(ma30w.map((p) => ({ time: p.time, value: p.value })))

    const ro = new ResizeObserver(() => {
      if (!hostRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: hostRef.current.clientWidth })
    })
    ro.observe(el)
    roRef.current = ro

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [weeklies, ma30w])

  const noWeekly = weeklies.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>
        Weekly chart · 30W MA
      </div>
      <div
        ref={hostRef}
        style={{
          width: '100%',
          height: 320,
          borderRadius: 6,
          overflow: 'hidden',
          border: `1px solid ${GRID}`,
          position: 'relative',
          ...(noWeekly
            ? {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: BG,
                fontSize: 11,
                color: MUTED,
              }
            : {}),
        }}
      >
        {noWeekly ? 'Not enough OHLC history for weekly candles' : null}
      </div>
      <VolumeDeliveryBars series={volSeries} />
      <RsVsNiftySparkline points={rsPoints} />
    </div>
  )
}
