// pattern-match — Supabase Edge Function.
//
// Given current stock conditions (stage, substage, rs, vol, breadth)
// queries pattern_snapshots for historically similar setups and
// returns the aggregated forward-outcome distribution plus the top
// few most-similar individual instances.
//
// Mirrors scripts/backtest/query_similar_setups.py — if you change
// the tolerances or aggregation here, update that file too. The
// Python script is the reference / spot-check tool; this function
// is the runtime read path called from the stock-detail page.
//
// Deploy:
//   supabase functions deploy pattern-match
//
// Request body (POST application/json):
//   {
//     stage:        string,   // e.g. "Stage 2"
//     substage?:    string,   // exact match; null/undefined → skip
//     rs_score:     number,   // rs_vs_nifty centre  (± 10)
//     vol_ratio:    number,   // vol_ratio centre    (± 0.5)
//     above_ma30w_pct:  number,   // above_ma30w_pct centre  (± 7)
//   }
//
// Response (200): see PatternMatchResult below.
//
// Auth: standard bearer JWT — anyone signed in can call. The
// pattern_snapshots table is broadcast statistics (RLS allows
// authenticated SELECT) so this function is a thin wrapper, not a
// privilege-elevation path.

// @ts-ignore
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RS_TOL          = 10
const VOL_TOL         = 0.5
const BREADTH_TOL     = 7
const EXCLUDE_DAYS    = 90
const TOP_N_INSTANCES = 4
const PAGE_SIZE       = 1000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ── Type shapes ───────────────────────────────────────────────
interface PatternRow {
  company_id:           string
  date:                 string
  rs_vs_nifty:          number | null
  vol_ratio:            number | null
  above_ma30w_pct:          number | null
  forward_7d:           number | null
  forward_30d:          number | null
  forward_60d:          number | null
  forward_90d:          number | null
  hit_52w_high_30d:     boolean | null
  hit_52w_low_30d:      boolean | null
  stage_upgraded_30d:   boolean | null
  dropped_below_ma_30d: boolean | null
}

interface MatchRequest {
  stage:        string
  substage?:    string | null
  rs_score:     number
  vol_ratio:    number
  above_ma30w_pct:  number
}

interface SimilarInstance {
  symbol:           string
  date:             string
  similarity_score: number
  forward_7d:       number | null
  forward_30d:      number | null
  forward_60d:      number | null
  forward_90d:      number | null
}

interface PatternMatchResult {
  sample_size:          number
  earliest_date:        string | null
  latest_date:          string | null
  pct_positive_7d:      number | null
  pct_positive_30d:     number | null
  pct_positive_60d:     number | null
  median_return_30d:    number | null
  best_case_30d:        number | null
  worst_case_30d:       number | null
  pct_hit_52w_high:     number | null
  pct_dropped_below_ma: number | null
  pct_stage_upgraded:   number | null
  similar_instances:    SimilarInstance[]
  table: {
    headers:       string[]
    positive:      (number | null)[]
    median_return: (number | null)[]
    best_case:     (number | null)[]
    worst_case:    (number | null)[]
  }
}

// ── Aggregation helpers (mirror the Python) ───────────────────
function pctPositive(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null)
  if (v.length === 0) return null
  const pos = v.filter((x) => x > 0).length
  return Math.round((1000 * pos) / v.length) / 10
}

function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  const raw = v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
  return Math.round(raw * 100) / 100
}

