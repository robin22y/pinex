/**
 * PointsProgress — small landing block showing the user's
 * progress toward the Advanced unlock cost (500 pts by default,
 * read from feature_unlock_costs at runtime).
 *
 * Returns null when:
 *   - user not signed in
 *   - profile.advanced_unlocked is already true (admin / paid /
 *     streak-earned)
 *   - user_points row missing or balance unknown
 *
 * Otherwise renders a row like:
 *
 *   ★ 247 / 500 points to Advanced
 *   ████████░░░░░░░░░░░░░░░░░░░░░░ 49%
 *   Keep exploring to unlock
 *
 * The cost is fetched once from feature_unlock_costs(feature_key='advanced')
 * — admin can change it from the points-config admin surface
 * without a code change. Falls back to 500 if the table or row
 * isn't there yet (e.g. migration not applied yet on a dev clone).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context'
import { supabase } from '../../lib/supabase'

const DEFAULT_COST = 500
const FEATURE_KEY  = 'advanced'

export default function PointsProgress() {
  const { user, profile } = useAuth()

  const [points, setPoints] = useState(null)
  const [cost,   setCost]   = useState(DEFAULT_COST)

  // Pull balance once per signed-in user. Re-runs when the user
  // changes (sign-in / out). Read-after-write semantics not needed
  // — the chip lives below other landing surfaces so a slightly
  // stale value is fine; the next Home visit refreshes it.
  useEffect(() => {
    if (!user?.id) { setPoints(null); return }
    let cancelled = false
    supabase
      .from('user_points')
      .select('total_points')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const n = Number(data?.total_points)
        setPoints(Number.isFinite(n) ? n : null)
      })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [user?.id])

  // Pull cost catalogue once on mount — it's tiny and the cost
  // value is admin-editable, so we don't want to hardcode 500.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('feature_unlock_costs')
      .select('points_cost')
      .eq('feature_key', FEATURE_KEY)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const n = Number(data?.points_cost)
        if (Number.isFinite(n) && n > 0) setCost(n)
      })
      .catch(() => { /* keep default */ })
    return () => { cancelled = true }
  }, [])

  // ── Gates ──
  if (!user) return null
  if (profile?.advanced_unlocked === true) return null
  if (points == null) return null

  const pct        = Math.max(0, Math.min(100, Math.round((points / cost) * 100)))
  const ready      = points >= cost
  const remaining  = Math.max(0, cost - points)
  const captionTxt = ready
    ? 'You can unlock now from Rewards.'
    : `${remaining.toLocaleString('en-IN')} more to unlock`

  return (
    <Link
      to="/rewards"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        background: '#0F1217',
        border: '1px solid #1E2530',
        borderRadius: 8,
        padding: '12px 14px',
        marginTop: 24,
        marginBottom: 16,
      }}
      title="Open Rewards"
    >
      {/* Headline row — '★ 247 / 500 points to Advanced' */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          fontSize: 13,
          color: '#E2E8F0',
          marginBottom: 8,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span aria-hidden style={{ color: '#FBBF24', fontSize: 14 }}>★</span>
        <span style={{ fontWeight: 700 }}>
          {points.toLocaleString('en-IN')}
        </span>
        <span style={{ color: '#64748B' }}>/ {cost.toLocaleString('en-IN')}</span>
        <span style={{ color: '#CBD5E1' }}>
          points to <strong style={{ color: '#E2E8F0' }}>Advanced</strong>
        </span>
      </div>

      {/* Bar */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={cost}
        aria-valuenow={Math.min(points, cost)}
        style={{
          height: 6,
          background: '#1E2530',
          borderRadius: 99,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: ready ? '#22C55E' : '#FBBF24',
            borderRadius: 99,
            transition: 'width 240ms ease-out',
          }}
        />
      </div>

      {/* Caption */}
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: '#64748B',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {captionTxt}
        {!ready && (
          <span style={{ marginLeft: 8, color: '#475569' }}>
            ({pct}%)
          </span>
        )}
      </div>
    </Link>
  )
}
