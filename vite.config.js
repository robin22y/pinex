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

  return {
    plugins: [react()],
    define: {
      // Inline at build so `import.meta.env` + `hasSupabaseEnv` work from Netlify's env naming.
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anon),
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
        },
      },
    },
  }
})
