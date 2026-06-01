// BreadthLab — experimental page exploring the relationship
// between Nifty price and market breadth (% of NSE stocks above
// their 30-week trend lines). All observations here are
// MATHEMATICAL PATTERNS in historical data only — not predictive,
// not investment advice, not SEBI registered.
//
// Mounted at /breadth-lab. Linked in the DesktopSidebar with a
// BETA badge. NOT in the mobile BottomNav by design — experimental
// features stay one click further away than core nav.

import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'

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
        // Weinstein additions (populated by calc_market_internals.py)
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

  // ── Weinstein A/D divergence detector ─────────────────────────
  // Compares Nifty highs/lows against cumulative A/D line highs/
  // lows over the LAST 60 SESSIONS. The classical Weinstein
  // signal:
  //   - Nifty at a new high but A/D line NOT at a new high
  //     → BEARISH divergence (narrow rally)
  //   - Nifty at a new low but A/D line ABOVE its prior low
  //     → BULLISH divergence (selling climax)
  // Once we have 5y of A/D history these become statistically
  // meaningful. For now, fewer-than-20 days returns null so we
  // don't pretend to detect a signal from sparse data.
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

    // "Within 1%" of the 60-day high/low counts as testing it.
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

  // Divergence analysis — looks at last 30 trading days only.
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

    // Four named patterns + a "no pattern" fallback. Each one is
    // an observation about HISTORICAL data; nothing here predicts
    // the future. Copy is deliberately framed as observational.
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

    // Count "bearish divergence" days across the entire loaded
    // history — Nifty up while breadth ticked down.
    let bearishDivDays = 0
    for (let i = 1; i < data.length; i++) {
      const d = data[i]
      const p = data[i - 1]
      if (
        d.nifty_close > p.nifty_close &&
        d.above_ma30w_pct < p.above_ma30w_pct - 0.5
      ) {
        bearishDivDays++
      }
    }

    return {
      latest,
      niftyChange,
      breadthChange,
      divergenceType,
      divergenceDesc,
      divergenceColor,
      bearishDivDays,
      totalDays: data.length,
      breadthNow: latest.above_ma30w_pct,
      stage2Pct: latest.stage2_pct,
      newHighs: latest.new_52w_highs,
      newLows: latest.new_52w_lows,
      vix: latest.india_vix,
      healthScore: latest.market_health_score,
    }
  }, [data])

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

      {/* ── Section 1: Header ─────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
          }}
        >
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

      {/* Trial warning banner */}
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
        <div
          style={{
            fontSize: 11,
            color: '#94A3B8',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: '#FBBF24' }}>
            Trial feature — use with caution.
          </strong>{' '}
          This page analyses historical breadth patterns alongside Nifty
          price. The observations shown are based on limited data and have
          not been independently validated. Past patterns do not predict
          future market behaviour.
          <strong
            style={{
              color: '#94A3B8',
              display: 'block',
              marginTop: 4,
            }}
          >
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
          {/* ── Section 2: Main dual-axis chart ───────────────── */}
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
                  Trend line participation
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}
                >
                  Nifty 50 vs % stocks above 30W trend line · modern breadth
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

            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={filtered}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1E2530"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: '#475569' }}
                  tickFormatter={(d) => {
                    const dt = new Date(d)
                    return dt.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })
                  }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                {/* Left Y — Nifty */}
                <YAxis
                  yAxisId="nifty"
                  orientation="left"
                  tick={{ fontSize: 9, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'}
                  domain={['auto', 'auto']}
                />
                {/* Right Y — Breadth % */}
                <YAxis
                  yAxisId="breadth"
                  orientation="right"
                  tick={{ fontSize: 9, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v + '%'}
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0F1217',
                    border: '1px solid #1E2530',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: '#94A3B8', marginBottom: 4 }}
                  formatter={(value, name) => {
                    if (name === 'Nifty 50') {
                      return [value?.toLocaleString('en-IN'), name]
                    }
                    return [value + '%', name]
                  }}
                  labelFormatter={(d) =>
                    new Date(d).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  }
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#475569' }} />

                {/* Breadth area — background */}
                <Area
                  yAxisId="breadth"
                  type="monotone"
                  dataKey="above_ma30w_pct"
                  name="Breadth %"
                  fill="rgba(0,200,5,0.06)"
                  stroke="#00C805"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive
                />

                {/* Breadth reference lines */}
                <ReferenceLine
                  yAxisId="breadth"
                  y={60}
                  stroke="rgba(0,200,5,0.3)"
                  strokeDasharray="4 4"
                  label={{
                    value: '60%',
                    position: 'insideTopRight',
                    fontSize: 9,
                    fill: '#00C805',
                  }}
                />
                <ReferenceLine
                  yAxisId="breadth"
                  y={40}
                  stroke="rgba(251,191,36,0.3)"
                  strokeDasharray="4 4"
                  label={{
                    value: '40%',
                    position: 'insideTopRight',
                    fontSize: 9,
                    fill: '#FBBF24',
                  }}
                />

                {/* Nifty line */}
                <Line
                  yAxisId="nifty"
                  type="monotone"
                  dataKey="nifty_close"
                  name="Nifty 50"
                  stroke="#E2E8F0"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                />

                {/* Brush for zoom */}
                <Brush
                  dataKey="date"
                  height={20}
                  stroke="#1E2530"
                  fill="#0B0E11"
                  travellerWidth={6}
                  tickFormatter={(d) =>
                    new Date(d).toLocaleDateString('en-IN', {
                      month: 'short',
                    })
                  }
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Section 3: Metric cards (2×2 grid) ─────────────── */}
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

              {/* Divergence pattern */}
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

              {/* New highs vs lows */}
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
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                  }}
                >
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
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    /
                  </span>
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

              {/* Market health score */}
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

          {/* ── Section 4: Pattern interpretation ──────────────── */}
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

          {/* ── Section 5a: Nifty vs Cumulative A/D Line ─────────
              Weinstein's PRIMARY breadth tool. The cumulative
              advance/decline line should track the index — when
              it diverges, that's the meaningful signal. */}
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
                alignItems: 'baseline',
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                }}
              >
                Advance / Decline line
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'rgba(96,165,250,0.15)',
                  color: '#60A5FA',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Weinstein primary
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                marginBottom: 12,
              }}
            >
              Cumulative (advances − declines) vs Nifty · the
              classical breadth indicator
            </div>

            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={filtered}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1E2530"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: '#475569' }}
                  tickFormatter={(d) =>
                    new Date(d).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })
                  }
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                {/* Left Y — Nifty */}
                <YAxis
                  yAxisId="nifty"
                  orientation="left"
                  tick={{ fontSize: 9, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'}
                  domain={['auto', 'auto']}
                />
                {/* Right Y — Cumulative A/D */}
                <YAxis
                  yAxisId="ad"
                  orientation="right"
                  tick={{ fontSize: 9, fill: '#60A5FA' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    v == null
                      ? ''
                      : Math.abs(v) >= 1000
                        ? (v / 1000).toFixed(1) + 'k'
                        : String(Math.round(v))
                  }
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0F1217',
                    border: '1px solid #1E2530',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: '#94A3B8', marginBottom: 4 }}
                  formatter={(value, name) => {
                    if (name === 'Nifty 50') {
                      return [value?.toLocaleString('en-IN'), name]
                    }
                    return [value?.toLocaleString('en-IN'), name]
                  }}
                  labelFormatter={(d) =>
                    new Date(d).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  }
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#475569' }} />

                <Area
                  yAxisId="ad"
                  type="monotone"
                  dataKey="ad_line_cumulative"
                  name="A/D Cumulative"
                  fill="rgba(96,165,250,0.10)"
                  stroke="#60A5FA"
                  strokeWidth={1.8}
                  dot={false}
                />
                <Line
                  yAxisId="nifty"
                  type="monotone"
                  dataKey="nifty_close"
                  name="Nifty 50"
                  stroke="#E2E8F0"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>

            {/* A/D divergence interpretation */}
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

          {/* ── Section 5b: 52W Highs vs Lows over time ──────────
              Weinstein's CONFIRMATION breadth — does the participation
              count agree with the index level? */}
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
                alignItems: 'baseline',
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                }}
              >
                New highs vs new lows
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'rgba(0,200,5,0.15)',
                  color: '#00C805',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Weinstein confirm
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                marginBottom: 12,
              }}
            >
              Daily count of stocks at 52W highs (above zero) vs
              52W lows (below zero) · gold line = 10-day average
            </div>

            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={filtered}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1E2530"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 8, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(d) =>
                    new Date(d).toLocaleDateString('en-IN', {
                      month: 'short',
                    })
                  }
                />
                <YAxis
                  tick={{ fontSize: 8, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0F1217',
                    border: '1px solid #1E2530',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(v, n) => [v?.toLocaleString('en-IN'), n]}
                  labelFormatter={(d) =>
                    new Date(d).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  }
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#475569' }} />
                <ReferenceLine
                  y={0}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={1}
                />
                <Area
                  type="monotone"
                  dataKey="highs_minus_lows"
                  name="Highs − Lows"
                  fill="rgba(0,200,5,0.10)"
                  stroke="#00C805"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="hl_spread_10d_avg"
                  name="10-day avg"
                  stroke="#FBBF24"
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>

            <div
              style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.02)',
                fontSize: 10,
                color: '#475569',
                fontStyle: 'italic',
                lineHeight: 1.6,
              }}
            >
              Positive readings = healthy breadth (more stocks at new
              highs than lows). Persistently negative readings even
              while the index holds up = broad weakness beneath the
              surface. Observational only. EOD data. Not investment
              advice. Not SEBI registered.
            </div>
          </div>

          {/* ── Section 5c: Advancing stocks % over time ─────────── */}
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
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 4,
              }}
            >
              Stocks in advancing phase
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                marginBottom: 12,
              }}
            >
              % of NSE stocks in the advancing (Stage 2) phase ·
              PineX-derived metric, not classical Weinstein
            </div>

            <ResponsiveContainer width="100%" height={160}>
              <ComposedChart data={filtered}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1E2530"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 8, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(d) =>
                    new Date(d).toLocaleDateString('en-IN', {
                      month: 'short',
                    })
                  }
                />
                <YAxis
                  tick={{ fontSize: 8, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v + '%'}
                  domain={[0, 80]}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0F1217',
                    border: '1px solid #1E2530',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(v, n) => [v?.toFixed(1) + '%', n]}
                />
                <ReferenceLine
                  y={50}
                  stroke="rgba(255,255,255,0.1)"
                  strokeDasharray="3 3"
                />
                <Area
                  type="monotone"
                  dataKey="stage2_pct"
                  name="Advancing %"
                  fill="rgba(0,200,5,0.08)"
                  stroke="#00C805"
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Section 6: Collapsible guide ────────────────────── */}
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
                    title: 'What is market breadth?',
                    text: 'The percentage of NSE stocks trading above their 30-week trend lines. A high number means broad participation. A low number means few stocks are actually in uptrends despite what the index may show.',
                  },
                  {
                    title: 'What is a narrow rally?',
                    text: 'When the index rises but breadth falls — fewer stocks are participating. Historically this has sometimes preceded corrections. But this is an observation from limited data, not a reliable predictor.',
                  },
                  {
                    title: 'What is broad participation?',
                    text: 'When both the index and breadth rise together. More stocks crossing above trend lines while the index rises. Historically associated with more sustained moves — but not guaranteed.',
                  },
                  {
                    title: 'Why is this experimental?',
                    text: 'PineX has limited historical breadth data. The patterns shown are mathematical observations only. They have not been statistically validated on Indian markets. Use this as one data point, not a conclusion.',
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
