// In memory of Arshid · Kerala · 2026
// Some things matter more than markets.
//
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
  BaselineSeries,
  ColorType,
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
    // WHY: order DESCENDING + limit 1500 = NEWEST 1500 rows
    // (~6 years of trading days). Previous version used
    // .order(ascending: true).limit(500) which returns the
    // OLDEST 500 rows — so even after a 5-year market_internals
    // backfill the page showed only ~mid-2021 to mid-2023 and
    // silently dropped everything more recent.
    // We reverse to ascending in JS so the chart's time-axis
    // expectations don't change.
    .order('date', { ascending: false })
    .limit(1500)

  return (data || []).slice().reverse()
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────
// Bottom-pane breadth metric selector — one at a time so the eye
// has somewhere to land. Each entry pulls a different field from
// the market_internals row.
const BREADTH_METRICS = [
  { id: 'pct30w',  label: '% above 30W',  field: 'above_ma30w_pct', kind: 'pct',  color: '#00C805', subtitle: 'Modern breadth — % of NSE stocks above their 30-week trend line' },
  { id: 'adline',  label: 'A/D Line',     field: 'ad_line_cumulative', kind: 'line', color: '#60A5FA', subtitle: 'Cumulative (advances − declines), rebased to 0 at the start of the visible window — Weinstein primary breadth. Direction matters, not absolute level.' },
  { id: 'hldiff',  label: 'Highs − Lows', field: 'highs_minus_lows',   kind: 'hist', color: '#FBBF24', subtitle: 'Daily 52W highs minus lows · gold = 10-day moving average' },
  { id: 'stage2',  label: 'Advancing %',  field: 'stage2_pct',          kind: 'pct',  color: '#10B981', subtitle: 'Percent of NSE stocks in Stage 2 advancing phase' },
]

