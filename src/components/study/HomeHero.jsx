/**
 * HomeHero — the featured study at the top of the homepage.
 *
 * Props (no hard-coded text):
 *   hero   site_content 'home.hero' value:
 *          { eyebrow, headline_override, intro_override, cta_label,
 *            image }   ← image is the study_media object resolved from image_id
 *   study  the featured study_companies row (card fields + hero_image / card_image)
 *
 * Headline: hero.headline_override → study.headline → study.name.
 * Intro:    hero.intro_override    → study.summary  → study.story_hook.
 * Image:    hero.image             → study.hero_image.
 * Renders nothing without a headline.
 */
import { hasText } from './data.js'
import { studyHref } from './media.js'
import MediaFigure from './MediaFigure.jsx'

const pick = (...vals) => vals.find((v) => hasText(v)) ?? null

export default function HomeHero({ hero, study }) {
  const h = hero || {}
  const s = study || {}
  const headline = pick(h.headline_override, s.headline, s.name)
  if (!headline) return null
  const intro = pick(h.intro_override, s.summary, s.story_hook)
  const href = studyHref(s.slug)
  const image = h.image || s.hero_image

  return (
    <section className="st-home-hero" aria-labelledby="st-home-hero-h">
      <div className="st-home-hero-text">
        {hasText(h.eyebrow) && <p className="st-eyebrow">{h.eyebrow}</p>}
        <h1 id="st-home-hero-h">{headline}</h1>
        {hasText(s.name) && headline !== s.name && <p className="st-meta">{s.name}</p>}
        {intro && <p className="st-hook">{intro}</p>}
        {href && hasText(h.cta_label) && (
          <p>
            <a className="st-cta" href={href}>
              {h.cta_label}
            </a>
          </p>
        )}
      </div>
      <MediaFigure media={image} priority sizes="(min-width: 1040px) 520px, 100vw" className="st-home-hero-media" />
    </section>
  )
}
