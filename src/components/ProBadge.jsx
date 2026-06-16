// ── ProBadge ──────────────────────────────────────────────────────────────
// Small amber "PRO" chip used to flag features that will become paid in a
// future tier. It is PURELY VISUAL — there is no gating, blurring, locking,
// or redirect behind it. Every "PRO" feature is currently fully unlocked.
// The badge only signals future paid status.

export default function ProBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 5px',
        background: 'rgba(245,158,11,0.15)',
        border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: '3px',
        fontSize: '9px',
        fontWeight: '700',
        letterSpacing: '0.1em',
        color: '#F59E0B',
        marginLeft: '6px',
        verticalAlign: 'middle',
      }}
    >
      PRO
    </span>
  )
}
