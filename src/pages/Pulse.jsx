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

// Historical URLs: /pulse/YYYY-MM-DD
// ~1,600 indexable pages from 2020-01-28 to present
// Sitemap should include these — see scripts/generate_sitemap.py
//
// Data availability by period:
//   Aug 2019 → Jan 2020   advances/declines only
//   Jan 2020 → Jun 2026   full breadth + stages + AD
//   Jun 2026 onwards      full + sectors

import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import PulseShareCard from '../components/PulseShareCard'
import { supabase } from '../lib/supabase'

// ── Derived: market pulse verdict ─────────────────────────────────────────
// Drives the colour + label on the share card AND the SEO description.
// Tuned bands match the in-page breadth context phrasing.
function getMarketPulse(internals) {
  const breadth = Number(internals?.above_ma30w_pct) || 0
  const stage2 = Number(internals?.stage2_pct) || 0
  if (breadth >= 60 && stage2 >= 45) return 'Strong Breadth'
  if (breadth >= 50 && stage2 >= 38) return 'Improving Breadth'
  if (breadth >= 40) return 'Mixed Breadth'
  if (breadth >= 30) return 'Weakening Breadth'
  return 'Narrow Breadth'
}

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

// Short variant for the prev/next chips in DateNav — e.g. "12 Jun".
// `T00:00:00` forces local midnight so en-GB doesn't roll the day back
// when the device timezone is east of UTC (IST is +05:30).
function formatDateShort(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return dateStr
  }
}

