/** DevelopmentsTimeline — recent filings, orders, management and capex events (newest first). */
import { Paras } from './markdown.jsx'
import { hasText, sortedRows } from './data.js'
import { formatDate, isoDate } from './format.js'
import { Section, SourceRef } from './primitives.jsx'
import { DEVELOPMENT_LABELS } from './labels.js'

export default function DevelopmentsTimeline({ title, developments, sourceNumbers }) {
  const rows = sortedRows(developments)
    .filter((d) => hasText(d?.title))
    .sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')))
  if (!rows.length) return null
  return (
    <Section id="developments" title={title}>
      <ol className="st-timeline">
        {rows.map((d, i) => (
          <li key={d.id ?? i}>
            <span className="st-when">
              {d.event_date && <time dateTime={isoDate(d.event_date)}>{formatDate(d.event_date)}</time>}
              {d.event_date && DEVELOPMENT_LABELS[d.category] ? ' · ' : ''}
              {DEVELOPMENT_LABELS[d.category] ?? ''}
            </span>
            <h3>
              {d.title}
              <SourceRef id={d.source_id} sourceNumbers={sourceNumbers} />
            </h3>
            <Paras text={d.body} />
          </li>
        ))}
      </ol>
    </Section>
  )
}
