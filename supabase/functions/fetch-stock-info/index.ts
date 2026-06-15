// fetch-stock-info — Supabase Edge Function.
//
// Layer 2 fundamentals + shareholding + (on-demand) forensic flags for
// /iqjet-desk's Stock Lookup card. The frontend already has Layer 1
// (Supabase tables); this function adds anything the local pipeline
// doesn't carry: trailing PE, ROE, debt/equity, cash flow, receivables,
// inventory, goodwill, plus shareholding (insiders/institutions/insider
// transactions) and forensic flags derived from all of the above.
//
// Deploy:
//   supabase functions deploy fetch-stock-info
//   # Optional: enable promoter pledge + better Indian shareholding via
//   #   supabase secrets set INDIAN_API_KEY=...
//
// Cache:
//   public.stock_info_cache (scripts/sql/create_stock_info_cache.sql)
//   24-hour TTL. Holds the full computed payload; response shape is
//   trimmed per-request to honour the on-demand semantic.
//
// Request body:
//   {
//     symbol:        string,        // bare NSE symbol, e.g. "RELIANCE"
//     forensic?:     boolean,       // default false — gate the forensic_flags + IndianAPI pledge
//     shareholding?: boolean,       // default true  — include shareholding data
//   }
//
// Response (200):
//   {
//     symbol, fetched_at, cached,
//     fundamentals: { ... },                       // always
//     shareholding?: { ... } | null,               // when shareholding=true
//     forensic_flags?: { ... } | null,             // when forensic=true
//     shareholding_flags?: { ... } | null,         // when shareholding=true
//     notes: string[],
//   }
//
// Auth: bearer JWT, admin email enforced server-side.

