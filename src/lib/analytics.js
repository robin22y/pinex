// Thin PostHog wrapper for custom event tracking. Routes through
// ./posthog which lazy-loads the SDK after first paint, so call sites
// here never pull posthog-js into the critical-path bundle. Calls
// no-op when VITE_POSTHOG_KEY is unset (dev / preview deploys) so call
// sites don't have to gate themselves. Pageviews are auto-captured
// once init resolves — this module is for explicit business events.

import { capture } from './posthog'

export function trackEvent(event, properties = {}) {
  capture(event, properties)
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
