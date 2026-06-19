/**
 * YouMissedBanner — top-of-Home re-engagement nudge.
 *
 * Flow:
 *   1. While the user is on Home, listen for `visibilitychange`.
 *      When the tab goes hidden (close, tab-switch, OS minimise) we
 *      stamp the current stage2_count + new_52w_highs +
 *      timestamp to localStorage under
 *      'pinex_home_last_snapshot'.
 *
 *   2. On the NEXT mount we read that snapshot. If its timestamp is
 *      older than 24 h AND the current market_internals row has
 *      MORE stage2 stocks than the snapshot did, render the banner:
 *
 *        "You missed N new Stage 2 stocks since your last visit."
 *        "Come back daily → +20 pts → stay ahead."
 *
 *   3. Banner auto-dismisses after 5 s. No close button (per spec).
 *      After dismiss we delete the snapshot so the banner can't
 *      fire again until the next visibilitychange writes a fresh
 *      stamp.
 *
 * Self-gating:
 *   - No user / no current row / no qualifying snapshot → null.
 *   - delta ≤ 0 → null (nothing missed).
 *   - Gap < 24 h → null (not an "away" visit).
 *
 * The component fetches market_internals itself rather than depending
 * on Home's data shape, so it can be mounted anywhere on the page and
 * still snapshot correctly. One small SELECT per mount.
 */
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const STORAGE_KEY = 'pinex_home_last_snapshot'
const AWAY_THRESHOLD_MS = 24 * 60 * 60 * 1000
const AUTO_DISMISS_MS = 5000

function readSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    const ts = Number(obj.ts)
    if (!Number.isFinite(ts)) return null
    return {
      ts,
      stage2_count: Number(obj.stage2_count),
      new_52w_highs: Number(obj.new_52w_highs),
    }
  } catch {
    return null
  }
}

function writeSnapshot(stage2, highs) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ts: Date.now(),
        stage2_count: Number(stage2) || 0,
        new_52w_highs: Number(highs) || 0,
      })
    )
  } catch { /* private mode / quota — silently skip */ }
}

function clearSnapshot() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export default function YouMissedBanner() {
  const [delta, setDelta] = useState(null)
  const [visible, setVisible] = useState(false)
  const currentRef = useRef({ stage2: null, highs: null })

  useEffect(() => {
    let cancelled = false

    async function init() {
      // 1) Fetch current market state. Same single-row read the rest
      // of Home does, but scoped to just the two fields we care about.
      let stage2 = null
      let highs = null
      try {
        const { data } = await supabase
          .from('market_internals')
          .select('stage2_count, new_52w_highs')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        stage2 = Number(data?.stage2_count)
        highs  = Number(data?.new_52w_highs)
      } catch { /* leave nulls → no banner this load */ }

      if (cancelled) return
      if (!Number.isFinite(stage2) || !Number.isFinite(highs)) return

      currentRef.current = { stage2, highs }

      // 2) Compare against any saved snapshot.
      const snap = readSnapshot()
      if (!snap) return
      if (Date.now() - snap.ts < AWAY_THRESHOLD_MS) return

      const stage2Delta = stage2 - snap.stage2_count
      if (stage2Delta <= 0) {
        // Nothing to miss — drop the stale snapshot so it doesn't
        // sit around for tomorrow's read.
        clearSnapshot()
        return
      }

      setDelta(stage2Delta)
      setVisible(true)
      // Snapshot served its purpose. Removing here means a same-day
      // navigate-away → navigate-back can't double-fire the banner.
      clearSnapshot()
    }

    init()

    // Listener for the OUTGOING snapshot — stamp current values
    // whenever the tab goes hidden. visibilitychange is the right
    // event because it fires on tab close, tab switch, and the OS
    // backgrounding the browser on mobile.
    function onVis() {
      if (document.visibilityState !== 'hidden') return
      const { stage2, highs } = currentRef.current
      if (Number.isFinite(stage2) && Number.isFinite(highs)) {
        writeSnapshot(stage2, highs)
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Auto-dismiss after 5 s. Per spec there's no close button — the
  // banner is a brief, low-friction nudge.
  useEffect(() => {
    if (!visible) return
    const t = window.setTimeout(() => setVisible(false), AUTO_DISMISS_MS)
    return () => window.clearTimeout(t)
  }, [visible])

  if (!visible || !Number.isFinite(delta) || delta <= 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: '12px 16px 0',
        padding: '12px 14px',
        background: 'rgba(251, 191, 36, 0.10)',
        border: '1px solid rgba(251, 191, 36, 0.32)',
        borderRadius: 8,
        animation: 'pxYouMissedIn 0.32s ease',
      }}
    >
      <p style={{
        margin: 0,
        fontSize: 13,
        lineHeight: 1.55,
        color: 'var(--text-primary, #E2E8F0)',
      }}>
        You missed <strong style={{ color: '#FBBF24' }}>{delta.toLocaleString('en-IN')}</strong>{' '}
        new Stage 2 {delta === 1 ? 'stock' : 'stocks'} since your last visit.
      </p>
      <p style={{
        margin: '4px 0 0',
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--text-muted, #94A3B8)',
      }}>
        Come back daily → <strong style={{ color: '#E2E8F0' }}>+20 pts</strong> → stay ahead.
      </p>
      <style>{`
        @keyframes pxYouMissedIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
