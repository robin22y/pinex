import { useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { readLocal, writeLocal } from '../lib/localStore'
import { useAuth } from '../context'
import { C } from '../styles/tokens'
import ProBadge from '../components/ProBadge'
import InfoSheet from '../components/InfoSheet'
import ExportMenu from '../components/ExportMenu'
import { fetchPhaseHistory, sessionsInCurrentPhase, formatPhaseAge } from '../lib/phaseHelpers'

// ── The Lab ──────────────────────────────────────────────────────────────────
// A user-EXECUTED screener. Results NEVER auto-populate — the user picks a
// template, reviews the mathematical criteria, and clicks "Run My Screen".
// This is the core legal posture: PineX outputs the result of the user's own
// query against pre-calculated EOD data; it does not suggest stocks.
//
// Data: mv_home_stocks (price/RS/volume/obv) merged with swing_conditions
// (the 5 SwingX condition booleans + conditions_met) for the latest trading day.

// Optional gates shared by the per-stage screens — all OFF by default so the
// base list (every Stage-N stock) shows until the user opts into a narrowing
// filter. Reuses the same criterion ids/tests as SwingX.
const STAGE_GATES = [
  {
    id: 'swingx_volume_2x', name: 'Volume ≥ multiplier × recent average',
    formula: 'Today volume ÷ 30-day average volume ≥ multiplier',
    col: null, defaultOn: false, adjustable: true,
    param: { label: 'Min volume multiplier', value: 2.0, min: 1.5, max: 5.0, step: 0.5 },
    why: 'Above-average volume is observed as heavier participation behind the move.',
    notMean: 'Volume alone does not confirm direction. It is a data point only.',
  },
  {
    id: 'swingx_rs_positive', name: 'RS vs Nifty above threshold',
    formula: 'RS vs Nifty (119D) > min %',
    col: null, defaultOn: false, adjustable: true,
    param: { label: 'Minimum RS %', value: 0, min: -50, max: 50, step: 5 },
    why: 'Relative strength compares the stock’s return to the index over ~6 months.',
    notMean: 'Past relative strength does not guarantee future outperformance.',
  },
  {
    id: 'swingx_strong_sector', name: 'From a strong sector',
    formula: 'Sector breadth > min % (sector stocks above their 30W MA)',
    col: null, defaultOn: false, adjustable: true,
    param: { label: 'Min sector breadth %', value: 50, min: 30, max: 70, step: 5 },
    why: 'Sector breadth measures how many of the sector’s stocks are above their own 30W average.',
    notMean: 'A strong sector does not guarantee individual stock performance.',
  },
]

const TEMPLATES = [
  {
    id: 'trend-convergence', name: 'Trend Convergence', icon: '🔵', badge: null,
    tagline: 'Price, trend line, RS and OBV all pointing up',
    criteria: [
      { id: 'above_tl', name: 'Price above 30W Trend Line', formula: 'Close > MA(30W)', col: null, defaultOn: true, why: 'Price trading above its long-term average is the baseline of an established uptrend.' },
      { id: 'tl_rising', name: '30W Trend Line slope rising', formula: 'MA(30W) today > MA(30W) 4 weeks ago', col: null, defaultOn: true, why: 'A rising average shows the longer trend is still strengthening.' },
      { id: 'rs_positive', name: 'RS vs Nifty positive', formula: 'Stock return − Nifty return (119D) > 0', col: null, defaultOn: true, adjustable: true, param: { label: 'Min RS %', value: 0, min: -20, max: 50 }, why: 'Relative strength shows the stock is outperforming the index.' },
      { id: 'obv_rising', name: 'OBV slope rising', formula: 'OBV 10-day regression slope > 0', col: null, defaultOn: true, why: 'On-balance volume rising suggests accumulation under the price.' },
      { id: 'volume_above', name: 'Volume above 30D average', formula: 'Volume ratio > 1.0', col: null, defaultOn: false, why: 'Above-average volume shows participation behind the move.' },
      { id: 'near_tl', name: 'Extension < 15% from trend line', formula: '((Close − MA30W) / MA30W) × 100 < 15', col: null, defaultOn: false, adjustable: true, param: { label: 'Max extension %', value: 15, min: 5, max: 40 }, why: 'A smaller extension means price has not run too far from its average.' },
    ],
  },
  {
    id: 'base-formation', name: 'Base Formation', icon: '🟡', badge: null,
    tagline: 'Price stabilising after a decline on quiet volume',
    criteria: [
      { id: 'price_near_tl', name: 'Price near 30W Trend Line', formula: 'abs(Close − MA30W) / MA30W < 0.05', col: null, defaultOn: true, why: 'Price hugging its average is typical of a base.' },
      { id: 'tl_flat', name: 'Trend Line slope flat (Stage 1)', formula: 'MA(30W) slope ≈ 0', col: null, defaultOn: true, why: 'A flat average shows the prior decline has paused.' },
      { id: 'volume_low', name: 'Volume contracting', formula: 'Avg(Vol,3D) < Avg(Vol,30D) × 0.75', col: null, defaultOn: true, why: 'Drying-up volume often precedes a new move.' },
      { id: 'rsi_neutral', name: 'RSI in neutral range', formula: '40 ≤ RSI(14) ≤ 65', col: null, defaultOn: true, why: 'A neutral RSI is neither overbought nor oversold.' },
    ],
  },
  {
    id: 'trend-deterioration', name: 'Trend Deterioration', icon: '🔴', badge: null,
    tagline: 'Price below trend line with negative RS',
    criteria: [
      { id: 'below_tl', name: 'Price below 30W Trend Line', formula: 'Close < MA(30W)', col: null, defaultOn: true, why: 'Price below its average is the baseline of a downtrend.' },
      { id: 'rs_negative', name: 'RS vs Nifty negative', formula: 'Stock return − Nifty return (119D) < 0', col: null, defaultOn: true, why: 'Negative RS shows the stock is lagging the index.' },
      { id: 'tl_falling', name: 'Trend Line falling / breakdown', formula: 'MA(30W) today < MA(30W) 4 weeks ago', col: null, defaultOn: true, why: 'A falling average confirms the longer trend is weakening.' },
    ],
  },
  {
    id: 'swingx', name: 'SwingX Template', icon: '⚡', badge: 'PRO',
    tagline: 'The SwingX logic, recreated as transparent filters',
    criteria: [
      {
        id: 'swingx_crossed_30w', name: 'Price in advancing trend',
        formula: 'Stage 2 — close above a rising 30W MA',
        col: null, defaultOn: true, base: true,
        why: 'Price above a rising 30W trend line is the baseline condition cycle analysts look for in an advancing stock. This defines the SwingX universe — with every gate off, the table is simply all Stage 2 stocks.',
        notMean: 'This does not predict the stock will continue rising. It is a mathematical observation only.',
      },
      {
        id: 'swingx_volume_2x', name: 'Volume ≥ multiplier × recent average',
        formula: 'Today volume ÷ 30-day average volume ≥ multiplier',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min volume multiplier', value: 2.0, min: 1.5, max: 5.0, step: 0.5 },
        why: 'High volume during a price transition is observed as participation confirmation.',
        notMean: 'Volume alone does not confirm direction. It is a data point only.',
      },
      {
        id: 'swingx_rs_positive', name: 'RS vs Nifty above threshold',
        formula: 'RS vs Nifty (119D) > min %',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Minimum RS %', value: 0, min: -20, max: 50, step: 5 },
        why: 'Positive relative strength means the stock is outperforming the broader market index.',
        notMean: 'Outperformance in the past does not guarantee future outperformance.',
      },
      {
        id: 'swingx_strong_sector', name: 'From a strong sector',
        formula: 'Sector breadth > min % (sector stocks above their 30W MA)',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min sector breadth %', value: 50, min: 30, max: 70, step: 5 },
        why: 'Individual stock strength alongside broad sector strength is noted as contextual alignment.',
        notMean: 'A strong sector does not guarantee individual stock performance.',
      },
    ],
  },
  {
    id: 'breakout-30w', name: 'Recent 30W Breakout', icon: '🚀', badge: 'PRO',
    tagline: 'Just crossed above the 30W trend line on volume — and not yet extended',
    history: true,
    criteria: [
      {
        id: 'bx_recent_cross', name: 'Crossed above 30W Trend Line recently',
        formula: 'Close crossed from below to above MA(30W) within N weeks',
        col: null, defaultOn: true, base: true, adjustable: true,
        param: { label: 'Within how many weeks', value: 4, min: 1, max: 8, step: 1 },
        why: 'A recent crossover marks the week price reclaimed its long-term average — the point a downtrend can turn. Unlike the Stage-2 filter, this does NOT wait for the average itself to start rising, so it catches the cross early.',
        notMean: 'A crossover is a past event, not a prediction. Price can drop back below the line at any time.',
      },
      {
        id: 'bx_cross_volume', name: 'Above-average volume on the crossover',
        formula: 'Volume on the crossover day ÷ prior ~30-session average ≥ multiplier',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min volume multiplier', value: 2.0, min: 1.5, max: 5.0, step: 0.5 },
        why: 'Heavier volume on the crossover day is observed as stronger participation behind the move (measured at the cross, not on the run date).',
        notMean: 'Volume confirms nothing about future direction. It is one data point.',
      },
      {
        id: 'bx_not_extended', name: 'Not extended from the trend line',
        formula: '0 ≤ ((Close − MA30W) / MA30W) × 100 ≤ max %',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Max extension %', value: 15, min: 5, max: 40, step: 5 },
        why: 'A small distance above the average means price has not already run far past the breakout. Also ensures price is still holding above the line.',
        notMean: 'A low extension is not a buy signal — only a measure of distance from the average.',
      },
      {
        id: 'bx_ma_not_declining', name: '30W Trend Line not declining',
        formula: 'Not in a Stage 4 / 30W breakdown',
        col: null, defaultOn: false,
        why: 'Filters out crossovers that happen inside a clear downtrend (a falling 30W average).',
        notMean: 'A flat or rising average does not guarantee an uptrend will follow.',
      },
      {
        id: 'swingx_strong_sector', name: 'From a strong sector',
        formula: 'Sector breadth > min % (sector stocks above their 30W MA)',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min sector breadth %', value: 50, min: 30, max: 70, step: 5 },
        why: 'Individual stock strength alongside broad sector strength is noted as contextual alignment.',
        notMean: 'A strong sector does not guarantee individual stock performance.',
      },
    ],
  },
  {
    id: 'rs-momentum', name: 'RS Momentum', icon: '📈', badge: 'PRO',
    tagline: 'Outperforming Nifty with expanding volume',
    criteria: [
      { id: 'rs_strong', name: 'RS vs Nifty positive', formula: 'Stock return − Nifty return (119D) > min', col: null, defaultOn: true, adjustable: true, param: { label: 'Min RS %', value: 10, min: 0, max: 100 }, why: 'A higher RS bar isolates clearer outperformers.' },
      { id: 'volume_above_2', name: 'Volume above 30D average', formula: 'Volume ratio > 1.0', col: null, defaultOn: true, why: 'Above-average volume shows participation.' },
    ],
  },
  {
    id: 'stage-1', name: 'Stage 1 · Basing', icon: '🟡', badge: 'PRO',
    tagline: 'All Stage 1 (basing) stocks — add gates to narrow',
    criteria: [
      {
        id: 'stage1_base', name: 'In Stage 1 (basing)',
        formula: 'Weinstein stage classification = Stage 1',
        col: null, defaultOn: true, base: true,
        why: 'Stage 1 is the sideways base that follows a decline — price moving flat around a flattening 30W average. This defines the screen; with every gate off it lists all Stage 1 stocks.',
        notMean: 'A base can resolve up OR down. Stage 1 is an observation, not a forecast.',
      },
      ...STAGE_GATES,
    ],
  },
  {
    id: 'stage-3', name: 'Stage 3 · Topping', icon: '🟠', badge: 'PRO',
    tagline: 'All Stage 3 (topping) stocks — add gates to narrow',
    criteria: [
      {
        id: 'stage3_base', name: 'In Stage 3 (topping)',
        formula: 'Weinstein stage classification = Stage 3',
        col: null, defaultOn: true, base: true,
        why: 'Stage 3 is the rounding top after an advance — momentum fading while price stalls near its highs. This defines the screen; with every gate off it lists all Stage 3 stocks.',
        notMean: 'A top can resume up or roll over. Stage 3 is an observation, not a forecast.',
      },
      ...STAGE_GATES,
    ],
  },
  {
    id: 'stage-4', name: 'Stage 4 · Declining', icon: '🔴', badge: 'PRO',
    tagline: 'All Stage 4 (declining) stocks — add gates to narrow',
    criteria: [
      {
        id: 'stage4_base', name: 'In Stage 4 (declining)',
        formula: 'Weinstein stage classification = Stage 4',
        col: null, defaultOn: true, base: true,
        why: 'Stage 4 is the markdown phase — price below a falling 30W average. This defines the screen; with every gate off it lists all Stage 4 stocks.',
        notMean: 'A downtrend can pause or reverse. Stage 4 is an observation, not a forecast.',
      },
      ...STAGE_GATES,
    ],
  },
]

// Client-side tests for criteria without a swing_conditions column. Each reads
// merged mv_home_stocks fields. (ma30w_slope isn't in the feed, so slope-based
// rules use defensible proxies — noted in the methodology.)
const CLIENT_TESTS = {
  above_tl: (m) => m.close != null && m.ma30w != null && m.close > m.ma30w,
  below_tl: (m) => m.close != null && m.ma30w != null && m.close < m.ma30w,
  rs_positive: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 0),
  rs_strong: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 10),
  rs_negative: (m) => (m.rs_vs_nifty ?? 0) < 0,
  obv_rising: (m) => (parseFloat(m.obv_slope) || 0) > 0,
  volume_above: (m) => (m.vol_ratio || 0) > 1,
  volume_above_2: (m) => (m.vol_ratio || 0) > 1,
  near_tl: (m, p) => { const e = m.ma30w > 0 ? ((m.close - m.ma30w) / m.ma30w) * 100 : null; return e != null && e < (p ?? 15) },
  price_near_tl: (m) => m.ma30w > 0 && Math.abs((m.close - m.ma30w) / m.ma30w) < 0.05,
  tl_flat: (m) => m.stage === 'Stage 1',
  tl_falling: (m) => m.breakdown_30wma === true || m.stage === 'Stage 3' || m.stage === 'Stage 4',
  // Remapped from the (empty) swing_conditions table to real mv_home_stocks
  // fields. Slope / MA20 / 3D-volume aren't in the feed, so these use
  // documented proxies (stage, ma50, vol_ratio).
  tl_rising: (m) => m.stage === 'Stage 2',
  // SwingX (4 criteria). swing_conditions is empty, so "crossed above 30W"
  // uses the real breakout_30wma flag; "volume 2x" uses vol_ratio (today vs
  // 30D avg); "strong sector" uses the precomputed _sector_breadth.
  swingx_crossed_30w: (m) => m.stage === 'Stage 2',
  swingx_volume_2x: (m, p) => (m.vol_ratio || 0) >= (p ?? 2),
  swingx_rs_positive: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 0),
  swingx_strong_sector: (m, p) => (m._sector_breadth ?? 0) > (p ?? 50),
  volume_low: (m) => (m.vol_ratio || 0) > 0 && m.vol_ratio < 1,
  rsi_neutral: (m) => m.rsi != null && m.rsi >= 40 && m.rsi <= 65,
  // Recent 30W Breakout — bx_recent_cross / bx_cross_volume read fields that
  // runScreen annotates from price_data history (snapshot has no history).
  bx_recent_cross: (m, p) => m._weeks_since_cross != null && m._weeks_since_cross <= (p ?? 4),
  bx_cross_volume: (m, p) => (m._crossover_vol_ratio ?? 0) >= (p ?? 2),
  bx_not_extended: (m, p) => {
    const e = m.ma30w > 0 && m.close != null ? ((m.close - m.ma30w) / m.ma30w) * 100 : null
    return e != null && e >= 0 && e <= (p ?? 15)
  },
  bx_ma_not_declining: (m) => m.stage !== 'Stage 4' && m.breakdown_30wma !== true,
  // Per-stage base filters (locked base of the Stage 1/3/4 screens).
  stage1_base: (m) => m.stage === 'Stage 1',
  stage3_base: (m) => m.stage === 'Stage 3',
  stage4_base: (m) => m.stage === 'Stage 4',
}

