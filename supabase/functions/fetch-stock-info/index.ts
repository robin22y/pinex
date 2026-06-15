// fetch-stock-info — Supabase Edge Function.
//
// Layer 2 fundamentals + forensic flags for /iqjet-desk's Stock
// Lookup card. The frontend already has Layer 1 (Supabase tables);
// this function adds anything the local pipeline doesn't carry:
// trailing PE, ROE, debt/equity, cash flow, receivables, inventory,
// goodwill — plus the bookkeeping-health flags derived from those.
//
// Deploy:
//   supabase functions deploy fetch-stock-info
//   # No new secret needed unless you wire IndianAPI for promoter
//   # pledge (optional — set INDIAN_API_KEY to enable that lookup).
//
// Cache:
//   public.stock_info_cache (created via scripts/sql/create_stock_info_cache.sql)
//   24-hour TTL. RLS-locked; only this function (service role) reads/writes.
//
// Request body:
//   { symbol: string }            // bare NSE symbol, e.g. "RELIANCE"
//
// Response (200):
//   {
//     symbol,
//     fetched_at,
//     cached,                       // boolean — true if returned from cache
//     fundamentals: { ... },        // flat dict of Yahoo fields
//     forensic_flags: { ... },      // derived health checks
//     notes,                        // optional human-readable caveats
//   }
//
// Auth: bearer JWT in Authorization header, admin email enforced
// server-side (defence-in-depth — Supabase verify_jwt is also on).

