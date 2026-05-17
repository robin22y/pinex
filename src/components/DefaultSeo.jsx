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
      <html lang="en" />
      <title>{DEFAULT_TITLE}</title>
      <meta name="description" content={DEFAULT_DESCRIPTION} />
      <meta name="keywords" content={DEFAULT_KEYWORDS} />
      <meta name="author" content={SITE_NAME} />
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href={`${SITE_URL}/`} />

      <meta property="og:type" content="website" />
      <meta property="og:url" content={`${SITE_URL}/`} />
      <meta property="og:title" content={OG_TITLE} />
      <meta property="og:description" content={OG_DESCRIPTION} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:locale" content="en_IN" />
      <meta property="og:site_name" content={SITE_NAME} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={TWITTER_TITLE} />
      <meta name="twitter:description" content={TWITTER_DESCRIPTION} />
      <meta name="twitter:image" content={OG_IMAGE} />

      <link rel="icon" type="image/png" href="/favicon.png" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="dns-prefetch" href="https://xiozupvhtdqvpkgnftph.supabase.co" />

      <script type="application/ld+json">{JSON.stringify(STRUCTURED_DATA)}</script>
    </Helmet>
  )
}
