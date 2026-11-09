/**
 * WhatsNewList — rows from the home_whats_new view:
 *   { kind, id, title, date, study_slug, study_name, icon_key, link_href }
 *
 * title   site_content 'home.sections'.whats_new.title
 * labels  site_content 'site.labels' — kind_update / kind_period_note /
 *         kind_development name each kind; a missing label hides the tag.
 * Each row links to link_href (if safe) or the study page.
 */
import { arr, hasText } from './data.js'
import { formatDate, isoDate, safeHref } from './format.js'
import { studyHref } from './media.js'
import Icon from './Icon.jsx'

export default function WhatsNewList({ title, items, labels }) {
  const rows = arr(items).filter((it) => hasText(it?.title))
  if (!rows.length) return null
  const L = labels || {}
  return (
    <section className="st-section" aria-labelledby={hasText(title) ? 'st-whatsnew-h' : undefined}>
      {hasText(title) && <h2 id="st-whatsnew-h">{title}</h2>}
      <ol className="st-whatsnew">
        {rows.map((it, i) => {
          const href = safeHref(it.link_href) || studyHref(it.study_slug)
          const kind = L[`kind_${it.kind}`]
          return (
            <li key={it.id ?? i}>
              <Icon name={it.icon_key} size={18} />
              <div>
                <p className="st-meta">
                  {[
                    it.date ? (
                      <time key="d" dateTime={isoDate(it.date)}>
                        {formatDate(it.date)}
                      </time>
                    ) : null,
                    hasText(kind) ? <span key="k">{kind}</span> : null,
                    hasText(it.study_name) ? <span key="s">{it.study_name}</span> : null,
                  ]
                    .filter(Boolean)
                    .flatMap((el, j) => (j ? [' · ', el] : [el]))}
                </p>
                <p className="st-whatsnew-title">{href ? <a href={href}>{it.title}</a> : it.title}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
