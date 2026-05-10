import { hierarchy as d3Hierarchy, treemap as d3Treemap, treemapSquarify } from 'd3-hierarchy'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { stageAccentColor, stageBadge } from '../lib/stageUi'
import StagePill from './StagePill'

const BORDER = '#1E293B'
const MUTED = '#64748B'
const TEXT = '#F1F5F9'
const BLUE = '#38BDF8'
const BLUE_TEXT = '#080C14'
const CARD_BG = '#0D1525'
const NO_PRICE_TILE = '#1E293B'

const SECTOR_LABEL_PAD = 22
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

/** Price % change → tile color (flat “neutral” band uses mid grey, not NO_PRICE_TILE). */
function getColor(pctChange) {
  if (pctChange === null || pctChange === undefined || !Number.isFinite(Number(pctChange))) return NO_PRICE_TILE
  const p = Number(pctChange)
  if (p > 5) return '#16A34A'
  if (p > 2) return '#22C55E'
  if (p > 0.5) return '#86EFAC'
  if (p > -0.5) return '#334155'
  if (p > -2) return '#FCA5A5'
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
  obv: { label: 'OBV signal', short: 'OBV' },
}

function tileFill(row, mode) {
  switch (mode) {
    case 'price':
      return isBlankPriceChange(row) ? NO_PRICE_TILE : getColor(row.pct)
    case 'stage': {
      const raw = row.stage
      return raw != null && String(raw).trim() !== '' ? stageAccentColor(raw) : '#334155'
    }
    case 'delivery': {
      const t = row.deliveryTrend
      if (t === 'rising') return '#16A34A'
      if (t === 'falling') return '#991B1B'
      if (t === 'flat') return '#475569'
      return '#334155'
    }
    case 'obv': {
      const t = row.obvTrend
      if (t === 'rising') return '#16A34A'
      if (t === 'falling') return '#991B1B'
      if (t === 'flat') return '#475569'
      return '#334155'
    }
    default:
      return '#334155'
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
      avg >= 2.25 ? '#22C55E' : avg >= 1.75 ? '#FBBF24' : avg >= 1.35 ? '#0D9488' : '#FB923C'
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

/** Trading rows newest-first; need at least idx+1 rows; compare [0] vs [idx] — same as “idx trading days ago”. */
function pctFromOffsetRows(rowsNewestFirst, idx) {
  if (!rowsNewestFirst?.length || idx < 1) return null
  if (rowsNewestFirst.length <= idx) return null
  return pct1d(rowsNewestFirst[0].close, rowsNewestFirst[idx].close)
}

const IN_CHUNK = 300
const PAGE_ROWS = 5000
/** ~3M / 6M / 1Y trading sessions */
const TF_TRADING_OFFSET = { '3M': 63, '6M': 126, '1Y': 252 }
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
  'company_id, price_change_7d, price_change_30d, delivery_trend_7d, delivery_trend_30d, avg_delivery_30d, unusual_accumulation, date'

/**
 * Prefer today’s batch; if empty, use yesterday. Logs row count for debugging.
 */
async function fetchDeliverySignalsForHeatMap(supabaseClient) {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  const resToday = await supabaseClient
    .from('delivery_signals')
    .select(DELIVERY_SIGNALS_SELECT)
    .eq('date', today)
    .limit(12000)

  let rows = resToday.data || []
  let usedDate = today
  if (resToday.error) {
    console.warn('[HeatMap] delivery_signals today error:', resToday.error.message)
  }

  if (!rows.length) {
    const resY = await supabaseClient
      .from('delivery_signals')
      .select(DELIVERY_SIGNALS_SELECT)
      .eq('date', yesterdayStr)
      .limit(12000)
    rows = resY.data || []
    usedDate = yesterdayStr
    if (resY.error) {
      console.warn('[HeatMap] delivery_signals yesterday error:', resY.error.message)
    }
  }

  console.log(
    `[HeatMap] delivery_signals fetched ${rows.length} rows (using date=${usedDate}; tried today=${today}, fallback=${yesterdayStr})`,
  )

  const deliveryByCompany = Object.fromEntries((rows || []).map((r) => [r.company_id, r]))
  return { deliveryByCompany, signalsDate: usedDate, rowCount: rows.length }
}

export default function HeatMap({ navigate }) {
  const wrapRef = useRef(null)
  const searchRef = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 520 })
  const [timeframe, setTimeframe] = useState('1D')
  const [colorMode, setColorMode] = useState('price')
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const colorMenuRef = useRef(null)
  const TILE_LAYOUT = 'equal'
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [sectorFocus, setSectorFocus] = useState(null)
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
      setLoading(false)
      setRows([])
      return
    }
    let alive = true
    setLoading(true)

    async function load() {
      try {
        const companiesRes = await supabase.from('companies').select('id,symbol,name,sector,exchange').limit(6000)
        const companies = companiesRes.data || []

        const latestPriceRes = await supabase
          .from('price_data')
          .select('company_id,close,stage,obv_trend,date')
          .eq('is_latest', true)
          .limit(8000)

        const priceLatest = Object.fromEntries((latestPriceRes.data || []).map((r) => [r.company_id, r]))

        const { deliveryByCompany } = await fetchDeliverySignalsForHeatMap(supabase)

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

        if (tf === '1W' || tf === '1M') {
          const z = initAllUnknown()
          pctByCompany = z.pc
          hasByCompany = z.hb
          const field = tf === '1W' ? 'price_change_7d' : 'price_change_30d'
          for (const c of companies) {
            const s = deliveryByCompany[c.id]
            const raw = s?.[field]
            const v = Number(raw)
            if (Number.isFinite(v)) {
              pctByCompany[c.id] = v
              hasByCompany[c.id] = true
            }
          }
        } else if (tf === '1D') {
          const z = initAllUnknown()
          pctByCompany = z.pc
          hasByCompany = z.hb
          const oneD = await fetch1DPriceChanges(supabase, allIds)
          Object.assign(pctByCompany, oneD.pctByCompany)
          Object.assign(hasByCompany, oneD.hasByCompany)
        } else if (tf === '3M' || tf === '6M' || tf === '1Y') {
          const z = initAllUnknown()
          pctByCompany = z.pc
          hasByCompany = z.hb
          const off = TF_TRADING_OFFSET[tf]
          const horizon = await fetchHorizonFromPriceData(supabase, allIds, off)
          Object.assign(pctByCompany, horizon.pctByCompany)
          Object.assign(hasByCompany, horizon.hasByCompany)
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
      } catch {
        if (alive) setRows([])
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()
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

  const visibleSectors = useMemo(() => {
    if (!sectorFocus) return sectorsData
    return sectorsData.filter((s) => s.name === sectorFocus)
  }, [sectorsData, sectorFocus])

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

  const layout = useMemo(() => {
    const W = size.w
    const H = size.h
    if (!visibleSectors.length || W < 40 || H < 40)
      return { leaves: [], sectors: [], links: [], mobileBlocks: [] }

    const runSectorTreemap = (sectorName, stocks, sw, sh) => {
      if (!stocks.length) return { leaves: [] }
      const root = d3Hierarchy({
        name: sectorName,
        children: stocks.map((s) => ({ ...s, value: 1 })),
      })
        .sum((d) => (d.children ? 0 : d.value))
        .sort((a, b) => (b.value || 0) - (a.value || 0))

      d3Treemap()
        .tile(treemapSquarify)
        .size([sw, sh])
        .paddingOuter(4)
        .paddingInner(2)
        .paddingTop((d) => (d.depth === 0 ? SECTOR_LABEL_PAD : 0))
        .round(true)(root)

      const leaves = []
      root.leaves().forEach((leaf) => {
        const d = leaf.data
        leaves.push({
          ...d,
          x0: leaf.x0,
          y0: leaf.y0,
          x1: leaf.x1,
          y1: leaf.y1,
          sectorName,
        })
      })
      return { leaves }
    }

    if (isMobile) {
      const gap = 6
      const colW = (W - gap) / 2
      const tw = Math.max(80, colW - 4)
      const blocks = []
      for (let i = 0; i < visibleSectors.length; i++) {
        const s = visibleSectors[i]
        const { leaves } = runSectorTreemap(s.name, s.stocks, tw, MOBILE_HMAP_H)
        const agg = sectorAggregates(s.stocks, colorMode)
        blocks.push({
          sectorName: s.name,
          stocks: s.stocks,
          leaves,
          w: colW,
          h: MOBILE_HMAP_H,
          tw,
          th: MOBILE_HMAP_H,
          avgDisplay: agg.avgDisplay,
        })
      }
      return { leaves: blocks.flatMap((b) => b.leaves), sectors: [], mobileBlocks: blocks, links: [] }
    }

    const data = {
      name: 'root',
      children: visibleSectors.map((s) => ({
        name: s.name,
        children: s.stocks.map((st) => ({ ...st, value: 1 })),
      })),
    }

    const root = d3Hierarchy(data)
      .sum((d) => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    d3Treemap()
      .tile(treemapSquarify)
      .size([W, H])
      .paddingOuter(4)
      .paddingInner(2)
      .paddingTop((d) => (d.depth === 1 ? SECTOR_LABEL_PAD : 0))
      .round(true)(root)

    const leavesRaw = []
    const sectorRects = []
    for (const n of root.descendants()) {
      if (n.depth === 1) {
        const stocks = n.data.children || []
        const agg = sectorAggregates(stocks, colorMode)
        sectorRects.push({
          name: n.data.name,
          x0: n.x0,
          y0: n.y0,
          x1: n.x1,
          y1: n.y1,
          avgDisplay: agg.avgDisplay,
        })
      }
      if (!n.children && n.depth === 2) {
        const d = n.data
        leavesRaw.push({
          ...d,
          x0: n.x0,
          y0: n.y0,
          x1: n.x1,
          y1: n.y1,
          sectorName: n.parent?.data?.name,
        })
      }
    }

    return { leaves: leavesRaw, sectors: sectorRects, links: [], mobileBlocks: [] }
  }, [visibleSectors, size.w, size.h, isMobile, colorMode])

  const matchSet = useMemo(() => {
    if (!q) return null
    const m = new Set()
    for (const r of rows) {
      if (`${r.symbol} ${r.name}`.toLowerCase().includes(q)) m.add(r.company_id)
    }
    return m
  }, [q, rows])

  useEffect(() => {
    function onEsc(e) {
      if (e.key === 'Escape') {
        setSearch('')
        setMobileTip(null)
        setColorMenuOpen(false)
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
  }, [tooltip])

  useEffect(() => {
    if (!colorMenuOpen) return
    function onDocDown(e) {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target)) setColorMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [colorMenuOpen])

  const goStock = useCallback(
    (sym) => {
      navigate(`/stock/${sym}`)
    },
    [navigate],
  )

  const onLeafEnter = (leaf, evt) => {
    if (isMobile) return
    const { x, y } = clampTooltipXY(evt.clientX, evt.clientY, HEATMAP_TIP_W, HEATMAP_TIP_H)
    setTooltip({ x, y, leaf })
  }

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

  const onLeafClick = (leaf, evt) => {
    evt.stopPropagation()
    if (isMobile) {
      setMobileTip({ ...leaf, sector: leaf.sectorName || leaf.sector })
      return
    }
    goStock(leaf.symbol)
  }

  const renderTile = (leaf, keyPrefix) => {
    const rawW = leaf.x1 - leaf.x0
    const rawH = leaf.y1 - leaf.y0
    const dim = matchSet && !matchSet.has(leaf.company_id) ? 0.2 : 1
    const hilite = matchSet && matchSet.has(leaf.company_id)
    const baseHex = tileFill(leaf, colorMode)
    const gradId = `hg-${keyPrefix}-${leaf.company_id}`
    const priceLine = !isBlankPriceChange(leaf) ? fmtSignedPct(leaf.pct) : '—'

    const tierFull = rawW >= 110 && rawH >= 65
    const tierSymPct = rawW >= 80 && rawH >= 50
    const tierSymOnly = rawW >= 50 && rawH >= 35
    const fsSymSmall = Math.min(12, rawW / 5)

    const txt = {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '100%',
      pointerEvents: 'none',
    }

    let tileBody = null
    if (tierFull) {
      tileBody = (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '4px',
            boxSizing: 'border-box',
            height: '100%',
            justifyContent: 'flex-start',
          }}
        >
          <div style={{ ...txt, fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>{leaf.symbol}</div>
          <div style={{ ...txt, fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.7)', lineHeight: 1.15 }}>
            {leaf.name || '—'}
          </div>
          <div
            style={{
              ...txt,
              marginTop: 'auto',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1.15,
            }}
          >
            {priceLine}
          </div>
        </div>
      )
    } else if (tierSymPct) {
      tileBody = (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '4px',
            boxSizing: 'border-box',
            height: '100%',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ ...txt, fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>{leaf.symbol}</div>
          <div style={{ ...txt, fontSize: 10, fontWeight: 500, color: '#fff', lineHeight: 1.15 }}>{priceLine}</div>
        </div>
      )
    } else if (tierSymOnly) {
      tileBody = (
        <div
          style={{
            padding: '4px',
            boxSizing: 'border-box',
            height: '100%',
            display: 'flex',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ ...txt, fontSize: fsSymSmall, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>{leaf.symbol}</div>
        </div>
      )
    }

    return (
      <g
        key={`${keyPrefix}-${leaf.company_id}`}
        transform={`translate(${leaf.x0},${leaf.y0})`}
        style={{ cursor: 'pointer', opacity: dim }}
        onMouseEnter={(e) => onLeafEnter(leaf, e)}
        onMouseMove={onLeafMove}
        onMouseLeave={onLeafLeave}
        onClick={(e) => onLeafClick(leaf, e)}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={`${baseHex}CC`} />
            <stop offset="100%" stopColor={`${baseHex}88`} />
          </linearGradient>
        </defs>
        <rect
          width={rawW}
          height={rawH}
          fill={`url(#${gradId})`}
          stroke={hilite ? '#38BDF8' : BORDER}
          strokeWidth={hilite ? 2 : 1}
          style={{ transition: 'opacity 0.2s ease' }}
        />
        {tileBody ? (
          <foreignObject width={rawW} height={rawH} style={{ pointerEvents: 'none', overflow: 'hidden' }}>
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            >
              {tileBody}
            </div>
          </foreignObject>
        ) : null}
      </g>
    )
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

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={TILE_LAYOUT !== 'equal'}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: CARD_BG,
              color: TEXT,
              opacity: TILE_LAYOUT === 'equal' ? 1 : 0.5,
            }}
          >
            Equal size
          </button>
          <button
            type="button"
            disabled
            title="Coming soon"
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: '#0a0f18',
              color: MUTED,
              cursor: 'not-allowed',
            }}
          >
            By market cap — soon
          </button>
        </div>

        <div ref={searchRef} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          <div ref={colorMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setColorMenuOpen((o) => !o)}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: CARD_BG,
                color: TEXT,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              <span aria-hidden>🎨</span>
              <span style={{ color: MUTED, fontWeight: 500 }}>Color:</span>
              <span>{COLOR_MODE_META[colorMode].short}</span>
              <span style={{ color: MUTED, fontSize: 10 }}>▾</span>
            </button>
            {colorMenuOpen ? (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 6,
                  minWidth: 240,
                  padding: 6,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  background: '#0a0f18',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                  zIndex: 60,
                }}
              >
                {(['price', 'stage', 'delivery', 'obv']).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setColorMode(id)
                      setColorMenuOpen(false)
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderRadius: 6,
                      padding: '8px 10px',
                      marginBottom: 2,
                      fontSize: 13,
                      fontWeight: colorMode === id ? 700 : 500,
                      color: colorMode === id ? BLUE : TEXT,
                      background: colorMode === id ? 'rgba(56,189,248,0.12)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {colorMode === id ? '✓ ' : ''}
                    {COLOR_MODE_META[id].label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
        <button
          type="button"
          onClick={() => setSectorFocus(null)}
          style={{
            border: 'none',
            background: 'transparent',
            color: BLUE,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 8,
            cursor: 'pointer',
          }}
        >
          ← All sectors
        </button>
      ) : null}

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

        {!loading && isMobile && layout.mobileBlocks?.length ? (
          <div style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(160px, 1fr))',
                gap: 8,
                alignItems: 'start',
                minWidth: 360,
              }}
            >
              {layout.mobileBlocks.map((block) => (
                <div
                  key={block.sectorName}
                  style={{
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    background: '#0f1728',
                    overflow: 'hidden',
                    minHeight: MOBILE_HMAP_H,
                  }}
                >
                  <svg
                    width="100%"
                    height={MOBILE_HMAP_H}
                    viewBox={`0 0 ${block.tw} ${block.th}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ display: 'block' }}
                  >
                    <text
                      x={6}
                      y={14}
                      fill="#64748B"
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '1.5px',
                      }}
                    >
                      {`${String(block.sectorName || '').toUpperCase()} ${block.avgDisplay}`}
                    </text>
                    <g>{block.leaves.map((leaf) => renderTile(leaf, 'm'))}</g>
                  </svg>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && !isMobile ? (
          <svg width="100%" height={size.h} style={{ display: 'block', borderRadius: 12, border: `1px solid ${BORDER}` }}>
            <rect width="100%" height="100%" fill="#0f1728" rx={12} />
            {layout.sectors.map((s) => (
              <g key={s.name}>
                <rect
                  x={s.x0}
                  y={s.y0}
                  width={s.x1 - s.x0}
                  height={s.y1 - s.y0}
                  fill="rgba(255,255,255,0.02)"
                  stroke="none"
                  rx={2}
                />
                <text
                  x={s.x0 + 6}
                  y={s.y0 + 14}
                  fill="#64748B"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '1.5px',
                  }}
                >
                  {`${String(s.name || '').toUpperCase()} ${s.avgDisplay}`}
                </text>
              </g>
            ))}
            {layout.leaves.map((leaf) => renderTile(leaf, 'd'))}
          </svg>
        ) : null}

        {!loading && isMobile && !layout.mobileBlocks?.length ? (
          <p style={{ color: MUTED, padding: 24, textAlign: 'center' }}>No sector data.</p>
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

          <div style={{ marginTop: 12, fontSize: 11, color: '#64748B' }}>Click to view analysis</div>
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
              { lab: 'Flat', c: '#475569' },
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
