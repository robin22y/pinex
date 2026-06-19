/**
 * useProGate — single-line wiring for the ProGateModal teaser.
 *
 * Use at the top of any Pro feature surface to surface the "You're N
 * days away from Pro" modal exactly once per browser session for
 * Free users. The modal does NOT block the feature behind it — the
 * page continues to render so the user can keep exploring. Once
 * dismissed (X button, backdrop click, or Esc) it stays hidden until
 * the next browser session.
 *
 *   import useProGate from '../hooks/useProGate'
 *
 *   export default function ProScreener() {
 *     const proGateModal = useProGate('pro_screener', 'Pro Screener')
 *     return (
 *       <>
 *         {proGateModal}
 *         <PageContents />
 *       </>
 *     )
 *   }
 *
 * The hook itself handles every gate:
 *   - signed-out  → no modal
 *   - plan='pro'  → no modal
 *   - already seen this session for this featureKey → no modal
 *   - balance still loading → no modal until it lands (avoids the
 *     "You have 0 points" flash before the read completes)
 *
 * NOTE: file is `.jsx` (not `.js`) because the hook returns a JSX
 * element. Vite's oxc parser only enables JSX inside .jsx/.tsx.
 *
 * featureKey
 *   Stable identifier for the sessionStorage key. Pick one per
 *   surface ('pro_screener', 'swingx', 'historical_conditions',
 *   'iqjet'). Anything not in the existing set is fine — the key
 *   is purely a deduper.
 *
 * featureName
 *   Display string forwarded to ProGateModal. Renders inside the
 *   "<featureName> is where early signals appear first." headline.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'
import ProGateModal from '../components/ui/ProGateModal'

export default function useProGate(featureKey, featureName) {
  const { user, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [points, setPoints] = useState(null)

  useEffect(() => {
    if (!user?.id) { setOpen(false); return }
    if ((profile?.plan || 'free') === 'pro') { setOpen(false); return }

    // Once-per-session dedupe. sessionStorage clears on tab close so
    // the nudge re-appears in a fresh session.
    const seenKey = `pinex_progate_${featureKey}_${user.id}`
    try {
      if (sessionStorage.getItem(seenKey) === '1') return
    } catch { /* private mode — keep firing */ }

    let cancelled = false
    supabase
      .from('user_points')
      .select('total_points')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const n = Number(data?.total_points)
        setPoints(Number.isFinite(n) ? n : 0)
        setOpen(true)
        try { sessionStorage.setItem(seenKey, '1') } catch { /* ignore */ }
      })
      .catch(() => { /* silent — no modal on read failure */ })

    return () => { cancelled = true }
  }, [user?.id, profile?.plan, featureKey])

  // Render only when ready: open AND a balance landed. Returns the
  // modal element so the caller drops it straight into JSX.
  if (!open || points == null) return null

  return (
    <ProGateModal
      open={open}
      onClose={() => setOpen(false)}
      currentPoints={points}
      featureName={featureName}
    />
  )
}
