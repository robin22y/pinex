// ─────────────────────────────────────────────────────────────────
// Centralised SEO + social-meta strings.
//
// One source of truth so DefaultSeo.jsx (site-wide) and per-page
// <Helmet> blocks stay in sync. Adding a new keyword / changing the
// tagline only requires editing this file.
//
// Why so many keywords: Indian retail-investor search behaviour is
// fragmented across English / Hinglish phrasing (e.g. "nifty stock
// screener" vs "stage 2 stocks india" vs "delivery percentage NSE").
// We surface the high-intent ones explicitly; Google still indexes
// page-level content for everything else.
// ─────────────────────────────────────────────────────────────────

export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://pinex.in').replace(/\/$/, '')

export const SITE_NAME = 'PineX'

// Telegram bot — single source of truth for the username + deeplink.
// Any component that talks about "open the bot" should import these
// rather than hard-coding "@pinex_Alerts_bot" or t.me URLs. Renames
// (e.g. switching to a different bot, moving to staging) become a
// one-line change.
export const TELEGRAM_BOT_USERNAME = 'pinex_Alerts_bot'
export const TELEGRAM_BOT_HANDLE = `@${TELEGRAM_BOT_USERNAME}`
export const TELEGRAM_BOT_LINK_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=link`

export const DEFAULT_TITLE =
  'PineX — Free Indian Stock Screener | NSE Stage Analysis, Cycle Criteria & Market Breadth'

export const DEFAULT_DESCRIPTION =
  'PineX is a free Indian stock market intelligence platform tracking 2,100+ NSE stocks. ' +
  'Stage 2 uptrend classification, delivery volume data, SwingX cycle-criteria matches, ' +
  'Mansfield relative strength rankings, sector rotation and market breadth — all built ' +
  'on Weinstein Stage Analysis. End-of-day data only. Educational use, not investment advice.'

export const DEFAULT_KEYWORDS = [
  // High-intent retail-investor phrases
  'free indian stock screener',
  'nse stock screener india',
  'free stock screener india',
  'stock market screener india',
  // Stage analysis / Weinstein
  'stage analysis india',
  'stage 2 stocks india',
  'stage 2 breakout stocks',
  'weinstein stage analysis',
  'stan weinstein stock screener',
  // Delivery / volume
  'delivery percentage nse',
  'delivery volume analysis india',
  'high delivery stocks nse',
  'institutional buying nse',
  // Swing / momentum
  'swing trading india',
  'swing trade setups nse',
  'momentum stocks india',
  'SwingX',
  // Market breadth / sector
  'nifty market breadth',
  'sector rotation india',
  'nifty sector strength',
  'advance decline ratio india',
  // Mansfield RS
  'mansfield relative strength',
  'rs rating india',
  // Generic India / discoverability
  'nifty 500 stocks',
  'nifty 50 screener',
  'indian stock analysis',
  'nse stocks list',
].join(', ')

export const OG_TITLE = 'PineX — Indian Stock Intelligence Platform · Free NSE Screener'

export const OG_DESCRIPTION =
  'Track 2,100+ NSE stocks with Stage Analysis, SwingX cycle criteria, delivery data and ' +
  'market breadth. Built for Indian retail investors. Free, educational, EOD data only.'

export const TWITTER_TITLE = 'PineX — Free Indian Stock Screener & Market Breadth'

export const TWITTER_DESCRIPTION =
  'Stage 2 classification, SwingX cycle criteria, delivery data & sector strength for 2,100+ NSE stocks. Free.'

export const OG_IMAGE = `${SITE_URL}/og-image.png`

// ─────────────────────────────────────────────────────────────────
// Schema.org JSON-LD. Google uses this for rich-result eligibility.
// Combined Organization + WebApplication so search results can pick
// either schema. Adding `aggregateRating` / `review` blocks later
// will surface star ratings — out of scope until we have public
// review data.
// ─────────────────────────────────────────────────────────────────
export const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/favicon.svg`,
      sameAs: [
        // Add social profiles here as they go live; an empty array is
        // valid but populated ones help Google's knowledge panel.
      ],
    },
    {
      '@type': 'WebApplication',
      '@id': `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      description:
        'Free Indian stock market intelligence platform using Weinstein Stage ' +
        'Analysis. Stage 2 classification, SwingX cycle criteria, delivery data, ' +
        'Mansfield RS rankings, sector rotation and market breadth for 2,100+ NSE stocks.',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web, iOS, Android',
      browserRequirements: 'Requires JavaScript. Latest Chrome / Safari / Firefox / Edge.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'INR',
      },
      featureList: [
        'NSE Stock Screener (2,100+ stocks)',
        'Weinstein Stage Analysis (Stage 1-4 classification)',
        'SwingX cycle-criteria matches',
        'Delivery volume classifications',
        'Mansfield Relative Strength rankings',
        'Market breadth (A/D line, 52W highs/lows, % above 30W MA)',
        'Sector rotation and strength',
        'Shareholding patterns and pledge tracking',
        'PineX Academy — free educational modules',
      ],
      audience: {
        '@type': 'Audience',
        audienceType: 'Indian retail investors',
        geographicArea: {
          '@type': 'Country',
          name: 'India',
        },
      },
      isAccessibleForFree: true,
      inLanguage: 'en-IN',
    },
  ],
}