function boolPct(values: (boolean | null)[]): number | null {
  const v = values.filter((x): x is boolean => x != null)
  if (v.length === 0) return null
  return Math.round((1000 * v.filter((x) => x).length) / v.length) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function axisScore(value: number | null, target: number, tol: number): number {
  if (value == null || tol <= 0) return 0
  const diff = Math.abs(value - target)
  if (diff >= tol) return 0
  return 1 - diff / tol
}

function similarityScore(
  row: PatternRow,
  rs: number,
  vol: number,
  breadth: number,
): number {
  const parts = [
    axisScore(row.rs_vs_nifty,  rs,      RS_TOL),
    axisScore(row.vol_ratio,    vol,     VOL_TOL),
    axisScore(row.above_ma30w_pct,  breadth, BREADTH_TOL),
  ]
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length
  return Math.round(avg * 100)
}

// ── Handler ───────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405)

  let body: MatchRequest
  try {
    body = await req.json()
  } catch (_e) {
    return json({ error: 'invalid_json' }, 400)
  }

  // Required fields. substage is optional (and "" is treated as
  // missing — some stocks don't carry a Weinstein substage).
  const stage   = String(body?.stage ?? '').trim()
  const rs      = Number(body?.rs_score)
  const vol     = Number(body?.vol_ratio)
  const breadth = Number(body?.above_ma30w_pct)
  const substage = body?.substage ? String(body.substage).trim() : null
  if (!stage || !Number.isFinite(rs) || !Number.isFinite(vol) || !Number.isFinite(breadth)) {
    return json({ error: 'missing_required_fields' }, 400)
  }

  // Client. Service role bypasses RLS so the read works even if the
  // caller's JWT shouldn't have direct SELECT (unauthenticated free
  // browse, etc.). The table holds aggregate stats so no privacy
  // surface is exposed.
  // @ts-ignore Deno
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string
  // @ts-ignore Deno
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'function_misconfigured' }, 500)
  }
  const client = createClient(SUPABASE_URL, SERVICE_KEY)

  // Last-90-day cutoff. Server-side date so client clock skew can't
  // skew the result.
  const cutoff = new Date(Date.now() - EXCLUDE_DAYS * 86_400_000)
    .toISOString().slice(0, 10)

  // ── Query rows (paged) ──────────────────────────────────────
  const rows: PatternRow[] = []
  let start = 0
  while (true) {
    let q = client.from('pattern_snapshots')
      .select(
        'company_id, date, rs_vs_nifty, vol_ratio, above_ma30w_pct, ' +
        'forward_7d, forward_30d, forward_60d, forward_90d, ' +
        'hit_52w_high_30d, hit_52w_low_30d, ' +
        'stage_upgraded_30d, dropped_below_ma_30d'
      )
      .eq('stage', stage)
      .lt('date', cutoff)
      .gte('rs_vs_nifty', rs - RS_TOL)
      .lte('rs_vs_nifty', rs + RS_TOL)
      .gte('vol_ratio',   vol - VOL_TOL)
      .lte('vol_ratio',   vol + VOL_TOL)
      .gte('above_ma30w_pct', breadth - BREADTH_TOL)
      .lte('above_ma30w_pct', breadth + BREADTH_TOL)
    if (substage) q = q.eq('substage', substage)

    const { data, error } = await q.range(start, start + PAGE_SIZE - 1)
    if (error) {
      return json({ error: 'query_failed', detail: error.message }, 500)
    }
    const batch = (data ?? []) as PatternRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  // Empty result — return the zero shape so the client can render
  // an "Insufficient historical data" message without null-checks
  // on every field.
  if (rows.length === 0) {
    const empty: PatternMatchResult = {
      sample_size: 0,
      earliest_date: null,
      latest_date: null,
      pct_positive_7d: null,
      pct_positive_30d: null,
      pct_positive_60d: null,
      median_return_30d: null,
      best_case_30d: null,
      worst_case_30d: null,
      pct_hit_52w_high: null,
      pct_dropped_below_ma: null,
      pct_stage_upgraded: null,
      similar_instances: [],
      table: {
        headers:       ['7 days', '30 days', '60 days'],
        positive:      [null, null, null],
        median_return: [null, null, null],
        best_case:     [null, null, null],
        worst_case:    [null, null, null],
      },
    }
    return json(empty)
  }

  // ── Aggregate ───────────────────────────────────────────────
  const f7  = rows.map((r) => r.forward_7d)
  const f30 = rows.map((r) => r.forward_30d)
  const f60 = rows.map((r) => r.forward_60d)
  const f7v  = f7.filter((x): x is number => x != null)
  const f30v = f30.filter((x): x is number => x != null)
  const f60v = f60.filter((x): x is number => x != null)

  const table = {
    headers: ['7 days', '30 days', '60 days'],
    positive: [
      pctPositive(f7),
      pctPositive(f30),
      pctPositive(f60),
    ],
    median_return: [
      median(f7),
      median(f30),
      median(f60),
    ],
    best_case: [
      f7v.length  ? round2(Math.max(...f7v))  : null,
      f30v.length ? round2(Math.max(...f30v)) : null,
      f60v.length ? round2(Math.max(...f60v)) : null,
    ],
    worst_case: [
      f7v.length  ? round2(Math.min(...f7v))  : null,
      f30v.length ? round2(Math.min(...f30v)) : null,
      f60v.length ? round2(Math.min(...f60v)) : null,
    ],
  }

  // ── Top N similar instances ────────────────────────────────
  const scored = rows
    .map((r) => ({ row: r, score: similarityScore(r, rs, vol, breadth) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (b.row.forward_30d ?? -Infinity) - (a.row.forward_30d ?? -Infinity)
    })
    .slice(0, TOP_N_INSTANCES)

  const cids = Array.from(new Set(scored.map((s) => s.row.company_id).filter(Boolean)))
  const symbolByCid = new Map<string, string>()
  if (cids.length > 0) {
    const { data: comps } = await client
      .from('companies')
      .select('id, symbol')
      .in('id', cids)
    for (const c of comps ?? []) {
      if (c?.id && c?.symbol) symbolByCid.set(c.id, c.symbol)
    }
  }

  const similar_instances: SimilarInstance[] = scored.map(({ row, score }) => ({
    symbol:           symbolByCid.get(row.company_id) ?? row.company_id.slice(0, 8) + '…',
    date:             row.date,
    similarity_score: score,
    forward_7d:       row.forward_7d,
    forward_30d:      row.forward_30d,
    forward_60d:      row.forward_60d,
    forward_90d:      row.forward_90d,
  }))

  const dates = rows.map((r) => r.date).filter(Boolean).sort()

  const result: PatternMatchResult = {
    sample_size:          rows.length,
    earliest_date:        dates[0]            ?? null,
    latest_date:          dates[dates.length - 1] ?? null,
    pct_positive_7d:      pctPositive(f7),
    pct_positive_30d:     pctPositive(f30),
    pct_positive_60d:     pctPositive(f60),
    median_return_30d:    median(f30),
    best_case_30d:        f30v.length ? round2(Math.max(...f30v)) : null,
    worst_case_30d:       f30v.length ? round2(Math.min(...f30v)) : null,
    pct_hit_52w_high:     boolPct(rows.map((r) => r.hit_52w_high_30d)),
    pct_dropped_below_ma: boolPct(rows.map((r) => r.dropped_below_ma_30d)),
    pct_stage_upgraded:   boolPct(rows.map((r) => r.stage_upgraded_30d)),
    similar_instances,
    table,
  }

  return json(result)
})