// @ts-ignore - Deno std import (resolved at edge-runtime build time)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore - esm.sh import (resolved at edge-runtime build time)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const CACHE_TABLE = 'stock_info_cache'
const CACHE_TTL_HOURS = 24

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Yahoo blocks bare fetches without a desktop User-Agent.
const YAHOO_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const YAHOO_MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'balanceSheetHistory',
  'cashflowStatementHistory',
  'incomeStatementHistory',
  'assetProfile',
].join(',')

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  try {
    // ── 1. Auth — verify JWT + admin email ─────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ error: 'Missing Authorization bearer' }, 401)

    // @ts-ignore - Deno global available in edge runtime
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    // @ts-ignore
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
    // @ts-ignore
    const supabaseService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return json({ error: 'Server env vars missing' }, 500)
    }

    const supaUser = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: userRes, error: userErr } = await supaUser.auth.getUser()
    if (userErr || !userRes?.user) {
      return json({ error: 'Invalid or expired JWT' }, 401)
    }
    const email = String(userRes.user.email || '').trim().toLowerCase()
    if (email !== ADMIN_EMAIL) {
      return json({ error: 'Forbidden' }, 403)
    }

    // ── 2. Body ────────────────────────────────────────────────────
    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body must be JSON' }, 400)
    }
    const rawSymbol = String(body?.symbol || '').trim().toUpperCase()
    if (!rawSymbol || !/^[A-Z0-9&.\-]{1,20}$/.test(rawSymbol)) {
      return json({ error: 'Invalid symbol' }, 400)
    }

    // Service-role client for the cache table (RLS-bypassed).
    const supa = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ── 3. Cache check ────────────────────────────────────────────
    const { data: cacheRow } = await supa
      .from(CACHE_TABLE)
      .select('symbol,data,fetched_at')
      .eq('symbol', rawSymbol)
      .maybeSingle()

    if (cacheRow && isFresh(cacheRow.fetched_at)) {
      return json({ ...cacheRow.data, symbol: rawSymbol, cached: true }, 200)
    }

    // ── 4. Yahoo fetch ────────────────────────────────────────────
    const yahooUrl =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/` +
      `${encodeURIComponent(rawSymbol)}.NS?modules=${YAHOO_MODULES}`
    let yahooResult: any = null
    let yahooErr: string | null = null
    try {
      const r = await fetch(yahooUrl, {
        headers: {
          'User-Agent': YAHOO_UA,
          'Accept':     'application/json',
        },
      })
      if (!r.ok) {
        yahooErr = `Yahoo HTTP ${r.status}`
      } else {
        const j = await r.json()
        yahooResult = j?.quoteSummary?.result?.[0] || null
        if (j?.quoteSummary?.error) {
          yahooErr = String(j.quoteSummary.error?.description || 'Yahoo error')
        }
      }
    } catch (e) {
      yahooErr = String((e as any)?.message || e)
    }

    const fundamentals = extractYahoo(yahooResult)

    // ── 5. Promoter pledge — optional IndianAPI hook ──────────────
    // The user mentioned a ₹799/mo IndianAPI subscription. The exact
    // endpoint isn't part of this spec, so the hook is conditional:
    // if INDIAN_API_KEY is set on the function, we try a best-effort
    // GET against the shareholding endpoint and pull the latest
    // promoter pledge. If the response shape doesn't match or the
    // env var is unset, pledge stays null and the forensic check
    // surfaces UNKNOWN.
    // @ts-ignore
    const indianKey = Deno.env.get('INDIAN_API_KEY')
    let promoterPledgePct: number | null = null
    let indianApiErr: string | null = null
    if (indianKey) {
      try {
        const r = await fetch(
          `https://stock.indianapi.in/stock?name=${encodeURIComponent(rawSymbol)}`,
          { headers: { 'x-api-key': indianKey } },
        )
        if (r.ok) {
          const j = await r.json()
          // Defensive — IndianAPI's shape evolves. Look for any field
          // containing "pledge" with a numeric value. Stops silent
          // failures from a schema rename.
          promoterPledgePct = findFirstNumber(j, /pledge/i)
        } else {
          indianApiErr = `IndianAPI HTTP ${r.status}`
        }
      } catch (e) {
        indianApiErr = String((e as any)?.message || e)
      }
    }
    if (promoterPledgePct != null) {
      fundamentals.promoterPledgePct = promoterPledgePct
    }

    // ── 6. Forensic flags ─────────────────────────────────────────
    const forensicFlags = computeForensicFlags(fundamentals)

    const notes: string[] = []
    if (yahooErr)     notes.push(`Yahoo: ${yahooErr}`)
    if (indianApiErr) notes.push(`IndianAPI: ${indianApiErr}`)
    if (!indianKey)   notes.push('Promoter pledge requires INDIAN_API_KEY env var.')

    const payload = {
      fundamentals,
      forensic_flags: forensicFlags,
      notes,
    }

    // ── 7. Cache upsert ───────────────────────────────────────────
    // Only cache when we got *something* useful — otherwise a Yahoo
    // 429 would lock in an empty payload for 24h.
    if (yahooResult || promoterPledgePct != null) {
      await supa
        .from(CACHE_TABLE)
        .upsert(
          { symbol: rawSymbol, data: payload, fetched_at: new Date().toISOString() },
          { onConflict: 'symbol' },
        )
    }

    return json({ ...payload, symbol: rawSymbol, cached: false }, 200)
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
})

// ── Helpers ─────────────────────────────────────────────────────

function isFresh(fetchedAt: string): boolean {
  const t = new Date(fetchedAt).valueOf()
  if (!Number.isFinite(t)) return false
  return (Date.now() - t) < CACHE_TTL_HOURS * 3600 * 1000
}

