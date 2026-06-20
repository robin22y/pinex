// GuruScoreTeaser — compact tappable card on Home that surfaces the
// user's current Guru Score + tier title. Tap → /my-calls.
//
// Self-fetching, lightweight: only pulls stage + sector for the
// watchlist (no full price history). The partial score computed here
// reflects stage composition + sector diversity. Full score with gain
// data lives on /my-calls.
//
// Self-gates to null when the user has no watchlist, so it never
// occupies space pre-engagement.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { computeGuruScore } from '../lib/guruScore'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

function medalColorFor(score) {
  if (score >= 85) return '#F59E0B'
  if (score >= 70) return '#38BDF8'
  if (score >= 55) return '#22C55E'
  return '#A78BFA'
}

export default function GuruScoreTeaser() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [score, setScore] = useState(null) // null = unknown, hides

  useEffect(() => {
    if (!user?.id || !hasSupabaseEnv) return
    let active = true
    ;(async () => {
      try {
        const watchRes = await supabase
          .from('watchlists')
          .select('company_id,added_at')
          .eq('user_id', user.id)
          .limit(50)
        const watchRows = watchRes.data || []
        if (watchRows.length === 0) {
          if (active) setScore(null)
          return
        }
        const ids = [...new Set(watchRows.map((w) => w.company_id).filter(Boolean))]
        const [companiesRes, priceRes] = await Promise.all([
          supabase.from('companies').select('id,symbol,sector').in('id', ids),
          // is_latest=true → one row per company, latest stage. Much
          // cheaper than the full price-history fetch /my-calls does.
          supabase.from('price_data').select('company_id,stage').eq('is_latest', true).in('company_id', ids),
        ])
        const companyById = Object.fromEntries((companiesRes.data || []).map((c) => [c.id, c]))
        const stageByCompany = Object.fromEntries((priceRes.data || []).map((p) => [p.company_id, p.stage]))
        const items = watchRows.map((w) => {
          const c = companyById[w.company_id] || {}
          return {
            symbol: c.symbol || '',
            name: c.symbol || '',
            sector: c.sector || '',
            callDate: w.added_at?.slice(0, 10) || '',
            callPrice: null,
            callStage: null,
            currentPrice: null,
            currentStage: stageByCompany[w.company_id] || null,
          }
        })
        if (active) setScore(computeGuruScore(items))
      } catch {
        if (active) setScore(null)
      }
    })()
    return () => { active = false }
  }, [user?.id])

  if (!score || !score.stats || score.stats.totalCalls === 0) return null

  const accent = medalColorFor(score.score)

  return (
    <button
      type="button"
      onClick={() => navigate('/my-calls')}
      aria-label="View My Calls and Guru Score details"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 14px',
        background: `linear-gradient(135deg, ${accent}10 0%, transparent 70%)`,
        border: `1px solid ${accent}33`,
        borderRadius: 12,
        cursor: 'pointer',
        color: 'inherit',
        textAlign: 'left',
        marginBottom: 12,
      }}
    >
      <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>{score.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Your Guru Score
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
            {score.score}
          </span>
          <span style={{ fontSize: 10, color: C.textMuted }}>/100</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: accent, marginLeft: 4 }}>
            {score.title}
          </span>
        </div>
        <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>
          {score.stats.totalCalls} tracked · {score.stats.advancingNow} advancing
        </div>
      </div>
      <span style={{ fontSize: 12, color: accent, fontWeight: 700, flexShrink: 0 }}>→</span>
    </button>
  )
}
