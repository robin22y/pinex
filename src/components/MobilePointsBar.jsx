/**
 * MobilePointsBar — small persistent chip on mobile only.
 *
 *   Top-right corner of every in-shell page. Reads
 *   user_points.total_points; tap routes to /rewards. Self-gates
 *   to null when the user isn't signed in, when the balance
 *   hasn't loaded, or on desktop (md+) where the sidebar chip
 *   already carries the same affordance.
 *
 *   Position is fixed so it stays anchored as the user scrolls.
 *   It sits inside the safe-area-inset-top so iPhone-with-notch
 *   doesn't shove it under the status bar.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'

export default function MobilePointsBar() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [points, setPoints] = useState(null)

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

  if (!user || points == null) return null

  return (
    <button
      type="button"
      className="md:hidden"
      onClick={() => navigate('/rewards')}
      aria-label={`${points.toLocaleString('en-IN')} points — open Rewards`}
      title="Points"
      style={{
        position: 'fixed',
        // Sit just below the status bar on iPhone-with-notch.
        top: 'calc(env(safe-area-inset-top) + 10px)',
        right: 12,
        // Above the page content but below modals / toasts (which
        // use z-index >= 100). Below the BottomNav (z 9999) just
        // for safety — they don't overlap visually anyway.
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        background: 'rgba(15, 18, 23, 0.92)',
        border: '1px solid #1E2530',
        borderRadius: 999,
        color: '#E2E8F0',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        // Subtle shadow so the chip lifts off the underlying
        // page content on light/sepia themes.
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
      }}
    >
      <span aria-hidden style={{ color: '#FBBF24' }}>★</span>
      <span>{points.toLocaleString('en-IN')}</span>
      <span style={{ color: '#64748B', fontWeight: 500 }}>pts</span>
    </button>
  )
}
