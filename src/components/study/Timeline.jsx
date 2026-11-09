/** Timeline — ordered list; is_pull_quote items render as large pull quotes. */
import { Paras } from './markdown.jsx'
import { hasText, sortedRows } from './data.js'
import { Section, SourceRef } from './primitives.jsx'
import { whenLabel } from './labels.js'
import MediaFigure from './MediaFigure.jsx'

export default function Timeline({ title, timeline, sourceNumbers }) {
  const rows = sortedRows(timeline).filter((t) => hasText(t?.title))
  if (!rows.length) return null
  return (
    <Section id="timeline" title={title}>
      <ol className="st-timeline">
        {rows.map((t, i) => {
          const when = whenLabel(t)
          const ref = <SourceRef id={t.source_id} sourceNumbers={sourceNumbers} />
          return (
            <li key={t.id ?? i}>
              {when && (
                <time className="st-when" dateTime={when.dateTime}>
                  {when.text}
                </time>
              )}
              {t.is_pull_quote ? (
                <figure className="st-pullquote">
                  <blockquote>
                    <p>
                      {t.title}
                      {ref}
                    </p>
                  </blockquote>
                  {hasText(t.body) && <figcaption>{t.body}</figcaption>}
                </figure>
              ) : (
                <>
                  <h3>
                    {t.title}
                    {ref}
                  </h3>
                  <Paras text={t.body} />
                  <MediaFigure media={t.image} />
                </>
              )}
            </li>
          )
        })}
      </ol>
    </Section>
  )
}
