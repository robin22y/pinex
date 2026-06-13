// Thin PostHog wrapper for custom event tracking. All calls no-op when
// VITE_POSTHOG_KEY is unset (dev / preview deploys) so call sites don't
// have to gate themselves. Pageviews are already auto-captured by the
// init in main.jsx — this module is for explicit business events.

import posthog from 'posthog-js'

export function trackEvent(event, properties = {}) {
  if (!import.meta.env.VITE_POSTHOG_KEY) return
  posthog.capture(event, properties)
}

// Pre-defined event names — keep call sites consistent so a typo in
// one place doesn't fragment the funnel ("stock_view" vs "stock_viewed").
export const Events = {
  STOCK_VIEWED:             'stock_viewed',
  SCREEN_RUN:               'screen_run',
  SWINGX_OPENED:            'swingx_opened',
  RESEARCH_QUERY:           'research_query',
  ACADEMY_MODULE_STARTED:   'academy_module_started',
  WATCHLIST_ADDED:          'watchlist_added',
  DAILY_QUESTION_ANSWERED:  'daily_question_answered',
}
