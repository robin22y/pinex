import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { stageAccentColor, stageBadge } from '../lib/stageUi'
import StagePill from './StagePill'

const BORDER = 'var(--border)'
const MUTED = 'var(--text-muted)'
const TEXT = 'var(--text-primary)'
const BLUE = 'var(--info)'
const BLUE_TEXT = '#080C14'
const CARD_BG = 'var(--bg-input)'
const NO_PRICE_TILE = 'var(--border)'

const MOBILE_HMAP_H = 400
const DESKTOP_HMAP_MAX = 600
const DESKTOP_HMAP_VH = 0.65
const HEATMAP_TIP_W = 300
const HEATMAP_TIP_H = 290

/** Price mode: no meaningful change (undefined, null, or exactly 0) — dedicated dark tile, not negative red. */
function isBlankPriceChange(row) {
  if (!row?.hasData) return true
  const p = row.pct
  if (p == null || !Number.isFinite(p)) return true
  if (p === 0 || Math.abs(p) < 1e-9) return true
  return false
}

function clampTooltipXY(clientX, clientY, tipW, tipH, margin = 10) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  let x = clientX + 14
  let y = clientY + 10
  if (x + tipW > vw - margin) x = Math.max(margin, vw - margin - tipW)
  if (y + tipH > vh - margin) y = Math.max(margin, clientY - tipH - 12)
  if (x < margin) x = margin
  if (y < margin) y = margin
  return { x, y }
}

/** Price % change → tile color (flat "neutral" band uses mid grey, not NO_PRICE_TILE). */
function getColor(pctChange) {
  if (pctChange === null || pctChange === undefined || !Number.isFinite(Number(pctChange))) return NO_PRICE_TILE
  const p = Number(pctChange)
  if (p > 5) return '#16A34A'
  if (p > 2) return '#22C55E'
  if (p > 0.5) return 'var(--positive-soft)'
  if (p > -0.5) return 'var(--border-strong)'
  if (p > -2) return 'var(--negative-soft)'
  if (p > -5) return '#EF4444'
  return '#991B1B'
}