function critPass(crit, m, paramVal) {
  if (crit.col) return m[crit.col] === true
  const fn = CLIENT_TESTS[crit.id]
  return fn ? fn(m, paramVal) : true
}

const tlPct = (m) => (m.ma30w > 0 && m.close != null ? ((m.close - m.ma30w) / m.ma30w) * 100 : null)

// Merge locally-saved screens with any Supabase rows, de-duped by name.
// Remote rows win on conflict (they carry the canonical id); local-only
// screens are appended so nothing saved offline is ever lost.
function mergeScreens(localList, remoteList) {
  const byName = new Map()
  for (const r of remoteList || []) byName.set(r.name, r)
  for (const r of localList || []) if (!byName.has(r.name)) byName.set(r.name, r)
  return [...byName.values()]
}

// Enrich breakout candidates with crossover data from price_data history.
// Sets _weeks_since_cross (weeks since the most recent below→above 30W MA cross)
// and _crossover_vol_ratio (that day's volume ÷ prior ~30-session average). The
// snapshot feed (mv_home_stocks) has no history, so this is the one place the
// Lab reads price_data history — and the only way to catch a crossover BEFORE
// the 30W average itself turns up (which the precomputed breakout_30wma flag
// can't, since it gates on a rising slope).
async function annotateBreakout(candidates, weeks, latestDateIso) {
  for (const m of candidates) { m._weeks_since_cross = null; m._crossover_vol_ratio = null }
  const ids = candidates.map((c) => c.id).filter(Boolean)
  if (!ids.length) return
  // Fetch enough history to find a cross up to `weeks` back, plus ~30 sessions
  // before it for the volume average. Date cutoff caps the row count.
  const cutoff = new Date(latestDateIso || Date.now())
  cutoff.setDate(cutoff.getDate() - (Math.max(weeks, 8) * 7 + 70))
  const cutoffIso = cutoff.toISOString().slice(0, 10)
  // Chunk small: PostgREST caps a request at 1000 rows, and each company has
  // ~85 daily rows in the window — so keep companies-per-request × ~100 well
  // under 1000, or recent rows get truncated and crosses vanish.
  const byCompany = {}
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8)
    const { data } = await supabase
      .from('price_data')
      .select('company_id,date,close,ma30w,volume')
      .in('company_id', chunk)
      .gte('date', cutoffIso)
      .order('company_id', { ascending: true })
      .order('date', { ascending: true })
      .limit(1000)
    for (const r of data || []) (byCompany[r.company_id] ||= []).push(r)
  }
  const latestMs = new Date(latestDateIso || Date.now()).getTime()
  for (const m of candidates) {
    const series = (byCompany[m.id] || []).filter((r) => r.ma30w != null && r.close != null)
    if (series.length < 2) continue
    // Most recent below→above 30W MA cross.
    let crossIdx = -1
    for (let i = series.length - 1; i >= 1; i--) {
      if (series[i].close > series[i].ma30w && series[i - 1].close <= series[i - 1].ma30w) { crossIdx = i; break }
    }
    if (crossIdx === -1) continue
    const crossMs = new Date(series[crossIdx].date).getTime()
    m._weeks_since_cross = Math.max(0, Math.round((latestMs - crossMs) / (7 * 864e5)))
    const prior = series.slice(Math.max(0, crossIdx - 30), crossIdx).map((r) => Number(r.volume)).filter((v) => v > 0)
    const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0
    const cv = Number(series[crossIdx].volume)
    m._crossover_vol_ratio = avg > 0 && cv > 0 ? cv / avg : null
  }
}

