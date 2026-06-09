/**
 * SSR-style meta injection for /stock/:symbol (crawlers & social previews).
 *
 * Netlify env (Site settings): SUPABASE_URL or VITE_SUPABASE_URL,
 * SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function env(key) {
  return Deno.env.get(key) || ''
}

function supabaseUrl() {
  return (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/rest\/v1\/?$/, '')
}

function supabaseAnonKey() {
  return env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY')
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatRs(rs) {
  if (rs == null || rs === '') return ''
  const n = Number(rs)
  if (!Number.isFinite(n)) return ''
  return n >= 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`
}

function formatPrice(close) {
  if (close == null || close === '') return ''
  const n = Number(close)
  if (!Number.isFinite(n)) return ''
  return `₹${n.toLocaleString('en-IN')}`
}

// Bots / crawlers / link-preview fetchers that NEED the server-rendered
// meta tags to scrape (Open Graph cards, search snippets, Twitter/X
// previews, WhatsApp link unfurls). Real-user browsers do NOT match any
// of these — they get a fast pass-through below and the SPA hydrates
// the page client-side, picking up the title from <Helmet>.
//
// WHY THIS GATE EXISTS — earlier the edge function fired a Supabase
// query + buffered the entire origin HTML on EVERY visit. That added
// 500 ms – 1 s of blocking serial work to every human page load (and
// every cache-miss). Bots happily wait for SEO HTML; humans should
// not. The gate keeps the SSR-style meta injection for crawlers
// while letting real users hit the SPA directly.
const BOT_UA_RE = /bot|crawl|spider|slurp|googlebot|bingbot|yandex|baidu|duckduck|facebookexternalhit|twitterbot|linkedinbot|slackbot|whatsapp|telegram|discord|applebot|pinterest|embedly|quora|prerender|headlesschrome|lighthouse/i

function isBot(ua) {
  if (!ua) return false
  return BOT_UA_RE.test(ua)
}

export default async (request, context) => {
  const url = new URL(request.url)
  const pathname = url.pathname

  if (!pathname.startsWith('/stock/')) {
    return context.next()
  }

  // FAST PATH for real users — skip the Supabase query + HTML buffer
  // + regex rewrite entirely. The browser gets the static SPA shell
  // immediately; React Helmet sets the title client-side once the
  // bundle hydrates.
  const ua = request.headers.get('user-agent') || ''
  if (!isBot(ua)) {
    return context.next()
  }

  const symbol = pathname
    .replace(/^\/stock\//, '')
    .replace(/\/$/, '')
    .toUpperCase()

  if (!symbol) return context.next()

  const sbUrl = supabaseUrl()
  const sbKey = supabaseAnonKey()
  if (!sbUrl || !sbKey) {
    return context.next()
  }

  try {
    const supabase = createClient(sbUrl, sbKey)

    const { data } = await supabase
      .from('companies')
      .select(
        `
        name, sector, description,
        price_data!inner(
          close, stage, rs_vs_nifty,
          weinstein_substage, high_52w,
          low_52w, rsi, ma30w
        )
      `,
      )
      .eq('symbol', symbol)
      .eq('price_data.is_latest', true)
      .maybeSingle()

    if (!data) return context.next()

    const price = Array.isArray(data.price_data) ? data.price_data[0] : data.price_data
    if (!price) return context.next()

    const name = data.name || symbol
    const sector = data.sector || ''
    const stage = price.stage || ''
    const substage = price.weinstein_substage || stage
    const rs = price.rs_vs_nifty
    const close = price.close
    const description = data.description || ''

    const title = `${symbol} — ${name} Stock Analysis | ${substage} | PineX`
    const rsText = formatRs(rs)
    const priceText = formatPrice(close)

    const metaDesc = description
      ? `${description.slice(0, 120)}... ${substage} stage. ${rsText} vs Nifty. Free analysis on PineX.`
      : `${name} (${symbol}) is currently ${substage}. Price: ${priceText}. RS vs Nifty: ${rsText}. ${sector} sector. Full stage analysis on PineX.`

    const ogTitle = `${symbol} Stock Analysis — ${substage} | PineX India`

    const eTitle = escapeHtml(title)
    const eDesc = escapeHtml(metaDesc)
    const eOgTitle = escapeHtml(ogTitle)
    const eName = escapeHtml(name)
    const eSymbol = escapeHtml(symbol)

    const response = await context.next()
    const html = await response.text()

    let updatedHtml = html.replace(/<title>.*?<\/title>/s, `<title>${eTitle}</title>`)

    if (/<meta\s+name="description"/i.test(updatedHtml)) {
      updatedHtml = updatedHtml.replace(
        /<meta\s+name="description"[^>]*>/i,
        `<meta name="description" content="${eDesc}" />`,
      )
    } else {
      updatedHtml = updatedHtml.replace(
        '</head>',
        `  <meta name="description" content="${eDesc}" />\n</head>`,
      )
    }

    const extraHead = `
  <meta property="og:title" content="${eOgTitle}" />
  <meta property="og:description" content="${eDesc}" />
  <meta property="og:url" content="https://pinex.in/stock/${eSymbol}" />
  <meta name="twitter:title" content="${eOgTitle}" />
  <meta name="twitter:description" content="${eDesc}" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    "name": "${eName}",
    "tickerSymbol": "${eSymbol}",
    "exchange": "NSE",
    "description": "${eDesc}",
    "url": "https://pinex.in/stock/${eSymbol}"
  }
  </script>
`

    updatedHtml = updatedHtml.replace('</head>', `${extraHead}\n</head>`)

    const headers = new Headers(response.headers)
    headers.set('content-type', 'text/html; charset=utf-8')
    headers.set('cache-control', 'public, max-age=3600')

    return new Response(updatedHtml, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (err) {
    console.error(`stock-meta error for ${symbol}:`, err)
    return context.next()
  }
}

export const config = {
  path: '/stock/*',
}