function fmtSignedPct(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

/** 1–4 (+ 1.5 for Stage 1+) from stage text; null if unknown */
function parseStageStep(stageRaw) {
  const s = String(stageRaw || '').trim()
  if (!s) return null
  if (/stage\s*1\+/i.test(s)) return 1.5
  const t = s.toLowerCase().replace(/\s+/g, '')
  if (t.includes('stage1')) return 1
  if (t.includes('stage2')) return 2
  if (t.includes('stage3')) return 3
  if (t.includes('stage4')) return 4
  const digits = s.match(/[1-4]/)
  if (digits) return Number(digits[0])
  return null
}

/** rising | flat | falling */
function parseTrend(raw) {
  const t = String(raw || '').toLowerCase()
  if (t.includes('rising')) return 'rising'
  if (t.includes('falling')) return 'falling'
  if (t.includes('flat')) return 'flat'
  return null
}

const COLOR_MODE_META = {
  price: { label: 'Price change', short: 'Price' },
  stage: { label: 'Stage (incl. Emerging)', short: 'Stage' },
  delivery: { label: 'Delivery trend', short: 'Delivery' },
  obv: { label: 'OBV trend', short: 'OBV' },
}

function tileFill(row, mode) {
  switch (mode) {
    case 'price':
      return isBlankPriceChange(row) ? NO_PRICE_TILE : getColor(row.pct)
    case 'stage': {
      const raw = row.stage
      return raw != null && String(raw).trim() !== '' ? stageAccentColor(raw) : 'var(--border-strong)'
    }
    case 'delivery': {
      const t = row.deliveryTrend
      if (t === 'rising') return '#16A34A'
      if (t === 'falling') return '#991B1B'
      if (t === 'flat') return 'var(--text-hint)'
      return 'var(--border-strong)'
    }
    case 'obv': {
      const t = row.obvTrend
      if (t === 'rising') return '#16A34A'
      if (t === 'falling') return '#991B1B'
      if (t === 'flat') return 'var(--text-hint)'
      return 'var(--border-strong)'
    }
    default:
      return 'var(--border-strong)'
  }
}

function sectorAggregates(stocks, mode) {
  if (!stocks?.length) return { avg: null, dot: MUTED, avgDisplay: '—' }
  if (mode === 'price') {
    const vals = stocks.filter((s) => !isBlankPriceChange(s)).map((s) => s.pct)
    if (!vals.length) return { avg: null, dot: MUTED, avgDisplay: '—' }
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    const dot = avg > 0.5 ? '#16A34A' : avg < -0.5 ? '#EF4444' : '#94a3b8'
    return { avg, dot, avgDisplay: fmtSignedPct(avg) }
  }
  if (mode === 'stage') {
    const nums = stocks.map((s) => s.stageStep).filter((n) => n != null)
    if (!nums.length) return { avg: null, dot: MUTED, avgDisplay: '—' }
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length
    const dot =
      avg >= 2.25 ? '#22C55E' : avg >= 1.75 ? 'var(--warning)' : avg >= 1.35 ? '#0D9488' : '#FB923C'
    return { avg, dot, avgDisplay: `Avg ${avg.toFixed(1)}` }
  }
  const trendKey = mode === 'delivery' ? 'deliveryTrend' : 'obvTrend'
  let r = 0
  let f = 0
  let l = 0
  for (const s of stocks) {
    const t = s[trendKey]
    if (t === 'rising') r += 1
    else if (t === 'flat') f += 1
    else if (t === 'falling') l += 1
  }
  const denom = r + f + l
  if (!denom) return { avg: null, dot: MUTED, avgDisplay: '—' }
  const pctRise = (100 * r) / denom
  const dot = pctRise > 50 ? '#16A34A' : pctRise < 35 ? '#991B1B' : '#94a3b8'
  return { avg: pctRise, dot, avgDisplay: `${Math.round(pctRise)}% ↑` }
}

function sectorTileColor(stocks, mode) {
  const agg = sectorAggregates(stocks, mode)
  if (mode === 'price') {
    return agg.avg != null && Number.isFinite(agg.avg) ? getColor(agg.avg) : NO_PRICE_TILE
  }
  return agg.dot || NO_PRICE_TILE
}

function stockSortValue(row, mode) {
  if (mode === 'price') return isBlankPriceChange(row) ? -9999 : row.pct
  if (mode === 'stage') return row.stageStep ?? -1
  const key = mode === 'delivery' ? 'deliveryTrend' : 'obvTrend'
  const trend = row[key]
  if (trend === 'rising') return 3
  if (trend === 'flat') return 2
  if (trend === 'falling') return 1
  return 0
}

function stockMetricLabel(row, mode) {
  if (mode === 'price') return isBlankPriceChange(row) ? '—' : fmtSignedPct(row.pct)
  if (mode === 'stage') {
    const badge = row.stage ? stageBadge(row.stage) : null
    return badge?.label || row.stage || '—'
  }
  const key = mode === 'delivery' ? 'deliveryTrend' : 'obvTrend'
  const trend = row[key]
  if (trend === 'rising') return 'Rising'
  if (trend === 'flat') return 'Flat'
  if (trend === 'falling') return 'Falling'
  return '—'
}

const TIMES = [
  { id: '1D', label: '1D' },
  { id: '1W', label: '1W' },
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: '6M', label: '6M' },
  { id: '1Y', label: '1Y' },
]

function sameCalendarDay(a, b) {
  return String(a ?? '').slice(0, 10) === String(b ?? '').slice(0, 10)
}

function pct1d(cur, prev) {
  const a = Number(cur)
  const b = Number(prev)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
  return ((a - b) / b) * 100
}

/** Trading rows newest-first; need at least idx+1 rows; compare [0] vs [idx] — same as "idx trading days ago". */
function pctFromOffsetRows(rowsNewestFirst, idx) {
  if (!rowsNewestFirst?.length || idx < 1) return null
  if (rowsNewestFirst.length <= idx) return null
  return pct1d(rowsNewestFirst[0].close, rowsNewestFirst[idx].close)
}

const IN_CHUNK = 300
const PAGE_ROWS = 5000
/** Trading-day offsets for each timeframe */
const TF_TRADING_OFFSET = { '1W': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252 }
const PARALLEL_PRICE_QUERIES = 24

/**
 * Batched 1D: fetch price_data for many companies, global date desc, merge pages until
 * each company has two distinct calendar days (most recent + prior).
 */
function mergeTwoLatestRows(twoLatestMap, rows) {
  for (const r of rows) {
    const id = r.company_id
    let arr = twoLatestMap.get(id)
    if (!arr) {
      twoLatestMap.set(id, [r])
      continue
    }
    if (arr.length >= 2) continue
    if (arr.length === 1) {
      if (!sameCalendarDay(arr[0].date, r.date)) {
        arr.push(r)
      }
    }
  }
}

