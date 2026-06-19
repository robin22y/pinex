/**
 * MobilePointsBar — mobile-only persistent Pro-progress indicator.
 *
 * Re-export wrapper around ProAccessProgress in 'floating' variant so
 * every existing call site (App.jsx mounts this globally) keeps
 * working without touching the imports. The actual rendering — small
 * fixed-position card at top-right with the PRO ACCESS X/1000 bar —
 * lives in src/components/points/ProAccessProgress.jsx.
 *
 * Replaces the old "⭐ N pts" chip per the June 2026 points-economy
 * rebalance. Pro users + signed-out users render nothing (the
 * underlying component self-gates).
 */
import ProAccessProgress from './points/ProAccessProgress'

export default function MobilePointsBar() {
  return <ProAccessProgress variant="floating" />
}