// Long variant for the DateNav centre + Helmet — "Friday, 12 June 2026".
function formatDateLong(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

// Plain-English breadth context — derived client-side from the % above
// 30W MA. Chosen so the band wording matches the way the rest of the
// app talks about market health (Healthy / Mixed / Weak).
function getBreadthContext(pct) {
  if (pct >= 60) return 'Strong — broad participation'
  if (pct >= 50) return 'Healthy — majority above trend'
  if (pct >= 40) return 'Mixed — neither broad nor narrow'
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
  // URL param — present when the user is browsing /pulse/:date.
  // When absent we fetch the latest market_internals row.
  const { date: urlDate } = useParams()
  const navigate = useNavigate()

  const [internals, setInternals] = useState(null)
  const [sectors, setSectors] = useState([])
  const [availableDates, setAvailableDates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showShareCard, setShowShareCard] = useState(false)
  // isMobile drives the sticky bottom-bar nudge — hide on desktop where
  // the inline CTAs at the bottom of the page are already visible.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Hide the floating support chat bubble on this page only — public
  // pulse leans heavy on the sector pulse columns and the bubble was
  // overlapping the weakest-sectors list. Restored on unmount so other
  // pages keep the support entry point.
  useEffect(() => {
    const chatBubble = document.querySelector('[class*="chat"], [id*="chat"], iframe[src*="crisp"]')
    if (chatBubble) chatBubble.style.display = 'none'
    return () => {
      if (chatBubble) chatBubble.style.display = ''
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        // 1. Today's row — either pinned to the URL date or the most
        //    recent available. maybeSingle so an invalid date in the
        //    URL doesn't error — it just renders the no-data view.
        let internalsQuery = supabase
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
        if (urlDate) {
          internalsQuery = internalsQuery.eq('date', urlDate)
        } else {
          internalsQuery = internalsQuery.order('date', { ascending: false }).limit(1)
        }
        const intRes = await internalsQuery.maybeSingle()
        if (cancelled) return
        if (intRes.error) throw intRes.error
        let internalsRow = intRes.data || null

        // Fallback for stale / null nifty_change_1d. The pipeline
        // (calc_market_internals.py) is supposed to compute this from
        // market_internals history, but pipeline timing races have
        // shipped 0.0 in production. If the stored value is null or
        // 0.0 *and* the prior stored nifty_close differs from today,
        // recompute client-side from the previous market_internals
        // row and overwrite the field on the in-memory copy.
        if (internalsRow) {
          const storedChg = Number(internalsRow.nifty_change_1d)
          const isStale = internalsRow.nifty_change_1d == null ||
            (Number.isFinite(storedChg) && storedChg === 0)
          if (isStale && Number.isFinite(Number(internalsRow.nifty_close))) {
            const prevRes = await supabase
              .from('market_internals')
              .select('date, nifty_close')
              .lt('date', internalsRow.date)
              .order('date', { ascending: false })
              .limit(1)
              .maybeSingle()
            const prevClose = Number(prevRes?.data?.nifty_close)
            const todayClose = Number(internalsRow.nifty_close)
            if (Number.isFinite(prevClose) && prevClose > 0 &&
                Number.isFinite(todayClose) && todayClose !== prevClose) {
              const calcPct = Math.round(((todayClose - prevClose) / prevClose) * 10000) / 100
              internalsRow = { ...internalsRow, nifty_change_1d: calcPct }
            }
          }
        }

        // 2. Sectors — fetched against the SAME date the internals row
        //    landed on (not necessarily today, especially for historical
        //    URLs). Pre-Jun 2026 dates return [] which the page handles
        //    with the sector-availability notice.
        const dataDate = internalsRow?.date
        let sectorsRows = []
        if (dataDate) {
          const secRes = await supabase
            .from('sectors')
            .select('name, display_name, stage2_pct, health, total_companies, stage2_count')
            .eq('date', dataDate)
            .order('stage2_pct', { ascending: false })
          if (!cancelled && !secRes.error) {
            sectorsRows = secRes.data || []
          }

          // Fallback — internals can land on a date the sectors pipeline
          // hasn't covered yet (sectors run slower than market_internals).
          // Use the most recent sector date ≤ today rather than showing
          // an empty Sector Pulse block.
          if (sectorsRows.length === 0) {
            const latestDateRes = await supabase
              .from('sectors')
              .select('date')
              .lte('date', dataDate)
              .order('date', { ascending: false })
              .limit(1)
            const fallbackDate = latestDateRes.data?.[0]?.date
            if (!cancelled && fallbackDate && fallbackDate !== dataDate) {
              const secRes2 = await supabase
                .from('sectors')
                .select('name, display_name, stage2_pct, health, total_companies, stage2_count')
                .eq('date', fallbackDate)
                .order('stage2_pct', { ascending: false })
              if (!cancelled && !secRes2.error) {
                sectorsRows = secRes2.data || []
              }
            }
          }
        }

        // 3. Available dates — drives the prev/next chips in DateNav.
        //    Cap at 500 so the array stays small (~500 trading days =
        //    ~2 years). Older history is reachable by typing the URL.
        const datesRes = await supabase
          .from('market_internals')
          .select('date')
          .gte('date', '2020-01-28')
          .order('date', { ascending: false })
          .limit(500)
        const dateList = !cancelled && !datesRes.error
          ? (datesRes.data || []).map(r => r.date)
          : []

        if (cancelled) return
        setInternals(internalsRow)
        setSectors(sectorsRows)
        setAvailableDates(dateList)
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [urlDate])

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

  // Sector filter — drop unnamed / shell-rows (no display_name) and
  // tiny sectors with fewer than 5 listed companies. Without the
  // size guard a one-stock sector like "GEMS" can render 100%
  // stage2_pct and appear next to legitimate Banking / IT entries,
  // which misrepresents what's actually moving in the market.
  const cleanSectors = (sectors || []).filter((s) =>
    s.display_name !== null
    && s.display_name !== undefined
    && s.total_companies >= 5
  )
  const strongest = [...cleanSectors]
    .sort((a, b) => b.stage2_pct - a.stage2_pct)
    .slice(0, 3)
  const weakest = [...cleanSectors]
    .sort((a, b) => a.stage2_pct - b.stage2_pct)
    .slice(0, 3)

  const stageTotal = (internals.stage1_count || 0) + (internals.stage2_count || 0)
    + (internals.stage3_count || 0) + (internals.stage4_count || 0)

  const niftyChange1d = Number(internals.nifty_change_1d)
  const niftyChangeColor = Number.isFinite(niftyChange1d)
    ? (niftyChange1d >= 0 ? 'var(--positive)' : 'var(--negative)')
    : 'var(--text-muted)'

  // Derived for the share card + SEO metadata. Same function the share
  // card uses so the colour and label match the modal.
  const marketPulse = getMarketPulse(internals)
  // Strongest sector — used in nudge 2 below to drive the "see all
  // stocks in <sector>" CTA. Falls back to empty string when the
  // sectors fetch returns no rows.
  const topSector = strongest[0] || null

  // A/D ratio — internals.ad_ratio is stored as a clamped int (e.g. 1)
  // for some historical rows, which renders as a misleading "1.00".
  // Recompute from raw advances/declines when both are present; fall
  // back to the stored value when raw counts aren't available (very
  // old rows from the 2019 partial-data window).
  const adRatio = internals?.advances && internals?.declines && internals?.declines > 0
    ? (internals.advances / internals.declines).toFixed(2)
    : internals?.ad_ratio?.toFixed(2) || '—'

  // Historical-mode flags drive the Helmet copy + canonical and the
  // "Stage classification data available from..." notice above the
  // breadth section. We treat any URL-pinned date as historical even
  // when it happens to equal the latest data — the URL still has a
  // dated slug worth canonicalising.
  const isHistorical = Boolean(urlDate)
  const pageTitle = isHistorical
    ? `NSE Market Breadth ${formatDateLong(internals?.date)} — ${internals?.above_ma30w_pct}% Above 30W MA | PineX`
    : `NSE Market Breadth Today — ${internals?.above_ma30w_pct}% Above 30W MA | PineX`
  const pageDescription = isHistorical
    ? `Historical Indian stock market data for ${formatDateLong(internals?.date)}. ${internals?.above_ma30w_pct}% of NSE stocks above 30-week trend line. ${internals?.stage2_count} stocks Advancing. Free market structure data.`
    : `Free Indian stock market breadth data. ${internals?.above_ma30w_pct}% of ${internals?.total_stocks} NSE stocks above 30-week trend line. ${internals?.stage2_count} stocks Advancing. ${Number(internals?.stage2_pct ?? 0).toFixed(1)}% in Stage 2. Updated after market close daily.`
  const canonicalUrl = isHistorical
    ? `https://pinex.in/pulse/${internals?.date}`
    : 'https://pinex.in/pulse'

  return (
    <PulseShell>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta name="keywords" content="NSE market breadth, Indian stock market cycle analysis, NSE advance decline ratio, Indian stocks above 200 DMA, NSE stage analysis, PineX" />
        <meta property="og:title" content={`NSE Market Pulse — Breadth ${internals?.above_ma30w_pct}% | PineX`} />
        <meta property="og:description" content={`${internals?.stage2_count} NSE stocks Advancing. Breadth: ${internals?.above_ma30w_pct}%. Free daily market structure data.`} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content="https://pinex.in/og-image.png" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`NSE Market Pulse — ${internals?.above_ma30w_pct}% Breadth`} />
        <meta name="twitter:description" content={`${internals?.stage2_count} stocks Advancing. Free Indian market structure data at pinex.in/pulse`} />
        <link rel="canonical" href={canonicalUrl} />
        <meta name="robots" content="index, follow" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Dataset",
          "name": "PineX NSE Market Breadth Data",
          "description": "Daily Indian stock market breadth, cycle stage distribution, and sector participation data for 2,125 NSE stocks",
          "url": "https://pinex.in/pulse",
          "creator": {
            "@type": "Organization",
            "name": "PineX",
            "url": "https://pinex.in",
          },
          "temporalCoverage": "2019/..",
          "spatialCoverage": "India",
          "variableMeasured": [
            "Market Breadth",
            "Cycle Stage Distribution",
            "Sector Participation",
            "Advance Decline Ratio",
          ],
        })}</script>
      </Helmet>

      {/* Header */}
      <Header date={latestDate} onShare={() => setShowShareCard(true)} />

      {/* Date navigation — prev / current / next chips. Only renders
          when we have a date list to navigate over (DB-empty / loading
          states fall through). The buttons disable themselves at the
          ends of the available range. */}
      {availableDates.length > 0 && internals?.date && (
        <DateNav
          currentDate={internals.date}
          availableDates={availableDates}
          navigate={navigate}
        />
      )}

      {/* Pre-Jan-2020 dates have advances/declines only, no stage
          classification (the calc_market_internals stages started
          January 2020). Show a subtle notice instead of misleading
          "0 stocks Advancing" rows. */}
      {internals && Number(internals.stage2_count) === 0 && Number(internals.advances) > 0 && (
        <div style={{
          padding: '12px 16px',
          fontSize: 12,
          color: 'var(--text-hint)',
          background: 'var(--bg-elevated)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
        }}>
          Stage classification data available from January 2020 onwards.
          Showing advance/decline data only for this date.
        </div>
      )}

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
          <span>A/D Ratio: <span className="num">{adRatio}</span></span>
          <span>52W Highs: <span className="num" style={{ color: 'var(--positive)' }}>{Number(internals?.new_52w_highs ?? 0).toLocaleString('en-IN')}</span></span>
          <span>52W Lows: <span className="num" style={{ color: 'var(--negative)' }}>{Number(internals?.new_52w_lows ?? 0).toLocaleString('en-IN')}</span></span>
        </div>
      </Section>

      {/* Nudge 1 — sign up to see which stocks drove this breadth reading */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          See which stocks are driving this breadth reading
        </span>
        <Link to="/register" style={{
          fontSize: 12,
          color: 'var(--accent)',
          textDecoration: 'none',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          Sign up free →
        </Link>
      </div>

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

      {/* Section — Market Participation (90-day A-D cumulative line).
          Self-fetches from market_breadth; renders null while loading and
          on empty so the layout doesn't shift on slow connections. */}
      <AdvanceDeclineSection />

      {/* Section — Sector Pulse */}
      <Section title="Sector Pulse">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <SectorList label="Strongest" rows={strongest} positive />
          <SectorList label="Weakest"   rows={weakest}   positive={false} />
        </div>
        {/* Subtle notice — sector breakdown only exists from Jun 2026
            onwards. For older URLs the sector lists render as "No data
            yet" placeholders; this line tells the user why. */}
        {sectors.length === 0 && (
          <div style={{
            marginTop: 12,
            fontSize: 12,
            color: 'var(--text-hint)',
            textAlign: 'center',
          }}>
            Sector data available from June 2026 onwards.
          </div>
        )}
      </Section>

      {/* Nudge 2 — sector deep-dive CTA, named with the day's leader */}
      {topSector && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            See all stocks in {topSector.display_name || topSector.name} — {Number(topSector.stage2_pct).toFixed(1)}% advancing
          </span>
          <Link to="/register" style={{
            fontSize: 12,
            color: 'var(--accent)',
            textDecoration: 'none',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            View sector →
          </Link>
        </div>
      )}

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
          {(internals?.new_52w_highs > 0 || internals?.new_52w_lows > 0) && (
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

      {/* Telegram subscribe — secondary conversion path for users who
          don't want an account but want the daily report pushed.
          Telegram blue (#229ED9) is hardcoded since it's a brand colour
          and should look identical regardless of the active theme. */}
      <div style={{
        padding: '20px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          Get this daily after market close
        </div>
        <div style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 4,
        }}>
          Free · No account needed · Auto-subscribes on first tap · Unsubscribe anytime
        </div>
        {/* Primary CTA → the bot. Tapping the bot link and hitting "Start"
            once auto-subscribes the user via cmd_start's upsert into
            telegram_subscribers — that's the table the daily broadcast
            pulls from. The Telegram channel (below as a pill) is passive
            and doesn't register the user, so it's secondary. */}
        <a
          href="https://t.me/pineX_Alerts_bot?start=help"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#229ED9',
            color: '#FFFFFF',
            padding: '10px 24px',
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            width: '100%',
            justifyContent: 'center',
            boxSizing: 'border-box',
          }}
        >
          Subscribe via Telegram Bot →
        </a>

        {/* Secondary follow surfaces — passive Telegram channel and
            WhatsApp channel. These don't register the user; they're
            broadcast feeds for users who prefer not to interact with
            the bot. */}
        <div style={{
          marginTop: 4,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          <a
            href="https://t.me/pinexin"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 999,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              background: 'var(--bg-surface)',
            }}
          >
            Telegram Channel ↗
          </a>
          <a
            href="https://whatsapp.com/channel/pinex"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 999,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              background: 'var(--bg-surface)',
            }}
          >
            WhatsApp Channel ↗
          </a>
        </div>
      </div>

      {/* Spacer — pushes content up so the sticky mobile nudge bar
          (rendered as a sibling outside PulseShell below) doesn't
          paint over the disclaimer footer on small screens. */}
      {isMobile && <div style={{ height: 72 }} />}

      {/* Nudge 3 — sticky bottom bar, mobile only. Sits above the page
          via position:fixed + zIndex:100. Hidden on ≥768px viewports
          where the inline conversion CTAs above are already visible. */}
      {isMobile && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 16px',
          background: 'var(--bg-elevated)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          zIndex: 100,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              See which stocks are Advancing
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Free · 2,125 stocks · Updated daily
            </div>
          </div>
          <Link to="/register" style={{
            background: 'var(--accent)',
            color: 'var(--bg-primary)',
            padding: '8px 16px',
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            Sign up free
          </Link>
        </div>
      )}

      {/* Share-card modal — html2canvas-rasterised 1200×630 PNG. Mounted
          only while showShareCard is true so the heavy html2canvas
          import doesn't run on initial page load. */}
      {showShareCard && (
        <PulseShareCard
          internals={internals}
          sectors={cleanSectors}
          marketPulse={marketPulse}
          onClose={() => setShowShareCard(false)}
        />
      )}
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

function DateNav({ currentDate, availableDates, navigate }) {
  // availableDates is sorted DESC (latest first). prevDate is the
  // OLDER trading day, nextDate is the NEWER one — same convention as
  // a calendar arrow pair.
  const currentIndex = availableDates.indexOf(currentDate)
  const prevDate = availableDates[currentIndex + 1] // older
  const nextDate = availableDates[currentIndex - 1] // newer
  const isLatest = currentIndex === 0

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 16px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-elevated)',
      gap: 10,
    }}>
      {/* Previous trading day — disabled at the oldest end of the list */}
      <button
        type="button"
        onClick={() => prevDate && navigate(`/pulse/${prevDate}`)}
        disabled={!prevDate}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '5px 10px',
          fontSize: 12,
          color: prevDate ? 'var(--text-primary)' : 'var(--text-hint)',
          cursor: prevDate ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        ← {prevDate ? formatDateShort(prevDate) : 'Earlier'}
      </button>

      {/* Current date — long form, with a "view latest" escape hatch
          when the user is anywhere other than today. */}
      <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {formatDateLong(currentDate)}
        </div>
        {!isLatest && (
          <button
            type="button"
            onClick={() => navigate('/pulse')}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 11,
              color: 'var(--accent)',
              cursor: 'pointer',
              padding: 0,
              marginTop: 2,
              fontFamily: 'inherit',
            }}
          >
            View latest →
          </button>
        )}
      </div>

      {/* Next trading day — disabled when we're already on the latest */}
      <button
        type="button"
        onClick={() => nextDate && navigate(`/pulse/${nextDate}`)}
        disabled={!nextDate}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '5px 10px',
          fontSize: 12,
          color: nextDate ? 'var(--text-primary)' : 'var(--text-hint)',
          cursor: nextDate ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        {nextDate ? formatDateShort(nextDate) : 'Latest'} →
      </button>
    </div>
  )
}

