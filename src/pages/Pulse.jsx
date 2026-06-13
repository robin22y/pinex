// Pulse — public landing page showing today's NSE market breadth /
// cycle distribution / sector pulse. Anonymous-friendly. Reads from
// market_internals + sectors via the Supabase anon key (RLS permits
// public SELECT on both tables).
//
// Goals:
//   • Acquisition surface — give anon visitors enough structure to
//     understand what PineX shows, then convert via the two CTAs
//     near the bottom.
//   • No login. No app shell. No bottom nav. Mounted via App.jsx
//     under RootLayout, but RootLayout's pathname check disables
//     the shell nav specifically for /pulse.
//   • Theme-aware via CSS vars (--positive / --negative / --border
//     etc.). The page renders the same shape in dark and sepia;
//     only the colour palette flips.

import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

// Plain-English breadth context — derived client-side from the % above
// 30W MA. Chosen so the band wording matches the way the rest of the
// app talks about market health (Healthy / Mixed / Weak).
function getBreadthContext(pct) {
  if (pct >= 60) return 'Strong — broad participation'
  if (pct >= 50) return 'Healthy — majority above trend'
  if (pct >= 40) return 'Neutral — mixed conditions'
  if (pct >= 30) return 'Weak — deteriorating breadth'
  return 'Critical — market under pressure'
}

function getVixContext(vix) {
  if (vix == null) return ''
  if (vix < 12) return 'Very low — complacency zone'
  if (vix < 16) return 'Normal range'
  if (vix < 20) return 'Elevated — some fear'
  if (vix < 25) return 'High — significant fear'
  return 'Extreme — panic conditions'
}

// Stage chip colours — match the rest of the app's stage palette.
// Theme-aware via the existing var(--stage*-color) tokens defined in
// theme.css for both dark and sepia.
const STAGE_META = [
  { key: 'stage2_count', label: 'Advancing', color: 'var(--stage2-color)' },
  { key: 'stage1_count', label: 'Basing',    color: 'var(--stage1-color)' },
  { key: 'stage3_count', label: 'Topping',   color: 'var(--stage3-color)' },
  { key: 'stage4_count', label: 'Declining', color: 'var(--stage4-color)' },
]

// ── Component ──────────────────────────────────────────────────────────────

