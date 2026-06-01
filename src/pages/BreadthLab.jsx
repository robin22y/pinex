// BreadthLab — experimental page exploring the relationship
// between Nifty 50 price and market breadth (% of NSE stocks above
// their 30-week trend lines, cumulative A/D line, 52W highs vs
// lows, % advancing). All observations here are MATHEMATICAL
// PATTERNS in historical data only — not predictive, not
// investment advice, not SEBI registered.
//
// The main visual is a UNIFIED Lightweight Charts (TradingView's
// MIT-licensed open-source library) with four synced panes:
//
//   Pane 0  Nifty 50 close (white line)        — large
//   Pane 1  Cumulative A/D Line (blue area)    — Weinstein primary
//   Pane 2  H-L (highs−lows) histogram + 10d   — Weinstein confirm
//           moving average (gold line)
//   Pane 3  % stocks above 30W trend line      — modern breadth
//           with 60% and 40% reference lines
//
// All four panes share ONE time axis and ONE crosshair so you can
// read divergences directly against Nifty's price by looking up
// the column.
//
// Mounted at /breadth-lab. Linked in the DesktopSidebar with a
// BETA badge. NOT in the mobile BottomNav by design.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import {
  AreaSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
} from 'lightweight-charts'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────
// Theme colours — resolved at render time so the chart honours
// active app theme (dark / sepia / light).
// ─────────────────────────────────────────────────────────────────
function readCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const C_NIFTY = '#E2E8F0'   // off-white — the index line
const C_AD = '#60A5FA'      // blue — Weinstein primary
const C_HL_AVG = '#FBBF24'  // gold — H-L 10-day average
const C_HL_POS = 'rgba(0,200,5,0.6)'   // green histogram bars
const C_HL_NEG = 'rgba(239,68,68,0.6)' // red histogram bars
const C_BREADTH = '#00C805' // green — % above 30W MA