async function fetch1DPriceChanges(supabaseClient, companyIds) {
  const pctByCompany = Object.fromEntries(companyIds.map((id) => [id, null]))
  const hasByCompany = Object.fromEntries(companyIds.map((id) => [id, false]))
  if (!companyIds.length) return { pctByCompany, hasByCompany }

  for (let c = 0; c < companyIds.length; c += IN_CHUNK) {
    const chunk = companyIds.slice(c, c + IN_CHUNK)
    const twoLatest = new Map()
    let offset = 0
    for (;;) {
      const { data, error } = await supabaseClient
        .from('price_data')
        .select('company_id, close, date')
        .in('company_id', chunk)
        .order('date', { ascending: false })
        .range(offset, offset + PAGE_ROWS - 1)

      if (error) break
      const batch = data || []
      if (!batch.length) break

      mergeTwoLatestRows(twoLatest, batch)

      let allHaveTwo = true
      for (const id of chunk) {
        const arr = twoLatest.get(id)
        if (!arr || arr.length < 2) {
          allHaveTwo = false
          break
        }
      }
      if (allHaveTwo) break
      if (batch.length < PAGE_ROWS) break
      offset += PAGE_ROWS
    }

    for (const id of chunk) {
      const arr = twoLatest.get(id)
      if (arr?.length >= 2) {
        const p = pct1d(arr[0].close, arr[1].close)
        if (p != null) {
          pctByCompany[id] = p
          hasByCompany[id] = true
        }
      }
    }
  }

  return { pctByCompany, hasByCompany }
}

async function fetchHorizonFromPriceData(supabaseClient, companyIds, tradingDayOffset) {
  const pctByCompany = Object.fromEntries(companyIds.map((id) => [id, null]))
  const hasByCompany = Object.fromEntries(companyIds.map((id) => [id, false]))
  const need = tradingDayOffset + 1

  for (let i = 0; i < companyIds.length; i += PARALLEL_PRICE_QUERIES) {
    const batch = companyIds.slice(i, i + PARALLEL_PRICE_QUERIES)
    const results = await Promise.all(
      batch.map((companyId) =>
        supabaseClient
          .from('price_data')
          .select('close, date')
          .eq('company_id', companyId)
          .order('date', { ascending: false })
          .limit(need),
      ),
    )
    for (let j = 0; j < batch.length; j++) {
      const rows = results[j]?.data || []
      const p = pctFromOffsetRows(rows, tradingDayOffset)
      if (p != null) {
        pctByCompany[batch[j]] = p
        hasByCompany[batch[j]] = true
      }
    }
  }

  return { pctByCompany, hasByCompany }
}

const DELIVERY_SIGNALS_SELECT =
  'company_id, price_change_7d, price_change_30d, price_change_90d, price_change_180d, price_change_365d, delivery_trend_7d, delivery_trend_30d, avg_delivery_30d, unusual_accumulation, date'

/**
 * Fire today + up to 6 prior days in parallel; use the most recent date with rows.
 */
async function fetchDeliverySignalsForHeatMap(supabaseClient) {
  const dates = []
  for (let i = 0; i <= 6; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }

  const results = await Promise.all(
    dates.map((dateStr) =>
      supabaseClient
        .from('delivery_signals')
        .select(DELIVERY_SIGNALS_SELECT)
        .eq('date', dateStr)
        .limit(12000)
        .then((res) => ({ dateStr, rows: res.data || [], error: res.error }))
    )
  )

  const best = results.find((r) => r.rows.length > 0)
  if (!best) {
    return { deliveryByCompany: {}, signalsDate: null, rowCount: 0 }
  }

  const deliveryByCompany = Object.fromEntries(best.rows.map((r) => [r.company_id, r]))
  return { deliveryByCompany, signalsDate: best.dateStr, rowCount: best.rows.length }
}

// Cache heatmap rows per timeframe — keyed by build ID so deploys auto-bust it.
const HM_CACHE_TTL = 15 * 60 * 1000
const hmCacheKey = (tf) =>
  `pinex_hm_${tf}_${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '0'}`

function getHmCached(tf) {
  try {
    const raw = localStorage.getItem(hmCacheKey(tf))
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > HM_CACHE_TTL) { localStorage.removeItem(hmCacheKey(tf)); return null }
    return data
  } catch { return null }
}

function setHmCache(tf, data) {
  try {
    localStorage.setItem(hmCacheKey(tf), JSON.stringify({ data, ts: Date.now() }))
  } catch {}
}

