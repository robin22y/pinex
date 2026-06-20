/**
 * ProAccessProgress — persistent "PRO ACCESS X/1000" bar.
 *
 * Replaces the old "⭐ N pts" chip on both the desktop sidebar
 * (DesktopSidebar.jsx) and the floating mobile indicator
 * (MobilePointsBar.jsx). One reusable component, two callers — same
 * visual everywhere.
 *
 * PROPS
 *   variant   'sidebar'  (default) → renders inline in document flow,
 *                                    full-width of the wrapper
 *             'floating'           → fixed to the top-right of the
 *                                    viewport with safe-area-inset-top
 *                                    padding; hidden on md+ screens
 *                                    (use `sidebar` variant in the
 *                                    sidebar at that breakpoint)
 *
 * BEHAVIOUR
 *   1. Reads user_points.total_points + profiles.plan on mount.
 *   2. Renders nothing when: no user, plan = 'pro', or balance still
 *      loading. Avoids a "0 / 1,000" flash on first paint.
 *   3. Subscribes to the pinex:points-awarded CustomEvent so earned
 *      points reflect immediately (same listener WelcomeModal uses).
 *   4. Tapping the bar routes to /rewards.
 *
 * STYLE — matches Robin's spec verbatim:
 *   height: 4px bar
 *   background: #1E2530
 *   fill:       #FBBF24
 *   labels above the bar:
 *     "PRO ACCESS"  11px / #64748B (left)
 *     "680/1,000"   11px / #E2E8F0 (right, tabular-nums)
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context'
import { supabase } from '../../lib/supabase'

const PRO_THRESHOLD = 1000

export default function ProAccessProgress({ variant = 'sidebar' }) {
  const { user, isPro } = useAuth()
  const navigate = useNavigate()
  const [points, setPoints] = useState(null)

  // Single balance read, exposed so the event listener can call it.
  const refresh = useCallback(async () => {
    if (!user?.id) { setPoints(null); return }
    try {
      const { data } = await supabase
        .from('user_points')
        .select('total_points')
        .eq('user_id', user.id)
        .maybeSingle()
      const n = Number(data?.total_points)
      setPoints(Number.isFinite(n) ? n : null)
    } catch {
      // RLS / network — leave as null so the bar stays hidden.
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) { setPoints(null); return }
    let cancelled = false
    refresh()
    function onAward() { if (!cancelled) refresh() }
    function onWalletUpdated(ev) {
      if (cancelled) return
      const next = Number(ev?.detail?.totalPoints)
      if (Number.isFinite(next)) setPoints(next)
      else refresh()
    }
    window.addEventListener('pinex:points-awarded', onAward)
    window.addEventListener('pinex:wallet-updated', onWalletUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('pinex:points-awarded', onAward)
      window.removeEventListener('pinex:wallet-updated', onWalletUpdated)
    }
  }, [user?.id, refresh])

  // ── Gating ────────────────────────────────────────────────────────
  if (!user) return null
  if (isPro) return null
  if (points == null) return null

  const clamped = Math.min(Math.max(0, points), PRO_THRESHOLD)
  const pct = (clamped / PRO_THRESHOLD) * 100
  const displayCurrent = clamped.toLocaleString('en-IN')
  const displayMax = PRO_THRESHOLD.toLocaleString('en-IN')

  // The bar body — identical in both variants; only wrapper changes.
  const body = (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: '#64748B',
            textTransform: 'uppercase',
          }}
        >
          Pro access
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#E2E8F0',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {displayCurrent}/{displayMax}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={PRO_THRESHOLD}
        aria-valuenow={points}
        aria-label={`${displayCurrent} of ${displayMax} points to Pro`}
        style={{
          height: 4,
          background: '#1E2530',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: '#FBBF24',
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </>
  )

  // ── Variants ─────────────────────────────────────────────────────
  // 'sidebar' — inline, full-width within the wrapper the caller
  // provides (the DesktopSidebar wraps it in padding). The button
  // is button-shaped (clickable / focusable) but visually flat.
  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={() => navigate('/rewards')}
        title={`${displayCurrent}/${displayMax} points to Pro · open Rewards`}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '6px 4px',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        {body}
      </button>
    )
  }

  // 'floating' — fixed to top-right on mobile. .md:hidden CSS class
  // keeps it off desktop where DesktopSidebar's sidebar variant
  // already renders the bar. width:160 keeps it compact enough not
  // to crowd whatever header content sits on the page.
  return (
    <button
      type="button"
      className="md:hidden"
      onClick={() => navigate('/rewards')}
      aria-label={`${displayCurrent} of ${displayMax} points to Pro — open Rewards`}
      title="Pro access progress"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 10px)',
        right: 12,
        zIndex: 60,
        width: 160,
        padding: '8px 10px 9px',
        background: 'rgba(15, 18, 23, 0.92)',
        border: '1px solid #1E2530',
        borderRadius: 8,
        cursor: 'pointer',
        textAlign: 'left',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
        fontFamily: 'inherit',
      }}
    >
      {body}
    </button>
  )
}
