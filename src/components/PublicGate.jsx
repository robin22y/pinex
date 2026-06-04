// ── PublicGate ──────────────────────────────────────────────────────────────
// Route wrapper that redirects anonymous visitors back to /home and surfaces
// the signup bottom-sheet. Use this on routes that should NOT be reachable
// without an account (screener, lab/swingx, stock detail, sector detail,
// heatmap, breadth-lab). Signed-in users pass through to children
// unchanged.
//
// Why not just hide the route nav links: deep links / bookmarks / SEO crawls
// would still reach the page directly. PublicGate enforces the rule at
// render time so there's no way around it client-side.

import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { useSignupPrompt } from './SignupPrompt'

export default function PublicGate({ children }) {
  const { user, loading } = useAuth()
  const { open } = useSignupPrompt()

  // Trigger the signup bottom-sheet for the redirect target so the user
  // lands on /home with the prompt already showing — they see context
  // (the screener data) plus the prompt explaining why they got bounced.
  useEffect(() => {
    if (!loading && !user) open()
    // open is stable via useCallback so the deps below don't churn.
  }, [loading, user, open])

  if (loading) return null
  if (!user) return <Navigate to="/home" replace />
  return children
}
