/* eslint-env node */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

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

  return {
    plugins: [react(), supabasePreconnect].filter(Boolean),
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
      // transitive chunk dependency of every entry. That meant Home was
      // downloading vendor-charts (110 KB recharts, used only by Lab /
      // SectorRotation / WhenToSell / admin pages) and html2canvas (197 KB,
      // used only when the user exports a share card) at high priority on
      // page load, competing with the real entry for bandwidth and adding
      // ~300 KB to first-paint transfer for chunks the home visitor never
      // touches. Lighthouse confirmed both showed up in network-requests
      // with isLinkPreload=true on Home.
      //
      // We keep modulepreload on for the chunks that actually matter for
      // first paint (react, supabase, index, runtime, tokens) and drop the
      // heavy lazy-route-only ones. They still load on demand via the lazy
      // import when the user navigates to those routes — Netlify retains
      // old hashed assets indefinitely so stale-index navigation still
      // resolves to the correct (still-present) chunks.
      //
      // polyfill=true adds the small Safari/older-browser shim for
      // <link rel="modulepreload">.
      modulePreload: {
        polyfill: true,
        resolveDependencies(_filename, deps) {
          return deps.filter(
            (dep) => !/vendor-charts|html2canvas/.test(dep),
          )
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
