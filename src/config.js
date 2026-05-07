const paywallEnv = import.meta.env.VITE_PAYWALL_ACTIVE
const adsEnv = import.meta.env.VITE_ADS_ACTIVE

/** Treat paywall as active unless explicitly disabled (`false` / `0`). */
export const CONFIG = {
  admin: {
    superAdminEmail: (import.meta.env.VITE_SUPERADMIN_EMAIL ?? '').trim(),
  },
  features: {
    paywallActive:
      paywallEnv !== 'false' && paywallEnv !== '0',
    adsActive:
      adsEnv === 'true' || adsEnv === '1',
  },
  limits: {
    stockViewsDaily: 10,
    freeStockViewsPerDay: 10,
    watchlistStocks: 10,
    portfolioHoldings: 10,
    downloadsMonthly: 5,
  },
}