function Header({ date, onShare }) {
  return (
    <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Link to="/home" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>
          Pine<span style={{ color: 'var(--accent)' }}>X</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Home — `/` runs through HomeGate which routes signed-in
              users to their dashboard at /home and signed-out users
              back to /pulse. Same outline style as the Share button so
              the header's two actions read as a pair. */}
          <Link
            to="/"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: 12,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontFamily: 'inherit',
              lineHeight: '1.2',
            }}
          >
            Home
          </Link>
          {/* Share — opens the html2canvas-rasterised PulseShareCard.
              Outline style matches the page's terminal aesthetic; only
              the in-card buttons use the accent green fill. */}
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '6px 14px',
                fontSize: 12,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Share ↗
            </button>
          )}
          <Link to="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 12 }}>
            Sign in
          </Link>
        </div>
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

// ── AdvanceDeclineSection ────────────────────────────────────────────
// Pulse-page widget showing the running 90-day cumulative advance /
// decline line plus today's raw advances / declines / unchanged.
//
// Reads market_breadth (RLS-public). Renders null while loading and on
// empty so the surrounding layout doesn't shift. Line colour is a
// 20-day momentum signal:
//   ad_cumulative today > value 20 days ago → green (broadening)
//   ad_cumulative today < value 20 days ago → red   (narrowing)
//   equal                                    → amber (neutral)
function AdvanceDeclineSection() {
  // null while loading; [] when the table is empty (RLS denied, fresh
  // pipeline state, etc.) — both cases render null and reserve no space.
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('market_breadth')
      .select('trading_date, advances, declines, unchanged, ad_cumulative, ad_daily')
      .order('trading_date', { ascending: false })
      .limit(90)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setRows([]); return }
        // Reverse so oldest is first — Recharts walks the array
        // left-to-right and a descending series would draw the line
        // backwards (last x-axis tick would be the oldest date).
        setRows((data || []).slice().reverse())
      })
    return () => { cancelled = true }
  }, [])

  // While loading, reserve the same vertical space the rendered chart
  // will occupy — otherwise the section "appearing" causes layout shift
  // (Lighthouse flagged this as one of the top CLS contributors). 364 px
  // is the measured live height of the full section on mobile (heading +
  // sub-text + 160 px chart + legend + trend copy + footer disclaimer).
  // On hard-empty (RLS / fresh pipeline) we keep the reservation too so
  // there's still no shift — an unobtrusive empty section is preferable
  // to a jolt.
  if (rows == null || rows.length === 0) {
    return (
      <div style={{ padding: '20px 16px', borderTop: '1px solid var(--border)', minHeight: 364, boxSizing: 'border-box' }} />
    )
  }

  const latest = rows[rows.length - 1] || {}
  const current = Number(latest.ad_cumulative) || 0
  const lookback = rows.length > 20 ? rows[rows.length - 21] : rows[0]
  const baseline = Number(lookback.ad_cumulative) || 0

  // 20-day momentum colour — hex literals to honour the spec exactly.
  // (Surrounding chrome — labels, tooltip, disclaimers — uses CSS vars
  // so it tracks the active sepia / dark theme.)
  let lineColor = '#f59e0b'
  if (current > baseline) lineColor = '#22c55e'
  else if (current < baseline) lineColor = '#ef4444'

  const fmtShort = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso + 'T00:00:00')
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    } catch { return iso }
  }

  // 20-period MA of ad_cumulative. First 19 rows hold null so the
  // dashed line only starts where the window is fully populated —
  // avoids a misleading "flat" segment that would otherwise paint
  // a partial-window average over the leftmost weeks.
  const withMA20 = (rows.map((r) => ({
    label: fmtShort(r.trading_date),
    ad_cumulative: r.ad_cumulative,
  }))).map((row, i, arr) => {
    if (i < 19) return { ...row, ma20: null }
    const slice = arr.slice(i - 19, i + 1)
    const sum = slice.reduce((acc, x) => acc + (Number(x.ad_cumulative) || 0), 0)
    return { ...row, ma20: Math.round(sum / 20) }
  })
  const chartData = withMA20

  // Trend interpretation — compare today's ad_cumulative to the value
  // 20 rows back. Falls back to "neutral" when the lookback window
  // isn't yet 21 rows deep (early days after a fresh backfill).
  const prev20 = rows.length > 20 ? rows[rows.length - 21] : null
  let trendCopy = 'Mixed participation — market breadth neutral over last 20 days'
  if (prev20) {
    if (current > Number(prev20.ad_cumulative)) {
      trendCopy = 'Broad participation improving — more stocks advancing than declining over last 20 days'
    } else if (current < Number(prev20.ad_cumulative)) {
      trendCopy = 'Broad participation weakening — more stocks declining despite index movements'
    }
  }

  return (
    <Section title="Market Participation — 90 days">
      <div style={{
        fontSize: 12,
        color: 'var(--text-muted)',
        marginBottom: 12,
        lineHeight: 1.4,
      }}>
        Rising = more stocks advancing than declining across all NSE stocks
      </div>

      <div style={{ width: '100%', height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              interval="preserveStartEnd"
              minTickGap={32}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                fontSize: 11,
                color: 'var(--text-primary)',
              }}
              labelStyle={{ color: 'var(--text-muted)' }}
              formatter={(value, name) => [
                value == null ? '—' : Number(value).toLocaleString('en-IN'),
                name === 'ma20' ? '20-day avg' : 'A-D cumulative',
              ]}
            />
            <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="ad_cumulative"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="A/D Line"
            />
            <Line
              type="monotone"
              dataKey="ma20"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              name="20-day avg"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend — colour swatches use the live line stroke (so the A/D
          swatch tracks the green/red/amber momentum colour) plus the
          static grey for the 20-day MA. */}
      <div style={{
        marginTop: 8,
        fontSize: 11,
        color: 'var(--text-muted)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
        alignItems: 'center',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ display: 'inline-block', width: 18, height: 2, background: lineColor }} />
          A/D Line
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 18,
              height: 0,
              borderTop: '1.5px dashed #94a3b8',
            }}
          />
          20-day average
        </span>
      </div>

      {/* Auto-interpretation — single line describing the 20-day trend. */}
      <div style={{
        marginTop: 6,
        fontSize: 12,
        color: 'var(--text-muted)',
        lineHeight: 1.4,
      }}>
        {trendCopy}
      </div>

      <div style={{
        marginTop: 10,
        fontSize: 12,
        color: 'var(--text-muted)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
      }}>
        <span>↑ <span className="num" style={{ color: 'var(--positive)' }}>{Number(latest.advances || 0).toLocaleString('en-IN')}</span> Advanced</span>
        <span>↓ <span className="num" style={{ color: 'var(--negative)' }}>{Number(latest.declines || 0).toLocaleString('en-IN')}</span> Declined</span>
        <span>→ <span className="num">{Number(latest.unchanged || 0).toLocaleString('en-IN')}</span> Unchanged</span>
      </div>

      <div style={{
        marginTop: 8,
        fontSize: 10,
        color: 'var(--text-muted)',
        lineHeight: 1.4,
      }}>
        Data observation only · Not investment advice · Not SEBI registered · Beta stage — errors possible, verify independently · PineX uses its own calculations which may differ from official sources
      </div>
    </Section>
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
// PulseSkeleton — reserves the same vertical space as the loaded page so
// the loading → loaded transition doesn't cause layout shift. Heights
// taken from a production Lighthouse run (Moto G4 emulation, mobile)
// measured AT DATA-ARRIVAL TIME, before web fonts swap in. Earlier
// versions of this stub were sized from a font-loaded dev preview,
// which under-counted by ~50 px on Market Breadth: the stats row
// (Advances · Declines · A/D · 52W H · 52W L) wraps to 3 lines in the
// fallback font but ~1 line once DM Sans arrives. Same story on the
// Sign-up CTA strip (subtitle wrap) and the Header (subtitle wrap).
// Heights here intentionally match the WORST-CASE pre-font layout so
// the second transition (font swap) is the only thing left — and the
// font-swap shift is small enough that Lighthouse doesn't flag it.
//   header 134, date-nav 49, breadth 225, cta 58, stages 165,
//   participation chart 364, sector pulse 158, market context 161.
// Lighthouse measured CLS 0.316 with the previous 80-px stub.
function PulseSkeleton() {
  const placeholder = (height, withTitle = true) => (
    <div style={{ padding: '20px 16px', borderTop: '1px solid var(--border)', minHeight: height, boxSizing: 'border-box' }}>
      {withTitle && (
        <div style={{
          height: 11,
          width: '35%',
          background: 'var(--bg-elevated)',
          marginBottom: 12,
        }} />
      )}
      <div style={{
        height: 14,
        width: '60%',
        background: 'var(--bg-elevated)',
        marginBottom: 8,
      }} />
      <div style={{
        height: 14,
        width: '45%',
        background: 'var(--bg-elevated)',
      }} />
    </div>
  )
  return (
    <PulseShell>
      {/* Header stub */}
      <div style={{ minHeight: 134, boxSizing: 'border-box' }} />
      {/* DateNav stub */}
      <div style={{ minHeight: 49, borderTop: '1px solid var(--border)', boxSizing: 'border-box' }} />
      {placeholder(225)/* Market Breadth */}
      <div style={{ minHeight: 58, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', boxSizing: 'border-box' }}/* Sign-up CTA strip */ />
      {placeholder(165)/* Cycle Stage Distribution */}
      {placeholder(364)/* Market Participation 90D */}
      {placeholder(158)/* Sector Pulse */}
      {placeholder(161)/* Market Context */}
    </PulseShell>
  )
}