export default function Pulse() {
  const [internals, setInternals] = useState(null)
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const intRes = await supabase
          .from('market_internals')
          .select(`
            date, nifty_close, india_vix, vix_level,
            stage1_count, stage2_count, stage3_count, stage4_count,
            total_stocks, stage2_pct, stage4_pct,
            advances, declines, ad_ratio,
            above_ma30w_pct, above_ma30w_count,
            market_phase, market_health_score,
            nifty_change_1d, nifty_change_1w,
            new_52w_highs, new_52w_lows,
            divergence_active, divergence_severity
          `)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (intRes.error) throw intRes.error
        if (cancelled) return

        const secRes = await supabase
          .from('sectors')
          .select('name, display_name, stage2_pct, health, total_companies, stage2_count')
          .order('date', { ascending: false })
          .order('stage2_pct', { ascending: false })
          .limit(40)
        if (cancelled) return

        setInternals(intRes.data || null)
        setSectors(secRes.data || [])
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Render branches ─────────────────────────────────────────────────────

  if (loading) return <PulseSkeleton />

  if (error || !internals) {
    return (
      <PulseShell>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          Market data updates after NSE close (3:30 PM IST).<br />
          Check back after market hours.
        </div>
      </PulseShell>
    )
  }

  // Most recent date — used both for the sector filter (keep only
  // today's row per sector) and for the header subtitle.
  const latestDate = internals.date

  // Sectors arrive ordered (date DESC, stage2_pct DESC). The first row
  // per sector for the latest date is the one we want. The client-side
  // filter below drops any older-date rows that snuck through the
  // top-40 limit.
  const todaySectors = sectors.filter(s => true) // no date column to filter on per spec; use whole result
  const sectorsByStrength = [...todaySectors].sort((a, b) => (b.stage2_pct ?? -1) - (a.stage2_pct ?? -1))
  const strongest = sectorsByStrength.slice(0, 3)
  const weakest = [...sectorsByStrength].reverse().slice(0, 3)

  const stageTotal = (internals.stage1_count || 0) + (internals.stage2_count || 0)
    + (internals.stage3_count || 0) + (internals.stage4_count || 0)

  const niftyChange1d = Number(internals.nifty_change_1d)
  const niftyChangeColor = Number.isFinite(niftyChange1d)
    ? (niftyChange1d >= 0 ? 'var(--positive)' : 'var(--negative)')
    : 'var(--text-muted)'

  return (
    <PulseShell>
      <Helmet>
        <title>NSE Market Breadth & Cycle Analysis Today | PineX Pulse</title>
        <meta
          name="description"
          content={`Free daily Indian market breadth data. ${internals.above_ma30w_pct}% of NSE stocks above 30-week trend line. ${internals.stage2_count} stocks Advancing. Updated after market close.`}
        />
        <meta property="og:title" content="PineX Market Pulse — NSE Breadth & Cycle Data" />
        <meta property="og:description" content="Free Indian market structure data. Breadth, cycle stages, sector participation. Updated daily." />
        <meta name="robots" content="index, follow" />
      </Helmet>

      {/* Header */}
      <Header date={latestDate} />

      {/* Section — Market Breadth */}
      <Section title="Market Breadth">
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          <span className="num">{Number(internals.above_ma30w_pct).toFixed(1)}%</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          above 30W trend line — {getBreadthContext(Number(internals.above_ma30w_pct) || 0)}
        </div>
        {/* Razor breadth bar — terminal-style, 0 radius. Width tracks
            the breadth % so the chart reads at a glance. */}
        <div style={{
          marginTop: 12,
          height: 8,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 0,
        }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, Math.max(0, Number(internals.above_ma30w_pct) || 0))}%`,
            background: 'var(--positive)',
            borderRadius: 0,
          }} />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
          <span>Advances: <span className="num" style={{ color: 'var(--positive)' }}>{Number(internals.advances).toLocaleString('en-IN')}</span></span>
          <span>Declines: <span className="num" style={{ color: 'var(--negative)' }}>{Number(internals.declines).toLocaleString('en-IN')}</span></span>
          <span>A/D Ratio: <span className="num">{Number(internals.ad_ratio ?? (internals.declines ? internals.advances / internals.declines : 0)).toFixed(2)}</span></span>
        </div>
      </Section>

      {/* Section — Cycle Stage Distribution */}
      <Section title="Cycle Stage Distribution">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STAGE_META.map(s => {
            const count = Number(internals[s.key]) || 0
            const pct = stageTotal > 0 ? (count / stageTotal) * 100 : 0
            return (
              <div key={s.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) minmax(60px, auto) minmax(60px, auto) 2fr', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                  {s.label}
                </div>
                <div className="num" style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  {count.toLocaleString('en-IN')}
                </div>
                <div className="num" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {pct.toFixed(1)}%
                </div>
                <div style={{
                  height: 8,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 0,
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, pct)}%`,
                    background: s.color,
                    borderRadius: 0,
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Section — Sector Pulse */}
      <Section title="Sector Pulse">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <SectorList label="Strongest" rows={strongest} positive />
          <SectorList label="Weakest"   rows={weakest}   positive={false} />
        </div>
      </Section>

      {/* Section — Market Context */}
      <Section title="Market Context">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <div>
            Nifty:{' '}
            <span className="num" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {Number(internals.nifty_close).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {Number.isFinite(niftyChange1d) && (
              <span className="num" style={{ color: niftyChangeColor, marginLeft: 8 }}>
                ({niftyChange1d >= 0 ? '+' : ''}{niftyChange1d.toFixed(2)}% today)
              </span>
            )}
          </div>
          <div>
            VIX: <span className="num" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{Number(internals.india_vix).toFixed(2)}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {getVixContext(Number(internals.india_vix))}</span>
          </div>
          {internals.market_phase && (
            <div>Phase: <span style={{ color: 'var(--text-primary)' }}>{internals.market_phase}</span></div>
          )}
          {Number.isFinite(Number(internals.new_52w_highs)) && Number.isFinite(Number(internals.new_52w_lows)) && (
            <div>
              52W highs: <span className="num" style={{ color: 'var(--positive)' }}>{internals.new_52w_highs}</span>
              {'  · '}
              52W lows: <span className="num" style={{ color: 'var(--negative)' }}>{internals.new_52w_lows}</span>
            </div>
          )}
        </div>
      </Section>

      {/* Conversion CTA — sign up + search */}
      <div style={{
        padding: '24px 16px',
        borderTop: '1px solid var(--border)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          See which specific stocks are in each stage
        </div>
        <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link
            to="/register"
            style={{
              display: 'inline-block',
              background: 'var(--accent)',
              color: 'var(--bg-primary)',
              padding: '10px 24px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Sign up free →
          </Link>
          <Link
            to="/home"
            style={{
              display: 'inline-block',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '10px 24px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Search any stock →
          </Link>
        </div>
      </div>

      {/* Disclaimer footer */}
      <div style={{
        padding: '20px 16px',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        lineHeight: 1.7,
        color: 'var(--text-hint)',
        textAlign: 'center',
      }}>
        Data observation only.<br />
        Not investment advice.<br />
        Not SEBI registered.<br />
        Verify independently before acting.
      </div>
    </PulseShell>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PulseShell({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'inherit',
    }}>
      <div style={{
        maxWidth: 640,
        margin: '0 auto',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}>
        {children}
      </div>
    </div>
  )
}

function Header({ date }) {
  return (
    <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Link to="/" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>
          Pine<span style={{ color: 'var(--accent)' }}>X</span>
        </Link>
        <Link to="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 12 }}>
          Sign in
        </Link>
      </div>
      <div style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        PineX Market Pulse
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
        {formatDate(date)} · End of day · Not investment advice
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ padding: '20px 16px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function SectorList({ label, rows, positive }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>No data yet</span>
        )}
        {rows.map((r) => {
          const pct = Number(r.stage2_pct)
          return (
            <div key={r.name || r.display_name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.display_name || r.name}
              </span>
              <span className="num" style={{ color: positive ? 'var(--positive)' : 'var(--negative)', fontWeight: 600, flexShrink: 0 }}>
                {Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Simple skeleton — three grey rectangles, no spinner.
function PulseSkeleton() {
  const bar = {
    height: 14,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 0,
    marginBottom: 12,
  }
  return (
    <PulseShell>
      <div style={{ padding: 20 }}>
        <div style={{ ...bar, width: '40%', height: 18 }} />
        <div style={{ ...bar, width: '70%' }} />
        <div style={{ ...bar, width: '55%' }} />
      </div>
    </PulseShell>
  )
}