// Yahoo numeric fields ship as { raw, fmt, longFmt } — pull .raw.
function num(node: any): number | null {
  if (node == null) return null
  if (typeof node === 'number') return Number.isFinite(node) ? node : null
  if (typeof node === 'object' && 'raw' in node) {
    const n = Number(node.raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function extractYahoo(r: any) {
  if (!r) {
    return {
      // Always-present skeleton so the frontend can render even
      // when Yahoo refuses the request.
      longName: null, sector: null, industry: null,
      currentPrice: null, previousClose: null, marketCap: null,
      fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
      trailingPE: null, forwardPE: null, priceToBook: null,
      dividendYield: null,
      totalRevenue: null, revenueGrowth: null, earningsGrowth: null,
      profitMargins: null, operatingMargins: null, grossMargins: null,
      debtToEquity: null, returnOnEquity: null, returnOnAssets: null,
      freeCashflow: null, operatingCashflow: null,
      totalDebt: null, totalCash: null,
      netIncome: null, netReceivables: null, inventory: null,
      goodwill: null, totalAssets: null,
      promoterPledgePct: null,
    }
  }
  const price = r.price || {}
  const sd    = r.summaryDetail || {}
  const dks   = r.defaultKeyStatistics || {}
  const fd    = r.financialData || {}
  const ap    = r.assetProfile || {}
  const bs    = r.balanceSheetHistory?.balanceSheetStatements?.[0] || {}
  const cf    = r.cashflowStatementHistory?.cashflowStatements?.[0] || {}
  const is    = r.incomeStatementHistory?.incomeStatementHistory?.[0] || {}

  return {
    longName:           price.longName || price.shortName || null,
    sector:             ap.sector   || null,
    industry:           ap.industry || null,

    currentPrice:       num(fd.currentPrice) ?? num(price.regularMarketPrice),
    previousClose:      num(price.regularMarketPreviousClose),
    marketCap:          num(price.marketCap),

    fiftyTwoWeekHigh:   num(sd.fiftyTwoWeekHigh),
    fiftyTwoWeekLow:    num(sd.fiftyTwoWeekLow),

    trailingPE:         num(sd.trailingPE) ?? num(price.trailingPE),
    forwardPE:          num(sd.forwardPE),
    priceToBook:        num(dks.priceToBook),
    dividendYield:      num(sd.dividendYield),

    totalRevenue:       num(fd.totalRevenue) ?? num(is.totalRevenue),
    revenueGrowth:      num(fd.revenueGrowth),
    earningsGrowth:     num(fd.earningsGrowth),
    profitMargins:      num(fd.profitMargins),
    operatingMargins:   num(fd.operatingMargins),
    grossMargins:       num(fd.grossMargins),
    debtToEquity:       num(fd.debtToEquity),
    returnOnEquity:     num(fd.returnOnEquity),
    returnOnAssets:     num(fd.returnOnAssets),
    freeCashflow:       num(fd.freeCashflow),
    operatingCashflow:  num(fd.operatingCashflow),
    totalDebt:          num(fd.totalDebt),
    totalCash:          num(fd.totalCash),

    netIncome:          num(cf.netIncome) ?? num(is.netIncome),
    netReceivables:     num(bs.netReceivables),
    inventory:          num(bs.inventory),
    goodwill:           num(bs.goodWill) ?? num(bs.goodwill),
    totalAssets:        num(bs.totalAssets),

    // Filled by the IndianAPI hook below, or stays null.
    promoterPledgePct:  null as number | null,
  }
}

// Forensic ratios + traffic-light flags. UNKNOWN when a denominator
// is missing — UI surfaces that as "data not available" so the LLM
// doesn't get a false GREEN.
function computeForensicFlags(f: any) {
  // ── Cash flow vs profit ─────────────────────────────────────────
  let cashFlag = 'UNKNOWN'
  let cashRatio: number | null = null
  if (f.operatingCashflow != null && f.netIncome != null && f.netIncome > 0) {
    cashRatio = f.operatingCashflow / f.netIncome
    if (cashRatio > 1.0)       cashFlag = 'GREEN'
    else if (cashRatio >= 0.75) cashFlag = 'YELLOW'
    else                        cashFlag = 'RED'
  } else if (f.netIncome != null && f.netIncome < 0) {
    cashFlag = 'RED'  // losing money — cash conversion is moot
  }

  // ── Receivables vs revenue ──────────────────────────────────────
  let recvFlag = 'UNKNOWN'
  let recvRatio: number | null = null
  if (f.netReceivables != null && f.totalRevenue != null && f.totalRevenue > 0) {
    recvRatio = f.netReceivables / f.totalRevenue
    recvFlag = recvRatio > 0.25 ? 'YELLOW' : 'GREEN'
  }

  // ── Debt years to repay ─────────────────────────────────────────
  let debtFlag = 'UNKNOWN'
  let debtYears: number | null = null
  if (f.totalDebt != null) {
    if (f.freeCashflow != null && f.freeCashflow > 0) {
      debtYears = f.totalDebt / f.freeCashflow
      if (debtYears > 5)      debtFlag = 'RED'
      else if (debtYears > 3) debtFlag = 'YELLOW'
      else                    debtFlag = 'GREEN'
    } else if (f.totalDebt > 0) {
      // Debt exists but no free cash flow → cannot service debt
      debtFlag = 'RED'
    }
  }

  // ── Inventory vs revenue ────────────────────────────────────────
  let invFlag = 'UNKNOWN'
  let invRatio: number | null = null
  if (f.inventory != null && f.totalRevenue != null && f.totalRevenue > 0) {
    invRatio = f.inventory / f.totalRevenue
    invFlag = invRatio > 0.3 ? 'YELLOW' : 'GREEN'
  }

  // ── Goodwill vs total assets ────────────────────────────────────
  let gwFlag = 'UNKNOWN'
  let gwRatio: number | null = null
  if (f.goodwill != null && f.totalAssets != null && f.totalAssets > 0) {
    gwRatio = f.goodwill / f.totalAssets
    gwFlag = gwRatio > 0.3 ? 'YELLOW' : 'GREEN'
  }

  // ── Promoter pledge ────────────────────────────────────────────
  let pledgeFlag = 'UNKNOWN'
  if (f.promoterPledgePct != null) {
    if (f.promoterPledgePct > 50)      pledgeFlag = 'SEVERE'
    else if (f.promoterPledgePct > 20) pledgeFlag = 'RED'
    else                                pledgeFlag = 'GREEN'
  }

  // ── Summary ─────────────────────────────────────────────────────
  const flagged: string[] = []
  if (cashFlag === 'RED')                              flagged.push('cash conversion')
  if (debtFlag === 'RED')                              flagged.push('debt')
  if (pledgeFlag === 'RED' || pledgeFlag === 'SEVERE') flagged.push('promoter pledge')

  let summary: string
  if (flagged.length === 0) {
    summary = 'No red flags from available data.'
  } else {
    summary = `${flagged.length} red flag${flagged.length > 1 ? 's' : ''} — ${flagged.join(', ')}.`
  }

  return {
    cash_vs_profit:      cashFlag,
    cash_ratio:          cashRatio,
    receivables_flag:    recvFlag,
    receivables_ratio:   recvRatio,
    debt_years:          debtYears,
    debt_flag:           debtFlag,
    inventory_flag:      invFlag,
    inventory_ratio:     invRatio,
    goodwill_flag:       gwFlag,
    goodwill_ratio:      gwRatio,
    promoter_pledge_pct: f.promoterPledgePct,
    pledge_flag:         pledgeFlag,
    summary,
    contingent_liabilities_note:
      'Not in any public API. Check annual report for contingent liabilities.',
  }
}

// Best-effort search for the first numeric value whose key matches
// the supplied pattern, recursing into nested objects/arrays.
function findFirstNumber(obj: any, keyPattern: RegExp): number | null {
  const seen = new Set<any>()
  const stack: any[] = [obj]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    for (const [k, v] of Object.entries(node)) {
      if (keyPattern.test(k)) {
        if (typeof v === 'number' && Number.isFinite(v)) return v
        if (typeof v === 'string') {
          const n = parseFloat(v)
          if (Number.isFinite(n)) return n
        }
        if (v && typeof v === 'object' && 'raw' in (v as any)) {
          const n = Number((v as any).raw)
          if (Number.isFinite(n)) return n
        }
      }
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return null
}
