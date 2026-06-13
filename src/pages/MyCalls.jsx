// src/pages/MyCalls.jsx
//
// "My Calls" — personal track record page that surfaces a Guru Score
// computed from the user's watchlist. Hidden share card captured by
// html2canvas for a downloadable PNG.
//
// Data sources (real schema — not the spec's stale view):
//   watchlists   user_id + company_id (NOT symbol)
//   companies    id + symbol + name + sector
//   price_data   company_id + date + close + stage (NOT trading_date,
//                NOT symbol)
//
// The spec's fetch used watchlist/symbol/trading_date which don't
// exist in this codebase — adapted while preserving the rest of the
// logic exactly as written.

import { useEffect, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import Card from '../components/ui/Card'
import SectionLabel from '../components/ui/SectionLabel'
import Skeleton from '../components/ui/Skeleton'
import { useAuth } from '../context'
import { computeGuruScore } from '../lib/guruScore'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

function ScoreRing({ score, size = 120 }) {
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const filled = (score / 100) * circumference
  const gap = circumference - filled

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {/* Track */}
      <circle
        cx="50" cy="50" r={radius}
        fill="none"
        stroke={C.surfaceCard}
        strokeWidth="7"
      />
      {/* Progress — gold→blue gradient via stroke trick */}
      <circle
        cx="50" cy="50" r={radius}
        fill="none"
        stroke="url(#scoreGrad)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${gap}`}
        strokeDashoffset={circumference * 0.25}
        style={{ transition: 'stroke-dasharray 1s ease' }}
      />
      <defs>
        <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      <text x="50" y="46" textAnchor="middle" fontSize="22" fontWeight="700" fill={C.text}>{score}</text>
      <text x="50" y="60" textAnchor="middle" fontSize="9" fill={C.textMuted}>/ 100</text>
    </svg>
  )
}

