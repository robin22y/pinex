import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context'
import { supabase } from '../../lib/supabase'

// While You Were Away — landing block shown when the signed-in user
// hasn't been around for ≥ 72 hours. Reads two market_internals rows
// (one closest-on-or-before the user's previous last_active_at, one
// the latest snapshot) plus the top stage-2 sector on each of those
// dates. Renders up to three plain-English insight lines plus a
// 'see what changed' link to /explore. Returns null in every other
// case — no spacer, no loading state, no error UI.
//
// PREV-VALUE SOURCE
//   AuthContext stamps profiles.last_active_at = now() on hydrate.
//   Reading profile.last_active_at here would therefore see TODAY's
//   timestamp and the days-away maths would collapse to 0. To work
//   around that, AuthContext also snapshots the *pre-update* value
//   to sessionStorage('pinex_prev_last_active_at') on the first
//   hydrate of the browser session. We read that snapshot first and
//   only fall back to profile.last_active_at when it isn't present
//   (e.g. tab opened mid-session).

const AWAY_THRESHOLD_MS = 72 * 60 * 60 * 1000   // 72 hours
const DAY_MS = 24 * 60 * 60 * 1000

// Top sector on a given date — ordered by stage2_pct desc.
async function fetchTopSector(date) {
  if (!date) return null
  const { data } = await supabase
    .from('sectors')
    .select('display_name, name, stage2_pct, date')
    .eq('date', date)
    .order('stage2_pct', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

// market_internals row at or before targetDate (handles weekends/holidays).
async function fetchInternalsOnOrBefore(targetDate) {
  if (!targetDate) return null
  const { data } = await supabase
    .from('market_internals')
    .select('date, above_ma30w_pct, stage2_count')
    .lte('date', targetDate)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

async function fetchLatestInternals() {
  const { data } = await supabase
    .from('market_internals')
    .select('date, above_ma30w_pct, stage2_count')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

async function fetchLatestSectorDate() {
  const { data } = await supabase
    .from('sectors')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.date || null
}

export default function WhileYouWereAway() {
  const { user, profile } = useAuth()
  const [snapshot, setSnapshot] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    const today = new Date().toISOString().slice(0, 10)
    return localStorage.getItem(`wywa_dismissed_${today}`) === '1'
  })

  // Previous last_active_at — session snapshot first, then profile fallback.
  const prevLastActive = useMemo(() => {
    if (typeof window === 'undefined') return null
    const sessionSnap = sessionStorage.getItem('pinex_prev_last_active_at')
    if (sessionSnap) return sessionSnap
    return profile?.last_active_at || null
  }, [profile?.last_active_at])

  const daysAway = useMemo(() => {
    if (!prevLastActive) return null
    const then = new Date(prevLastActive).getTime()
    if (!Number.isFinite(then)) return null
    const delta = Date.now() - then
    if (delta < AWAY_THRESHOLD_MS) return null
    return Math.floor(delta / DAY_MS)
  }, [prevLastActive])

  // Gate before any network work — signed-in, not dismissed today,
  // and ≥ 3 days since last_active_at.
  const eligible = !!user && !dismissed && daysAway != null && daysAway >= 3

  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    ;(async () => {
      try {
        const refDate = String(prevLastActive).slice(0, 10)
        const latestSectorDate = await fetchLatestSectorDate()
        const [then, now, sectorThen, sectorNow] = await Promise.all([
          fetchInternalsOnOrBefore(refDate),
          fetchLatestInternals(),
          fetchTopSector(refDate),
          latestSectorDate ? fetchTopSector(latestSectorDate) : Promise.resolve(null),
        ])
        if (cancelled) return
        // No comparable data → silently hide; we don't want a half-
        // populated block on stocks the pipeline hasn't covered.
        if (!then || !now) {
          setSnapshot(null)
          return
        }
        setSnapshot({ then, now, sectorThen, sectorNow })
      } catch {
        if (!cancelled) setSnapshot(null)
      }
    })()
    return () => { cancelled = true }
  }, [eligible, prevLastActive])

  const onDismiss = () => {
    const today = new Date().toISOString().slice(0, 10)
    try { localStorage.setItem(`wywa_dismissed_${today}`, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  if (!eligible || !snapshot) return null

  // ── Deltas + plain-English insight lines ──
  const breadthThen = Number(snapshot.then.above_ma30w_pct)
  const breadthNow  = Number(snapshot.now.above_ma30w_pct)
  const breadthChg  = Number.isFinite(breadthThen) && Number.isFinite(breadthNow)
    ? breadthNow - breadthThen : null

  const stage2Then = Number(snapshot.then.stage2_count)
  const stage2Now  = Number(snapshot.now.stage2_count)
  const stage2Chg  = Number.isFinite(stage2Then) && Number.isFinite(stage2Now)
    ? stage2Now - stage2Then : null

  const sectorThenName = snapshot.sectorThen?.display_name || snapshot.sectorThen?.name || null
  const sectorNowName  = snapshot.sectorNow?.display_name  || snapshot.sectorNow?.name  || null

  const insights = []

  if (breadthChg != null) {
    const sub = `${breadthThen.toFixed(0)}% → ${breadthNow.toFixed(0)}%`
    if (breadthChg > 2)       insights.push({ line: 'Market participation improved',     sub })
    else if (breadthChg < -2) insights.push({ line: 'Market participation weakened',     sub })
    else                      insights.push({ line: 'Market participation held steady',  sub })
  }

  if (stage2Chg != null) {
    const sub = `${stage2Then} → ${stage2Now}`
    if (stage2Chg > 20)       insights.push({ line: `${stage2Chg} more stocks in advancing phase`, sub })
    else if (stage2Chg < -20) insights.push({ line: `${Math.abs(stage2Chg)} fewer stocks in advancing phase`, sub })
    else                      insights.push({ line: 'Advancing stock count stable', sub })
  }

  if (sectorThenName && sectorNowName) {
    if (sectorThenName === sectorNowName) {
      insights.push({ line: `${sectorNowName} continued leading`, sub: null })
    } else {
      insights.push({ line: `Sector leadership shifted to ${sectorNowName}`, sub: null })
    }
  }

  if (insights.length === 0) return null

  // ── Render (max 3 insights per spec) ──
  const shown = insights.slice(0, 3)

  return (
    <div
      role="region"
      aria-label="While you were away"
      style={{
        borderLeft: '3px solid #FBBF24',
        background: '#0F1217',
        padding: 16,
        marginBottom: 24,
        position: 'relative',
        borderRadius: 4,
        // The block sits on a sepia or dark page — its own dark
        // background is fixed (#0F1217) so the amber accent reads
        // correctly in both themes.
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          top: 8, right: 8,
          background: 'transparent',
          border: 'none',
          color: '#64748B',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 4,
        }}
      >
        ×
      </button>

      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.08em',
          color: '#FBBF24',
          textTransform: 'uppercase',
          marginBottom: 12,
          fontWeight: 700,
        }}
      >
        While you were away · {daysAway} day{daysAway === 1 ? '' : 's'}
      </div>

      {shown.map((ins, i) => (
        <div
          key={i}
          style={{
            fontSize: 14,
            color: '#E2E8F0',
            lineHeight: 1.8,
          }}
        >
          <span style={{ color: '#FBBF24', marginRight: 6 }}>→</span>
          {ins.line}
          {ins.sub && (
            <span style={{ fontSize: 12, color: '#64748B', marginLeft: 4 }}>
              {ins.sub}
            </span>
          )}
        </div>
      ))}

      <Link
        to="/explore"
        style={{
          fontSize: 13,
          color: '#60A5FA',
          marginTop: 12,
          display: 'inline-block',
          textDecoration: 'none',
        }}
      >
        See what changed →
      </Link>
    </div>
  )
}
