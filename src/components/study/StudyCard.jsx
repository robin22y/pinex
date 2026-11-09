/**
 * StudyCard — one study in a grid (homepage, directory, series pages).
 *
 * study   study_companies row with card_image / hero_image media objects
 * labels  site_content 'site.labels' ({ min_read: '{n} min read' })
 * headingLevel  3 by default (cards sit under an h2)
 *
 * Title:   card_title → headline → name
 * Summary: card_summary → summary
 * Image:   card_image → hero_image
 */
import { hasText } from './data.js'
import { fillTemplate, studyHref } from './media.js'
import MediaFigure from './MediaFigure.jsx'

const pick = (...vals) => vals.find((v) => hasText(v)) ?? null

export default function StudyCard({ study, labels, headingLevel = 3 }) {
  const s = study || {}
  const title = pick(s.card_title, s.headline, s.name)
  const href = studyHref(s.slug)
  if (!title || !href) return null
  const summary = pick(s.card_summary, s.summary)
  const readTime = fillTemplate(labels?.min_read, s.read_time_minutes)
  const H = headingLevel === 2 ? 'h2' : 'h3'
  const meta = [s.name !== title ? s.name : null, readTime].filter(Boolean)

  return (
    <article className="st-study-card">
      <MediaFigure media={s.card_image || s.hero_image} sizes="(min-width: 1040px) 320px, (min-width: 560px) 50vw, 100vw" />
      {hasText(s.label) && <p className="st-label">{s.label}</p>}
      <H>
        <a href={href}>{title}</a>
      </H>
      {summary && <p className="st-small">{summary}</p>}
      {meta.length > 0 && <p className="st-meta">{meta.join(' · ')}</p>}
    </article>
  )
}