// Captured by html2canvas — kept off-screen until handleShare fires.
function GuruCertCard({ scoreResult, displayName, cardRef }) {
  if (!scoreResult || !scoreResult.stats) return null
  const { score, title, emoji, stats } = scoreResult

  const medalColor = score >= 85 ? '#F59E0B'
                   : score >= 70 ? '#38BDF8'
                   : score >= 55 ? '#22C55E'
                                 : '#A78BFA'

  const formatGain = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

  return (
    <div
      ref={cardRef}
      style={{
        width: 420,
        fontFamily: '"DM Sans", system-ui, sans-serif',
        background: `linear-gradient(160deg, ${C.base} 0%, ${C.base} 60%, ${C.base} 100%)`,
        border: `1px solid ${medalColor}44`,
        borderRadius: 20,
        padding: 32,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Radial glow behind score ring */}
      <div style={{
        position: 'absolute',
        top: 24,
        right: 24,
        width: 160,
        height: 160,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${medalColor}18 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Top accent bar — three-segment gradient */}
      <div style={{
        height: 3,
        borderRadius: 99,
        background: `linear-gradient(90deg, ${medalColor}, #38BDF8, #A78BFA)`,
        marginBottom: 28,
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{
            margin: 0,
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: medalColor,
            fontWeight: 600,
          }}>
            PineX Cycle Analysis
          </p>
          <p style={{
            margin: '6px 0 0',
            fontSize: 22,
            fontWeight: 800,
            color: C.text,
            lineHeight: 1.2,
          }}>
            {displayName || 'Cycle Analyst'}
          </p>
          <p style={{
            margin: '4px 0 0',
            fontSize: 13,
            color: C.textMuted,
          }}>
            Cycle Reading Record
          </p>
        </div>

        <ScoreRing score={score} size={88} />
      </div>

      {/* Title badge */}
      <div style={{
        marginTop: 20,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: `${medalColor}18`,
        border: `1px solid ${medalColor}55`,
        borderRadius: 99,
        padding: '6px 14px',
      }}>
        <i className={`fi ${emoji}`} style={{ fontSize: 18, color: medalColor, lineHeight: 0, display: 'inline-flex' }} aria-hidden />
        <span style={{ fontSize: 14, fontWeight: 700, color: medalColor }}>{title}</span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: C.surfaceCard, margin: '20px 0' }} />

      {/* Stats grid — 2×2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { label: 'Stocks Tracked', value: `${stats.totalCalls}` },
          { label: 'Currently Advancing', value: `${stats.advancingNow}` },
          { label: 'Avg Gain Since Call', value: formatGain(stats.avgGainPct) },
          { label: 'Best Call', value: stats.bestCallSymbol
              ? `${stats.bestCallSymbol} ${formatGain(stats.bestGainPct)}`
              : '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: C.surface,
            border: `1px solid ${C.surfaceCard}`,
            borderRadius: 10,
            padding: '10px 12px',
          }}>
            <p style={{ margin: 0, fontSize: 10, color: C.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {label}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 700, color: C.text }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Early spotter badge — only if they have any */}
      {stats.earlySpots > 0 ? (
        <div style={{
          marginTop: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: '#052E16',
          border: '1px solid #166534',
          borderRadius: 10,
        }}>
          <span style={{ fontSize: 14 }}>⭐</span>
          <p style={{ margin: 0, fontSize: 12, color: '#22C55E' }}>
            Early spotter: {stats.earlySpots} stock{stats.earlySpots > 1 ? 's' : ''} identified before Stage 2 confirmation
          </p>
        </div>
      ) : null}

      {/* Footer */}
      <div style={{
        marginTop: 20,
        paddingTop: 14,
        borderTop: `1px solid ${C.surfaceCard}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <p style={{ margin: 0, fontSize: 11, color: C.textFaint }}>
          Past cycle observations ·{'\n'}Not investment advice
        </p>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: medalColor }}>
          pinex.in
        </p>
      </div>
    </div>
  )
}

export default function MyCalls() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const cardRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [watchItems, setWatchItems] = useState([])
  const [scoreResult, setScoreResult] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')

  const displayName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.user_metadata?.name?.trim() ||
    ''

  useEffect(() => {
    if (!user?.id || !hasSupabaseEnv) return
    let active = true

    async function load() {
      setLoading(true)
      try {
        // 1. Watchlist — table is `watchlists` (plural) keyed by
        // company_id, not the spec's `watchlist`/`symbol`.
        const watchRes = await supabase
          .from('watchlists')
          .select('company_id,created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50)

        const watchRows = watchRes.data || []
        if (watchRows.length === 0) {
          if (active) { setWatchItems([]); setLoading(false) }
          return
        }

        const companyIds = [...new Set(watchRows.map((w) => w.company_id).filter(Boolean))]

        // 2. Company info — symbol/name/sector pulled by id.
        const companiesRes = await supabase
          .from('companies')
          .select('id,symbol,name,sector')
          .in('id', companyIds)

        const companyById = Object.fromEntries(
          (companiesRes.data || []).map((c) => [c.id, c])
        )

        // 3. Price rows — keyed by company_id + date (not symbol +
        // trading_date as the spec assumed).
        const allPriceRes = await supabase
          .from('price_data')
          .select('company_id,date,close,stage')
          .in('company_id', companyIds)
          .order('date', { ascending: true })

        const allPriceRows = allPriceRes.data || []

        // Group price rows by company_id.
        const priceRowsByCompany = {}
        for (const row of allPriceRows) {
          if (!row?.company_id) continue
          if (!priceRowsByCompany[row.company_id]) priceRowsByCompany[row.company_id] = []
          priceRowsByCompany[row.company_id].push(row)
        }

        // 4. For each watchlist item, find call-date price and current price.
        const items = watchRows.map((w) => {
          const callDateStr = w.created_at?.slice(0, 10) || ''
          const rows = priceRowsByCompany[w.company_id] || []
          const company = companyById[w.company_id] || {}

          // Closest row on or before call date (rows are sorted asc).
          let callRow = null
          for (const row of rows) {
            if (row.date <= callDateStr) callRow = row
            else break
          }

          // Current price = last row (rows sorted asc, last = most recent).
          const currentRow = rows.length > 0 ? rows[rows.length - 1] : null

          const callPrice = callRow ? Number(callRow.close) || null : null
          const callStage = callRow ? callRow.stage || null : null
          const currentPrice = currentRow ? Number(currentRow.close) || null : null
          const currentStage = currentRow ? currentRow.stage || null : null

          const gainPct =
            callPrice && callPrice > 0 && currentPrice
              ? ((currentPrice - callPrice) / callPrice) * 100
              : null

          return {
            symbol: company.symbol || '',
            name: company.name || company.symbol || '',
            sector: company.sector || '',
            callDate: callDateStr,
            callPrice,
            callStage,
            currentPrice,
            currentStage,
            gainPct,
          }
        })

        if (!active) return

        setWatchItems(items)
        setScoreResult(computeGuruScore(items))
      } catch {
        // fail silently — show empty state
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [user?.id])

  async function handleShare() {
    if (!cardRef.current) return
    setSharing(true)
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 3,
        useCORS: true,
      })
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) { setMessage('Could not create card image.'); return }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `PineX_GuruScore_${scoreResult?.score || 0}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage('Card downloaded — share it anywhere! 🎉')
    } catch {
      setMessage('Could not download card right now.')
    } finally {
      setSharing(false)
    }
  }

  // Helper for gain display
  function gainColor(pct) {
    if (pct == null) return C.textMuted
    return pct >= 0 ? C.green : C.red
  }
  function gainText(pct) {
    if (pct == null) return '—'
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
  }
  function formatCallDate(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  function stageLabel(s) {
    const v = String(s || '').toLowerCase().replace(/\s+/g, '')
    if (v === 'stage2') return 'Advancing'
    if (v === 'stage1') return 'Basing'
    if (v === 'stage3') return 'Topping'
    if (v === 'stage4') return 'Declining'
    return s || '—'
  }
  function stageColor(s) {
    const v = String(s || '').toLowerCase().replace(/\s+/g, '')
    if (v === 'stage2') return C.green
    if (v === 'stage1') return C.amber
    return C.red
  }

  const medalColor = scoreResult
    ? scoreResult.score >= 85 ? '#F59E0B'
      : scoreResult.score >= 70 ? '#38BDF8'
      : scoreResult.score >= 55 ? '#22C55E'
      : '#A78BFA'
    : C.blue

  return (
    <>
      <Helmet>
        <title>My Guru Score — PineX</title>
      </Helmet>

      {/* Hidden share card — captured by html2canvas */}
      <div
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          pointerEvents: 'none',
          opacity: 0,
        }}
      >
        <GuruCertCard
          scoreResult={scoreResult}
          displayName={displayName}
          cardRef={cardRef}
        />
      </div>

      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">

        {loading ? (
          <div className="space-y-4">
            <Skeleton height={180} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : watchItems.length === 0 ? (
          /* Empty state */
          <div
            className="rounded-2xl border p-8 text-center"
            style={{ borderColor: C.border, background: C.surface }}
          >
            <p className="text-4xl">🌱</p>
            <p className="mt-3 text-base font-semibold" style={{ color: C.text }}>
              Your track record starts here
            </p>
            <p className="mt-2 text-sm" style={{ color: C.textMuted }}>
              Add stocks to your watchlist and PineX will track how they perform from the day you spotted them.
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-4 rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.border}` }}
            >
              Find stocks to track
            </button>
          </div>
        ) : (
          <>
            {/* Score hero card */}
            <div
              className="rounded-2xl border p-6 relative overflow-hidden"
              style={{
                background: `linear-gradient(160deg, ${C.base} 0%, ${C.base} 100%)`,
                borderColor: `${medalColor}44`,
              }}
            >
              {/* Glow */}
              <div style={{
                position: 'absolute',
                top: 0, right: 0,
                width: 200, height: 200,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${medalColor}12 0%, transparent 70%)`,
                pointerEvents: 'none',
              }} />

              {/* Accent bar */}
              <div style={{
                height: 3,
                borderRadius: 99,
                background: `linear-gradient(90deg, ${medalColor}, #38BDF8, #A78BFA)`,
                marginBottom: 20,
              }} />

              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: medalColor }}>
                    PineX Cycle Analysis
                  </p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: C.text }}>
                    Guru Score
                  </p>
                  <div
                    className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
                    style={{
                      background: `${medalColor}18`,
                      border: `1px solid ${medalColor}55`,
                    }}
                  >
                    <i className={`fi ${scoreResult.emoji}`} style={{ fontSize: 18, color: medalColor, lineHeight: 0, display: 'inline-flex' }} aria-hidden />
                    <span className="text-sm font-bold" style={{ color: medalColor }}>
                      {scoreResult.title}
                    </span>
                  </div>
                </div>
                <ScoreRing score={scoreResult.score} size={100} />
              </div>

              {/* Stats row */}
              {scoreResult.stats && (
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Tracked', value: `${scoreResult.stats.totalCalls}` },
                    { label: 'Advancing', value: `${scoreResult.stats.advancingNow}` },
                    { label: 'Avg gain', value: scoreResult.stats.avgGainPct != null ? gainText(scoreResult.stats.avgGainPct) : '—' },
                    { label: 'Best call', value: scoreResult.stats.bestCallSymbol
                        ? `${scoreResult.stats.bestCallSymbol} ${gainText(scoreResult.stats.bestGainPct)}`
                        : '—' },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="rounded-xl border p-3"
                      style={{ borderColor: C.border, background: C.surface2 }}
                    >
                      <p className="text-xs uppercase tracking-wide" style={{ color: C.textMuted }}>{label}</p>
                      <p className="mt-1 text-sm font-bold" style={{ color: C.text }}>{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {scoreResult.stats?.earlySpots > 0 && (
                <div
                  className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2"
                  style={{ borderColor: '#166534', background: '#052E16' }}
                >
                  <span>⭐</span>
                  <p className="text-xs" style={{ color: C.green }}>
                    Early spotter: {scoreResult.stats.earlySpots} stock{scoreResult.stats.earlySpots > 1 ? 's' : ''} identified before Stage 2 confirmation
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="mt-5 w-full rounded-xl py-3 text-sm font-bold"
                style={{
                  background: `linear-gradient(90deg, ${medalColor}22, #38BDF822)`,
                  border: `1px solid ${medalColor}55`,
                  color: medalColor,
                  opacity: sharing ? 0.7 : 1,
                }}
              >
                {sharing ? 'Preparing card...' : '📤 Download & Share My Score'}
              </button>
              {message ? (
                <p className="mt-2 text-center text-xs" style={{ color: C.textMuted }}>{message}</p>
              ) : null}
            </div>

            {/* Disclaimer */}
            <p className="text-xs italic" style={{ color: C.textMuted }}>
              This shows price movement after you added stocks to your watchlist, tracked from that date.
              PineX does not give investment advice. Past cycle observations are not a guarantee of future performance.
            </p>

            {/* Individual calls list */}
            <div>
              <SectionLabel text="All Tracked Calls" />
              <div className="space-y-3">
                {watchItems.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    onClick={() => navigate(`/stock/${item.symbol}`)}
                    className="w-full text-left"
                  >
                    <Card>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: C.text }}>
                            {item.name}
                            <span className="ml-2 text-xs font-normal" style={{ color: C.textMuted }}>
                              ({item.symbol})
                            </span>
                          </p>
                          <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
                            Called {formatCallDate(item.callDate)}
                            {item.callStage ? (
                              <span> · Entry: <span style={{ color: stageColor(item.callStage) }}>{stageLabel(item.callStage)}</span></span>
                            ) : null}
                          </p>
                          {item.callPrice && item.currentPrice ? (
                            <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
                              ₹{item.callPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              {' → '}
                              ₹{item.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
                              Price data unavailable for call date
                            </p>
                          )}
                          {item.currentStage ? (
                            <p className="mt-1 text-xs" style={{ color: stageColor(item.currentStage) }}>
                              Now: {stageLabel(item.currentStage)}
                            </p>
                          ) : null}
                        </div>
                        {item.gainPct != null ? (
                          <p
                            className="ml-4 flex-shrink-0 text-lg font-bold"
                            style={{ color: gainColor(item.gainPct) }}
                          >
                            {gainText(item.gainPct)}
                          </p>
                        ) : null}
                      </div>
                    </Card>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
