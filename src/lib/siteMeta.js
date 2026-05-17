export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://pinex.in').replace(/\/$/, '')

export const SITE_NAME = 'PineX'

export const DEFAULT_TITLE =
  'PineX — Indian Stock Market Structure | Stage Analysis & SwingX Signals'

export const DEFAULT_DESCRIPTION =
  'PineX tracks 2100+ NSE stocks using Stan Weinstein Stage Analysis. Find Stage 2 uptrend stocks, delivery signals, SwingX setups and market breadth data. Free for Indian retail investors.'

export const DEFAULT_KEYWORDS =
  'indian stock screener, NSE stock analysis, stage analysis india, weinstein stage 2 stocks, swing trading india, nifty stocks screener, delivery volume NSE, stock market india, free stock screener india, nifty 500 stocks, SwingX'

export const OG_TITLE = 'PineX — Indian Stock Intelligence Platform'

export const OG_DESCRIPTION =
  'Track 2100+ NSE stocks with Stage Analysis, SwingX signals and delivery data. Free market intelligence for Indian investors.'

export const TWITTER_TITLE = 'PineX — Indian Stock Intelligence'

export const TWITTER_DESCRIPTION =
  'Free NSE stock screener with Stage Analysis and SwingX signals.'

export const OG_IMAGE = `${SITE_URL}/og-image.png`

export const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: SITE_NAME,
  url: SITE_URL,
  description:
    'Indian stock market intelligence platform using Stan Weinstein Stage Analysis for NSE stocks',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web, iOS, Android',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'INR',
  },
  featureList: [
    'NSE Stock Screener',
    'Stage Analysis',
    'SwingX Signals',
    'Delivery Volume Analysis',
    'Market Breadth',
    'Shareholding Patterns',
  ],
  audience: {
    '@type': 'Audience',
    audienceType: 'Indian retail investors',
  },
}
