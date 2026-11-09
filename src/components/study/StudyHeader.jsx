/**
 * StudyHeader — label, name, listing, headline, hook, byline, dates, hero.
 *
 * The byline is fixed ("PineX Research"): studies never carry a personal
 * name. Every other word comes from data:
 *   company.label            eyebrow (DB default 'Company Study')
 *   labels.updated           e.g. 'Updated'       (site_content 'site.labels')
 *   labels.min_read          e.g. '{n} min read'
 * A missing label simply omits that piece.
 *
 * Images come from study_media objects only (company.logo_image,
 * company.hero_image), so alt text and credit are always present.
 */
import { formatDate, isoDate } from './format.js'
import { hasText } from './data.js'
import { BYLINE, countryName } from './labels.js'
import { fillTemplate } from './media.js'
import MediaFigure from './MediaFigure.jsx'

export default function StudyHeader({ company, readingMinutes, labels }) {
  const c = company || {}
  const L = labels || {}
  const listing = [c.exchange, c.ticker].filter(Boolean).join(': ')
  const meta = [listing, countryName(c.country), c.sector, c.industry].filter(Boolean)
  const updated = c.updated_at || c.reviewed_at || c.published_at
  const minutes = c.read_time_minutes ?? readingMinutes
  const readTime = fillTemplate(L.min_read, minutes)

  return (
    <header className="st-header">
      {hasText(c.label) && <p className="st-eyebrow">{c.label}</p>}
      <div className="st-title-row">
        <MediaFigure media={c.logo_image} sizes="40px" eager className="st-logo-fig" imgClassName="st-logo" />
        <h1>{c.name}</h1>
      </div>
      {meta.length > 0 && <p className="st-meta">{meta.join(' · ')}</p>}
      {hasText(c.headline) && <p className="st-headline">{c.headline}</p>}
      {hasText(c.story_hook) && <p className="st-hook">{c.story_hook}</p>}
      <p className="st-byline">
        <strong>{BYLINE}</strong>
        {updated && hasText(L.updated) && (
          <>
            {` · ${L.updated} `}
            <time dateTime={isoDate(updated)}>{formatDate(updated)}</time>
          </>
        )}
        {readTime ? ` · ${readTime}` : null}
      </p>
      <MediaFigure media={c.hero_image} priority className="st-hero" />
    </header>
  )
}