// @ts-ignore
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const CACHE_TABLE = 'stock_info_cache'
const CACHE_TTL_HOURS = 24

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
  'institutionOwnership',
  'fundOwnership',
  'majorHoldersBreakdown',
  'insiderHolders',
  'insiderTransactions',
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
    // ── Auth ────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ error: 'Missing Authorization bearer' }, 401)

    // @ts-ignore
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

    // ── Body ────────────────────────────────────────────────────────
    let body: any
    try { body = await req.json() }
    catch { return json({ error: 'Body must be JSON' }, 400) }

    const rawSymbol = String(body?.symbol || '').trim().toUpperCase()
    if (!rawSymbol || !/^[A-Z0-9&.\-]{1,20}$/.test(rawSymbol)) {
      return json({ error: 'Invalid symbol' }, 400)
    }
    const wantForensic     = body?.forensic === true
    // Shareholding defaults TRUE per the /iqjet-desk spec (the section
    // loads automatically, unlike the on-demand forensic audit).
    const wantShareholding = body?.shareholding !== false

    const supa = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ── Cache ──────────────────────────────────────────────────────
    const { data: cacheRow } = await supa
      .from(CACHE_TABLE)
      .select('symbol,data,fetched_at')
      .eq('symbol', rawSymbol)
      .maybeSingle()

    if (cacheRow && isFresh(cacheRow.fetched_at)) {
      // Hit. Some fields may be missing if the cached entry was
      // computed before this code added shareholding/forensic — fall
      // through to a fresh fetch in that case.
      const cached = cacheRow.data || {}
      const needsForensicButMissing      = wantForensic     && !cached.forensic_flags
      const needsShareholdingButMissing  = wantShareholding && cached.shareholding === undefined
      if (!needsForensicButMissing && !needsShareholdingButMissing) {
        return json(shapeResponse(cached, rawSymbol, true, wantForensic, wantShareholding), 200)
      }
    }

    // ── Yahoo fetch ────────────────────────────────────────────────
    const yahooUrl =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/` +
      `${encodeURIComponent(rawSymbol)}.NS?modules=${YAHOO_MODULES}`
    let yahooResult: any = null
    let yahooErr: string | null = null
    try {
      const r = await fetch(yahooUrl, {
        headers: { 'User-Agent': YAHOO_UA, 'Accept': 'application/json' },
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

    let fundamentals = extractYahooFundamentals(yahooResult)
    const shareholding = extractYahooShareholding(yahooResult)
    let fundamentalsSource: 'Yahoo Finance' | 'IndianAPI' | 'none' =
      yahooResult ? 'Yahoo Finance' : 'none'
    // Notes accumulator — declared early because the IndianAPI
    // fallback below pushes its outcome onto it.
    const notes: string[] = []

    // ── IndianAPI fundamentals fallback ───────────────────────────
    // Yahoo's quoteSummary endpoint started returning 401/Unauthorized
    // for unauthenticated server-side requests in late 2024 — the
    // crumb-cookie flow is now required for reliable access. When
    // Yahoo failed (or returned a skeleton of nulls) and we DO have
    // an INDIAN_API_KEY, try IndianAPI as the primary fundamentals
    // source. Field names are defensively pattern-matched since
    // IndianAPI's response shape evolves.
    // @ts-ignore - Deno env
    const indianKeyForFundamentals = Deno.env.get('INDIAN_API_KEY')
    const yahooEmpty = !yahooResult ||
      (fundamentals.currentPrice == null && fundamentals.marketCap == null && fundamentals.trailingPE == null)
    if (yahooEmpty && indianKeyForFundamentals) {
      try {
        const r = await fetch(
          `https://stock.indianapi.in/stock?name=${encodeURIComponent(rawSymbol)}`,
          { headers: { 'x-api-key': indianKeyForFundamentals } },
        )
        if (r.ok) {
          const j = await r.json()
          const merged = mergeIndianFundamentals(fundamentals, j)
          // If the merge produced AT LEAST one new numeric field, treat
          // IndianAPI as the source for display purposes.
          const beforeNonNull = Object.values(fundamentals).filter((v) => v != null).length
          const afterNonNull = Object.values(merged).filter((v) => v != null).length
          if (afterNonNull > beforeNonNull) {
            fundamentals = merged
            fundamentalsSource = 'IndianAPI'
            notes.push('IndianAPI fundamentals ok')
          }
        } else if (r.status !== 404) {
          notes.push(`IndianAPI fundamentals HTTP ${r.status}`)
        }
      } catch (e) {
        notes.push(`IndianAPI fundamentals: ${String((e as any)?.message || e)}`)
      }
    }

    // ── IndianAPI augmentations (optional) ─────────────────────────
    // The user has a ₹799/mo subscription. IndianAPI may carry
    // better Indian-specific data than Yahoo — promoter pledge,
    // promoter % vs FII vs DII breakdown, recent shareholding
    // history. We attempt the documented endpoint first, fall back
    // to a generic stock lookup.
    // @ts-ignore
    const indianKey = Deno.env.get('INDIAN_API_KEY')
    const indianApiErrs: string[] = []

    if (wantForensic && indianKey) {
      try {
        const r = await fetch(
          `https://stock.indianapi.in/stock?name=${encodeURIComponent(rawSymbol)}`,
          { headers: { 'x-api-key': indianKey } },
        )
        if (r.ok) {
          const j = await r.json()
          const pledge = findFirstNumber(j, /pledge/i)
          if (pledge != null) fundamentals.promoterPledgePct = pledge
        } else {
          indianApiErrs.push(`IndianAPI stock HTTP ${r.status}`)
        }
      } catch (e) {
        indianApiErrs.push(`IndianAPI stock: ${String((e as any)?.message || e)}`)
      }
    }

    if (wantShareholding && indianKey) {
      try {
        // Documented IndianAPI shareholding endpoint per the spec.
        const r = await fetch(
          `https://stock.indianapi.in/api/v1/shareholding/${encodeURIComponent(rawSymbol)}`,
          { headers: { 'x-api-key': indianKey } },
        )
        if (r.ok) {
          const j = await r.json()
          const merged = mergeIndianShareholding(shareholding, j)
          Object.assign(shareholding, merged)
        } else if (r.status !== 404) {
          indianApiErrs.push(`IndianAPI shareholding HTTP ${r.status}`)
        }
      } catch (e) {
        indianApiErrs.push(`IndianAPI shareholding: ${String((e as any)?.message || e)}`)
      }
    }

    // ── Forensic + shareholding flags ──────────────────────────────
    const forensicFlags        = computeForensicFlags(fundamentals)
    const shareholdingFlags    = computeShareholdingFlags(shareholding)

    if (yahooErr)              notes.unshift(`Yahoo: ${yahooErr}`)
    for (const e of indianApiErrs) notes.push(e)
    if (!indianKey)            notes.push('INDIAN_API_KEY not set — promoter pledge + richer shareholding skipped.')

    const fullPayload = {
      fundamentals,
      shareholding,
      forensic_flags:     forensicFlags,
      shareholding_flags: shareholdingFlags,
      source:             fundamentalsSource,
      notes,
    }

    // Cache always carries the full computed object. Only cache when
    // we got something useful — otherwise a Yahoo 429 would lock in
    // an empty payload for 24h.
    if (yahooResult || shareholding.indianApiUsed) {
      await supa.from(CACHE_TABLE).upsert(
        { symbol: rawSymbol, data: fullPayload, fetched_at: new Date().toISOString() },
        { onConflict: 'symbol' },
      )
    }

    return json(shapeResponse(fullPayload, rawSymbol, false, wantForensic, wantShareholding), 200)
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
})

