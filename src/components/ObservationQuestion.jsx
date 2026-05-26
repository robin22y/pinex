/**
 * ObservationQuestion — the neutral, you-answer-it question card
 * that closes every engagement-feature section.
 *
 * Tone rules (enforced by use, not by code):
 *  - State an observation if needed
 *  - Then ask a question
 *  - Never conclude, predict, or direct
 *  - Attribute observations to "cycle analysis", not to PineX as an
 *    advisor
 *
 * The user reads the question and answers it in their own head —
 * we never grade or auto-respond.
 *
 * Props:
 *   observation  (optional)  short factual statement, e.g.
 *                            "Breadth is 62% — broad participation."
 *   question     (required)  the neutral question, ending in "?"
 *   tone         (optional)  'neutral' | 'attention'  — visual weight
 */
export default function ObservationQuestion({
  observation,
  question,
  tone = 'neutral',
  style,
}) {
  const accent =
    tone === 'attention'
      ? 'var(--warning)'
      : 'var(--text-muted)'

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        ...style,
      }}
    >
      {observation ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          {observation}
        </div>
      ) : null}
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          fontWeight: 600,
          lineHeight: 1.5,
        }}
      >
        {question}
      </div>
    </div>
  )
}
