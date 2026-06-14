import { Helmet } from 'react-helmet-async'
import {
  DEFAULT_KEYWORDS,
  DEFAULT_TITLE,
  OG_IMAGE,
  SITE_NAME,
  SITE_URL,
  STRUCTURED_DATA,
} from '../lib/siteMeta'

/**
 * Site-wide default meta.
 *
 * Intentionally does NOT render description / og:title / og:description /
 * og:image / og:url / og:type / twitter:card / twitter:title /
 * twitter:description — those are per-page concerns and the page-level
 * <Helmet> in each route owns them. Two declarations of any of these tags
 * (one here, one in the page) produces two DOM nodes; LinkedIn / X / Slack
 * read the FIRST match and would otherwise scrape this generic fallback
 * instead of the actual page content.
 *
 * What stays here = stuff that doesn't change per page: keywords, robots,
 * theme color, geo signals, og:locale / og:site_name, supplementary
 * og:image:width / og:image:height / og:image:alt, twitter:image
 * (the static fallback), favicons, sitemap, font preconnects, JSON-LD.
 */
export default function DefaultSeo() {
  return (
    <Helmet>
      <html lang="en-IN" />
      <title>{DEFAULT_TITLE}</title>
      <meta name="keywords" content={DEFAULT_KEYWORDS} />
      <meta name="author" content={SITE_NAME} />
      <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
      <meta name="googlebot" content="index, follow" />
      {/* Canonical is set per page in route-level <Helmet>. Lighthouse
          flagged "3 conflicting canonicals" when this default + the
          page Helmet + index.html each emitted one — now there's at
          most one per page, sourced from the page itself. */}

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

      {/* og:image dimensions + alt describe whichever og:image the
          page-level <Helmet> declares — all pages point at the same
          /og-image.png (1200×630), so these stay valid as fallbacks. */}
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${SITE_NAME} — Indian stock intelligence platform`} />
      <meta property="og:locale" content="en_IN" />
      <meta property="og:site_name" content={SITE_NAME} />

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
