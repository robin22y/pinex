/**
 * SeriesList — active study_series rows:
 *   { id, slug, name, description, icon_key, image (media), study_count }
 *
 * title   site_content 'home.sections'.popular_series.title
 * labels  site_content 'site.labels' ({ studies_in_series: '{n} studies' })
 */
import { arr, hasText, sortedRows } from './data.js'
import { fillTemplate } from './media.js'
import Icon from './Icon.jsx'
import MediaFigure from './MediaFigure.jsx'

export default function SeriesList({ title, series, labels }) {
  const rows = sortedRows(arr(series)).filter((s) => s?.is_active !== false && hasText(s?.name) && s?.slug)
  if (!rows.length) return null
  const H = hasText(title) ? 'h3' : 'h2'
  return (
    <section className="st-section" aria-labelledby={hasText(title) ? 'st-series-h' : undefined}>
      {hasText(title) && <h2 id="st-series-h">{title}</h2>}
      <ul className="st-grid">
        {rows.map((s) => {
          const count = fillTemplate(labels?.studies_in_series, s.study_count)
          return (
            <li key={s.id ?? s.slug} className="st-series-card">
              <MediaFigure media={s.image} sizes="(min-width: 1040px) 320px, (min-width: 560px) 50vw, 100vw" />
              <H>
                <Icon name={s.icon_key} size={18} />
                {/* Plain text until the /series/<slug> pages exist (Phase 6). */}
                {s.name}
              </H>
              {hasText(s.description) && <p className="st-small">{s.description}</p>}
              {count && <p className="st-meta">{count}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