// ── Response shaping ────────────────────────────────────────────

function shapeResponse(
  payload: any,
  symbol: string,
  cached: boolean,
  wantForensic: boolean,
  wantShareholding: boolean,
) {
  const out: any = {
    symbol,
    cached,
    fundamentals: payload.fundamentals || null,
    notes:        payload.notes        || [],
  }
  if (wantShareholding) {
    out.shareholding       = payload.shareholding       ?? null
    out.shareholding_flags = payload.shareholding_flags ?? null
  }
  if (wantForensic) {
    out.forensic_flags = payload.forensic_flags ?? null
  }
  return out
}

// ── Helpers ─────────────────────────────────────────────────────

function isFresh(fetchedAt: string): boolean {
  const t = new Date(fetchedAt).valueOf()
  if (!Number.isFinite(t)) return false
  return (Date.now() - t) < CACHE_TTL_HOURS * 3600 * 1000
}

function num(node: any): number | null {
  if (node == null) return null
  if (typeof node === 'number') return Number.isFinite(node) ? node : null
  if (typeof node === 'object' && 'raw' in node) {
    const n = Number(node.raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function extractYahooFundamentals(r: any) {
  const empty = {
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
    promoterPledgePct: null as number | null,
  }
  if (!r) return empty

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
    promoterPledgePct:  null as number | null,
  }
}

function extractYahooShareholding(r: any) {
  const empty = {
    asOf:               null as string | null,
    promoterPct:        null as number | null,
    institutionPct:     null as number | null,
    publicPct:          null as number | null,
    institutionsCount:  null as number | null,
    topInstitutions:    [] as Array<{ name: string; pctHeld: number | null; value: number | null; reportDate: string | null }>,
    insiderTransactions: [] as Array<{ filerName: string; transactionText: string; shares: number | null; value: number | null; startDate: string | null }>,
    insiderHolders:     [] as Array<{ name: string; relation: string | null; positionDirect: number | null; latestTransactionDesc: string | null }>,
    indianApiUsed:      false,
  }
  if (!r) return empty

  // Major holders breakdown — quick splits.
  const mhb = r.majorHoldersBreakdown || {}
  const insiders     = num(mhb.insidersPercentHeld)
  const institutions = num(mhb.institutionsPercentHeld)
  // Yahoo's "insiders" approximates promoter holding for Indian
  // stocks — the local promoter family typically registers as
  // insider holders. Public = whatever's left.
  const promoterPct    = insiders     != null ? insiders     * 100 : null
  const institutionPct = institutions != null ? institutions * 100 : null
  const publicPct = (promoterPct != null && institutionPct != null)
    ? Math.max(0, 100 - promoterPct - institutionPct)
    : null

  // Institutional ownership — top 10 list.
  const instList = r.institutionOwnership?.ownershipList || []
  const topInstitutions = instList.slice(0, 10).map((o: any) => ({
    name:       o.organization || '—',
    pctHeld:    num(o.pctHeld),
    value:      num(o.value),
    reportDate: num(o.reportDate) != null ? new Date((num(o.reportDate) as number) * 1000).toISOString().slice(0, 10) : null,
  }))

  // Insider transactions — typically last 10-20 entries.
  const tx = (r.insiderTransactions?.transactions || []).slice(0, 20).map((t: any) => ({
    filerName:       t.filerName || '—',
    transactionText: t.transactionText || '',
    shares:          num(t.shares),
    value:           num(t.value),
    startDate:       num(t.startDate) != null
      ? new Date((num(t.startDate) as number) * 1000).toISOString().slice(0, 10)
      : null,
  }))

  // Insider holders.
  const holders = (r.insiderHolders?.holders || []).slice(0, 15).map((h: any) => ({
    name:                  h.name || '—',
    relation:              h.relation || null,
    positionDirect:        num(h.positionDirect),
    latestTransactionDesc: h.latestTransDescription || null,
  }))

  return {
    asOf:               null as string | null,
    promoterPct,
    institutionPct,
    publicPct,
    institutionsCount:  num(mhb.institutionsCount),
    topInstitutions,
    insiderTransactions: tx,
    insiderHolders:     holders,
    indianApiUsed:      false,
  }
}

// Merge IndianAPI fundamentals payload into the Yahoo skeleton.
// IndianAPI's stock-info response carries a mix of section objects
// (`companyProfile`, `financials`, `ratios`…) that vary across
// equities. Rather than chase the schema, we defensively scan for
// known field-name patterns and pull the first numeric match.
// Any field already populated by Yahoo is left alone.
function mergeIndianFundamentals(base: any, j: any) {
  const out = { ...base }
  const setIfNull = (key: string, value: number | null) => {
    if (out[key] == null && value != null && Number.isFinite(value)) out[key] = value
  }
  setIfNull('currentPrice',     findFirstNumber(j, /^(currentPrice|ltp|lastTradePrice|price|close)$/i))
  setIfNull('previousClose',    findFirstNumber(j, /^(previousClose|prevClose|prev_close)$/i))
  setIfNull('marketCap',        findFirstNumber(j, /^(marketCap|market_cap|mcap)$/i))
  setIfNull('fiftyTwoWeekHigh', findFirstNumber(j, /^(52WeekHigh|52w_high|high52w|year_high|high52)$/i))
  setIfNull('fiftyTwoWeekLow',  findFirstNumber(j, /^(52WeekLow|52w_low|low52w|year_low|low52)$/i))
  setIfNull('trailingPE',       findFirstNumber(j, /^(pe|peRatio|trailingPe|pe_ratio|price_to_earnings)$/i))
  setIfNull('priceToBook',      findFirstNumber(j, /^(pb|pbRatio|priceToBook|pb_ratio|price_to_book)$/i))
  setIfNull('dividendYield',    findFirstNumber(j, /^(dividendYield|div_yield|dividend_yield)$/i))
  setIfNull('totalRevenue',     findFirstNumber(j, /^(totalRevenue|revenue|sales|net_sales|revenueTtm)$/i))
  setIfNull('revenueGrowth',    findFirstNumber(j, /^(revenueGrowth|revenue_growth|sales_growth)$/i))
  setIfNull('profitMargins',    findFirstNumber(j, /^(profitMargin|profit_margin|net_margin|netProfitMargin)$/i))
  setIfNull('operatingMargins', findFirstNumber(j, /^(operatingMargin|operating_margin|ebit_margin)$/i))
  setIfNull('grossMargins',     findFirstNumber(j, /^(grossMargin|gross_margin)$/i))
  setIfNull('debtToEquity',     findFirstNumber(j, /^(debtEquity|debt_to_equity|de|deRatio|debt_equity)$/i))
  setIfNull('returnOnEquity',   findFirstNumber(j, /^(roe|returnOnEquity|return_on_equity)$/i))
  setIfNull('returnOnAssets',   findFirstNumber(j, /^(roa|returnOnAssets|return_on_assets|roce)$/i))
  setIfNull('freeCashflow',     findFirstNumber(j, /^(freeCashflow|free_cash_flow|fcf)$/i))
  setIfNull('operatingCashflow',findFirstNumber(j, /^(operatingCashflow|operating_cash_flow|ocf|cash_from_operations)$/i))
  setIfNull('totalDebt',        findFirstNumber(j, /^(totalDebt|total_debt|debt)$/i))
  setIfNull('totalCash',        findFirstNumber(j, /^(totalCash|total_cash|cash)$/i))
  setIfNull('netIncome',        findFirstNumber(j, /^(netIncome|net_income|netProfit|net_profit|pat)$/i))
  setIfNull('netReceivables',   findFirstNumber(j, /^(netReceivables|receivables|trade_receivables)$/i))
  setIfNull('inventory',        findFirstNumber(j, /^(inventory|inventories)$/i))
  setIfNull('goodwill',         findFirstNumber(j, /^(goodwill|good_will)$/i))
  setIfNull('totalAssets',      findFirstNumber(j, /^(totalAssets|total_assets|assets)$/i))
  // Name + sector if Yahoo missed them
  if (!out.longName) {
    const name = findFirstString(j, /^(companyName|company_name|name|fullName)$/i)
    if (name) out.longName = name
  }
  if (!out.sector) {
    const sec = findFirstString(j, /^(sector|industrySector|industry_sector)$/i)
    if (sec) out.sector = sec
  }
  if (!out.industry) {
    const ind = findFirstString(j, /^(industry|sub_industry)$/i)
    if (ind) out.industry = ind
  }
  return out
}

function findFirstString(obj: any, keyPattern: RegExp): string | null {
  const seen = new Set<any>()
  const stack: any[] = [obj]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    for (const [k, v] of Object.entries(node)) {
      if (keyPattern.test(k) && typeof v === 'string' && v.trim()) return v.trim()
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return null
}

// Merge IndianAPI shareholding payload into the Yahoo skeleton.
// Schema isn't guaranteed; we look for common field names and
// override Yahoo values when the Indian data is present.
function mergeIndianShareholding(base: any, j: any) {
  const out = { ...base, indianApiUsed: true }
  // Pull date
  const asOf = j?.as_of || j?.reportDate || j?.quarter || null
  if (asOf) out.asOf = String(asOf)
  // Common shapes:
  //   { promoter_pct, fii_pct, dii_pct, public_pct }
  //   { holding: { promoter, fii, dii, public } }
  //   { current: { promoter, ... } }
  const promoter      = findFirstNumber(j, /^promoter(_?(pct|percent|%))?$/i)
  const fii           = findFirstNumber(j, /^fii(_?(pct|percent|%))?$/i)
  const dii           = findFirstNumber(j, /^dii(_?(pct|percent|%))?$/i)
  const institutional = findFirstNumber(j, /^institut(ions?|ional)(_?(pct|percent|%))?$/i)
  const publicPct     = findFirstNumber(j, /^public(_?(pct|percent|%))?$/i)
  if (promoter != null) out.promoterPct = promoter
  if (institutional != null) out.institutionPct = institutional
  else if (fii != null || dii != null) {
    out.institutionPct = (fii || 0) + (dii || 0)
  }
  if (publicPct != null) out.publicPct = publicPct
  return out
}

function computeForensicFlags(f: any) {
  let cashFlag = 'UNKNOWN'; let cashRatio: number | null = null
  if (f.operatingCashflow != null && f.netIncome != null && f.netIncome > 0) {
    cashRatio = f.operatingCashflow / f.netIncome
    if (cashRatio > 1.0)       cashFlag = 'GREEN'
    else if (cashRatio >= 0.75) cashFlag = 'YELLOW'
    else                        cashFlag = 'RED'
  } else if (f.netIncome != null && f.netIncome < 0) {
    cashFlag = 'RED'
  }

  let recvFlag = 'UNKNOWN'; let recvRatio: number | null = null
  if (f.netReceivables != null && f.totalRevenue != null && f.totalRevenue > 0) {
    recvRatio = f.netReceivables / f.totalRevenue
    recvFlag = recvRatio > 0.25 ? 'YELLOW' : 'GREEN'
  }

  let debtFlag = 'UNKNOWN'; let debtYears: number | null = null
  if (f.totalDebt != null) {
    if (f.freeCashflow != null && f.freeCashflow > 0) {
      debtYears = f.totalDebt / f.freeCashflow
      if (debtYears > 5)      debtFlag = 'RED'
      else if (debtYears > 3) debtFlag = 'YELLOW'
      else                    debtFlag = 'GREEN'
    } else if (f.totalDebt > 0) {
      debtFlag = 'RED'
    }
  }

  let invFlag = 'UNKNOWN'; let invRatio: number | null = null
  if (f.inventory != null && f.totalRevenue != null && f.totalRevenue > 0) {
    invRatio = f.inventory / f.totalRevenue
    invFlag = invRatio > 0.3 ? 'YELLOW' : 'GREEN'
  }

  let gwFlag = 'UNKNOWN'; let gwRatio: number | null = null
  if (f.goodwill != null && f.totalAssets != null && f.totalAssets > 0) {
    gwRatio = f.goodwill / f.totalAssets
    gwFlag = gwRatio > 0.3 ? 'YELLOW' : 'GREEN'
  }

  let pledgeFlag = 'UNKNOWN'
  if (f.promoterPledgePct != null) {
    if (f.promoterPledgePct > 50)      pledgeFlag = 'SEVERE'
    else if (f.promoterPledgePct > 20) pledgeFlag = 'RED'
    else                                pledgeFlag = 'GREEN'
  }

  const flagged: string[] = []
  if (cashFlag === 'RED')                              flagged.push('cash conversion')
  if (debtFlag === 'RED')                              flagged.push('debt')
  if (pledgeFlag === 'RED' || pledgeFlag === 'SEVERE') flagged.push('promoter pledge')

  const summary = flagged.length === 0
    ? 'No red flags from available data.'
    : `${flagged.length} red flag${flagged.length > 1 ? 's' : ''} — ${flagged.join(', ')}.`

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

// Shareholding-derived flags. Promoter skin, insider direction,
// institutional trend. Some fields are null when the data isn't there.
function computeShareholdingFlags(s: any) {
  let promoterFlag = 'UNKNOWN'
  let promoterDetail: string | null = null
  if (s.promoterPct != null) {
    if (s.promoterPct < 25)      { promoterFlag = 'RED';    promoterDetail = 'Very low promoter commitment.' }
    else if (s.promoterPct < 40) { promoterFlag = 'YELLOW'; promoterDetail = 'Low promoter skin in the game.' }
    else                         { promoterFlag = 'GREEN';  promoterDetail = 'Promoter holding above 40%.' }
  }

  // Insider buys vs sells over the last 90 days. Yahoo's
  // transactionText is human-readable: "Sale", "Purchase", etc.
  let insiderFlag = 'UNKNOWN'
  let insiderDirection: 'buying' | 'selling' | 'neutral' = 'neutral'
  let insiderDetail: string | null = null
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000
  const recent = (s.insiderTransactions || []).filter((t: any) =>
    t.startDate && new Date(t.startDate).valueOf() >= cutoff,
  )
  if (recent.length > 0) {
    let buys = 0; let sells = 0
    const months: Record<string, number> = {}
    for (const t of recent) {
      const text = String(t.transactionText || '').toLowerCase()
      const isSell = /sale|sold|dispos/.test(text)
      const isBuy  = /purchas|bought|acquir/.test(text)
      if (isSell) sells++
      if (isBuy)  buys++
      if (isSell && t.startDate) {
        const m = t.startDate.slice(0, 7)
        months[m] = (months[m] || 0) + 1
      }
    }
    const maxSellsInOneMonth = Math.max(0, ...Object.values(months))
    if (buys > sells) {
      insiderFlag = 'GREEN'
      insiderDirection = 'buying'
      insiderDetail = `${buys} buys vs ${sells} sells in last 90 days.`
    } else if (maxSellsInOneMonth >= 3) {
      insiderFlag = 'RED'
      insiderDirection = 'selling'
      insiderDetail = `${maxSellsInOneMonth} insider sales in a single month — coordinated selling.`
    } else if (sells > buys) {
      insiderFlag = 'YELLOW'
      insiderDirection = 'selling'
      insiderDetail = `${sells} sells vs ${buys} buys in last 90 days.`
    } else {
      insiderDetail = 'Mixed insider activity.'
    }
  } else {
    insiderDetail = 'No insider transactions reported.'
  }

  // Institutional trend — Yahoo doesn't give quarter-over-quarter,
  // so this stays UNKNOWN unless IndianAPI fills it in later.
  const institutionFlag = 'UNKNOWN'

  const summaryParts: string[] = []
  if (promoterFlag === 'RED' || promoterFlag === 'YELLOW') summaryParts.push('promoter')
  if (insiderFlag === 'RED' || insiderFlag === 'YELLOW')   summaryParts.push('insider activity')
  const summary = summaryParts.length === 0
    ? 'No shareholding red flags from available data.'
    : `${summaryParts.length} concern${summaryParts.length > 1 ? 's' : ''} — ${summaryParts.join(', ')}.`

  return {
    promoter_flag:      promoterFlag,
    promoter_detail:    promoterDetail,
    promoter_trend:     'unknown',          // need historical data for stable/inc/dec
    insider_flag:       insiderFlag,
    insider_direction:  insiderDirection,
    insider_detail:     insiderDetail,
    institution_flag:   institutionFlag,
    institution_trend:  'unknown',
    summary,
  }
}

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
