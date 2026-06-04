import { Helmet } from 'react-helmet-async'
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_TITLE,
  OG_DESCRIPTION,
  OG_IMAGE,
  OG_TITLE,
  SITE_NAME,
  SITE_URL,
  STRUCTURED_DATA,
  TWITTER_DESCRIPTION,
  TWITTER_TITLE,
} from '../lib/siteMeta'

/** Site-wide default meta; pages can override with their own `<Helmet>`. */
export default function DefaultSeo() {
  return (
    <Helmet>
      <html lang="en-IN" />
      <title>{DEFAULT_TITLE}</title>
      <meta name="description" content={DEFAULT_DESCRIPTION} />
      <meta name="keywords" content={DEFAULT_KEYWORDS} />
      <meta name="author" content={SITE_NAME} />
      <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
      <meta name="googlebot" content="index, follow" />
      <link rel="canonical" href={`${SITE_URL}/`} />

      {/* Mobile-first viewport (already in index.html, restated here
          so per-page <Helmet> overrides don't accidentally drop it). */}
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      {/* Browser chrome / address-bar tinting to match the app's
          dark-mode primary background (--bg-primary = #0B0E11). */}
      <meta name="theme-color" content="#0B0E11" />
      <meta name="color-scheme" content="dark" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
      <meta name="application-name" content={SITE_NAME} />
      {/* Indian-market geo signals — helps Google understand the
          audience even before page content is indexed. */}
      <meta name="geo.region" content="IN" />
      <meta name="geo.placename" content="India" />

      <meta property="og:type" content="website" />
      <meta property="og:url" content={`${SITE_URL}/`} />
      <meta property="og:title" content={OG_TITLE} />
      <meta property="og:description" content={OG_DESCRIPTION} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${SITE_NAME} — Indian stock intelligence platform`} />
      <meta property="og:locale" content="en_IN" />
      <meta property="og:site_name" content={SITE_NAME} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={TWITTER_TITLE} />
      <meta name="twitter:description" content={TWITTER_DESCRIPTION} />
      <meta name="twitter:image" content={OG_IMAGE} />
      <meta name="twitter:image:alt" content={`${SITE_NAME} — free Indian stock screener`} />

      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      {/* Sitemap pointer — Google reads <link rel="sitemap"> on the
          home page when no robots.txt sitemap directive exists. */}
      <link rel="sitemap" type="application/xml" href="/sitemap.xml" />

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <script type="application/ld+json">{JSON.stringify(STRUCTURED_DATA)}</script>
    </Helmet>
  )
}
