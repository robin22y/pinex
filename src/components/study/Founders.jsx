/** FounderCard + FoundersSection. */
import { Paras } from './markdown.jsx'
import { hasText, sortedRows } from './data.js'
import MediaFigure from './MediaFigure.jsx'
import { Section, SourceRef } from './primitives.jsx'

export function FounderCard({ founder, sourceNumbers }) {
  const f = founder || {}
  if (!hasText(f.name)) return null
  const role = f.current_role
  return (
    <li className="st-card st-founder">
      <MediaFigure media={f.image} sizes="96px" className="st-founder-fig" />
      <div>
        <h3>
          {f.name}
          <SourceRef id={f.source_id} sourceNumbers={sourceNumbers} />
        </h3>
        {hasText(role) && <p className="st-small">{role}</p>}
        <dl className="st-dl">
          {hasText(f.education) && (
            <>
              <dt>Education</dt>
              <dd>{f.education}</dd>
            </>
          )}
          {hasText(f.previous_career) && (
            <>
              <dt>Before this</dt>
              <dd>{f.previous_career}</dd>
            </>
          )}
          {hasText(f.founding_story) && (
            <>
              <dt>How it started</dt>
              <dd>
                <Paras text={f.founding_story} />
              </dd>
            </>
          )}
        </dl>
      </div>
    </li>
  )
}

export default function FoundersSection({ title, founders, sourceNumbers }) {
  const rows = sortedRows(founders).filter((f) => hasText(f?.name))
  if (!rows.length) return null
  return (
    <Section id="founders" title={title}>
      <ul className="st-cards">
        {rows.map((f, i) => (
          <FounderCard key={f.id ?? i} founder={f} sourceNumbers={sourceNumbers} />
        ))}
      </ul>
    </Section>
  )
}
