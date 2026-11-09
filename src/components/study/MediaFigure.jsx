/**
 * MediaFigure — the only way study components render an image.
 *
 * <figure> + <picture>/<img srcset> + <figcaption> with caption and credit.
 * Renders nothing unless the media object has alt_text, credit,
 * width/height and a usable URL (see hasMedia in media.js).
 *
 * priority → fetchpriority="high" and no lazy loading (use for the hero only).
 */
import { hasText } from './data.js'
import { hasMedia, mediaSources, objectPosition } from './media.js'

export default function MediaFigure({
  media,
  sizes = '(min-width: 720px) 680px, 100vw',
  priority = false,
  className,
  imgClassName,
}) {
  if (!hasMedia(media)) return null
  const { fallback, sources } = mediaSources(media)
  const img = (
    <img
      src={fallback.src}
      srcSet={fallback.srcSet}
      sizes={fallback.srcSet ? sizes : undefined}
      alt={media.alt_text}
      width={media.width}
      height={media.height}
      loading={priority ? undefined : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={imgClassName}
      style={{ objectPosition: objectPosition(media) }}
    />
  )
  return (
    <figure className={`st-media${className ? ` ${className}` : ''}`}>
      {sources.length ? (
        <picture>
          {sources.map((s) => (
            <source key={s.type} type={s.type} srcSet={s.srcSet} sizes={sizes} />
          ))}
          {img}
        </picture>
      ) : (
        img
      )}
      <figcaption>
        {hasText(media.caption) && <span className="st-caption">{media.caption}</span>}
        <span className="st-credit">{media.credit}</span>
      </figcaption>
    </figure>
  )
}
