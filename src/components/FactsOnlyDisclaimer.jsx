/**
 * FactsOnlyDisclaimer — the standard "facts only, not advice"
 * micro-footer that every engagement-feature surface must end with.
 *
 * WHY: PineX's editorial line is hard — we state observations and
 * ask questions, we never conclude or direct. This component is the
 * visible promise of that line, in one place so the wording stays
 * consistent across notifications, dashboards, and reports.
 *
 * Use `compact` for narrow surfaces (mobile cards, chat-style rows);
 * the default size suits full-width sections.
 */
export default function FactsOnlyDisclaimer({ compact = false, style }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: compact ? 10 : 11,
        color: 'var(--text-hint)',
        lineHeight: 1.5,
        padding: compact ? '6px 10px' : '8px 12px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        ...style,
      }}
    >
      <span aria-hidden="true">ℹ️</span>
      <span>
        Facts only · Not advice · Your decision
      </span>
    </div>
  )
}