export default function Lab() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()

  const [view, setView] = useState('landing') // landing | parameters | results
  const [template, setTemplate] = useState(null)
  const [critState, setCritState] = useState({}) // id -> { on, param }
  const [universe, setUniverse] = useState('nifty500')
  const [sortBy, setSortBy] = useState('rs')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [tradingDate, setTradingDate] = useState(null)
  const [savedScreens, setSavedScreens] = useState([])
  const [resultSector, setResultSector] = useState('all') // post-run sector filter on the results view
  const [phaseAges, setPhaseAges] = useState({}) // company_id -> sessions in current phase
  const phaseAgesRef = useRef({}) // cache so switching sector doesn't re-fetch
  const [savedMsg, setSavedMsg] = useState('') // inline "✓ saved" confirmation
  const universeRef = useRef(null) // cache merged dataset between runs

  const selectTemplate = (t) => {
    setTemplate(t)
    const cs = {}
    for (const c of t.criteria) cs[c.id] = { on: c.base ? true : c.defaultOn, param: c.param?.value }
    setCritState(cs)
    setResults(null)
    setView('parameters')
  }

  // Deep-link: /lab?template=swingx
  useEffect(() => {
    const tid = params.get('template')
    if (tid) {
      const t = TEMPLATES.find((x) => x.id === tid)
      if (t) selectTemplate(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Saved screens — LOCAL-FIRST. Read the user's (or guest's) locally-cached
  // screens instantly, then try Supabase as a best-effort mirror. The table may
  // not be deployed; that's fine — localStorage is the source of truth for the
  // UI and a logged-in user's screens still sync up/down when it exists.
  useEffect(() => {
    const uid = user?.id
    const local = readLocal('saved_screens', uid, [])
    setSavedScreens(local)
    if (!uid) return
    supabase.from('user_saved_screens').select('id,name,template_id,criteria_config,sort_by,universe')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(20)
      .then(({ data, error }) => {
        if (error || !data) return
        const merged = mergeScreens(local, data).slice(0, 20)
        writeLocal('saved_screens', uid, merged)
        setSavedScreens(merged)
      })
      .catch(() => {})
  }, [user?.id])

  // Stage-age enrichment (client-side). For the rows currently in view, derive
  // "sessions in current phase" from price_data history via phaseHelpers. Reads
  // are chunked (8 companies × 120d ≈ <1000 rows) to dodge PostgREST's row cap,
  // results are cached per company_id so switching sector doesn't re-fetch, and
  // the map fills in progressively. The Breakout template uses its own
  // weeks-since-cross instead, so we skip the fetch there.
  useEffect(() => {
    if (view !== 'results' || !results || template?.history) return
    const all = results.stocks || []
    const v = resultSector === 'all' ? all : all.filter((m) => (m.sector || '') === resultSector)
    const ids = v.slice(0, 250).map((m) => m.id).filter(Boolean)
    const missing = ids.filter((id) => !(id in phaseAgesRef.current))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < missing.length && !cancelled; i += 8) {
        const chunk = missing.slice(i, i + 8)
        const grouped = await fetchPhaseHistory(chunk, 120)
        for (const cid of chunk) {
          const g = grouped[cid]
          phaseAgesRef.current[cid] = g ? sessionsInCurrentPhase(g) : null
        }
        if (!cancelled) setPhaseAges({ ...phaseAgesRef.current })
      }
    })()
    return () => { cancelled = true }
  }, [view, results, resultSector, template?.history])

  const loadUniverse = async () => {
    if (universeRef.current) return universeRef.current
    const pages = await Promise.all([
      supabase.from('mv_home_stocks').select('*').order('symbol').range(0, 999),
      supabase.from('mv_home_stocks').select('*').order('symbol').range(1000, 1999),
      supabase.from('mv_home_stocks').select('*').order('symbol').range(2000, 2999),
    ])
    const merged = pages.flatMap((p) => p.data || [])

    // Sector breadth (% of sector stocks above their 30W MA) across the full
    // universe — used by the "strong sector" criterion. Annotated per stock.
    const secTot = {}, secUp = {}
    for (const m of merged) {
      if (!m.sector) continue
      secTot[m.sector] = (secTot[m.sector] || 0) + 1
      if (m.close != null && m.ma30w != null && m.close > m.ma30w) secUp[m.sector] = (secUp[m.sector] || 0) + 1
    }
    for (const m of merged) {
      m._sector_breadth = m.sector && secTot[m.sector] ? (secUp[m.sector] || 0) / secTot[m.sector] * 100 : 0
    }

    // Nifty 500 membership (companies.nifty500) for the universe filter.
    const nifty500 = new Set()
    try {
      for (let start = 0; start < 4000; start += 1000) {
        const { data } = await supabase.from('companies').select('id').eq('nifty500', true).range(start, start + 999)
        if (!data?.length) break
        for (const r of data) nifty500.add(r.id)
        if (data.length < 1000) break
      }
    } catch { /* non-fatal — nifty500 filter falls back to all */ }

    // Latest EOD date for the disclaimer line (mv_home_stocks has no date col).
    let td = null
    try {
      const { data } = await supabase.from('price_data').select('date').eq('is_latest', true).order('date', { ascending: false }).limit(1)
      td = data?.[0]?.date || null
    } catch { /* non-fatal */ }
    universeRef.current = { merged, td, nifty500 }
    setTradingDate(td)
    return universeRef.current
  }

  const runScreen = async () => {
    if (!template) return
    setLoading(true)
    try {
      const { merged, nifty500, td } = await loadUniverse()
      const active = template.criteria.filter((c) => critState[c.id]?.on)
      // Universe filter — Nifty 500 (free) or full NSE universe.
      const pool = universe === 'nifty500' && nifty500 && nifty500.size
        ? merged.filter((m) => nifty500.has(m.id))
        : merged

      let matched
      if (template.history) {
        // Breakout screen: snapshot pre-filter first (cheap), then enrich the
        // survivors with crossover history and apply the history-based criteria.
        const histIds = new Set(['bx_recent_cross', 'bx_cross_volume'])
        const snapActive = active.filter((c) => !histIds.has(c.id))
        const histActive = active.filter((c) => histIds.has(c.id))
        // Definitional bound for a "recent breakout": currently above the 30W MA
        // and still near it (≤ 35%). Cheap snapshot filter that keeps the history
        // fetch bounded even when every gate is off — not user gating.
        let candidates = pool.filter((m) => {
          if (!(m.close != null && m.ma30w > 0 && m.close > m.ma30w)) return false
          return ((m.close - m.ma30w) / m.ma30w) * 100 <= 35
        })
        candidates = candidates.filter((m) => snapActive.every((c) => critPass(c, m, critState[c.id]?.param)))
        candidates = candidates.slice(0, 500) // bound the history fetch
        if (histActive.length) {
          const weeks = critState['bx_recent_cross']?.param ?? 4
          await annotateBreakout(candidates, weeks, td)
          matched = candidates.filter((m) => histActive.every((c) => critPass(c, m, critState[c.id]?.param)))
        } else {
          matched = candidates
        }
        matched.sort((a, b) => {
          const wa = a._weeks_since_cross ?? 9999, wb = b._weeks_since_cross ?? 9999
          if (wa !== wb) return wa - wb
          return (b._crossover_vol_ratio ?? 0) - (a._crossover_vol_ratio ?? 0)
        })
      } else {
        matched = pool.filter((m) => active.every((c) => critPass(c, m, critState[c.id]?.param)))
        matched.sort((a, b) => {
          if (sortBy === 'tl') return (tlPct(b) ?? -9999) - (tlPct(a) ?? -9999)
          if (sortBy === 'name') return String(a.name || a.symbol).localeCompare(String(b.name || b.symbol))
          return (b.rs_vs_nifty ?? -9999) - (a.rs_vs_nifty ?? -9999)
        })
      }
      setResultSector('all')
      phaseAgesRef.current = {}
      setPhaseAges({})
      setResults({ stocks: matched, activeCount: active.length, activeNames: active.map((c) => c.name) })
      setView('results')
    } finally {
      setLoading(false)
    }
  }

  const saveScreen = async () => {
    if (!template) return
    const name = window.prompt('Name your screen:', template.name)
    if (!name) return
    const uid = user?.id // undefined → 'guest' bucket; works logged out too
    const record = {
      id: `local-${Date.now()}`,
      name,
      template_id: template.id,
      criteria_config: critState,
      universe,
      sort_by: sortBy,
      created_at: new Date().toISOString(),
    }
    // Local-first: persist immediately (de-duped by name, newest first, capped).
    const existing = readLocal('saved_screens', uid, [])
    const next = [record, ...existing.filter((s) => s.name !== name)].slice(0, 20)
    const ok = writeLocal('saved_screens', uid, next)
    setSavedScreens(next)
    setSavedMsg(ok ? `✓ Saved “${name}” — find it on the Lab home (← Back to templates)` : 'Could not save — your browser is blocking local storage.')
    setTimeout(() => setSavedMsg(''), 5000)
    // Best-effort Supabase mirror for logged-in users — failure is non-fatal,
    // the local copy is already saved.
    if (uid) {
      try {
        await supabase.from('user_saved_screens').upsert({
          user_id: uid, name, template_id: template.id,
          criteria_config: critState, universe, sort_by: sortBy, last_run: new Date().toISOString(),
        })
      } catch { /* local copy already saved */ }
    }
  }

  const activeCount = useMemo(() => (template ? template.criteria.filter((c) => critState[c.id]?.on).length : 0), [template, critState])

  // ── LANDING ─────────────────────────────────────────────────────────────
  if (view === 'landing') {
    return (
      <Shell title="PineX Lab" maxWidth={1040}>
        <div style={{ padding: '20px 16px 8px' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>🔬 PineX Lab</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
            Run your own cycle-analysis screen. All results come from your parameters · EOD data only.
          </p>
        </div>
        <SectionHead>Templates</SectionHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, padding: '0 16px' }}>
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => selectTemplate(t)}
              style={{ textAlign: 'left', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, cursor: 'pointer', color: 'inherit' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{t.name}</span>
                {t.badge === 'PRO' && <ProBadge />}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 }}>{t.tagline}</div>
              <div style={{ fontSize: 11, color: C.textFaint }}>{t.criteria.length} criteria · Use template →</div>
            </button>
          ))}
          <button onClick={() => selectTemplate({ id: 'custom', name: 'Build Your Own', icon: '✏️', badge: 'PRO', tagline: 'Pick any combination', criteria: TEMPLATES[0].criteria })}
            style={{ textAlign: 'left', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 12, padding: 16, cursor: 'pointer', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>✏️</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Build Your Own</span>
              <ProBadge />
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>Choose any combination of criteria</div>
          </button>
        </div>

        {savedScreens.length > 0 && (
          <>
            <SectionHead>Your saved screens <ProBadge /></SectionHead>
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {savedScreens.map((sv) => (
                <button key={sv.id}
                  onClick={() => { const t = TEMPLATES.find((x) => x.id === sv.template_id) || TEMPLATES[0]; setTemplate(t); setCritState(sv.criteria_config || {}); setSortBy(sv.sort_by || 'rs'); setUniverse(sv.universe || 'all'); setView('parameters') }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', color: 'inherit' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{sv.name}</span>
                  <span style={{ fontSize: 12, color: C.blue }}>Re-run →</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 24 }} />
      </Shell>
    )
  }

  // ── PARAMETERS ──────────────────────────────────────────────────────────
  if (view === 'parameters') {
    return (
      <Shell title={template?.name}>
        <div style={{ padding: '12px 16px 0' }}>
          <button onClick={() => setView('landing')} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>← Back to templates</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{template?.icon}</span>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>{template?.name}</h1>
            {template?.badge === 'PRO' && <ProBadge />}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
            These are the mathematical criteria your screen will apply. Review and adjust, then run.
          </p>
        </div>

        <SectionHead>Criteria</SectionHead>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {template?.criteria.map((c) => {
            const on = !!critState[c.id]?.on
            return (
              <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={c.base ? undefined : () => setCritState((p) => ({ ...p, [c.id]: { ...p[c.id], on: !on } }))}
                    title={c.base ? 'Always applied — this defines the screen' : undefined}
                    style={{ width: 40, height: 22, borderRadius: 12, border: 'none', cursor: c.base ? 'default' : 'pointer', flexShrink: 0, position: 'relative', background: on ? C.amber : C.surface2, opacity: c.base ? 0.9 : 1, transition: 'background .15s' }}>
                    <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: on ? '#000' : C.textMuted, transition: 'left .15s' }} />
                  </button>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: on ? C.text : C.textMuted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {c.name}
                    {c.base && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: C.amber, border: `1px solid ${C.amberBorder}`, background: C.amberBg, borderRadius: 4, padding: '1px 5px' }}>BASE</span>}
                  </span>
                  <InfoSheet title={c.name} trigger={<span style={{ color: C.textMuted, fontSize: 13 }}>ℹ️</span>}>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>The maths:</strong><br /><span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{c.formula}</span></p>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>Why cycle analysts watch it:</strong><br />{c.why}</p>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>What it does not mean:</strong><br />{c.notMean || 'This criterion does not predict future price movement. It is a mathematical observation.'}</p>
                    <p style={{ margin: 0, fontSize: 11, color: C.textFaint }}>ℹ️ Data only · Not advice</p>
                  </InfoSheet>
                </div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6, marginLeft: 50, fontFamily: 'var(--font-mono, monospace)' }}>{c.formula}</div>
                {c.adjustable && c.param && on && (
                  <div style={{ marginLeft: 50, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: C.textMuted, minWidth: 90 }}>{c.param.label}: <strong style={{ color: C.amber }}>{critState[c.id]?.param}</strong></span>
                    <input type="range" min={c.param.min} max={c.param.max} step={c.param.step || 1} value={critState[c.id]?.param ?? c.param.value}
                      onChange={(e) => setCritState((p) => ({ ...p, [c.id]: { ...p[c.id], param: Number(e.target.value) } }))}
                      style={{ flex: 1, accentColor: C.amber }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <SectionHead>Universe & sort</SectionHead>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => setUniverse('nifty500')}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${universe === 'nifty500' ? C.amberBorder : C.border}`, background: universe === 'nifty500' ? C.amberBg : C.surface }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: universe === 'nifty500' ? C.amber : C.text }}>{universe === 'nifty500' ? '● ' : '○ '}Nifty 500</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>500 stocks · Free</div>
            </button>
            <button onClick={() => setUniverse('all')}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${universe === 'all' ? C.amberBorder : C.border}`, background: universe === 'all' ? C.amberBg : C.surface }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: universe === 'all' ? C.amber : C.text, display: 'flex', alignItems: 'center' }}>{universe === 'all' ? '● ' : '○ '}All NSE stocks<ProBadge /></div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>2100+ stocks · Unlocked</div>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: C.textMuted }}>Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
              <option value="rs">RS vs Nifty</option>
              <option value="tl">% from 30W Trend Line</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        <div style={{ padding: '20px 16px 120px' }}>
          <button onClick={runScreen} disabled={loading || activeCount === 0}
            style={{ width: '100%', height: 48, borderRadius: 12, border: 'none', background: activeCount ? C.amber : C.surface2, color: activeCount ? '#000' : C.textMuted, fontSize: 16, fontWeight: 700, cursor: activeCount ? 'pointer' : 'default' }}>
            {loading ? 'Running your screen…' : `▶  Run My Screen${activeCount ? ` · ${activeCount} criteria` : ''}`}
          </button>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: C.textFaint, textAlign: 'center', lineHeight: 1.5 }}>
            {loading
              ? `Checking stocks against your ${activeCount} parameters… EOD data${tradingDate ? ` as of ${tradingDate}` : ''}`
              : 'Results are generated from your parameters · EOD data only · Not investment advice'}
          </p>
        </div>
        <div style={{ height: 24 }} />
      </Shell>
    )
  }

  // ── RESULTS ─────────────────────────────────────────────────────────────
  const rows = results?.stocks || []
  // Post-run sector filter (view only — doesn't change the screen). Lets the
  // user isolate e.g. all Stage-2 pharma without re-running.
  const rowSectors = [...new Set(rows.map((m) => m.sector).filter(Boolean))].sort()
  const viewRows = resultSector === 'all' ? rows : rows.filter((m) => (m.sector || '') === resultSector)
  const DISPLAY_CAP = 250
  return (
    <Shell title="Screen results">
      <div style={{ padding: '14px 16px 0' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>Your screen results</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: C.text }}>
          <strong>{rows.length}</strong> stock{rows.length === 1 ? '' : 's'} matched your <strong>{results?.activeCount}</strong> criteria
          {resultSector !== 'all' && <> · <strong>{viewRows.length}</strong> in {resultSector}</>}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.textMuted }}>EOD · {tradingDate || '—'} · sorted by {sortBy}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 0' }}>
          {(results?.activeNames || []).map((n) => (
            <span key={n} style={{ fontSize: 10, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: '2px 8px' }}>✓ {n}</span>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0', alignItems: 'center' }}>
          <button onClick={() => setView('parameters')} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 13, cursor: 'pointer' }}>← Modify screen</button>
          <button onClick={saveScreen} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.amberBorder}`, background: C.amberBg, color: C.amber, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>Save screen <ProBadge /></button>
          {rows.length > 0 && (
            <ExportMenu
              label="Export"
              align="left"
              filename={`PineX_${(template?.id || 'screen')}`}
              title={`PineX Lab — ${template?.name || 'Screen'}`}
              getRows={() => viewRows.map((m) => {
                const tl = tlPct(m)
                return {
                  'Symbol': m.symbol,
                  'Company': m.name || m.symbol,
                  'Sector': m.sector || '',
                  'CMP (Rs)': m.close ?? '',
                  '% vs 30W Trend Line': tl == null ? '' : tl.toFixed(1),
                  'RS vs Nifty (%)': m.rs_vs_nifty ?? '',
                  'Volume Ratio': m.vol_ratio ?? '',
                  'Criteria met': `${results?.activeCount ?? ''}/${results?.activeCount ?? ''}`,
                }
              })}
            />
          )}
        </div>
        {savedMsg && (
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: savedMsg.startsWith('✓') ? C.green : C.red }}>{savedMsg}</p>
        )}
      </div>

      {/* Sector filter — narrow the run results to one sector (e.g. Pharma). */}
      {rows.length > 0 && rowSectors.length > 1 && (
        <div style={{ padding: '0 16px 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Sector</span>
          <select value={resultSector} onChange={(e) => setResultSector(e.target.value)}
            style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, maxWidth: 220 }}>
            <option value="all">All sectors ({rows.length})</option>
            {rowSectors.map((s) => (
              <option key={s} value={s}>{s} ({rows.filter((m) => m.sector === s).length})</option>
            ))}
          </select>
          {resultSector !== 'all' && (
            <button onClick={() => setResultSector('all')} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 12, cursor: 'pointer', padding: 0 }}>clear</button>
          )}
        </div>
      )}

      {/* Results table */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 56px 52px', gap: 8, padding: '8px 4px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>Ticker</span><span style={{ textAlign: 'right' }}>CMP</span><span style={{ textAlign: 'right' }}>TL%</span><span style={{ textAlign: 'right' }}>RS</span>
        </div>
        {viewRows.slice(0, DISPLAY_CAP).map((m) => {
          const tl = tlPct(m)
          return (
            <div key={m.id || m.symbol} onClick={() => navigate('/stock/' + m.symbol)}
              style={{ display: 'grid', gridTemplateColumns: '1fr 76px 56px 52px', gap: 8, padding: '9px 4px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{m.symbol}</div>
                <div style={{ fontSize: 10, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.sector}</div>
                {(() => {
                  const parts = []
                  if (template?.history && m._weeks_since_cross != null) parts.push(`${m._weeks_since_cross}w since cross`)
                  else { const s = phaseAges[m.id]; if (s != null) parts.push(`${m.stage} · ${formatPhaseAge(s)}`) }
                  if (m.swingx_days != null) parts.push(`SwingX ${m.swingx_days}d`)
                  return parts.length ? <div style={{ fontSize: 9, color: C.textFaint, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⏱ {parts.join(' · ')}</div> : null
                })()}
              </div>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{m.close == null ? '—' : '₹' + Number(m.close).toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: tl == null ? C.textMuted : tl > 0 ? C.green : C.red }}>{tl == null ? '—' : (tl > 0 ? '+' : '') + tl.toFixed(0) + '%'}</span>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: m.rs_vs_nifty == null ? C.textMuted : m.rs_vs_nifty > 0 ? C.green : C.red }}>{m.rs_vs_nifty == null ? '—' : (m.rs_vs_nifty > 0 ? '+' : '') + Number(m.rs_vs_nifty).toFixed(0)}</span>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>No stocks matched all your criteria. Try loosening a parameter.</div>
        )}
        {rows.length > 0 && viewRows.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>No {resultSector} stocks in this result.</div>
        )}
        {viewRows.length > DISPLAY_CAP && (
          <div style={{ padding: '12px 0', textAlign: 'center', color: C.textFaint, fontSize: 11 }}>
            Showing first {DISPLAY_CAP} of {viewRows.length} · filter by sector to narrow
          </div>
        )}
      </div>

      <p style={{ padding: '16px', fontSize: 11, color: C.textMuted, lineHeight: 1.6, fontStyle: 'italic' }}>
        These stocks match the mathematical criteria you set. What you do with this is entirely your decision.<br />
        ℹ️ Data only · Not advice · Not SEBI registered
      </p>
      <div style={{ height: 24 }} />
    </Shell>
  )
}

function Shell({ title, children, maxWidth = 760 }) {
  return (
    <>
      <Helmet><title>{title} | PineX Lab</title></Helmet>
      <div style={{ minHeight: '100vh', background: C.base, color: C.text, width: '100%', maxWidth, margin: '0 auto' }}>{children}</div>
    </>
  )
}

function SectionHead({ children }) {
  return (
    <div style={{ padding: '18px 16px 8px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center' }}>{children}</div>
  )
}

function RadioPill({ label, active, onClick, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ padding: '7px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, border: `1px solid ${active ? C.amberBorder : C.border}`, background: active ? C.amberBg : 'transparent', color: active ? C.amber : C.textMuted }}>
      {label}
    </button>
  )
}
