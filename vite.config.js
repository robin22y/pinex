// eslint-env node — Node globals live in this file (process.env, etc.)
// The `/* eslint-env node */` comment form was dropped in ESLint v10;
// `globals.node` is set via eslint.config.js for vite.config.js
// instead. `process` import below keeps the no-undef rule happy
// without relying on global ambient typing.
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Netlify/UI often exposes `SUPABASE_URL` + `SUPABASE_ANON_KEY` without `VITE_`.
 * Without `VITE_`, stock data never reaches the SPA bundle (`hasSupabaseEnv` stays false).
 */
function resolveSupabaseInject(mode, cwd) {
  const fromFiles = loadEnv(mode, cwd, '')
  const pick = (...keys) => {
    for (const key of keys) {
      const v = (fromFiles[key] ?? process.env[key] ?? '').trim()
      if (v) return v
    }
    return ''
  }

  const url = pick('VITE_SUPABASE_URL', 'SUPABASE_URL', 'PUBLIC_SUPABASE_URL')

  const anon = pick(
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_PUBLIC_SUPABASE_ANON_KEY',
    'PUBLIC_SUPABASE_ANON_KEY',
  )

  return { url, anon }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const cwd = process.cwd()
  const { url, anon } = resolveSupabaseInject(mode, cwd)

  // Preconnect to the Supabase origin during HTML parsing — saves
  // the DNS + TCP + TLS handshake (~150-300 ms) before the first
  // query fires. Runs only when we actually have a URL (skips the
  // placeholder fallback used when env vars are missing). The
  // injection happens at build time so the tag lands in dist/index.html
  // with no runtime cost.
  const supabasePreconnect = url && !url.includes('placeholder') ? {
    name: 'inject-supabase-preconnect',
    transformIndexHtml(html) {
      const link = `<link rel="preconnect" href="${url}" crossorigin />\n    <link rel="dns-prefetch" href="${url}" />`
      // Insert after the existing fonts.gstatic preconnect so the
      // ordering reads naturally (fonts → supabase → other head).
      return html.replace(
        /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin \/>/,
        (m) => `${m}\n    ${link}`,
      )
    },
  } : null

  // ── Dev-only parity with the netlify.toml rewrite ──────────────────
  // In production, `[[redirects]] from = "/quickscanner"` serves
  // public/quickscanner.html at the extensionless path. netlify.toml is
  // NOT read by `npm run dev`, so without this the dev server hands
  // /quickscanner to the SPA fallback and React Router throws
  // "404 Not Found" — the file is right there at /quickscanner.html, but
  // only the built site knows to map the clean URL onto it.
  //
  // Rewrites the request internally (no redirect), matching the
  // status = 200 behaviour of the Netlify rule so the URL stays
  // /quickscanner in dev too. `netlify dev` on port 8888 already got
  // this right via netlify.toml; this makes plain `vite` agree.
  const quickscannerDevRewrite = {
    name: 'quickscanner-dev-rewrite',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url || '').split('?')
        if (path === '/quickscanner' || path === '/quickscanner/') {
          req.url = '/quickscanner.html' + (query ? `?${query}` : '')
        }
        next()
      })
    },
  }

  return {
    plugins: [
      react(),
      quickscannerDevRewrite,
      supabasePreconnect,
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'PineX — Market Structure',
          short_name: 'PineX',
          description: 'Track how stocks actually move — using price and volume, not opinions.',
          theme_color: '#863bff',
          background_color: '#05070A',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          // ── Let /quickscanner reach the network ──────────────────
          // generateSW installs
          //     new NavigationRoute(createHandlerBoundToURL("index.html"))
          // which intercepts EVERY navigation and answers it with the
          // precached React shell. That is right for the SPA and wrong
          // for /quickscanner, which is a real static document served by
          // a netlify.toml rewrite: the shell would load, React Router
          // would find no matching route, and the user would get a 404.
          //
          // The symptom is distinctive — a hard refresh works because it
          // bypasses the service worker and hits Netlify directly, while
          // a normal visit 404s. Any "only works on hard reload" bug on
          // this origin should start here.
          //
          // globIgnores below keeps the file out of the PRECACHE; that is
          // a different mechanism and does not stop the navigation route
          // from claiming the URL. Both are needed.
          navigateFallbackDenylist: [/^\/quickscanner/],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          globIgnores: [
            '**/vendor-charts*',
            '**/html2canvas*',
            // quickscanner.html is a ~190 KB generated page that the
            // daily pipeline rewrites every trading day. globPatterns
            // above matches **/*.html, so without this it would be
            // precached: every user would download it on service-worker
            // install whether or not they ever open it, and the daily
            // rewrite would change the precache manifest revision daily,
            // forcing the whole SW to re-validate. It is also exactly
            // the kind of page that must never be served stale from
            // cache — netlify.toml already sends no-store for *.html.
            '**/quickscanner*',
          ],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 300 },
              },
            },
          ],
        },
      }),
    ].filter(Boolean),
    define: {
      // Inline at build so `import.meta.env` + `hasSupabaseEnv` work from Netlify's env naming.
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anon),
      // Unique per-deploy ID — used to bust localStorage caches on new deploys.
      '__BUILD_ID__': JSON.stringify(Date.now().toString(36)),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('recharts')) return 'vendor-charts'
            if (id.includes('@supabase')) return 'vendor-supabase'
            // Split heavy libraries off the index chunk so they download
            // in parallel and cache independently of app code changes.
            // posthog-js is intentionally NOT listed here — it's loaded
            // via a dynamic import in src/lib/posthog.js, so Rollup
            // gives it its own chunk that's fetched after first paint.
            if (id.includes('framer-motion')) return 'vendor-motion'
            if (id.includes('fuse.js')) return 'vendor-fuse'
            if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n'
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/') || id.includes('\\react\\')) return 'vendor-react'
          },
        },
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
      chunkSizeWarningLimit: 1000,
      // WHY: Preloads dynamic chunks when the main bundle loads, reducing
      // runtime chunk-fetch failures right after a deploy (when the browser
      // holds a stale index.html referencing hashes that the server still
      // has — preloading at first paint catches them before they're needed).
      //
      // resolveDependencies FILTER: by default Vite preloads *every*
      // transitive chunk dependency of every entry. We keep modulepreload
      // ON for everything Pulse statically imports (vendor-charts /
      // recharts is a critical-path dep for the public landing) and DROP
      // only html2canvas (197 KB, user-action triggered for share-card
      // export — never needed at first paint). Home was the previous
      // reason vendor-charts was excluded; now Home is lazy (App.jsx),
      // so excluding charts only hurt Pulse — its only eager consumer.
      //
      // polyfill=true adds the small Safari/older-browser shim for
      // <link rel="modulepreload">.
      modulePreload: {
        polyfill: true,
        resolveDependencies(_filename, deps) {
          return deps.filter((dep) => !/html2canvas/.test(dep))
        },
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        '@supabase/supabase-js',
      ],
    },
  }
})
