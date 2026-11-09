/**
 * SourcesList — grouped by kind; each item has id="src-<id>" so SourceRef
 * markers resolve. Numbering comes from numberSources() so markers and list
 * always agree.
 */
import { hasText, numberSources } from './data.js'
import { formatDate, isoDate, safeHref } from './format.js'
import { Section } from './primitives.jsx'

function SourceItem({ source: s, n }) {
  const url = safeHref(s.url)
  const archive = safeHref(s.archive_url)
  const bits = [
    hasText(s.publisher) ? s.publisher : null,
    s.document_date ? formatDate(s.document_date) : null,
    hasText(s.page) ? `p. ${s.page}` : null,
  ].filter(Boolean)
  return (
    <li id={`src-${s.id}`} value={n}>
      <cite>{s.title}</cite>
      {bits.length > 0 && `. ${bits.join(', ')}`}.
      {url && (
        <>
          {' '}
          <a className="st-url" href={url} rel="noopener noreferrer">
            {url}
          </a>
        </>
      )}
      {archive && (
        <>
          {' '}
          (<a href={archive} rel="noopener noreferrer">archived copy</a>)
        </>
      )}
      {s.accessed_on && (
        <>
          {' '}
          Accessed <time dateTime={isoDate(s.accessed_on)}>{formatDate(s.accessed_on)}</time>.
        </>
      )}
    </li>
  )
}

export default function SourcesList({ title, sources, numbered }) {
  const { groups } = numbered || numberSources(sources)
  if (!groups.length) return null
  return (
    <Section id="sources" title={title} className="st-sources">
      {groups.map((g) => (
        <div key={g.kind}>
          <h3>{g.label}</h3>
          <ol start={g.items[0].n}>
            {g.items.map(({ source, n }) => (
              <SourceItem key={source.id} source={source} n={n} />
            ))}
          </ol>
        </div>
      ))}
    </Section>
  )
}
