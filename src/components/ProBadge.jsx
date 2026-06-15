// ── ProBadge ──────────────────────────────────────────────────────────────
// Was: small amber "PRO" chip flagging features earmarked for a future paid
// tier. While PineX is in open beta and pricing isn't published, the badge
// only confuses users ("does this cost money?") so we return null app-wide.
// Restore the amber chip when Pro pricing is ready to launch.
//
// The component is intentionally still exported with the same signature so
// every existing import site keeps working without a search-and-replace.

// eslint-disable-next-line react-refresh/only-export-components
export default function ProBadge() {
  return null
}