// ─────────────────────────────────────────────────────────────────
// Data fetch
// ─────────────────────────────────────────────────────────────────
async function loadData() {
  const { data } = await supabase
    .from('market_internals')
    .select(
      'date, nifty_close, ' +
        'above_ma30w_pct, ' +
        'above_ma150_pct, ' +
        'stage2_pct, ' +
        'new_52w_highs, ' +
        'new_52w_lows, ' +
        'market_health_score, ' +
        'market_phase, ' +
        'divergence_active, ' +
        'divergence_type, ' +
        'divergence_severity, ' +
        'india_vix, ' +
        'advance_decline_ratio, ' +
        'ad_line_cumulative, ' +
        'hl_spread_10d_avg, ' +
        'advances, declines, ' +
        'highs_minus_lows',
    )
    .gt('above_ma30w_pct', 0)
    .order('date', { ascending: true })
    .limit(500)

  return data || []
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────
export default function BreadthLab() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('6M')
  const [showGuide, setShowGuide] = useState(false)
  const chartHostRef = useRef(null)

  useEffect(() => {
    loadData().then((d) => {
      setData(d)
      setLoading(false)
    })
  }, [])

  // Filter by selected time range. ALL uses every row; otherwise
  // approximate trading-day counts (21 ≈ 1mo, 63 ≈ 3mo, 126 ≈ 6mo).
  const filtered = useMemo(() => {
    if (!data.length) return []
    if (timeRange === 'ALL') return data
    const days = { '1M': 21, '3M': 63, '6M': 126 }[timeRange] || 126
    return data.slice(-days)
  }, [data, timeRange])

  // ── Weinstein A/D divergence detector (last 60 sessions) ──────
  const adDivergence = useMemo(() => {
    if (filtered.length < 20) return null
    const window = filtered.slice(-60)
    const niftyVals = window
      .map((r) => Number(r.nifty_close))
      .filter((v) => Number.isFinite(v) && v > 0)
    const adVals = window
      .map((r) => Number(r.ad_line_cumulative))
      .filter((v) => Number.isFinite(v))
    if (niftyVals.length < 10 || adVals.length < 10) return null

    const niftyHigh = Math.max(...niftyVals)
    const niftyLow = Math.min(...niftyVals)
    const adHigh = Math.max(...adVals)
    const adLow = Math.min(...adVals)
    const latest = filtered[filtered.length - 1]
    const todayNifty = Number(latest.nifty_close)
    const todayAd = Number(latest.ad_line_cumulative)

    const niftyAtHigh = todayNifty >= niftyHigh * 0.99
    const niftyAtLow = todayNifty <= niftyLow * 1.01
    const adAtHigh = todayAd >= adHigh * 0.99
    const adAtLow = todayAd <= adLow * 1.01

    let kind = null
    let title = 'No A/D divergence in last 60 days'
    let desc =
      'The cumulative A/D line is tracking the index broadly. ' +
      'Participation looks consistent with the Nifty move.'
    let color = '#94A3B8'

    if (niftyAtHigh && !adAtHigh) {
      kind = 'bearish'
      title = 'Bearish A/D divergence'
      desc =
        'Nifty is at or near a 60-day high but the cumulative ' +
        'advance/decline line is below its own prior high. ' +
        'Historically this "narrow rally" pattern has preceded ' +
        'broad weakness — but this is observational data only.'
      color = '#FBBF24'
    } else if (niftyAtLow && !adAtLow) {
      kind = 'bullish'
      title = 'Bullish A/D divergence'
      desc =
        'Nifty is testing a 60-day low but the cumulative ' +
        'advance/decline line is holding above its own prior ' +
        'low. Historically this "selling climax" pattern has ' +
        'preceded recoveries — but this is observational data only.'
      color = '#60A5FA'
    }

    return { kind, title, desc, color, todayAd, adHigh, adLow }
  }, [filtered])

  // ── 30-day breadth-vs-Nifty divergence pattern + metric cards ─
  const analysis = useMemo(() => {
    if (data.length < 10) return null

    const latest = data[data.length - 1]
    const prev30 = data[Math.max(0, data.length - 30)]

    const niftyChange =
      latest.nifty_close && prev30.nifty_close
        ? ((latest.nifty_close - prev30.nifty_close) /
            prev30.nifty_close) *
          100
        : 0

    const breadthChange =
      (latest.above_ma30w_pct || 0) - (prev30.above_ma30w_pct || 0)

    let divergenceType = null
    let divergenceDesc = null
    let divergenceColor = '#94A3B8'

    if (niftyChange > 2 && breadthChange < -5) {
      divergenceType = 'Narrow Rally'
      divergenceDesc =
        'Nifty is rising but fewer stocks are above their trend lines. ' +
        'Historically this pattern has preceded broad market weakness — ' +
        'but this is observational data only.'
      divergenceColor = '#FBBF24'
    } else if (niftyChange < -2 && breadthChange > 5) {
      divergenceType = 'Breadth Recovery'
      divergenceDesc =
        'More stocks are crossing above trend lines even as the index ' +
        'has pulled back. This pattern has sometimes preceded index ' +
        'recovery — but this is observational data only.'
      divergenceColor = '#60A5FA'
    } else if (niftyChange > 1 && breadthChange > 3) {
      divergenceType = 'Broad Participation'
      divergenceDesc =
        'Both the index and the number of stocks above trend lines are ' +
        'rising together. Historically this has been associated with ' +
        'more sustained moves — but this is observational data only.'
      divergenceColor = '#00C805'
    } else if (niftyChange < -1 && breadthChange < -3) {
      divergenceType = 'Broad Weakness'
      divergenceDesc =
        'Both the index and breadth are declining together. Historically ' +
        'associated with more sustained corrections — but this is ' +
        'observational data only.'
      divergenceColor = '#FF3B30'
    } else {
      divergenceType = 'No Clear Pattern'
      divergenceDesc =
        'No significant divergence detected in the last 30 days. ' +
        'Index and breadth are moving broadly in line with each other.'
      divergenceColor = '#475569'
    }

    return {
      latest,
      niftyChange,
      breadthChange,
      divergenceType,
      divergenceDesc,
      divergenceColor,
      totalDays: data.length,
      breadthNow: latest.above_ma30w_pct,
      stage2Pct: latest.stage2_pct,
      newHighs: latest.new_52w_highs,
      newLows: latest.new_52w_lows,
      vix: latest.india_vix,
      healthScore: latest.market_health_score,
    }
  }, [data])

  // ── Unified Lightweight Charts lifecycle ──────────────────────
  useEffect(() => {
    const el = chartHostRef.current
    if (!el || filtered.length === 0) return undefined

    const BG = readCssVar('--bg-primary', '#0B0E14')
    const GRID = readCssVar('--border', '#1E2530')
    const MUTED = readCssVar('--text-muted', '#94A3B8')

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: MUTED,
        fontSize: 11,
        // Hide TradingView attribution (allowed by MIT licence for
        // the open-source build).
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID, style: 1 },
        horzLines: { color: GRID, style: 1 },
      },
      width: el.clientWidth,
      height: 620,
      rightPriceScale: {
        borderColor: GRID,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: GRID,
        rightOffset: 4,
        barSpacing: 6,
      },
      crosshair: { mode: 1 }, // magnet to data
    })

    // ── Pane 0: Nifty 50 close (large) ────────────────────────
    const niftyData = filtered
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        value: Number(r.nifty_close),
      }))
      .filter((p) => p.time && Number.isFinite(p.value) && p.value > 0)

    const niftySer = chart.addSeries(
      LineSeries,
      {
        color: C_NIFTY,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'Nifty 50',
        priceFormat: { type: 'price', precision: 0, minMove: 1 },
      },
      0,
    )
    niftySer.setData(niftyData)

    // ── Pane 1: Cumulative A/D Line ───────────────────────────
    const adData = filtered
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        value: Number(r.ad_line_cumulative),
      }))
      .filter((p) => p.time && Number.isFinite(p.value))

    if (adData.length > 0) {
      const adSer = chart.addSeries(
        AreaSeries,
        {
          topColor: 'rgba(96,165,250,0.25)',
          bottomColor: 'rgba(96,165,250,0.00)',
          lineColor: C_AD,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'A/D Line',
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
        },
        1,
      )
      adSer.setData(adData)
    }

    // ── Pane 2: H-L histogram + 10-day average overlay ────────
    const hlBars = filtered
      .map((r) => {
        const v = Number(r.highs_minus_lows)
        if (!Number.isFinite(v)) return null
        return {
          time: String(r.date).slice(0, 10),
          value: v,
          color: v >= 0 ? C_HL_POS : C_HL_NEG,
        }
      })
      .filter(Boolean)

    if (hlBars.length > 0) {
      const hlSer = chart.addSeries(
        HistogramSeries,
        {
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'H − L',
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
          base: 0,
        },
        2,
      )
      hlSer.setData(hlBars)

      // 10-day average overlaid on the same pane.
      const hlAvgData = filtered
        .map((r) => ({
          time: String(r.date).slice(0, 10),
          value: Number(r.hl_spread_10d_avg),
        }))
        .filter((p) => p.time && Number.isFinite(p.value))

      if (hlAvgData.length > 0) {
        const hlAvgSer = chart.addSeries(
          LineSeries,
          {
            color: C_HL_AVG,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            title: 'H-L 10d',
          },
          2,
        )
        hlAvgSer.setData(hlAvgData)
      }
    }

    // ── Pane 3: % stocks above 30W MA ─────────────────────────
    const breadthData = filtered
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        value: Number(r.above_ma30w_pct),
      }))
      .filter((p) => p.time && Number.isFinite(p.value))

    if (breadthData.length > 0) {
      const breadthSer = chart.addSeries(
        AreaSeries,
        {
          topColor: 'rgba(0,200,5,0.25)',
          bottomColor: 'rgba(0,200,5,0.00)',
          lineColor: C_BREADTH,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: '% > 30W',
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        },
        3,
      )
      breadthSer.setData(breadthData)

      // 60% and 40% reference lines — Weinstein "healthy" /
      // "weak" thresholds on the modern breadth metric.
      try {
        breadthSer.createPriceLine({
          price: 60,
          color: 'rgba(0,200,5,0.3)',
          lineWidth: 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: '60%',
        })
        breadthSer.createPriceLine({
          price: 40,
          color: 'rgba(251,191,36,0.3)',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '40%',
        })
      } catch { /* createPriceLine missing on older API — skip */ }
    }

    // ── Pane heights — give Nifty the most space, breadth the
    // least. v5 lets us call setHeight() on each pane.
    try {
      const panes = chart.panes()
      if (panes.length >= 4) {
        if (typeof panes[0].setHeight === 'function') panes[0].setHeight(260)
        if (typeof panes[1].setHeight === 'function') panes[1].setHeight(130)
        if (typeof panes[2].setHeight === 'function') panes[2].setHeight(100)
        if (typeof panes[3].setHeight === 'function') panes[3].setHeight(110)
      }
    } catch { /* older API or panes not ready — defaults */ }

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (!chartHostRef.current) return
      chart.applyOptions({ width: chartHostRef.current.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [filtered])

  // ──────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        paddingBottom: 80,
      }}
    >
      <Helmet>
        <title>Breadth Lab · Experimental | PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {/* ── Header ───────────────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 20 }}>⚗️</span>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            Breadth Lab
          </h1>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 10,
              background: 'rgba(251,191,36,0.15)',
              border: '1px solid rgba(251,191,36,0.3)',
              color: '#FBBF24',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Experimental
          </span>
        </div>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Explores the relationship between Nifty price and market breadth.
          Observations are mathematical patterns in historical data only.
          Not predictive. Not investment advice.
        </p>
      </div>

      {/* ── Trial warning banner ─────────────────────────────── */}
      <div
        style={{
          margin: '12px 16px',
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(251,191,36,0.06)',
          border: '1px solid rgba(251,191,36,0.2)',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
        <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.6 }}>
          <strong style={{ color: '#FBBF24' }}>
            Trial feature — use with caution.
          </strong>{' '}
          This page analyses historical breadth patterns alongside Nifty
          price. The observations shown are based on limited data and have
          not been independently validated. Past patterns do not predict
          future market behaviour.
          <strong style={{ color: '#94A3B8', display: 'block', marginTop: 4 }}>
            ℹ️ EOD data only · Not investment advice · Not SEBI registered
          </strong>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Loading breadth data...
        </div>
      ) : data.length === 0 ? (
        <div
          style={{
            margin: '0 16px',
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border)',
            borderRadius: 12,
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          No market breadth data available yet. The market_internals
          pipeline needs at least one trading day of computed values.
        </div>
      ) : (
        <>
          {/* ── Unified chart card (4 synced panes) ─────────────── */}
          <div
            style={{
              margin: '0 16px 16px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  Nifty + breadth (four synced panes)
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}
                >
                  Cumulative A/D · 52W highs−lows · 30W participation —
                  all aligned to Nifty's date axis
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {['1M', '3M', '6M', 'ALL'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: `1px solid ${
                        timeRange === r
                          ? 'rgba(0,200,5,0.4)'
                          : 'var(--border)'
                      }`,
                      background:
                        timeRange === r
                          ? 'rgba(0,200,5,0.1)'
                          : 'transparent',
                      color:
                        timeRange === r ? '#00C805' : 'var(--text-muted)',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Legend chips */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                fontSize: 10,
                color: '#94A3B8',
                marginBottom: 8,
              }}
            >
              {[
                { color: C_NIFTY, label: 'Nifty 50' },
                { color: C_AD, label: 'A/D Line · Weinstein primary' },
                { color: C_HL_AVG, label: 'H-L 10d avg' },
                { color: C_BREADTH, label: '% above 30W' },
              ].map((item) => (
                <span
                  key={item.label}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 2,
                      background: item.color,
                      display: 'inline-block',
                    }}
                  />
                  {item.label}
                </span>
              ))}
            </div>

            <div
              ref={chartHostRef}
              style={{
                width: '100%',
                height: 620,
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
              }}
            />

            {/* A/D divergence interpretation, sits directly under
                the unified chart since the A/D pane is one of the
                stacked panes. */}
            {adDivergence && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)',
                  borderLeft: `3px solid ${adDivergence.color}`,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: adDivergence.color,
                    marginBottom: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {adDivergence.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#94A3B8',
                    lineHeight: 1.6,
                    marginBottom: 6,
                  }}
                >
                  {adDivergence.desc}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: '#475569',
                    fontStyle: 'italic',
                  }}
                >
                  ⚠️ Observational only. The A/D line needs years of
                  history before its divergences are statistically
                  meaningful — PineX is still accumulating that
                  history. EOD data only. Not investment advice.
                  Not SEBI registered.
                </div>
              </div>
            )}
          </div>

          {/* ── Metric cards (2×2 grid) ─────────────────────────── */}
          {analysis && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                padding: '0 16px',
                marginBottom: 16,
              }}
            >
              {/* Breadth now */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}
                >
                  Breadth today
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color:
                      analysis.breadthNow >= 60
                        ? '#00C805'
                        : analysis.breadthNow >= 40
                          ? '#FBBF24'
                          : '#FF3B30',
                    fontFamily: 'var(--font-mono, monospace)',
                    lineHeight: 1,
                    marginBottom: 3,
                  }}
                >
                  {analysis.breadthNow?.toFixed(1)}%
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color:
                      analysis.breadthChange >= 0 ? '#00C805' : '#FF3B30',
                  }}
                >
                  {analysis.breadthChange >= 0 ? '+' : ''}
                  {analysis.breadthChange?.toFixed(1)}% vs 30d ago
                </div>
              </div>

              {/* 30-day pattern */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: `1px solid ${analysis.divergenceColor}30`,
                  borderRadius: 10,
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}
                >
                  30-day pattern
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: analysis.divergenceColor,
                    lineHeight: 1.2,
                    marginBottom: 3,
                  }}
                >
                  {analysis.divergenceType}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Nifty {analysis.niftyChange >= 0 ? '+' : ''}
                  {analysis.niftyChange?.toFixed(1)}%{' '}/{' '}
                  Breadth {analysis.breadthChange >= 0 ? '+' : ''}
                  {analysis.breadthChange?.toFixed(1)}pp
                </div>
              </div>

              {/* 52W H/L */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}
                >
                  52W Highs / Lows
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: '#00C805',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {analysis.newHighs ?? '—'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/</span>
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: '#FF3B30',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {analysis.newLows ?? '—'}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}
                >
                  Highs / Lows today
                </div>
              </div>

              {/* Health score */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}
                >
                  Health score
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color:
                      (analysis.healthScore || 0) >= 60
                        ? '#00C805'
                        : (analysis.healthScore || 0) >= 40
                          ? '#FBBF24'
                          : '#FF3B30',
                    fontFamily: 'var(--font-mono, monospace)',
                    lineHeight: 1,
                    marginBottom: 3,
                  }}
                >
                  {analysis.healthScore ?? '—'}
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      fontWeight: 400,
                    }}
                  >
                    /100
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {analysis.latest?.market_phase || 'Composite score'}
                </div>
              </div>
            </div>
          )}

          {/* ── 30-day pattern interpretation panel ──────────────── */}
          {analysis?.divergenceType && (
            <div
              style={{
                margin: '0 16px 16px',
                background: 'var(--bg-surface)',
                border: `1px solid ${analysis.divergenceColor}25`,
                borderLeft: `3px solid ${analysis.divergenceColor}`,
                borderRadius: '0 10px 10px 0',
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: analysis.divergenceColor,
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Pattern observation
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {analysis.divergenceType}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#94A3B8',
                  lineHeight: 1.7,
                  marginBottom: 10,
                }}
              >
                {analysis.divergenceDesc}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: '#475569',
                  fontStyle: 'italic',
                  padding: '8px 10px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 6,
                }}
              >
                ⚠️ This is an observational pattern from limited historical
                data ({analysis.totalDays} trading days). It is NOT a
                prediction and has NOT been statistically validated. Past
                patterns do not repeat reliably. This feature is
                experimental. EOD data only. Not investment advice. Not
                SEBI registered.
              </div>
            </div>
          )}

          {/* ── Collapsible guide ─────────────────────────────── */}
          <div
            style={{
              margin: '0 16px 80px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setShowGuide((g) => !g)}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'none',
                border: 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: 12,
              }}
            >
              <span>ℹ️ How to read this page</span>
              <span>{showGuide ? '↑' : '↓'}</span>
            </button>

            {showGuide && (
              <div
                style={{
                  padding: '0 16px 16px',
                  borderTop: '1px solid var(--border)',
                }}
              >
                {[
                  {
                    title: 'How are the four panes synced?',
                    text: 'They share one time axis. Hover anywhere on the chart and the crosshair snaps to the same trading day across Nifty, the A/D line, the H-L spread, and the 30W participation pane. That makes divergences visible at a glance — look up the column from the top pane to the bottom.',
                  },
                  {
                    title: 'What is the A/D Line?',
                    text: 'A running total of (advances − declines). The Weinstein-canonical breadth indicator. Direction matters more than the level. When Nifty makes a new high but the A/D line fails to confirm, that\'s a bearish divergence. When Nifty makes a new low but the A/D line is higher than its prior low, that\'s a bullish divergence (selling climax).',
                  },
                  {
                    title: 'What is the H-L spread?',
                    text: 'Daily count of (52W highs − 52W lows). Positive bars = more highs than lows; negative bars = more lows than highs. The gold line is the 10-day moving average — same signal, smoother. Persistently negative even while Nifty holds up = broad weakness beneath the surface.',
                  },
                  {
                    title: 'What is % above 30W?',
                    text: 'The percentage of NSE stocks trading above their 30-week trend lines. "Modern" breadth metric (not in Weinstein\'s book). 60% line = healthy participation; 40% line = caution threshold.',
                  },
                  {
                    title: 'Why is this experimental?',
                    text: 'PineX has limited historical breadth data — especially for the cumulative A/D line which only started populating recently. The patterns shown are mathematical observations only. They have not been statistically validated on Indian markets. Use this as one data point, not a conclusion.',
                  },
                  {
                    title: 'What should I do with this?',
                    text: 'Nothing directly. This data helps you understand the context behind the index move. Whether the index rise is broad or narrow is one factor in your own analysis. PineX does not recommend any action based on this data.',
                  },
                ].map((item, i) => (
                  <div key={i} style={{ marginTop: 14 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        marginBottom: 4,
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#94A3B8',
                        lineHeight: 1.7,
                      }}
                    >
                      {item.text}
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    marginTop: 16,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)',
                    fontSize: 10,
                    color: '#475569',
                    lineHeight: 1.7,
                    fontStyle: 'italic',
                  }}
                >
                  All data is end-of-day (EOD) only. PineX is not registered
                  with SEBI as a Research Analyst or Investment Adviser.
                  Nothing on this page constitutes investment advice, a
                  research report, or a recommendation of any kind. This
                  feature is experimental and has not been independently
                  validated.
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