export default function ArshidBreadthLab() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('6M')
  const [showGuide, setShowGuide] = useState(false)
  // Bottom pane metric — single choice, default to "% above 30W"
  // because it's the most populated breadth field across history.
  const [bottomMetric, setBottomMetric] = useState('pct30w')
  const chartHostRef = useRef(null)
  // Dedicated chart hosts for the two always-visible cards below
  // the main 2-pane chart (A/D Line + 52W H-L spread). Each card
  // renders its own Lightweight Charts instance.
  const adChartRef = useRef(null)
  const hlChartRef = useRef(null)

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

  // Selected metric definition for the bottom pane.
  const activeMetric = useMemo(
    () =>
      BREADTH_METRICS.find((m) => m.id === bottomMetric) ||
      BREADTH_METRICS[0],
    [bottomMetric],
  )

  // Sanity check: does the selected breadth field actually have
  // non-zero data in the filtered window? If every value is 0/null
  // we tell the user the column is still warming up instead of
  // showing an empty rectangle.
  const bottomDataState = useMemo(() => {
    if (!filtered.length) return 'empty'
    const vals = filtered
      .map((r) => Number(r[activeMetric.field]))
      .filter((v) => Number.isFinite(v))
    if (vals.length === 0) return 'empty'
    const allZero = vals.every((v) => v === 0)
    if (allZero) return 'all_zero'
    return 'ok'
  }, [filtered, activeMetric])

  // ── Lightweight Charts lifecycle — 2 panes only ───────────────
  //   Pane 0 (260px) Nifty 50 close
  //   Pane 1 (160px) Selected breadth metric (toggleable)
  // Far calmer than 4 cramped panes. Eye lands in one place.
  useEffect(() => {
    const el = chartHostRef.current
    if (!el || filtered.length === 0 || bottomDataState !== 'ok') {
      return undefined
    }

    const BG = readCssVar('--bg-primary', '#0B0E14')
    const GRID = readCssVar('--border', '#1E2530')
    const MUTED = readCssVar('--text-muted', '#94A3B8')

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: MUTED,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID, style: 1 },
        horzLines: { color: GRID, style: 1 },
      },
      width: el.clientWidth,
      height: 460,
      rightPriceScale: {
        borderColor: GRID,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: GRID,
        rightOffset: 4,
        barSpacing: filtered.length < 30 ? 18 : 6,
      },
      crosshair: { mode: 1 },
    })

    // ── Pane 0: Nifty 50 close ────────────────────────────────
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

    // ── Pane 1: selected breadth metric ───────────────────────
    let bottomData = filtered
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        value: Number(r[activeMetric.field]),
      }))
      .filter((p) => p.time && Number.isFinite(p.value))

    // For the cumulative A/D line, rebase to 0 at the first
    // visible point. The absolute level depends on when we
    // started counting (arbitrary), so "-15247" reads as bad
    // when it just reflects the start date. The SHAPE — rising
    // vs falling, divergence with Nifty — is what matters.
    if (activeMetric.id === 'adline' && bottomData.length > 0) {
      const baseline = bottomData[0].value
      bottomData = bottomData.map((p) => ({
        time: p.time,
        value: p.value - baseline,
      }))
    }

    if (activeMetric.kind === 'hist') {
      // Filled AREA chart split at zero — green above, red below.
      // Visually consistent with the other metric charts (smooth
      // shape, not discrete bars) while preserving the sign signal
      // that matters for a "highs minus lows" reading. 10d moving
      // average overlays as a single line for trend smoothing.
      const bSer = chart.addSeries(
        BaselineSeries,
        {
          baseValue: { type: 'price', price: 0 },
          topLineColor: '#10B981',
          topFillColor1: 'rgba(16,185,129,0.35)',
          topFillColor2: 'rgba(16,185,129,0.00)',
          bottomLineColor: '#EF4444',
          bottomFillColor1: 'rgba(239,68,68,0.00)',
          bottomFillColor2: 'rgba(239,68,68,0.35)',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: activeMetric.label,
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
        },
        1,
      )
      bSer.setData(bottomData)

      // 10-day moving average overlay (gold line). Only render
      // when the column has a non-trivial signal — otherwise we'd
      // draw a flat zero line that just adds visual noise.
      const hlAvg = filtered
        .map((r) => ({
          time: String(r.date).slice(0, 10),
          value: Number(r.hl_spread_10d_avg),
        }))
        .filter((p) => p.time && Number.isFinite(p.value))
      const hlAvgHasSignal =
        hlAvg.length > 0 && hlAvg.some((p) => Math.abs(p.value) > 0.05)
      if (hlAvgHasSignal) {
        const aSer = chart.addSeries(
          LineSeries,
          {
            color: C_HL_AVG,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            title: '10d avg',
          },
          1,
        )
        aSer.setData(hlAvg)
      }
    } else {
      // Line / pct → area chart, same shape
      const bSer = chart.addSeries(
        AreaSeries,
        {
          topColor: `${activeMetric.color}40`,
          bottomColor: `${activeMetric.color}00`,
          lineColor: activeMetric.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: activeMetric.label,
          priceFormat: {
            type: 'price',
            precision: activeMetric.kind === 'pct' ? 1 : 0,
            minMove: activeMetric.kind === 'pct' ? 0.1 : 1,
          },
        },
        1,
      )
      bSer.setData(bottomData)

      // Reference lines on percent metrics only.
      if (activeMetric.kind === 'pct') {
        try {
          bSer.createPriceLine({
            price: 60,
            color: 'rgba(0,200,5,0.3)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: '60%',
          })
          bSer.createPriceLine({
            price: 40,
            color: 'rgba(251,191,36,0.3)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: '40%',
          })
        } catch { /* older API — skip */ }
      }
    }

    // Set pane heights — main pane gets the lion's share.
    try {
      const panes = chart.panes()
      if (panes.length >= 2) {
        if (typeof panes[0].setHeight === 'function') panes[0].setHeight(280)
        if (typeof panes[1].setHeight === 'function') panes[1].setHeight(160)
      }
    } catch { /* defaults */ }

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
  }, [filtered, activeMetric, bottomDataState])

  // ── A/D Line vs Nifty (separate always-visible card) ──────────
  // Single pane, dual price scale: Nifty on the LEFT axis, A/D
  // cumulative on the RIGHT axis. This is the Weinstein primary
  // breadth chart — when Nifty and the A/D line diverge, that's
  // the signal.
  const adDataState = useMemo(() => {
    if (!filtered.length) return 'empty'
    const vals = filtered
      .map((r) => Number(r.ad_line_cumulative))
      .filter((v) => Number.isFinite(v))
    if (vals.length === 0) return 'empty'
    if (vals.every((v) => v === 0)) return 'all_zero'
    return 'ok'
  }, [filtered])

  useEffect(() => {
    const el = adChartRef.current
    if (!el || filtered.length === 0 || adDataState !== 'ok') return undefined

    const BG = readCssVar('--bg-primary', '#0B0E14')
    const GRID = readCssVar('--border', '#1E2530')
    const MUTED = readCssVar('--text-muted', '#94A3B8')

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: MUTED,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID, style: 1 },
        horzLines: { color: GRID, style: 1 },
      },
      width: el.clientWidth,
      height: 240,
      // Dual price scales on the same pane — Nifty (left) and
      // A/D Line (right). They share the X axis and crosshair.
      leftPriceScale: { borderColor: GRID, visible: true },
      rightPriceScale: { borderColor: GRID, visible: true },
      timeScale: {
        borderColor: GRID,
        rightOffset: 4,
        barSpacing: filtered.length < 30 ? 18 : 6,
      },
      crosshair: { mode: 1 },
    })

    // A/D Line — blue area, RIGHT scale
    const adSer = chart.addSeries(AreaSeries, {
      topColor: 'rgba(96,165,250,0.30)',
      bottomColor: 'rgba(96,165,250,0.00)',
      lineColor: '#60A5FA',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'A/D (Δ)',
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    })
    // Rebase to 0 at the first visible point. The absolute level
    // of a cumulative A/D line is arbitrary — it depends entirely
    // on which date we started counting. Users read "-15247" as
    // "bad", which is wrong; the meaningful signal is the SHAPE
    // (rising = healthy breadth, falling = weakening). Rebasing
    // each view to 0 strips the misleading absolute number while
    // preserving every divergence pattern.
    const adRaw = filtered
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        value: Number(r.ad_line_cumulative),
      }))
      .filter((p) => p.time && Number.isFinite(p.value))
    const adBaseline = adRaw.length > 0 ? adRaw[0].value : 0
    adSer.setData(adRaw.map((p) => ({ time: p.time, value: p.value - adBaseline })))

    // Nifty — off-white line, LEFT scale
    const niSer = chart.addSeries(LineSeries, {
      color: C_NIFTY,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'Nifty 50',
      priceScaleId: 'left',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    })
    niSer.setData(
      filtered
        .map((r) => ({
          time: String(r.date).slice(0, 10),
          value: Number(r.nifty_close),
        }))
        .filter((p) => p.time && Number.isFinite(p.value) && p.value > 0),
    )

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (!adChartRef.current) return
      chart.applyOptions({ width: adChartRef.current.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [filtered, adDataState])

  // ── 30-day A/D divergence flag (for the A/D card's footer
  // callout). Spec'd simpler than the existing 60-session
  // adDivergence detector above so it can be shown as a short
  // "Bearish/Bullish — Nifty up, A/D falling" badge below the
  // chart. Both detectors coexist; this one is the quick-read.
  const adDirection30d = useMemo(() => {
    if (filtered.length < 5) return null
    const last = filtered[filtered.length - 1]
    const prev = filtered[Math.max(0, filtered.length - 30)]
    if (!last || !prev) return null
    const niftyChange =
      last.nifty_close && prev.nifty_close
        ? ((last.nifty_close - prev.nifty_close) / prev.nifty_close) * 100
        : 0
    const adChange =
      Number(last.ad_line_cumulative || 0) -
      Number(prev.ad_line_cumulative || 0)
    if (niftyChange > 2 && adChange < 0)
      return { text: 'Bearish — Nifty up, A/D falling', kind: 'bearish' }
    if (niftyChange < -2 && adChange > 0)
      return { text: 'Bullish — Nifty down, A/D rising', kind: 'bullish' }
    return null
  }, [filtered])

  // ── 52W H-L spread (separate always-visible card) ─────────────
  // Single pane BaselineSeries — green fill above zero, red fill
  // below zero. Smoother visual than discrete bars; sign signal
  // preserved by the bicolor split. 10-day MA overlay shows the
  // smoothed trend when data has accumulated.
  const hlDataState = useMemo(() => {
    if (!filtered.length) return 'empty'
    const vals = filtered
      .map((r) => Number(r.highs_minus_lows))
      .filter((v) => Number.isFinite(v))
    if (vals.length === 0) return 'empty'
    return 'ok'
  }, [filtered])

  useEffect(() => {
    const el = hlChartRef.current
    if (!el || filtered.length === 0 || hlDataState !== 'ok') return undefined

    const BG = readCssVar('--bg-primary', '#0B0E14')
    const GRID = readCssVar('--border', '#1E2530')
    const MUTED = readCssVar('--text-muted', '#94A3B8')

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: MUTED,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID, style: 1 },
        horzLines: { color: GRID, style: 1 },
      },
      width: el.clientWidth,
      height: 180,
      rightPriceScale: {
        borderColor: GRID,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: GRID,
        rightOffset: 4,
        barSpacing: filtered.length < 30 ? 18 : 6,
      },
      crosshair: { mode: 1 },
    })

    const hlSer = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#10B981',
      topFillColor1: 'rgba(16,185,129,0.35)',
      topFillColor2: 'rgba(16,185,129,0.00)',
      bottomLineColor: '#EF4444',
      bottomFillColor1: 'rgba(239,68,68,0.00)',
      bottomFillColor2: 'rgba(239,68,68,0.35)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'H − L',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    })
    hlSer.setData(
      filtered
        .map((r) => ({
          time: String(r.date).slice(0, 10),
          value: Number(r.highs_minus_lows),
        }))
        .filter((p) => p.time && Number.isFinite(p.value)),
    )

    // 10-day moving average — only render when meaningful.
    const hlAvg = filtered
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        value: Number(r.hl_spread_10d_avg),
      }))
      .filter((p) => p.time && Number.isFinite(p.value))
    const hasSignal =
      hlAvg.length > 0 && hlAvg.some((p) => Math.abs(p.value) > 0.05)
    if (hasSignal) {
      const aSer = chart.addSeries(LineSeries, {
        color: C_HL_AVG,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: '10d avg',
      })
      aSer.setData(hlAvg)
    }

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (!hlChartRef.current) return
      chart.applyOptions({ width: hlChartRef.current.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [filtered, hlDataState])

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

      {/* ── In memory of Arshid · Kerala · 2026 ─────────────────
          This lab was built the day the world lost him. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          margin: '12px 16px 0',
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
        }}
      >
        <img
          src="/assets/arshid.png"
          alt="Arshid"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            objectFit: 'cover',
            objectPosition: 'center top',
            border: '1px solid var(--border)',
            opacity: 0.9,
            flexShrink: 0,
          }}
        />
        <div>
          <p
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              margin: 0,
              lineHeight: '1.5',
            }}
          >
            In memory of Arshid · Kerala · 2026
          </p>
          <p
            style={{
              fontSize: '10px',
              color: 'var(--text-hint)',
              margin: 0,
              lineHeight: '1.4',
            }}
          >
            This lab was built the day the world lost him.
          </p>
        </div>
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
          {/* ── 2-pane Lightweight chart: Nifty + one breadth metric.
              Switched from a 4-pane stack because sparse data made
              every pane look broken at the same time. With one
              breadth metric at a time, the eye lands in one place
              and the comparison is obvious. */}
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
                marginBottom: 8,
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
                  Nifty 50 vs {activeMetric.label}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}
                >
                  {activeMetric.subtitle}
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

            {/* Bottom-pane metric chooser */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginBottom: 10,
              }}
            >
              {BREADTH_METRICS.map((m) => {
                const active = m.id === bottomMetric
                return (
                  <button
                    key={m.id}
                    onClick={() => setBottomMetric(m.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: `1px solid ${active ? m.color : 'var(--border)'}`,
                      background: active ? `${m.color}1A` : 'transparent',
                      color: active ? m.color : 'var(--text-muted)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: m.color,
                        marginRight: 6,
                        verticalAlign: 'middle',
                      }}
                    />
                    {m.label}
                  </button>
                )
              })}
            </div>

            {bottomDataState === 'all_zero' ? (
              <div
                style={{
                  height: 460,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 6,
                  textAlign: 'center',
                  padding: '0 24px',
                }}
              >
                <span style={{ fontSize: 24 }}>📊</span>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  {activeMetric.label} is still warming up
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    lineHeight: 1.6,
                    maxWidth: 460,
                  }}
                >
                  Every value in the loaded window is zero — this
                  field was added recently and hasn't accumulated
                  meaningful data yet. Pick a different metric
                  above (% above 30W has the most history), or
                  check back in a few daily pipeline runs.
                </div>
              </div>
            ) : (
              <div
                ref={chartHostRef}
                style={{
                  width: '100%',
                  height: 460,
                  borderRadius: 6,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                }}
              />
            )}

            {/* A/D divergence interpretation — only show when A/D
                metric is selected so it stays relevant to what the
                user is currently looking at. */}
            {bottomMetric === 'adline' && adDivergence && (
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

          {/* ── A/D Line vs Nifty (always visible) ────────────────
              Single pane, dual-Y. Nifty on the LEFT axis, A/D
              cumulative on the RIGHT axis. The classical Weinstein
              "is participation confirming the index?" chart. */}
          <div
            style={{
              margin: '0 16px 16px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '14px',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: 2,
                }}
              >
                Advance / Decline Line vs Nifty
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Weinstein primary breadth indicator · Cumulative
                (advances − declines)
              </div>
            </div>

            {adDataState === 'all_zero' ? (
              <div
                style={{
                  height: 240,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '0 24px',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: 22 }}>📈</span>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  A/D Line is warming up
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    lineHeight: 1.5,
                    maxWidth: 440,
                  }}
                >
                  Every value in this window is zero. Run
                  scripts/sql/backfill_ad_line_and_hl_history.sql in
                  Supabase to reconstruct the cumulative A/D line
                  from existing price_data history.
                </div>
              </div>
            ) : (
              <div
                ref={adChartRef}
                style={{
                  width: '100%',
                  height: 240,
                  borderRadius: 6,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                }}
              />
            )}

            {/* "How to read" callout (always visible — context) */}
            <div
              style={{
                marginTop: 10,
                fontSize: 10,
                color: '#475569',
                lineHeight: 1.7,
                padding: '8px 10px',
                background: 'rgba(96,165,250,0.04)',
                borderRadius: 6,
                borderLeft: '2px solid #60A5FA',
              }}
            >
              <strong style={{ color: '#60A5FA' }}>How to read:</strong>{' '}
              When Nifty rises but the A/D line does not confirm —
              fewer stocks are participating. When A/D rises while
              Nifty falls — broader market may be stabilising. The
              A/D line is rebased to 0 at the start of the visible
              window so direction reads cleanly — the absolute level
              of a cumulative breadth indicator is arbitrary (depends
              on when counting started) and not meaningful on its
              own. These are historical observations only. Not
              predictive. Not advice.
            </div>

            {/* 30-day divergence badge (only when one fires) */}
            {adDirection30d && (
              <div
                style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background:
                    adDirection30d.kind === 'bearish'
                      ? 'rgba(251,191,36,0.08)'
                      : 'rgba(96,165,250,0.08)',
                  border: `1px solid ${
                    adDirection30d.kind === 'bearish'
                      ? 'rgba(251,191,36,0.2)'
                      : 'rgba(96,165,250,0.2)'
                  }`,
                  fontSize: 11,
                  color:
                    adDirection30d.kind === 'bearish'
                      ? '#FBBF24'
                      : '#60A5FA',
                }}
              >
                A/D Line: {adDirection30d.text}
              </div>
            )}
          </div>

          {/* ── 52W Highs vs Lows spread (always visible) ─────────
              BaselineSeries — green fill above zero, red fill
              below zero. Weinstein confirmation indicator. */}
          <div
            style={{
              margin: '0 16px 16px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '14px',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: 2,
                }}
              >
                New 52W Highs vs Lows
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Weinstein confirmation indicator · gold line = 10-day
                average spread
              </div>
            </div>

            <div
              ref={hlChartRef}
              style={{
                width: '100%',
                height: 180,
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
              }}
            />

            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                color: '#475569',
                lineHeight: 1.6,
              }}
            >
              Green fill = more new 52W highs than lows. Red fill =
              more new 52W lows than highs. Weinstein uses expanding
              new highs to confirm a healthy advancing market.
              Observational only. Not advice.
            </div>
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
