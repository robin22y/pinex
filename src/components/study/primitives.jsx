/**
 * primitives.jsx — small building blocks shared by every study section.
 */
import { sectionLabel } from './data.js'

/** <section id> + <h2>. Callers return null BEFORE rendering this when empty. */
export function Section({ id, title, children, className }) {
  return (
    <section id={id} className={`st-section${className ? ` ${className}` : ''}`} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title ?? sectionLabel(id)}</h2>
      {children}
    </section>
  )
}

/**
 * Footnote marker linking to #src-<id> in the Sources list. Renders nothing
 * when the row has no source_id or the source is not in the list, so a
 * marker never points at a missing anchor.
 */
export function SourceRef({ id, sourceNumbers }) {
  if (!id || !sourceNumbers || !sourceNumbers.has(id)) return null
  const n = sourceNumbers.get(id)
  return (
    <sup className="st-ref">
      <a href={`#src-${id}`} aria-label={`Source ${n}`}>
        [{n}]
      </a>
    </sup>
  )
}