export default function HeatMap({ navigate }) {
  const wrapRef = useRef(null)
  const searchRef = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 520 })
  const [timeframe, setTimeframe] = useState('1M')
  const [colorMode, setColorMode] = useState('price')
  const TILE_LAYOUT = 'equal'
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [sectorFocus, setSectorFocus] = useState(null)
  const [minSectorStocks, setMinSectorStocks] = useState(false)
  const [tooltip, setTooltip] = useState(null)
  const [mobileTip, setMobileTip] = useState(null)
  const rafRef = useRef(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      rafRef.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const vw = Math.max(320, r.width)
        const mobile = vw < 768
        const nextH = mobile
          ? MOBILE_HMAP_H
          : Math.min(DESKTOP_HMAP_MAX, typeof window !== 'undefined' ? window.innerHeight * DESKTOP_HMAP_VH : DESKTOP_HMAP_MAX)
        setSize({ w: vw, h: nextH })
      })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseEnv) {
      queueMicrotask(() => {
        setLoading(false)
        setRows([])
      })
      return
    }
    let alive = true
    queueMicrotask(() => setLoading(true))

    async function load(background = false) {
      try {
        // Fire all three startup queries in parallel — saves ~2 serial round trips
        const [companiesRes, latestPriceRes, { deliveryByCompany }] = await Promise.all([
          supabase.from('companies').select('id,symbol,name,sector,exchange').limit(6000),
          supabase.from('price_data').select('company_id,close,stage,obv_trend,date').eq('is_latest', true).limit(8000),
          fetchDeliverySignalsForHeatMap(supabase),
        ])

        const companies = companiesRes.data || []
        const priceLatest = Object.fromEntries((latestPriceRes.data || []).map((r) => [r.company_id, r]))

        const tf = timeframe
        const allIds = companies.map((c) => c.id)
        let pctByCompany = {}
        let hasByCompany = {}

        const initAllUnknown = () => {
          const pc = {}
          const hb = {}
          for (const c of companies) {
            pc[c.id] = null
            hb[c.id] = false
          }
          return { pc, hb }
        }

        // Map each timeframe to its pre-computed delivery_signals column.
        // 1D has no pre-computed column so falls back to price_data.
        const TF_SIGNAL_FIELD = {
          '1W': 'price_change_7d',
          '1M': 'price_change_30d',
          '3M': 'price_change_90d',
          '6M': 'price_change_180d',
          '1Y': 'price_change_365d',
        }

        if (tf === '1D') {
          const z = initAllUnknown()
          pctByCompany = z.pc
          hasByCompany = z.hb
          const oneD = await fetch1DPriceChanges(supabase, allIds)
          Object.assign(pctByCompany, oneD.pctByCompany)
          Object.assign(hasByCompany, oneD.hasByCompany)
        } else if (TF_SIGNAL_FIELD[tf]) {
          const z = initAllUnknown()
          pctByCompany = z.pc
          hasByCompany = z.hb
          const field = TF_SIGNAL_FIELD[tf]
          let filledCount = 0
          for (const c of companies) {
            const s = deliveryByCompany[c.id]
            const v = Number(s?.[field])
            if (Number.isFinite(v)) {
              pctByCompany[c.id] = v
              hasByCompany[c.id] = true
              filledCount++
            }
          }
          // Pipeline gap or columns not yet migrated — fall back to price_data
          if (filledCount === 0) {
            const off = TF_TRADING_OFFSET[tf]
            const horizon = await fetchHorizonFromPriceData(supabase, allIds, off)
            Object.assign(pctByCompany, horizon.pctByCompany)
            Object.assign(hasByCompany, horizon.hasByCompany)
          }
        } else {
          const z = initAllUnknown()
          pctByCompany = z.pc
          hasByCompany = z.hb
        }

        const merged = companies.map((c) => {
          const p = priceLatest[c.id]
          const d = deliveryByCompany[c.id]
          const pct = pctByCompany[c.id] ?? null
          const hasData = Boolean(hasByCompany[c.id] && pct != null)
          const stageStep = parseStageStep(p?.stage)
          const deliveryTrend = parseTrend(d?.delivery_trend_30d)
          const obvTrend = parseTrend(p?.obv_trend)
          return {
            company_id: c.id,
            symbol: String(c.symbol || '').toUpperCase(),
            name: c.name || c.symbol || '—',
            sector: (c.sector && String(c.sector).trim()) || 'Other',
            exchange: String(c.exchange || 'NSE'),
            close: p?.close ?? null,
            stage: p?.stage ?? null,
            obv_trend: p?.obv_trend ?? null,
            avg_delivery_30d: d?.avg_delivery_30d != null ? Number(d.avg_delivery_30d) : null,
            delivery_trend_7d: d?.delivery_trend_7d ?? null,
            delivery_trend_30d: d?.delivery_trend_30d ?? null,
            unusual_accumulation: d?.unusual_accumulation ?? null,
            pct,
            hasData,
            stageStep,
            deliveryTrend,
            obvTrend,
          }
        })

        if (!alive) return
        setRows(merged)
        setHmCache(timeframe, merged)
        if (background) setLoading(false)
      } catch {
        if (alive) setRows([])
      } finally {
        if (alive) setLoading(false)
      }
    }

    const cached = getHmCached(timeframe)
    if (cached?.length) {
      setRows(cached)
      setLoading(false)
      void load(true) // silent background refresh
    } else {
      void load(false)
    }
    return () => {
      alive = false
    }
  }, [timeframe])

  const q = search.trim().toLowerCase()

  const sectorsData = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (!r.symbol) continue
      const sec = r.sector || 'Other'
      if (!map.has(sec)) map.set(sec, [])
      map.get(sec).push(r)
    }
    return [...map.entries()]
      .map(([name, stocks]) => ({ name, stocks }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const sectorTiles = useMemo(
    () =>
      sectorsData
        .map(({ name, stocks }) => {
          const agg = sectorAggregates(stocks, colorMode)
          return {
            name,
            stocks,
            stockCount: stocks.length,
            avgDisplay: agg.avgDisplay,
            sortValue: agg.avg ?? -9999,
            tileColor: sectorTileColor(stocks, colorMode),
          }
        })
        .filter((s) => !minSectorStocks || s.stockCount >= 10)
        .sort((a, b) => b.sortValue - a.sortValue),
    [sectorsData, colorMode, minSectorStocks],
  )

  const summary = useMemo(() => {
    if (colorMode === 'price') {
      let up = 0
      let down = 0
      let flat = 0
      const valid = []
      for (const r of rows) {
        const p = r.pct
        if (p == null || !Number.isFinite(p)) continue
        if (p > 0.5) up += 1
        else if (p < -0.5) down += 1
        else flat += 1
        valid.push(r)
      }
      const avg =
        valid.length ? valid.reduce((s, r) => s + r.pct, 0) / valid.length : null
      let best = null
      let worst = null
      for (const r of valid) {
        if (!best || r.pct > best.pct) best = r
        if (!worst || r.pct < worst.pct) worst = r
      }
      return { kind: 'price', up, down, flat, avg, best, worst, n: valid.length }
    }
    if (colorMode === 'stage') {
      const counts = { 1: 0, 1.5: 0, 2: 0, 3: 0, 4: 0, na: 0 }
      for (const r of rows) {
        if (r.stageStep == null) counts.na += 1
        else counts[r.stageStep] += 1
      }
      const withSt = rows.filter((r) => r.stageStep != null)
      const avg = withSt.length
        ? withSt.reduce((s, r) => s + r.stageStep, 0) / withSt.length
        : null
      let top = null
      for (const [k, v] of Object.entries(counts)) {
        if (k === 'na') continue
        if (!top || v > top.v) top = { k: Number(k), v }
      }
      return {
        kind: 'stage',
        counts,
        avg,
        topStage: top?.k ?? null,
        topCount: top?.v ?? 0,
        n: withSt.length,
      }
    }
    const key = colorMode === 'delivery' ? 'deliveryTrend' : 'obvTrend'
    let rising = 0
    let flat = 0
    let falling = 0
    let na = 0
    for (const r of rows) {
      const t = r[key]
      if (t === 'rising') rising += 1
      else if (t === 'flat') flat += 1
      else if (t === 'falling') falling += 1
      else na += 1
    }
    const denom = rising + flat + falling
    const mix = denom ? `${rising}↑ · ${flat}→ · ${falling}↓` : '—'
    return {
      kind: 'trend',
      rising,
      flat,
      falling,
      na,
      mix,
      label: colorMode === 'delivery' ? 'Delivery' : 'OBV',
      n: denom,
    }
  }, [rows, colorMode])

  const isMobile = size.w < 768
  const gridColumns = isMobile ? 2 : size.w >= 1280 ? 7 : size.w >= 1024 ? 6 : 5

  const matchSet = useMemo(() => {
    if (!q) return null
    const m = new Set()
    for (const r of rows) {
      if (`${r.symbol} ${r.name}`.toLowerCase().includes(q)) m.add(r.company_id)
    }
    return m
  }, [q, rows])

  const focusedStocks = useMemo(() => {
    if (!sectorFocus) return []
    const sector = sectorsData.find((s) => s.name === sectorFocus)
    if (!sector) return []
    let list = [...sector.stocks]
    list.sort((a, b) => stockSortValue(b, colorMode) - stockSortValue(a, colorMode))
    if (matchSet) list = list.filter((r) => matchSet.has(r.company_id))
    return list
  }, [sectorFocus, sectorsData, colorMode, matchSet])

  useEffect(() => {
    function onEsc(e) {
      if (e.key === 'Escape') {
        if (sectorFocus) {
          setSectorFocus(null)
          return
        }
        setSearch('')
        setMobileTip(null)
      }
    }
    function onDown(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearch((s) => (document.activeElement === searchRef.current ? s : s))
      }
      if (tooltip && !e.target.closest?.('[data-heatmap-ui]')) {
        setTooltip(null)
      }
    }
    document.addEventListener('keydown', onEsc)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.removeEventListener('mousedown', onDown)
    }
  }, [tooltip, sectorFocus])

  const goStock = useCallback(
    (sym) => {
      navigate(`/stock/${sym}`)
    },
    [navigate],
  )

  const onLeafMove = (evt) => {
    if (isMobile) return
    setTooltip((t) => {
      if (!t) return t
      const { x, y } = clampTooltipXY(evt.clientX, evt.clientY, HEATMAP_TIP_W, HEATMAP_TIP_H)
      return { ...t, x, y }
    })
  }

  const onLeafLeave = () => {
    if (!isMobile) setTooltip(null)
  }

  const onStockClick = (row, evt) => {
    evt.stopPropagation()
    if (isMobile) {
      setMobileTip({ ...row, sector: row.sectorName || row.sector })
      return
    }
    goStock(row.symbol)
  }

  const onStockEnter = (row, evt) => {
    if (isMobile) return
    const { x, y } = clampTooltipXY(evt.clientX, evt.clientY, HEATMAP_TIP_W, HEATMAP_TIP_H)
    setTooltip({ x, y, leaf: row })
  }

  return (
    <div data-heatmap-ui style={{ position: 'relative', width: '100%' }}>
      <style>{`
        @keyframes heatmapSh { 0%{opacity:.35} 50%{opacity:.9} 100%{opacity:.35} }
        .heatmap-shimmer { animation: heatmapSh 1.2s ease-in-out infinite; }
      `}</style>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          marginBottom: 12,
        }}
      >
        {TIMES.map((t) => {
          const on = timeframe === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTimeframe(t.id)}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '10px 18px',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                background: on ? BLUE : 'transparent',
                color: on ? BLUE_TEXT : MUTED,
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Color mode chips — always visible, no dropdown needed */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 12 }}>
        {Object.entries(COLOR_MODE_META).map(([id, meta]) => {
          const on = colorMode === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setColorMode(id)}
              style={{
                border: `1px solid ${on ? BLUE : BORDER}`,
                borderRadius: 999,
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: on ? 700 : 500,
                cursor: 'pointer',
                background: on ? 'rgba(56,189,248,0.12)' : CARD_BG,
                color: on ? BLUE : MUTED,
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {meta.short}
            </button>
          )
        })}
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          marginBottom: 10,
          width: '100%',
        }}
      >
        <div ref={searchRef} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={sectorFocus || ''}
            onChange={(e) => setSectorFocus(e.target.value || null)}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              background: CARD_BG,
              color: TEXT,
              minWidth: 140,
            }}
          >
            <option value="">All sectors</option>
            {sectorsData.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search symbol or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: 180,
              maxWidth: '42vw',
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              background: CARD_BG,
              color: TEXT,
            }}
          />
        </div>
      </div>

      {sectorFocus ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setSectorFocus(null)}
            style={{
              border: 'none',
              background: 'transparent',
              color: BLUE,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ← All sectors
          </button>
          <span style={{ fontWeight: 700, color: TEXT }}>{sectorFocus}</span>
          <span style={{ color: MUTED, fontSize: 12 }}>{focusedStocks.length} stocks</span>
        </div>
      ) : (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            fontSize: 12,
            color: MUTED,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={minSectorStocks}
            onChange={(e) => setMinSectorStocks(e.target.checked)}
          />
          Only show sectors with 10+ stocks
        </label>
      )}

      <div
        style={{
          fontSize: 12,
          color: MUTED,
          marginBottom: 10,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 16px',
          alignItems: 'center',
        }}
      >
        {summary.kind === 'price' ? (
          <>
            <span>
              {summary.up} stocks up, {summary.down} stocks down, {summary.flat} flat
            </span>
            <span>Avg change: {summary.avg != null ? fmtSignedPct(summary.avg) : '—'}</span>
            <span>
              Best:{' '}
              {summary.best ? (
                <strong style={{ color: TEXT }}>
                  {summary.best.symbol} {fmtSignedPct(summary.best.pct)}
                </strong>
              ) : (
                '—'
              )}
            </span>
            <span>
              Worst:{' '}
              {summary.worst ? (
                <strong style={{ color: TEXT }}>
                  {summary.worst.symbol} {fmtSignedPct(summary.worst.pct)}
                </strong>
              ) : (
                '—'
              )}
            </span>
          </>
        ) : null}
        {summary.kind === 'stage' ? (
          <>
            <span>
              S1 {summary.counts[1]} · S2 {summary.counts[2]} · S3 {summary.counts[3]} · S4 {summary.counts[4]}
              {summary.counts.na ? ` · ? ${summary.counts.na}` : ''}
            </span>
            <span>Avg stage: {summary.avg != null ? summary.avg.toFixed(2) : '—'}</span>
            <span>
              Most:{' '}
              {summary.topStage != null ? (
                <strong style={{ color: TEXT }}>
                  Stage {summary.topStage} ({summary.topCount} stocks)
                </strong>
              ) : (
                '—'
              )}
            </span>
          </>
        ) : null}
        {summary.kind === 'trend' ? (
          <>
            <span>
              🟢 {summary.rising} rising · ⬜ {summary.flat} flat · 🔴 {summary.falling} falling
              {summary.na ? ` · ? ${summary.na}` : ''}
            </span>
            <span>
              Mix: <strong style={{ color: TEXT }}>{summary.mix}</strong> ({summary.label}, 30d)
            </span>
          </>
        ) : null}
      </div>

      <div ref={wrapRef} style={{ position: 'relative', width: '100%', minHeight: 400 }}>
        {loading ? (
          <div
            className="heatmap-shimmer"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#0a0f18',
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              color: MUTED,
              fontSize: 14,
            }}
          >
            Loading market data
            {timeframe === '1D' || timeframe === '3M' || timeframe === '6M' || timeframe === '1Y'
              ? ' & calculating price change…'
              : '…'}
          </div>
        ) : null}

        {!loading && !sectorFocus ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gap: 4,
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: '#0f1728',
              padding: 4,
            }}
          >
            {sectorTiles.map((sector) => (
              <button
                key={sector.name}
                type="button"
                onClick={() => setSectorFocus(sector.name)}
                style={{
                  minHeight: 76,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 4,
                  background: sector.tileColor,
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 8px',
                  textAlign: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.25,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {sector.name}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{sector.avgDisplay}</span>
              </button>
            ))}
          </div>
        ) : null}

        {!loading && sectorFocus ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gap: 4,
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: '#0f1728',
              padding: 4,
            }}
          >
            {focusedStocks.map((row) => {
              const dim = matchSet && !matchSet.has(row.company_id) ? 0.25 : 1
              const hilite = matchSet && matchSet.has(row.company_id)
              return (
                <button
                  key={row.company_id}
                  type="button"
                  onClick={(e) => onStockClick(row, e)}
                  onMouseEnter={(e) => onStockEnter(row, e)}
                  onMouseMove={onLeafMove}
                  onMouseLeave={onLeafLeave}
                  style={{
                    minHeight: 76,
                    border: `1px solid ${hilite ? '#38BDF8' : BORDER}`,
                    borderRadius: 4,
                    background: tileFill(row, colorMode),
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    padding: '10px 8px',
                    textAlign: 'center',
                    opacity: dim,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.15 }}>{row.symbol}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      lineHeight: 1.15,
                      color: 'rgba(255,255,255,0.82)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {row.name || '—'}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{stockMetricLabel(row, colorMode)}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {!loading && !sectorFocus && !sectorTiles.length ? (
          <p style={{ color: MUTED, padding: 24, textAlign: 'center' }}>No sector data.</p>
        ) : null}

        {!loading && sectorFocus && !focusedStocks.length ? (
          <p style={{ color: MUTED, padding: 24, textAlign: 'center' }}>No stocks match this view.</p>
        ) : null}
      </div>

      {/* Tooltip — desktop */}
      {tooltip && !isMobile ? (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 50,
            width: HEATMAP_TIP_W,
            maxWidth: 'min(100vw - 24px, 300px)',
            padding: 12,
            borderRadius: 8,
            background: '#0b1222',
            border: `1px solid ${BORDER}`,
            color: TEXT,
            fontSize: 12,
            pointerEvents: 'none',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{tooltip.leaf.name}</div>
          <div style={{ color: MUTED, marginTop: 4, fontSize: 12 }}>
            {tooltip.leaf.symbol} · {tooltip.leaf.sectorName || tooltip.leaf.sector || '—'}
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Price change ({timeframe})
            </div>
            <div
              className="font-data"
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: !isBlankPriceChange(tooltip.leaf) ? getColor(tooltip.leaf.pct) : MUTED,
                marginTop: 4,
              }}
            >
              {!isBlankPriceChange(tooltip.leaf) ? fmtSignedPct(tooltip.leaf.pct) : '—'}
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stage</span>
            <StagePill stage={tooltip.leaf.stage} className="text-[10px]" />
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
            Delivery (30d avg):{' '}
            <span style={{ color: TEXT, fontWeight: 600 }}>
              {tooltip.leaf.avg_delivery_30d != null && Number.isFinite(tooltip.leaf.avg_delivery_30d)
                ? `${tooltip.leaf.avg_delivery_30d.toFixed(1)}%`
                : '—'}
            </span>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>Click to view analysis</div>
        </div>
      ) : null}

      {/* Mobile tap tooltip */}
      {isMobile && mobileTip ? (
        <div
          data-heatmap-ui
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 45,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => {
            setMobileTip(null)
          }}
        >
          <div
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 320,
              padding: 14,
              borderRadius: 8,
              background: '#0b1222',
              border: `1px solid ${BORDER}`,
              color: TEXT,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 700 }}>{mobileTip.name}</div>
            <div style={{ color: MUTED, marginTop: 4, fontSize: 12 }}>
              {mobileTip.symbol} · {mobileTip.sector || '—'}
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Price change ({timeframe})
              </div>
              <div
                className="font-data"
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: !isBlankPriceChange(mobileTip) ? getColor(mobileTip.pct) : MUTED,
                  marginTop: 4,
                }}
              >
                {!isBlankPriceChange(mobileTip) ? fmtSignedPct(mobileTip.pct) : '—'}
              </div>
            </div>

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Stage
              </span>
              <StagePill stage={mobileTip.stage} className="text-[10px]" />
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: MUTED }}>
              Delivery (30d avg):{' '}
              <span style={{ color: TEXT, fontWeight: 600 }}>
                {mobileTip.avg_delivery_30d != null && Number.isFinite(mobileTip.avg_delivery_30d)
                  ? `${mobileTip.avg_delivery_30d.toFixed(1)}%`
                  : '—'}
              </span>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>Tap outside to close</div>
            <button
              type="button"
              onClick={() => goStock(mobileTip.symbol)}
              style={{
                marginTop: 12,
                width: '100%',
                padding: 10,
                borderRadius: 8,
                border: 'none',
                background: BLUE,
                color: BLUE_TEXT,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Open full analysis
            </button>
          </div>
        </div>
      ) : null}

      {/* Legend */}
      <div
        style={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          zIndex: 40,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(8,12,20,0.95)',
          border: `1px solid ${BORDER}`,
          fontSize: 10,
          color: MUTED,
          pointerEvents: 'none',
          maxWidth: colorMode === 'stage' ? 260 : 220,
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 700, color: TEXT, marginBottom: 6 }}>
          {COLOR_MODE_META[colorMode].label}
        </div>
        {colorMode === 'price' ? (
          <>
            <div
              style={{
                height: 10,
                borderRadius: 4,
                background:
                  'linear-gradient(90deg,#991B1B 0%, #EF4444 18%, #FCA5A5 32%, #334155 48%, #86EFAC 62%, #22C55E 78%, #16A34A 100%)',
                marginBottom: 6,
                transition: 'background 0.4s ease',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>&lt; -5%</span>
              <span>-2%</span>
              <span>0%</span>
              <span>+2%</span>
              <span>&gt; +5%</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 9, opacity: 0.85 }}>
              🔴 strong down → flat → strong up 🟢
            </div>
          </>
        ) : null}
        {colorMode === 'stage' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 9 }}>
            {['Stage 1', 'Stage 1+', 'Stage 2', 'Stage 3', 'Stage 4'].map((k) => {
              const meta = stageBadge(k)
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{ width: 14, height: 10, borderRadius: 2, background: meta.color, flexShrink: 0 }}
                  />
                  <span>{meta.label}</span>
                </div>
              )
            })}
          </div>
        ) : null}
        {(colorMode === 'delivery' || colorMode === 'obv') ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 9 }}>
            {[
              { lab: 'Rising', c: '#16A34A' },
              { lab: 'Flat', c: 'var(--text-hint)' },
              { lab: 'Falling', c: '#991B1B' },
            ].map((x) => (
              <div key={x.lab} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 22, height: 10, borderRadius: 2, background: x.c }} />
                <span>{x.lab}</span>
              </div>
            ))}
            <span style={{ opacity: 0.75 }}>
              {colorMode === 'delivery' ? 'From delivery_signals (30d trend)' : 'From price_data OBV trend'}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
