import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { stashReferralCode } from '../lib/userBootstrap'

// ── /join/:code ────────────────────────────────────────────────────────────
// Referral on-ramp. Captures the code from the URL, stashes it in
// localStorage so the Register form can attribute the new signup to the
// referrer, then redirects to /register. No UI — this is a pure
// route-side-effect component.
//
// Flow:
//   1. User clicks pinex.in/join/ROBIN2847
//   2. Join mounts, calls stashReferralCode("ROBIN2847")
//   3. <Navigate to="/register" replace /> bounces them to signup
//   4. After successful signup, downstream code (auth.js or a server-side
//      function) reads localStorage and credits the referrer. That step
//      is not in this file — Join just captures.
//
// Why a route + redirect rather than a query-param on /register:
//   - Shorter, shareable URLs (pinex.in/join/CODE)
//   - The code lives in one canonical place (localStorage), so a user can
//     browse around before signing up and still get credited correctly.
//   - SEO: the marketing landing page can deep-link to /register without
//     the code surface leaking into search indexes.
//
// localStorage cap and case-normalisation happen inside stashReferralCode.

export default function Join() {
  const { code } = useParams()

  useEffect(() => {
    stashReferralCode(code)
  }, [code])

  return <Navigate to="/register" replace />
}
