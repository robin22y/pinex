/** RiskCard + RisksList. Severity is a plain text label — no alarm colours. */
import { Paras } from './markdown.jsx'
import { hasText, sortedRows } from './data.js'
import { Section, SourceRef } from './primitives.jsx'
import { SEVERITY_LABELS } from './labels.js'

export function RiskCard({ risk, sourceNumbers }) {
  const r = risk || {}
  if (!hasText(r.title)) return null
  return (
    <li className="st-card">
      {SEVERITY_LABELS[r.severity] && (
        <p className="st-label">Severity: {SEVERITY_LABELS[r.severity]}</p>
      )}
      <h3>
        {r.title}
        <SourceRef id={r.source_id} sourceNumbers={sourceNumbers} />
      </h3>
      <Paras text={r.body} />
    </li>
  )
}

export default function RisksList({ title, risks, sourceNumbers }) {
  const rows = sortedRows(risks).filter((r) => hasText(r?.title))
  if (!rows.length) return null
  return (
    <Section id="risks" title={title}>
      <ul className="st-cards">
        {rows.map((r, i) => (
          <RiskCard key={r.id ?? i} risk={r} sourceNumbers={sourceNumbers} />
        ))}
      </ul>
    </Section>
  )
}
