/**
 * LatestStudies — titled grid of StudyCards.
 * title comes from site_content 'home.sections'.latest_studies.title; the
 * caller checks its `visible` flag. Renders nothing without studies.
 */
import { arr, hasText } from './data.js'
import StudyCard from './StudyCard.jsx'

export default function LatestStudies({ title, studies, labels }) {
  const rows = arr(studies).filter((s) => s?.slug)
  if (!rows.length) return null
  return (
    <section className="st-section" aria-labelledby={hasText(title) ? 'st-latest-h' : undefined}>
      {hasText(title) && <h2 id="st-latest-h">{title}</h2>}
      <ul className="st-grid">
        {rows.map((s) => (
          <li key={s.id ?? s.slug}>
            <StudyCard study={s} labels={labels} headingLevel={hasText(title) ? 3 : 2} />
          </li>
        ))}
      </ul>
    </section>
  )
}
