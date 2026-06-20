// Lazy wrapper around posthog-js. Keeps the ~80 KB analytics SDK off the
// critical-path bundle and out of first paint. main.jsx warms the import
// after first paint via requestIdleCallback (see startPosthog below).
//
// Other call sites (AuthContext, lib/analytics) use identify/reset/capture
// and never import posthog-js directly — so the SDK only ever ships in its
// own dynamically-imported chunk. Calls fired before init resolves are
// chained onto the ensure-loaded promise and replayed once it lands.

const KEY = import.meta.env.VITE_POSTHOG_KEY

let ready = null

function ensure() {
  if (!KEY) return Promise.resolve(null)
  if (!ready) {
    ready = import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(KEY, {
          api_host: 'https://eu.i.posthog.com',
          defaults: '2026-05-30',
          person_profiles: 'identified_only',
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: true,
        })
        return posthog
      })
      .catch(() => null)
  }
  return ready
}

// Warm the import after first paint. Safe to call repeatedly — ensure() memoises.
export function startPosthog() {
  ensure()
}

export function identify(id, props) {
  ensure().then((p) => p && p.identify(id, props))
}

export function reset() {
  ensure().then((p) => p && p.reset())
}

export function capture(event, props) {
  ensure().then((p) => p && p.capture(event, props))
}
