import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import PineXMark from '../components/PineXMark'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context'
import {
  askGemini,
  getStoredGeminiKey,
  isBlockedQuestion,
  logResearchUsage,
  REFUSAL_TEXT,
} from '../lib/researchAssistant'
import { awardPoints } from '../lib/pointsAwarder'
import { useAcademy } from '../hooks/useAcademy'
import { AcademyRequired } from '../components/AcademyGate'
import { useSignupPrompt } from '../components/SignupPrompt'
import SectorShareModal from '../components/SectorShareCard'
import DailyChecklist from '../components/DailyChecklist'
import DailyQuestion from '../components/DailyQuestion'
import ProBadge from '../components/ProBadge'
import MorningBrief from '../components/MorningBrief'
import WowMoment from '../components/WowMoment'
import StockFilters from '../components/StockFilters'
import ExportMenu from '../components/ExportMenu'
import {
  markHomeBackToSectorsTab,
  clearHomeBackToSectorsTab,
} from '../lib/appNav'

function AcademyNudgeBanner() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('academy_nudge_dismissed') === '1' }
    catch { return false }
  })

  // Soft prompt for grandfathered users who haven't completed the academy.
  const show =
    user &&
    profile?.academy_grandfathered === true &&
    !profile?.academy_completed &&
    !dismissed

  if (!show) return null

  const dismiss = () => {
    try { sessionStorage.setItem('academy_nudge_dismissed', '1') } catch {}
    setDismissed(true)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      background: 'rgba(0,200,5,0.08)',
      borderBottom: '1px solid rgba(0,200,5,0.2)',
      fontSize: 12, color: 'var(--text-primary)',
    }}>
      <span style={{ flex: 1, lineHeight: 1.4 }}>
        💡 Complete PineX Academy to deepen your understanding
      </span>
      <button
        onClick={() => navigate('/learn')}
        style={{
          padding: '5px 10px', borderRadius: 6, border: 'none',
          background: 'var(--accent)', color: '#000',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Start learning →
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          padding: '5px 8px', borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent', color: 'var(--text-muted)',
          fontSize: 11, cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  )
}

const C = {
  bg: 'var(--bg-primary)',
  surface: 'var(--bg-surface)',
  surface2: 'var(--bg-elevated)',
  card: 'var(--bg-elevated)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  textMuted: 'var(--text-muted)',
  hint: 'var(--text-hint)',
  green: 'var(--positive)',
  red: 'var(--negative)',
  blue: 'var(--info)',
  amber: 'var(--warning)',
}


const fmt = (n, d=1) => n == null ? '—' :
  n.toLocaleString('en-IN', {maximumFractionDigits: d})
const fmtPct = (n, d=1) => n == null ? '—' : 
  (n > 0 ? '+' : '') + n.toFixed(d) + '%'
const fmtVol = (n) => {
  if (!n) return '—'
  if (n >= 10000000) return (n/10000000).toFixed(1) + 'Cr'
  if (n >= 100000) return (n/100000).toFixed(1) + 'L'
  if (n >= 1000) return (n/1000).toFixed(0) + 'K'
  return Math.round(n)
}

/** Nifty sector card title → filter on `company.sector` (substring match) */
const NIFTY_SECTOR_NAME_MAP = {
  'Nifty Auto': 'Auto',
  'Nifty Bank': 'Banking',
  'Nifty IT': 'IT Services',
  'Nifty Pharma': 'Pharma',
  'Nifty FMCG': 'FMCG',
  'Nifty Metal': 'Metals & Mining',
  'Nifty Realty': 'Real Estate',
  'Nifty Energy': 'Oil & Gas',
  'Nifty Infra': 'Infrastructure',
  'Nifty Media': 'Media',
  'Nifty PSU Bank': 'Banking',
  'Nifty Financial Services': 'NBFC',
  'Nifty Private Bank': 'Banking',
  'Nifty Healthcare': 'Healthcare',
  'Nifty Consumer Durables': 'Consumer Durables',
  'Nifty Consumer Goods': 'FMCG',
  'Nifty Oil & Gas': 'Oil & Gas',
  'Nifty 50': null,
}

const STAGE_BADGE_TOOLTIPS = {
  'Stage 2': 'Price above rising 30W Trend Line',
  'Stage 1': 'Price base forming',
  'Stage 3': 'Momentum slowing',
  'Stage 4': 'Price below declining 30W Trend Line',
}

function mapNiftySectorToFilter(displayOrIndex) {
  const raw = String(displayOrIndex || '').trim()
  if (!raw) return null
  const lower = raw.replace(/\s+/g, ' ').toLowerCase()
  for (const [k, v] of Object.entries(NIFTY_SECTOR_NAME_MAP)) {
    if (k.toLowerCase().replace(/\s+/g, ' ') === lower) return v
  }
  if (/^nifty\s*50$/i.test(raw) || lower === 'nifty 50' || lower.startsWith('nifty 50 ')) return null
  const m = raw.match(/^nifty\s+(.+)$/i)
  if (m) return m[1].trim()
  return raw
}

const SUBSTAGE_CFG = {
  '2A+': { bg: 'var(--stage2-bg)',  color: 'var(--stage2-color)', border: 'var(--stage2-border)', label: 'S2 A+' },
  '2A-': { bg: 'var(--stage2-bg)',  color: 'var(--positive-soft)', border: 'var(--stage2-border)', label: 'S2 A-' },
  '2B+': { bg: 'var(--stage3-bg)',  color: 'var(--stage3-color)', border: 'var(--stage3-border)', label: 'S2 B+' },
  '2B-': { bg: 'var(--stage3-bg)',  color: 'var(--warning)',      border: 'var(--stage3-border)', label: 'S2 B-' },
}
const STAGE_CFG = {
  'Stage 2': { bg: 'var(--stage2-bg)', color: 'var(--stage2-color)', border: 'var(--stage2-border)', label: 'S2' },
  'Stage 1': { bg: 'var(--stage1-bg)', color: 'var(--stage1-color)', border: 'var(--stage1-border)', label: 'S1' },
  'Stage 3': { bg: 'var(--stage3-bg)', color: 'var(--stage3-color)', border: 'var(--stage3-border)', label: 'S3' },
  'Stage 4': { bg: 'var(--stage4-bg)', color: 'var(--stage4-color)', border: 'var(--stage4-border)', label: 'S4' },
}
const BADGE_STYLE = { fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.05em', flexShrink: 0 }

const StageBadge = ({ stage }) => {
  const s = STAGE_CFG[stage] || { bg: 'var(--border)', color: 'var(--text-muted)', border: 'var(--border)', label: '?' }
  const tip = STAGE_BADGE_TOOLTIPS[stage] || ''
  return (
    <span title={tip} style={{ ...BADGE_STYLE, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  )
}

function getStageBadge(stock) {
  const sub = stock?.weinstein_substage
  const stage = stock?.stage
  const tip = STAGE_BADGE_TOOLTIPS[stage] || ''
  if (sub && SUBSTAGE_CFG[sub]) {
    const s = SUBSTAGE_CFG[sub]
    return <span title={tip} style={{ ...BADGE_STYLE, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</span>
  }
  const s = STAGE_CFG[stage] || { bg: 'var(--border)', color: 'var(--text-muted)', border: 'var(--border)', label: '?' }
  return <span title={tip} style={{ ...BADGE_STYLE, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</span>
}

function getBadgeLabel(stock) {
  const sub = stock?.weinstein_substage
  if (!sub) {
    if (stock?.stage === 'Stage 2') return 'S2'
    if (stock?.stage === 'Stage 1') return 'S1'
    if (stock?.stage === 'Stage 3') return 'S3'
    if (stock?.stage === 'Stage 4') return 'S4'
    return '—'
  }
  if (sub === '2A+') return 'S2 A+'
  if (sub === '2A-') return 'S2 A-'
  if (sub === '2B+') return 'S2 B+'
  if (sub === '2B-') return 'S2 B-'
  if (sub.startsWith('S')) return sub
  return sub
}

// ── Rule-match score ────────────────────────────────────────────────────────
// Returns how many objective, EOD-data rules a stock currently meets. This is a
// neutral count of mathematical conditions — NOT a phase verdict, rating, or
// buy/sell signal. Each check carries the raw value so the expandable row can
// show exactly which rules matched (Chartink / Screener.in style transparency).
function ruleMatch(stock) {
  const close = Number(stock?.close)
  const ma30w = Number(stock?.ma30w)
  const pctFromMa = ma30w > 0 && close > 0 ? ((close - ma30w) / ma30w) * 100 : null
  const rs = stock?.rs_vs_nifty
  const obv = Number(stock?.obv_slope) || 0
  const volR = stock?.vol_ratio
  const del = stock?.avg_delivery_30d
  const checks = [
    {
      label: 'Price above 30W Trend Line',
      pass: pctFromMa != null && pctFromMa > 0,
      detail: pctFromMa != null ? `${pctFromMa > 0 ? '+' : ''}${pctFromMa.toFixed(1)}%` : '—',
    },
    {
      label: 'RS vs Nifty positive',
      pass: rs != null && rs > 0,
      detail: rs != null ? `${rs > 0 ? '+' : ''}${Number(rs).toFixed(1)}%` : '—',
    },
    {
      label: 'OBV rising',
      pass: obv > 0,
      detail: obv > 0 ? 'rising' : 'flat / falling',
    },
    {
      label: 'Volume above 30D average',
      pass: volR != null && volR > 1.0,
      detail: volR != null ? `${Number(volR).toFixed(2)}×` : '—',
    },
    {
      label: 'Delivery ≥ 50%',
      pass: del != null && del >= 50,
      detail: del != null ? `${Number(del).toFixed(0)}%` : '—',
    },
  ]
  return { score: checks.filter((c) => c.pass).length, total: checks.length, checks }
}

const PulseTag = ({ pulse }) => {
  const cfg = {
    Uptrend: { bg: 'var(--accent-dim)', 
               color: 'var(--accent)', 
               border: 'var(--accent-border)' },
    Watch: { bg: 'var(--negative-dim)', 
               color: 'var(--negative)', 
               border: 'rgba(255,59,48,.2)' },
    Neutral: { bg: 'rgba(100,116,139,.1)', 
               color: 'var(--text-secondary)', 
               border: 'rgba(100,116,139,.2)' },
  }
  const s = cfg[pulse] || cfg.Neutral
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontSize: 12, fontWeight: 500,
      padding: '3px 8px', borderRadius: 3,
    }}>
      {pulse || 'Neutral'}
    </span>
  )
}

/** VIX display band (value → color + label). */
function vixBand(vix) {
  const v = Number(vix)
  if (!Number.isFinite(v)) return { color: C.muted, label: '—' }
  if (v < 13) return { color: 'var(--accent)', label: 'calm' }
  if (v < 17) return { color: 'var(--warning)', label: 'normal' }
  if (v < 20) return { color: 'var(--warning)', label: 'elevated' }
  return { color: 'var(--negative)', label: 'fear' }
}

/** Nifty 1d % color */
function chgColor(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return C.muted
  if (Number(pct) > 0) return 'var(--positive)'
  if (Number(pct) < 0) return 'var(--negative)'
  return C.muted
}

/**
 * `history` = newest first (Supabase order desc).
 * Needs at least 2 rows for breadth / index / VIX / 52W / stage2 signals; 3 rows for 3‑session breadth.
 */
function buildMarketSignals(history) {
  const h = [...(history || [])]
  const signals = []

  const month = new Date().getMonth() + 1
  const SEASONAL = {
    3: {
      text: 'March: Quarter-end — institutional rebalancing historically common',
      color: 'var(--info)',
    },
    9: {
      text: 'September: FII rebalancing period — breadth often contracts',
      color: 'var(--info)',
    },
    10: {
      text: 'October: Festival season — consumption and retail sectors historically active',
      color: 'var(--info)',
    },
    12: {
      text: 'December: Year-end — profit booking historically common in small caps',
      color: 'var(--info)',
    },
  }

  if (h.length < 2) {
    if (SEASONAL[month]) {
      signals.push({
        type: 'info',
        icon: 'ti-calendar',
        color: SEASONAL[month].color,
        bg: 'var(--info-dim)',
        border: 'rgba(96,165,250,.25)',
        text: SEASONAL[month].text,
      })
    }
    return signals
  }

  const latest = h[0] || {}
  const prev = h[1] || {}
  const older = h[2] || {}

  // above_ma150_pct can be stale/zero in the DB; treat < 1% as invalid
  const rawBreadthNow  = Number(latest.above_ma150_pct)
  const rawBreadthPrev = Number(prev.above_ma150_pct)
  const breadthDataValid = rawBreadthNow >= 1 && rawBreadthPrev >= 1
  const breadthNow  = breadthDataValid ? rawBreadthNow  : (Number(latest.stage2_pct)  || 0)
  const breadthPrev = breadthDataValid ? rawBreadthPrev : (Number(prev.stage2_pct)    || 0)
  const breadthChange = breadthNow - breadthPrev

  if (breadthDataValid && breadthChange < -10 && breadthNow < 40) {
    signals.push({
      type: 'caution',
      icon: 'ti-trending-down',
      color: 'var(--warning)',
      bg: 'var(--warning-dim)',
      border: 'var(--warning-dim)',
      text: `Breadth fell sharply — stocks above 30W Trend Line dropped from ${breadthPrev.toFixed(0)}% to ${breadthNow.toFixed(0)}% in recent sessions`,
    })
  }

  const niftyNow = Number(latest.nifty_close) || 0
  const niftyPrev = Number(prev.nifty_close) || 0
  const niftyChange = niftyPrev > 0
    ? ((niftyNow - niftyPrev) / niftyPrev) * 100
    : 0

  if (breadthDataValid && niftyChange >= -1 && breadthChange < -5) {
    signals.push({
      type: 'caution',
      icon: 'ti-alert-triangle',
      color: 'var(--warning)',
      bg: 'var(--warning-dim)',
      border: 'rgba(251,191,36,.3)',
      text: `Index level masking weakness — only ${breadthNow.toFixed(0)}% of stocks above 30W Trend Line while index remains elevated`,
    })
  }

  if (h.length >= 3) {
    const rawBreadthOlder = Number(older.above_ma150_pct)
    const breadthOlder = (breadthDataValid && rawBreadthOlder >= 1) ? rawBreadthOlder : (Number(older.stage2_pct) || 0)
    const breadth3dDataValid = breadthDataValid && rawBreadthOlder >= 1
    const breadth3dChange = breadthNow - breadthOlder

    if (breadth3dDataValid && breadth3dChange > 5) {
      signals.push({
        type: 'positive',
        icon: 'ti-trending-up',
        color: 'var(--accent)',
        bg: 'var(--accent-dim)',
        border: 'var(--accent-border)',
        text: `Breadth recovering — stocks above 30W Trend Line improved from ${breadthOlder.toFixed(0)}% to ${breadthNow.toFixed(0)}% over 3 sessions`,
      })
    } else if (breadth3dDataValid && breadth3dChange < -15) {
      signals.push({
        type: 'caution',
        icon: 'ti-chart-line',
        color: 'var(--negative)',
        bg: 'var(--negative-dim)',
        border: 'rgba(255,59,48,.3)',
        text: `Broad market deteriorating — breadth fell ${Math.abs(breadth3dChange).toFixed(0)} percentage points over 3 sessions`,
      })
    }
  }

  const stage2Now = Number(latest.stage2_pct) || 0
  const stage2Prev = Number(prev.stage2_pct) || 0
  const stage2Change = stage2Now - stage2Prev

  if (stage2Change <= -3) {
    signals.push({
      type: 'caution',
      icon: 'ti-chart-bar',
      color: 'var(--warning)',
      bg: 'var(--warning-dim)',
      border: 'rgba(251,191,36,.3)',
      text: `Uptrend stocks contracting — ${stage2Now.toFixed(0)}% of tracked stocks in uptrend phase, down from ${stage2Prev.toFixed(0)}%`,
    })
  }

  const vix = Number(latest.india_vix) || 0
  const vixPrev = Number(prev.india_vix) || 0
  const vixRising = vix > vixPrev + 1

  if (vix > 20) {
    signals.push({
      type: 'watch',
      icon: 'ti-activity',
      color: 'var(--negative)',
      bg: 'var(--negative-dim)',
      border: 'rgba(255,59,48,.3)',
      text: `India VIX at ${vix.toFixed(1)} — elevated volatility conditions`,
    })
  } else if (vixRising && vix > 17) {
    signals.push({
      type: 'watch',
      icon: 'ti-activity',
      color: 'var(--warning)',
      bg: 'var(--warning-dim)',
      border: 'var(--warning-dim)',
      text: `Volatility increasing — VIX rising to ${vix.toFixed(1)}`,
    })
  }

  const highs = Number(latest.new_52w_highs) || 0
  const lows = Number(latest.new_52w_lows) || 0

  if (lows > highs * 2 && lows > 10) {
    signals.push({
      type: 'caution',
      icon: 'ti-arrow-down-circle',
      color: 'var(--negative)',
      bg: 'var(--negative-dim)',
      border: 'rgba(255,59,48,.3)',
      text: `${lows} stocks at 52-week lows vs ${highs} at highs — more stocks breaking down than breaking out`,
    })
  } else if (highs > lows * 3 && highs > 20) {
    signals.push({
      type: 'positive',
      icon: 'ti-arrow-up-circle',
      color: 'var(--accent)',
      bg: 'var(--accent-dim)',
      border: 'var(--accent-border)',
      text: `${highs} stocks at 52-week highs — broad participation in advance`,
    })
  }

  if (SEASONAL[month]) {
    signals.push({
      type: 'info',
      icon: 'ti-calendar',
      color: SEASONAL[month].color,
      bg: 'var(--info-dim)',
      border: 'rgba(96,165,250,.25)',
      text: SEASONAL[month].text,
    })
  }

  return signals
}

// sessionStorage cache — clears on tab close, 1-min TTL, date-validated.
const CACHE_KEY = 'pinex_stocks_v6'
const CACHE_VERSION = 6
const CACHE_MS = 60 * 1000
// 1 minute only

const getCached = () => {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.version !== CACHE_VERSION) {
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    const todayStr = new Date().toISOString().split('T')[0]
    if (parsed.dataDate && parsed.dataDate !== todayStr) {
      // Cache is from yesterday — force fresh fetch
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    if (Date.now() - parsed.ts < CACHE_MS) return parsed
    sessionStorage.removeItem(CACHE_KEY)
    return null
  } catch {
    return null
  }
}

const setCache = (stocks, market, sectors) => {
  try {
    sessionStorage.setItem(CACHE_KEY,
      JSON.stringify({ ts: Date.now(), version: CACHE_VERSION, stocks, market, sectors: sectors || [], dataDate: market?.date || null })
    )
  } catch {}
}

const getCacheAge = () => {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { ts } = JSON.parse(raw)
    return Math.floor((Date.now() - ts) / 60000)
  } catch { return null }
}

const FREE_LIMITS = {
  swingx: 3,
  stage2: 10,
  sector: 5,
  filter: 3,
  stock_list: 5,
}

// ── Smart Search ──────────────────────────────────────────────────────────────

const SEARCH_SUGGESTIONS = [
  { label: 'Stage 2 scan', query: 'stage 2' },
  { label: 'Pharma', query: 'pharma' },
  { label: 'Defence', query: 'defence' },
  { label: 'Capital Goods', query: 'capital goods' },
  { label: 'EMS', query: 'ems' },
  { label: 'New entries', query: 'new stage 2' },
  { label: 'High delivery', query: 'delivery' },
  { label: 'Clean ownership', query: 'clean ownership' },
  { label: 'Market', query: 'market' },
]

const SECTOR_MAP = {
  // Capital Goods
  'capital goods': 'Capital Goods', 'capital': 'Capital Goods', 'industrial': 'Capital Goods',
  // NBFC
  'nbfc': 'NBFC', 'non banking': 'NBFC', 'microfinance': 'NBFC', 'mfi': 'NBFC',
  // Auto Ancillary
  'auto ancillary': 'Auto Ancillary', 'auto parts': 'Auto Ancillary', 'ancillary': 'Auto Ancillary', 'auto component': 'Auto Ancillary',
  // IT Services
  'it services': 'IT Services', 'it': 'IT Services', 'tech': 'IT Services', 'software': 'IT Services', 'information technology': 'IT Services', 'infotech': 'IT Services',
  // Pharma
  'pharma': 'Pharma', 'pharmacy': 'Pharma', 'pharmaceutical': 'Pharma', 'drug': 'Pharma', 'medicine': 'Pharma',
  // Textiles
  'textile': 'Textiles', 'textiles': 'Textiles', 'fabric': 'Textiles', 'spinning': 'Textiles', 'yarn': 'Textiles',
  // Agro
  'agro': 'Agro', 'agri': 'Agro', 'agriculture': 'Agro', 'agricultural': 'Agro', 'farm': 'Agro', 'crop': 'Agro', 'seed': 'Agro',
  // Chemicals
  'chemical': 'Chemicals', 'chemicals': 'Chemicals', 'basic chemical': 'Chemicals',
  // FMCG
  'fmcg': 'FMCG', 'consumer goods': 'FMCG', 'food': 'FMCG', 'beverage': 'FMCG', 'fmcg goods': 'FMCG',
  // Real Estate
  'real estate': 'Real Estate', 'realty': 'Real Estate', 'property': 'Real Estate', 'housing': 'Real Estate', 'developer': 'Real Estate',
  // SME
  'sme': 'SME / Others', 'small cap': 'SME / Others', 'others': 'SME / Others',
  // Construction
  'construction': 'Construction', 'building': 'Construction', 'infra construction': 'Construction', 'epc': 'Construction',
  // Consumer Durables
  'consumer durables': 'Consumer Durables', 'durables': 'Consumer Durables', 'appliance': 'Consumer Durables', 'appliances': 'Consumer Durables', 'electronics': 'Consumer Durables', 'white goods': 'Consumer Durables',
  // Specialty Chemicals
  'specialty chemical': 'Specialty Chemicals', 'specialty chemicals': 'Specialty Chemicals', 'speciality chemical': 'Specialty Chemicals', 'agrochemical': 'Specialty Chemicals', 'agrochemicals': 'Specialty Chemicals', 'pesticide': 'Specialty Chemicals',
  // Metals & Mining
  'metal': 'Metals & Mining', 'metals': 'Metals & Mining', 'mining': 'Metals & Mining', 'metals mining': 'Metals & Mining', 'non ferrous': 'Metals & Mining', 'aluminium': 'Metals & Mining', 'copper': 'Metals & Mining', 'zinc': 'Metals & Mining',
  // Paper & Packaging
  'paper': 'Paper & Packaging', 'paper packaging': 'Paper & Packaging', 'packaging paper': 'Paper & Packaging', 'newsprint': 'Paper & Packaging',
  // Media
  'media': 'Media', 'entertainment': 'Media', 'broadcast': 'Media', 'ott': 'Media', 'film': 'Media', 'movie': 'Media', 'television': 'Media', 'tv': 'Media',
  // Engineering
  'engineering': 'Engineering', 'heavy engineering': 'Engineering', 'machine': 'Engineering', 'machinery': 'Engineering', 'equipment': 'Engineering',
  // Logistics
  'logistics': 'Logistics', 'supply chain': 'Logistics', 'freight': 'Logistics', 'courier': 'Logistics', 'transport': 'Logistics', 'warehouse': 'Logistics',
  // Hotels & Tourism
  'hotel': 'Hotels & Tourism', 'hotels': 'Hotels & Tourism', 'tourism': 'Hotels & Tourism', 'hospitality': 'Hotels & Tourism', 'resort': 'Hotels & Tourism', 'travel': 'Hotels & Tourism',
  // Banking
  'bank': 'Banking', 'banking': 'Banking', 'psu bank': 'Banking', 'private bank': 'Banking', 'hdfc': 'Banking', 'icici': 'Banking', 'sbi': 'Banking',
  // Infrastructure
  'infrastructure': 'Infrastructure', 'infra': 'Infrastructure', 'roads': 'Infrastructure', 'highway': 'Infrastructure', 'port': 'Infrastructure', 'airport': 'Infrastructure',
  // Apparel
  'apparel': 'Apparel', 'fashion': 'Apparel', 'garment': 'Apparel', 'clothing': 'Apparel', 'wear': 'Apparel',
  // Oil & Gas
  'oil': 'Oil & Gas', 'gas': 'Oil & Gas', 'oil gas': 'Oil & Gas', 'energy': 'Oil & Gas', 'petroleum': 'Oil & Gas', 'refinery': 'Oil & Gas', 'petrochemical': 'Oil & Gas',
  // Renewables
  'renewable': 'Renewables', 'renewables': 'Renewables', 'solar': 'Renewables', 'wind': 'Renewables', 'green energy': 'Renewables', 'clean energy': 'Renewables',
  // Steel
  'steel': 'Steel', 'iron': 'Steel', 'ferrous': 'Steel',
  // Exchanges & Broking
  'exchange': 'Exchanges & Broking', 'exchanges': 'Exchanges & Broking', 'broking': 'Exchanges & Broking', 'broker': 'Exchanges & Broking', 'stock exchange': 'Exchanges & Broking', 'bse': 'Exchanges & Broking', 'nse exchange': 'Exchanges & Broking',
  // Retail
  'retail': 'Retail', 'supermarket': 'Retail', 'ecommerce': 'Retail', 'e-commerce': 'Retail', 'd-mart': 'Retail', 'dmart': 'Retail', 'mart': 'Retail',
  // Cement
  'cement': 'Cement', 'concrete': 'Cement',
  // Healthcare
  'healthcare': 'Healthcare', 'health': 'Healthcare', 'medical': 'Healthcare', 'wellness': 'Healthcare',
  // Jewellery
  'jewellery': 'Jewellery', 'jewelry': 'Jewellery', 'gold': 'Jewellery', 'diamond': 'Jewellery', 'gems': 'Jewellery', 'titan': 'Jewellery',
  // Power
  'power': 'Power', 'electricity': 'Power', 'thermal': 'Power', 'hydro': 'Power', 'nuclear': 'Power', 'transmission': 'Power',
  // Telecom
  'telecom': 'Telecom', 'telco': 'Telecom', 'telecomm': 'Telecom', 'mobile': 'Telecom', 'broadband': 'Telecom', 'jio': 'Telecom', 'airtel': 'Telecom',
  // Pipes & Fittings
  'pipe': 'Pipes & Fittings', 'pipes': 'Pipes & Fittings', 'fitting': 'Pipes & Fittings', 'fittings': 'Pipes & Fittings', 'plumbing': 'Pipes & Fittings',
  // Auto
  'auto': 'Auto', 'automobile': 'Auto', 'automotive': 'Auto', 'car': 'Auto', 'vehicle': 'Auto', 'two wheeler': 'Auto', 'commercial vehicle': 'Auto', 'cv': 'Auto',
  // Fintech
  'fintech': 'Fintech', 'payments': 'Fintech', 'payment': 'Fintech', 'digital payment': 'Fintech', 'wallet': 'Fintech',
  // Hospitals
  'hospital': 'Hospitals', 'hospitals': 'Hospitals', 'clinic': 'Hospitals', 'healthcare facility': 'Hospitals', 'apollo': 'Hospitals', 'fortis': 'Hospitals',
  // EMS Electronics
  'ems': 'EMS Electronics', 'electronic manufacturing': 'EMS Electronics', 'electronics manufacturing': 'EMS Electronics', 'contract manufacturing': 'EMS Electronics', 'pcb': 'EMS Electronics', 'syrma': 'EMS Electronics',
  // Internet & New Age
  'internet': 'Internet & New Age', 'new age': 'Internet & New Age', 'startup': 'Internet & New Age', 'digital': 'Internet & New Age', 'platform': 'Internet & New Age', 'saas': 'Internet & New Age', 'app': 'Internet & New Age',
  // Fertilisers
  'fertiliser': 'Fertilisers', 'fertilizer': 'Fertilisers', 'fertilisers': 'Fertilisers', 'urea': 'Fertilisers', 'npk': 'Fertilisers',
  // Cables & Wires
  'cable': 'Cables & Wires', 'cables': 'Cables & Wires', 'wire': 'Cables & Wires', 'wires': 'Cables & Wires', 'conductor': 'Cables & Wires',
  // IT Products
  'it products': 'IT Products', 'hardware': 'IT Products', 'computer': 'IT Products', 'laptop': 'IT Products',
  // Asset Management
  'asset management': 'Asset Management', 'amc': 'Asset Management', 'mutual fund': 'Asset Management', 'fund': 'Asset Management',
  // Defence
  'defence': 'Defence', 'defense': 'Defence', 'military': 'Defence', 'army': 'Defence', 'navy': 'Defence', 'aerospace defence': 'Defence', 'bharat': 'Defence', 'hal': 'Defence', 'bel': 'Defence', 'drdo': 'Defence',
  // Insurance
  'insurance': 'Insurance', 'insurer': 'Insurance', 'life insurance': 'Insurance', 'general insurance': 'Insurance',
  // Paints & Coatings
  'paint': 'Paints & Coatings', 'paints': 'Paints & Coatings', 'coating': 'Paints & Coatings', 'coatings': 'Paints & Coatings', 'asian paints': 'Paints & Coatings',
  // Shipping
  'shipping': 'Shipping', 'maritime': 'Shipping', 'vessel': 'Shipping', 'fleet': 'Shipping',
  // Diagnostics
  'diagnostics': 'Diagnostics', 'diagnostic': 'Diagnostics', 'pathology': 'Diagnostics', 'lab': 'Diagnostics', 'testing': 'Diagnostics',
  // Packaging
  'packaging': 'Packaging', 'pack': 'Packaging', 'container': 'Packaging', 'bottle': 'Packaging',
  // Aerospace & Aviation
  'aerospace': 'Aerospace', 'aviation': 'Aviation', 'airline': 'Aviation', 'aircraft': 'Aerospace', 'satellite': 'Aerospace', 'space': 'Aerospace',
  // Financial Services
  'financial services': 'Financial Services', 'financial': 'Financial Services',
  // Semiconductors
  'semiconductor': 'Semiconductors', 'chip': 'Semiconductors', 'fab': 'Semiconductors',
  // Plastics
  'plastic': 'Plastics', 'plastics': 'Plastics', 'polymer': 'Plastics', 'pvc': 'Plastics',
  // Consumer (catch-all after more specific ones)
  'consumer': 'FMCG',
  // Finance (catch-all)
  'finance': 'NBFC',
}

const SEARCH_LS_KEY = 'pinex_searches_v1'
const MAX_STORED = 6

const trackSearch = (query) => {
  try {
    const raw = localStorage.getItem(SEARCH_LS_KEY)
    const existing = raw ? JSON.parse(raw) : []
    const updated = [query, ...existing.filter(q => q !== query)].slice(0, MAX_STORED)
    localStorage.setItem(SEARCH_LS_KEY, JSON.stringify(updated))
  } catch {}
}

const getMostSearched = () => {
  try {
    const raw = localStorage.getItem(SEARCH_LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

// ── isQuestion ────────────────────────────────────────────────────────────
// True when the smart-search text looks like a natural-language question
// rather than a stock/sector lookup. Used to decide whether to surface
// the Research Assistant "Ask" CTA below the search results.
//
// Heuristics (any one triggers):
//   - ends with "?"
//   - first word is how/what/why/when/which/explain/tell/show/compare
//   - more than 4 words AND parseSmartQuery returns no_match (stock-name
//     fallthrough handled by caller — we just check word count here)
const QUESTION_STARTERS = new Set([
  'how', 'what', 'why', 'when', 'which',
  'explain', 'tell', 'show', 'compare',
])
function isQuestion(query) {
  const s = String(query || '').trim()
  if (!s) return false
  if (s.endsWith('?')) return true
  const first = s.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '')
  if (QUESTION_STARTERS.has(first)) return true
  if (s.split(/\s+/).filter(Boolean).length > 4) return true
  return false
}

const parseSmartQuery = (query, allStocks, market) => {
  const q = query.toLowerCase().trim()
  if (!q) return null

  // STOCK LOOKUP
  const exactMatch = allStocks.find(s => s.symbol?.toLowerCase() === q)
  if (exactMatch) return { type: 'stock', stock: exactMatch }

  if (q.length >= 2) {
    const nameExact = (s) => s.name?.toLowerCase() === q
    const symStart  = (s) => s.symbol?.toLowerCase().startsWith(q)
    const nameStart = (s) => s.name?.toLowerCase().startsWith(q)
    const nameInc   = (s) => s.name?.toLowerCase().includes(q)
    const symInc    = (s) => s.symbol?.toLowerCase().includes(q)
    const matches = allStocks
      .filter(s => symStart(s) || nameInc(s) || symInc(s))
      .sort((a, b) => {
        const rank = s => nameExact(s) ? 0 : symStart(s) ? 1 : nameStart(s) ? 2 : nameInc(s) ? 3 : 4
        return rank(a) - rank(b)
      })
      .slice(0, 20)
    if (matches.length === 1) return { type: 'stock', stock: matches[0] }
    if (matches.length > 1) return { type: 'stock_list', stocks: matches, label: `Stocks matching "${query}"` }
  }

  // SECTOR LOOKUP — three-pass: exact → contains → prefix
  let matchedSector = null
  for (const [key, sector] of Object.entries(SECTOR_MAP)) {
    if (q === key) { matchedSector = sector; break }
  }
  if (!matchedSector) {
    for (const [key, sector] of Object.entries(SECTOR_MAP)) {
      if (q.includes(key)) { matchedSector = sector; break }
    }
  }
  if (!matchedSector && q.length >= 3) {
    for (const [key, sector] of Object.entries(SECTOR_MAP)) {
      if (key.startsWith(q)) { matchedSector = sector; break }
    }
  }
  if (matchedSector) {
    const sectorStocks = allStocks
      .filter(s => s.sector?.toLowerCase().includes(matchedSector.toLowerCase()) || s.sector === matchedSector)
      .sort((a, b) => (b.rs_vs_nifty || -999) - (a.rs_vs_nifty || -999))
    if (sectorStocks.length > 0) {
      return {
        type: 'sector', sector: matchedSector,
        stocks: sectorStocks,
        stage2: sectorStocks.filter(s => s.stage === 'Stage 2').length,
        swingx: sectorStocks.filter(s => s.high_conviction).length,
      }
    }
  }

  // MARKET QUERIES
  if (q.includes('market') || q.includes('nifty') ||
      q.includes('breadth') || q.includes('vix')) {
    return { type: 'market', market }
  }

  // SWINGX
  if (q.includes('swingx') || q.includes('swing x') ||
      q.includes('aligned') || q.includes('all conditions') || q.includes('best')) {
    const swingx = allStocks
      .filter(s => s.high_conviction)
      .sort((a, b) => (b.rs_vs_nifty || -999) - (a.rs_vs_nifty || -999))
    return { type: 'filter', label: 'SwingX — Stocks matching SwingX criteria', stocks: swingx, filter: 'highconviction' }
  }

  // STAGE 2
  if (q.includes('stage 2') || q.includes('uptrend') ||
      q.includes('established') || q.includes('advancing')) {
    const s2 = allStocks
      .filter(s => s.stage === 'Stage 2')
      .sort((a, b) => (b.rs_vs_nifty || -999) - (a.rs_vs_nifty || -999))
    return { type: 'filter', label: 'Stage 2 Parameter Scan · Price > 30W Trend Line + Positive RS', stocks: s2, filter: 'stage2' }
  }

  // NEW ENTRIES
  if (q.includes('new') || q.includes('entered') || q.includes('fresh') || q.includes('just')) {
    const fresh = allStocks
      .filter(s => s.stage === 'Stage 2' && s.breakout_30wma === true)
      .sort((a, b) => (b.rs_vs_nifty || -999) - (a.rs_vs_nifty || -999))
    return { type: 'filter', label: 'New Stage 2 Entries', stocks: fresh, filter: 'breakout30w' }
  }

  // DELIVERY
  if (q.includes('delivery') || q.includes('institutional') || q.includes('participation')) {
    const del = allStocks
      .filter(s => (s.avg_delivery_30d || 0) > 50)
      .sort((a, b) => (b.avg_delivery_30d || 0) - (a.avg_delivery_30d || 0))
    return { type: 'filter', label: 'High Participation Stocks', stocks: del, filter: 'delivery' }
  }

  // CLEAN OWNERSHIP
  if (q.includes('pledge') || q.includes('clean') ||
      q.includes('promoter') || q.includes('ownership')) {
    const clean = allStocks
      .filter(s => (s.promoter_pledge_pct === 0 || s.promoter_pledge_pct == null) && s.stage === 'Stage 2')
      .sort((a, b) => (b.rs_vs_nifty || -999) - (a.rs_vs_nifty || -999))
    return { type: 'filter', label: 'Clean Ownership in Stage 2', stocks: clean, filter: 'cleanpromoters' }
  }

  // WATCHLIST
  if (q.includes('watchlist') || q.includes('watch') ||
      q.includes('my stocks') || q.includes('portfolio')) {
    return { type: 'watchlist' }
  }

  // SECTORS
  if (q.includes('sector') || q.includes('strong sector') || q.includes('leading')) {
    return { type: 'sectors', label: 'Sector Performance' }
  }

  return { type: 'no_match', query }
}

export default function Home() {
  const { user, profile, loading: authLoading } = useAuth()
  const { hasScreenerAccess, hasSwingXAccess } = useAcademy()
  // Soft-gate for anonymous visitors. requireAuth() returns true when
  // the user is signed in (caller proceeds) and false when anonymous
  // (the global signup bottom-sheet is opened and the caller should
  // bail out). Used to gate the search input, stock-row clicks, and
  // sector tile clicks.
  const { requireAuth } = useSignupPrompt()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // WHY: Click-time gate for sector cards.
  // /home?tab=sectors is itself ungated (so users
  // can browse the sector grid), but drilling
  // INTO a sector reveals the filtered stocks
  // list — which requires academy. Pre-empt the
  // click with a bottom-sheet prompt instead of
  // a hard navigation.
  const [showAcademyPrompt, setShowAcademyPrompt] = useState(false)
  // WHY: SwingX gate — fired when a user without
  // SwingX access clicks the SwingX chip / tile,
  // or types "swingx" in the search bar. We
  // reuse the same AcademyRequired bottom-sheet
  // (level="swingx") so messaging + visual is
  // consistent with the sector + route gates.
  const [showSwingXGate, setShowSwingXGate] = useState(false)
  const [allStocks, setAllStocks] = useState([])
  const [market, setMarket] = useState(null)
  const [marketSignals, setMarketSignals] = useState([])
  const [marketHistory, setMarketHistory] = useState([])
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [search, setSearch] = useState('')
  const [smartQuery, setSmartQuery] = useState('')
  const [smartResults, setSmartResults] = useState(null)
  const [screenerSortKey, setScreenerSortKey] = useState('rs') // sort the screener results by value
  const [screenerSortDir, setScreenerSortDir] = useState('desc') // 'asc' | 'desc'
  // Optional, India-specific delivery filter layered on top of the SwingX
  // results (client-side only — does NOT touch fetch logic).
  const [deliveryFilter, setDeliveryFilter] = useState(false)
  // Multi-dimensional screener filter sheet (sector / 30W action / volume / RS /
  // delivery / RSI / pledge). Applying it sets smartResults to the matched list.
  const [showFilters, setShowFilters] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [mostSearched, setMostSearched] = useState([])
  const [activeFilter, setActiveFilter] = useState(() => {
    const saved = localStorage.getItem('pinex_filter')
    if (!saved || saved === 'highconviction') return 'all'
    return saved
  })
  const [sortCol, setSortCol] = useState('rs_vs_nifty')
  const [sortDir, setSortDir] = useState(-1)
  const [page, setPage] = useState(0)
  const [sectorTf, setSectorTf] = useState('1W')
  const [homeTab, setHomeTab] = useState('search')
  const [sectorFilter, setSectorFilter] = useState(null)
  const [sectorRowHover, setSectorRowHover] = useState(null)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)
  const [showSectorShare, setShowSectorShare] = useState(false)
  const [signalsOpen, setSignalsOpen] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [swingxDelta, setSwingxDelta] = useState(null)
  const [signalObservations, setSignalObservations] = useState([])
  const [mostWatched, setMostWatched] = useState([])
  // (Old buried Screens-tab invite banner removed — its sessionStorage
  // dismiss flag is no longer needed. The top-of-Home card uses
  // localStorage['pinex_top_invite_dismissed'] with a date key instead.)
  const [inviteCredits, setInviteCredits] = useState(0)
  // Invite code for the top-of-Home invite card. Null until the
  // profile fetch resolves OR if the profile has no code yet
  // (the Dashboard InviteSection auto-generates one in that case;
  // here we just hide the card to avoid an empty-link state).
  const [inviteCode, setInviteCode] = useState(null)
  // Per-session dismiss for the top Home invite card. Stored in
  // localStorage with a date key so it reappears the next day.
  const [topInviteDismissed, setTopInviteDismissed] = useState(() => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      return localStorage.getItem('pinex_top_invite_dismissed') === today
    } catch { return false }
  })
  const [inviteCopied, setInviteCopied] = useState(false)
  const PER_PAGE = 10

  // ── Research Assistant (BYOK Gemini) state ──────────────────────────────
  // hasResearchKey  - true when localStorage has pinex_gemini_key. Drives
  //                   the placeholder copy, the "Ask AI" CTA, and the
  //                   inline panel. Re-read on mount + a fresh focus event
  //                   so the user gets immediate feedback after saving
  //                   their key on Account and navigating back here.
  // searchPulse     - one-shot amber glow on the search bar that fires
  //                   when we land on Home after a save (the cross-page
  //                   handoff is localStorage['pinex_key_just_saved']).
  //                   The flag is cleared as soon as it's consumed so
  //                   the pulse doesn't re-fire on tab switches.
  // aiPanel         - the inline AI conversation panel below the search
  //                   bar. null when closed; { question, loading, answer,
  //                   refused, error } when active. Spec says only one
  //                   question/answer pair at a time — submitting a new
  //                   question replaces the previous answer.
  const [hasResearchKey, setHasResearchKey] = useState(() => Boolean(getStoredGeminiKey()))
  const [searchPulse, setSearchPulse]       = useState(false)
  const [aiPanel, setAiPanel]               = useState(null)

  // Re-check the key flag on mount (the user may have saved it on another
  // tab/page and navigated here). Also handles the cross-page handoff:
  // if pinex_key_just_saved is set, consume it and trigger the pulse.
  useEffect(() => {
    setHasResearchKey(Boolean(getStoredGeminiKey()))
    try {
      const flag = localStorage.getItem('pinex_key_just_saved')
      if (flag) {
        localStorage.removeItem('pinex_key_just_saved')
        // Defer the pulse to next paint so the user sees the bar already
        // mounted before it lights up.
        requestAnimationFrame(() => setSearchPulse(true))
      }
    } catch {}
  }, [])

  // Listen for localStorage changes from OTHER tabs (the user might add
  // their key from a second Account tab while Home is open).
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'pinex_gemini_key') {
        setHasResearchKey(Boolean(getStoredGeminiKey()))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Compute condensed market context for the AI prompt. Recomputes when
  // sectors / market change; cheap to redo.
  const aiMarketContext = useMemo(() => {
    const breadthPct = market?.above_ma150_pct ?? market?.stage2_pct ?? null
    const topSectors = (sectors || [])
      .slice()
      .sort((a, b) => (b.chg_1d || 0) - (a.chg_1d || 0))
      .slice(0, 5)
      .map(s => s.display_name || s.index_name)
      .filter(Boolean)
    return {
      breadthPct: breadthPct != null ? Number(breadthPct).toFixed(0) : null,
      topSectors,
      today: new Date().toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      }),
    }
  }, [market, sectors])

  // Show the "Ask your research assistant" CTA when:
  //   - user has saved a key
  //   - the typed query reads like a question
  //   - the query isn't a single direct stock hit (those take priority)
  const showAiCta =
    hasResearchKey &&
    smartQuery.trim().length > 1 &&
    isQuestion(smartQuery) &&
    aiPanel === null &&
    !(smartResults && smartResults.type === 'stock')

  // Open the inline AI panel for the current question. Closes the search
  // results so the answer gets visual focus.
  function openAiPanel(question) {
    const q = String(question || '').trim()
    if (!q) return
    // Local blocked-word filter — never even reach the network for these.
    if (isBlockedQuestion(q)) {
      setAiPanel({ question: q, loading: false, answer: '', refused: true, error: '' })
      return
    }
    setAiPanel({ question: q, loading: true, answer: '', refused: false, error: '' })

    // Build the system prompt context from current market state. Asking
    // a question with no market context still works (Gemini will answer
    // the general question), but giving it the breadth + top sectors
    // grounds the answer in today's market regime.
    const context = {
      symbol: null,
      companyName: null,
      sector: null,
      narrative: aiMarketContext.breadthPct
        ? `Market context — ${aiMarketContext.today}. ` +
          `Breadth: ${aiMarketContext.breadthPct}% of NSE stocks above the 30-week trend line. ` +
          (aiMarketContext.topSectors.length
            ? `Strongest sectors today: ${aiMarketContext.topSectors.join(', ')}. `
            : '') +
          'You are answering a general market question from the home search — ' +
          'not a stock-specific one. Stay focused on Indian-market cycle ' +
          'analysis concepts and end by suggesting they search for a ' +
          'specific stock on PineX for stock-level analysis.'
        : null,
    }

    askGemini(q, context)
      .then(({ text, usage, finishReason, responseTimeMs }) => {
        setAiPanel(prev => prev ? { ...prev, loading: false, answer: text } : prev)
        // Fire-and-forget usage + points. Neither blocks the panel.
        logResearchUsage({
          userId: user?.id,
          symbol: null,
          contextType: 'home_search',
          category: 'freetext',
          usage,
          finishReason,
          responseTimeMs,
        })
        if (user?.id) {
          awardPoints(user.id, 'research_question', {
            fallbackPoints: 2,
            notes: 'Research from home search',
            referenceId: null,
          }).catch(() => {})
        }
      })
      .catch(err => {
        // SAFETY-blocked also lands here — surface the friendly message
        // but still log the event so admins see the blocked count.
        if (err && err.code === 'SAFETY') {
          logResearchUsage({
            userId: user?.id,
            symbol: null,
            contextType: 'home_search',
            category: 'freetext',
            usage: err.usage,
            finishReason: err.finishReason || 'SAFETY',
            responseTimeMs: err.responseTimeMs,
          })
        }
        setAiPanel(prev => prev ? {
          ...prev,
          loading: false,
          error: err?.message || 'Could not reach Gemini. Try again.',
        } : prev)
      })
  }

  const [isSepiaMode, setIsSepiaMode] = useState(
    document.documentElement.getAttribute('data-theme') === 'sepia'
  )
  useEffect(() => {
    const sync = () => setIsSepiaMode(document.documentElement.getAttribute('data-theme') === 'sepia')
    window.addEventListener('pinex-theme-change', sync)
    return () => window.removeEventListener('pinex-theme-change', sync)
  }, [])

  // Once auth resolves, give logged-in users SwingX as default.
  // Guests stay on stage2 (set above). Only fires once on first auth resolution.
  const defaultFilterSet = useRef(false)
  useEffect(() => {
    if (authLoading || defaultFilterSet.current) return
    defaultFilterSet.current = true
    if (user) setActiveFilter('highconviction')
  }, [authLoading, user])

  useEffect(() => {
    if (!allStocks.length) return
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const current = allStocks.filter(s => s.high_conviction).length
    const prevStr = localStorage.getItem('pinex_swingx_' + yesterday)
    if (prevStr) {
      const prev = parseInt(prevStr, 10)
      if (!isNaN(prev) && prev > 0) setSwingxDelta(current - prev)
    }
    try { localStorage.setItem('pinex_swingx_' + today, String(current)) } catch {}
  }, [allStocks])

  useEffect(() => {
    supabase
      .from('signal_outcomes')
      .select(
        'symbol, signal_type, signal_date, ' +
        'signal_price, outcome_date, ' +
        'outcome_price, change_pct, ' +
        'days_held, sector, ' +
        'stage_at_signal, substage_at_signal'
      )
      .order('signal_date', { ascending: false })
      .limit(8)
      .then(({ data }) => { if (data?.length) setSignalObservations(data) })
      .catch(() => {})
  }, [])


  useEffect(() => {
    setMostSearched(getMostSearched())
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'sectors') setHomeTab('sectors')
    else if (t === 'screens') setHomeTab('screens')
    else if (t === 'stocks' || t === 'search') setHomeTab('search')
  }, [searchParams])

  const handleSectorClick = (sectorName) => {
    // Anonymous-visitor gate: drilling into a sector should also
    // surface the signup prompt, not silently filter. requireAuth()
    // opens the bottom-sheet for anon and returns false; we bail.
    if (!requireAuth()) return
    // WHY: Drilling into a sector exposes the
    // filtered stocks list — which is academy-
    // gated. Show the bottom-sheet prompt
    // instead of silently filtering, so the
    // user understands why nothing happened.
    if (user && profile && !hasScreenerAccess) {
      setShowAcademyPrompt(true)
      return
    }
    markHomeBackToSectorsTab(location.pathname)
    const r = parseSmartQuery(sectorName.toLowerCase(), allStocks, market)
    setSmartQuery(sectorName)
    setSmartResults(r)
    setSectorFilter(null)
    setActiveFilter('all')
    setSearch('')
    setPage(0)
    setHomeTab('screens')
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('tab', 'screens')
        return p
      },
      { replace: false },
    )
    requestAnimationFrame(() => {
      document.getElementById('screens-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const loadRef = React.useRef(null)
  const searchInputRef = useRef(null)

  useEffect(() => {
    // WHY: Supabase calls can hang indefinitely
    // when the project is paused, the region is
    // unreachable, or a session token is stale.
    // withTimeout races each query against a 15s
    // timer so the page surfaces a clear error
    // banner instead of an infinite spinner.
    const withTimeout = (promise, ms = 15000) => {
      const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s — Supabase may be unreachable`)), ms)
      )
      return Promise.race([promise, timer])
    }

    // Defensive dedupe by symbol — the upstream mv_home_stocks view
    // and the direct price_data fallback can both emit two rows per
    // symbol when `is_latest=true` ends up set on multiple price_data
    // dates for the same company (a pipeline-repair edge case). The
    // search box was showing the same stock twice with slightly
    // different prices (BIOCON at ₹416.8 AND ₹416.1, ANTHEM at ₹755.6
    // AND ₹745.5). Keep the row with the latest `date` if present,
    // else first occurrence wins. Symbol-insensitive (upper-cased
    // key) so casing drift in upstream tables doesn't slip through.
    const dedupeBySymbol = (rows) => {
      const best = new Map()
      for (const r of rows || []) {
        const sym = r?.symbol ? String(r.symbol).toUpperCase() : null
        if (!sym) continue
        const existing = best.get(sym)
        if (!existing) { best.set(sym, r); continue }
        const aDate = String(r.date || '')
        const bDate = String(existing.date || '')
        if (aDate > bDate) best.set(sym, r)
      }
      return Array.from(best.values())
    }

    const processStocks = (stocks) => {
      const merged = (stocks || []).map(c => ({
        ...c,
        delivery: c.avg_delivery_30d,
        delivery_trend: c.delivery_trend_30d,
        pledge: c.promoter_pledge_pct || 0,
        obv_slope: parseFloat(c.obv_slope) || 0,
        pct_from_ma: c.close && c.ma30w ? ((c.close - c.ma30w) / c.ma30w * 100) : null,
        high_conviction: Boolean(c.high_conviction),
      }))
      const rsVals = merged.filter(r => r.rs_vs_nifty != null).map(r => r.rs_vs_nifty).sort((a, b) => a - b)
      return merged.map(s => ({
        ...s,
        rs_rating: s.rs_vs_nifty != null && rsVals.length
          ? Math.max(1, Math.round((rsVals.filter(v => v <= s.rs_vs_nifty).length / rsVals.length) * 99))
          : null,
        ai_pulse: s.stage === 'Stage 2' && s.obv_slope > 0.01 ? 'Uptrend'
          : s.stage === 'Stage 4' || s.obv_slope < -0.02 ? 'Watch' : 'Neutral',
      }))
    }

    const applyData = (withR, mktRow, hist, sec) => {
      setAllStocks(withR)
      setMarket(mktRow)
      const h = hist || []
      setMarketHistory(h)
      setMarketSignals(buildMarketSignals(h))
      const latestDate = sec?.[0]?.date
      setSectors((sec || []).filter(s => s.date === latestDate))
    }

    const load = async (background = false) => {
      if (!background) { setLoading(true); setFetchError(null) }
      try {
        const [
          { data: p0, error: viewErr },
          { data: p1 },
          { data: p2 },
          { data: mkt },
          { data: mktHistory },
          { data: sec },
          // WHY: mv_home_stocks may or may not carry the company
          // `name` column depending on when the materialized view
          // was last rebuilt. Search by company name (parseSmartQuery
          // uses `s.name?.toLowerCase().includes(q)`) silently fails
          // when name is missing. We always pull a lightweight
          // {id, name, sector} map from the companies table in
          // parallel and merge it in below so name-search works
          // regardless of view state. Paginated 3-way to defeat
          // PostgREST's server-side max-rows cap (see comment below).
          { data: cE0 },
          { data: cE1 },
          { data: cE2 },
        // WHY: Supabase enforces a 1000-row
        // limit per query even with .limit()
        // removed. We fetch 3 pages of 1000
        // to get all 2125+ NSE stocks.
        ] = await Promise.all([
          withTimeout(supabase.from('mv_home_stocks').select('*').order('symbol').range(0, 999)),
          withTimeout(supabase.from('mv_home_stocks').select('*').order('symbol').range(1000, 1999)),
          withTimeout(supabase.from('mv_home_stocks').select('*').order('symbol').range(2000, 2999)),
          withTimeout(supabase.from('market_internals').select('*').order('date', { ascending: false }).limit(1)),
          withTimeout(supabase.from('market_internals')
            .select('date,nifty_close,new_52w_highs,new_52w_lows,above_ma150_pct,stage2_pct,india_vix,nifty_consecutive_up,nifty_consecutive_down')
            .order('date', { ascending: false }).limit(10)),
          withTimeout(supabase.from('nifty_sectors').select('*').order('date', { ascending: false }).limit(32)),
          // WHY 3 ranges, not range(0, 2999): PostgREST's server-side
          // `max-rows` setting (1000 on Supabase by default) silently
          // caps a single .range(0, 2999) to the first 1000 rows. We
          // paginate the same way we do for mv_home_stocks above so
          // every company carries through to the name/sector
          // enrichment — otherwise stocks past row 1000 (alphabetical
          // by id) end up with null sector and parseSmartQuery's
          // sector search ("pharma", "banking", etc.) returns nothing.
          withTimeout(supabase.from('companies').select('id,symbol,name,sector').order('symbol').range(0, 999)),
          withTimeout(supabase.from('companies').select('id,symbol,name,sector').order('symbol').range(1000, 1999)),
          withTimeout(supabase.from('companies').select('id,symbol,name,sector').order('symbol').range(2000, 2999)),
        ])
        // Build symbol → {name, sector} index for the enrichment
        // step. Keyed by symbol (rather than id) because not every
        // mv_home_stocks row necessarily carries company_id. Falls
        // back to id-lookup below if symbol is missing.
        const enrichBySymbol = {}
        const enrichById = {}
        const companyEnrich = [...(cE0 || []), ...(cE1 || []), ...(cE2 || [])]
        for (const c of companyEnrich) {
          if (c?.symbol) enrichBySymbol[String(c.symbol).toUpperCase()] = c
          if (c?.id) enrichById[c.id] = c
        }
        const enrich = (row) => {
          if (!row) return row
          const key = row.symbol ? String(row.symbol).toUpperCase() : null
          const hit = (key && enrichBySymbol[key]) || (row.company_id && enrichById[row.company_id]) || null
          if (!hit) return row
          return {
            ...row,
            // Only fill from the companies table when the view
            // didn't carry the column (or carried the symbol as a
            // null-name placeholder). The view's value wins when
            // present and meaningful.
            name: (row.name && String(row.name).trim()) || hit.name || row.symbol,
            sector: (row.sector && String(row.sector).trim()) || hit.sector || row.sector,
          }
        }

        const mvBatch = dedupeBySymbol(
          [...(p0 || []), ...(p1 || []), ...(p2 || [])].map(enrich),
        )

        // ── COMPANIES-TABLE FALLBACK ──────────────────────────────
        // WHY: mv_home_stocks can be empty/stale — most recently the
        // is_latest=true flag on price_data was wiped (only 12 of
        // ~2125 companies kept it), which made mv_home_stocks return
        // 12 rows total. Search box returned "No results" for every
        // query because allStocks was nearly empty.
        //
        // When the view is degraded, build allStocks from the
        // companies table directly so search keeps working against
        // the full universe. Stage / RS / close / volume stay empty
        // until the upstream is_latest repair lands — but symbol +
        // name + sector are enough for parseSmartQuery to match
        // "hdfc", "pharma", etc. and route to the stock detail
        // page, which loads its own price_data on demand.
        const SCREENER_MIN_ROWS = 100
        let firstBatch = mvBatch
        if (mvBatch.length < SCREENER_MIN_ROWS && companyEnrich.length > mvBatch.length) {
          console.warn(
            `[Home] mv_home_stocks returned only ${mvBatch.length} rows ` +
            `(expected ~2125). Falling back to companies + price_data ` +
            `(${companyEnrich.length} companies) so search stays usable.`
          )

          // Fetch the latest price row per company DIRECTLY from
          // price_data (same pattern as the viewErr fallback further
          // down). Paginated 3x1000 to defeat PostgREST's max-rows
          // cap. Joined by company_id below.
          const priceCols = 'company_id,close,open,high,low,volume,stage,ma30w,ma30w_slope,ma50,ma150,rs_vs_nifty,mansfield_rs,rsi,high_52w,low_52w,price_change_1d,weinstein_substage,obv_slope'
          const [pdA, pdB, pdC] = await Promise.all([
            withTimeout(supabase.from('price_data').select(priceCols).eq('is_latest', true).order('company_id').range(0, 999)),
            withTimeout(supabase.from('price_data').select(priceCols).eq('is_latest', true).order('company_id').range(1000, 1999)),
            withTimeout(supabase.from('price_data').select(priceCols).eq('is_latest', true).order('company_id').range(2000, 2999)),
          ])
          const priceRows = [
            ...((pdA && pdA.data) || []),
            ...((pdB && pdB.data) || []),
            ...((pdC && pdC.data) || []),
          ]
          console.warn(`[Home] price_data is_latest=true returned ${priceRows.length} rows`)

          // Index price rows by company_id for O(1) join.
          const priceMap = {}
          for (const p of priceRows) {
            if (p?.company_id) priceMap[p.company_id] = p
          }

          firstBatch = companyEnrich.map(c => {
            const p = priceMap[c.id] || {}
            return {
              id: c.id,
              symbol: c.symbol,
              name: c.name,
              sector: c.sector,
              // Spread price_data fields onto the row so ResultRow's
              // CMP / RS / 30W Trend / etc. render real values instead
              // of '—'. When a company has no is_latest row, p is {}
              // and those fields stay undefined → render '—' (safe
              // after the null-guard fixes in ResultRow).
              ...p,
            }
          })
        }

        let mktRow = mkt?.[0] || null
        if (mktRow && (mktRow.india_vix == null || mktRow.india_vix === '')) {
          const { data: vixRow } = await supabase
            .from('market_internals').select('india_vix')
            .not('india_vix', 'is', null).order('date', { ascending: false }).limit(1).maybeSingle()
          if (vixRow?.india_vix != null) mktRow = { ...mktRow, india_vix: vixRow.india_vix }
        }

        if (viewErr) {
          // View not available — fall back to direct price_data query
          const { data: fallback, error: fbErr } = await withTimeout(
            supabase.from('price_data')
              .select('id,company_id,close,stage,rs_vs_nifty,ma30w,ma50,volume,rsi,high_52w,low_52w,obv_slope')
              .eq('is_latest', true).limit(2000)
          )
          if (!fbErr && fallback?.length) {
            const { data: companies } = await withTimeout(
              supabase.from('companies').select('id,symbol,name,sector,tier').limit(3000)
            )
            const cMap = {}
            for (const c of companies || []) cMap[c.id] = c
            const merged = dedupeBySymbol(
              fallback.map(p => ({ ...p, ...(cMap[p.company_id] || {}) })),
            )
            const withR = processStocks(merged)
            applyData(withR, mktRow, mktHistory, sec)
            setCache(withR, mktRow, sec)
          }
          return
        }

        const withR = processStocks(firstBatch || [])
        applyData(withR, mktRow, mktHistory, sec)
        if (!background) setLoading(false)
        setCache(withR, mktRow, sec)
      } catch (e) {
        console.error('[Home] load error:', e)
        if (!background) setFetchError(e?.message || String(e))
      } finally {
        if (!background) setLoading(false)
      }
    }

    loadRef.current = () => load(false)

    const cached = getCached()
    if (cached?.stocks?.length) {
      setAllStocks(cached.stocks)
      setMarket(cached.market || null)
      if (cached.sectors?.length) {
        const latestDate = cached.sectors[0]?.date
        setSectors(cached.sectors.filter(s => s.date === latestDate))
      }
      setLoading(false)
      // Background refresh after 30s — don't block the instant render
      setTimeout(() => load(true), 30000)
    } else {
      load(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('invite_code, invite_credits')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setInviteCredits(data?.invite_credits || 0)
        setInviteCode(data?.invite_code || null)
      })
  }, [user?.id])

  useEffect(() => {
    if (homeTab !== 'watched') return
    supabase
      .from('watchlists')
      .select('symbol')
      .not('symbol', 'is', null)
      .then(({ data }) => {
        if (!data?.length) return
        const counts = {}
        data.forEach(r => { counts[r.symbol] = (counts[r.symbol] || 0) + 1 })
        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([symbol, count]) => ({ symbol, count }))
        setMostWatched(sorted)
      })
  }, [homeTab])

  // WHY: Keep the SwingX panel's stock list in sync with allStocks.
  // If the user opens the panel before load() resolves, parseSmartQuery
  // captured an empty allStocks closure and the panel is stuck on []
  // until they click again. As soon as allStocks lands (initial load
  // or 30s background refresh), re-parse so today's high-conviction
  // names appear without requiring another interaction.
  useEffect(() => {
    if (!smartResults || !allStocks.length) return
    const isSwingX = smartResults.label?.toLowerCase().includes('swingx')
    if (!isSwingX) return
    const expected = allStocks.filter(s => s.high_conviction).length
    const have = smartResults.stocks?.length || 0
    if (expected === have) return
    const r = parseSmartQuery('swingx', allStocks, market)
    setSmartResults(r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStocks, market])

  // WHY: One-shot auto-retry when SwingX shows empty post-load.
  // Covers the corner case where the cached payload had 0
  // high-conviction rows (e.g. a day the pipeline was mid-run when
  // the user hit Home). After the timer fires, loadRef.current()
  // refreshes allStocks; the auto-reparse useEffect above then
  // surfaces fresh data. Locked behind a ref so we don't hammer
  // the API on a genuinely empty-SwingX day.
  const swingxRetryFiredRef = useRef(false)
  useEffect(() => {
    if (!smartResults || loading || swingxRetryFiredRef.current) return
    const isSwingX = smartResults.label?.toLowerCase().includes('swingx')
    if (!isSwingX) return
    if ((smartResults.stocks?.length || 0) > 0) return
    swingxRetryFiredRef.current = true
    const t = setTimeout(() => {
      if (loadRef.current) loadRef.current()
    }, 1200)
    return () => clearTimeout(t)
  }, [smartResults, loading])

  const counts = useMemo(() => ({
    stage2: allStocks.filter(s=>s.stage==='Stage 2').length,
    highconviction: allStocks.filter(s => s.high_conviction).length,
  }), [allStocks])

  const filtered = useMemo(() => {
    let r = [...allStocks]
    if (sectorFilter) {
      const sf = sectorFilter.toLowerCase()
      r = r.filter((s) => {
        const sec = (s.sector || '').toLowerCase()
        return sec.includes(sf) || sf.includes(sec)
      })
    }
    if (activeFilter==='all') { /* no filter */ }
    else if (activeFilter==='above50dma') r=r.filter(s=>s.close!=null&&s.ma50!=null&&s.close>s.ma50)
    else if (activeFilter==='stage2') r=r.filter(s=>s.stage==='Stage 2')
    else if (activeFilter==='highconviction') r=r.filter(s => s.high_conviction)
    else if (activeFilter==='accumulation') r=r.filter(s=>s.is_accumulation)
    else if (activeFilter==='distribution') r=r.filter(s=>s.is_distribution)
    else if (activeFilter==='breakout30w') r=r.filter(s=>s.breakout_30wma)
    else if (activeFilter==='breakdown30w') r=r.filter(s=>s.breakdown_30wma)
    else if (activeFilter==='highdelivery') r=r.filter(s=>s.delivery>55)
    else if (activeFilter==='clean') r=r.filter(s=>(!s.pledge||s.pledge===0)&&s.stage==='Stage 2')
    if (search) {
      const q=search.toLowerCase()
      r=r.filter(s=>s.symbol?.toLowerCase().includes(q)||
        (s.sector||'').toLowerCase().includes(q)||
        (s.name||'').toLowerCase().includes(q))
    }
    if (sortCol === 'rs_vs_nifty' && sortDir === -1) {
      r.sort((a, b) => {
        if (a.high_conviction && !b.high_conviction) return -1
        if (!a.high_conviction && b.high_conviction) return 1
        if (a.stage === 'Stage 2' && b.stage !== 'Stage 2') return -1
        if (a.stage !== 'Stage 2' && b.stage === 'Stage 2') return 1
        return (b.rs_vs_nifty || -999) - (a.rs_vs_nifty || -999)
      })
    } else {
      r.sort((a,b)=>{
        const nil = sortDir === 1 ? Infinity : -Infinity
        const av=a[sortCol]??nil, bv=b[sortCol]??nil
        return sortDir*(av-bv)
      })
    }
    return r
  }, [allStocks, activeFilter, search, sortCol, sortDir, sectorFilter])

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || q.length < 1) return []
    return allStocks
      .filter(s =>
        s.symbol?.toLowerCase().startsWith(q) ||
        s.name?.toLowerCase().includes(q) ||
        s.symbol?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const aStart = a.symbol?.toLowerCase().startsWith(q) ? 0 : 1
        const bStart = b.symbol?.toLowerCase().startsWith(q) ? 0 : 1
        return aStart - bStart
      })
      .slice(0, 7)
  }, [search, allStocks])

  const paginated = filtered.slice(page*PER_PAGE, (page+1)*PER_PAGE)
  const totalPages = Math.ceil(filtered.length/PER_PAGE)

  const handleSort = (col) => {
    if (sortCol===col) setSortDir(d=>d*-1)
    else { setSortCol(col); setSortDir(-1) }
    setPage(0)
  }

  // Builds the row set for the current sorted+filtered screener view.
  // Handed to <ExportMenu/>, which renders Excel / Google Sheets / PDF
  // (each format carries the factual-data disclaimer). Positioned as a
  // PRO feature, ungated for now.
  const screenerExportRows = () =>
    (filtered || []).map((s) => ({
      'Symbol': s.symbol,
      'Company': s.name || s.symbol,
      'Sector': s.sector || '',
      'Phase': s.stage || '',
      'Sub-phase': s.weinstein_substage || '',
      'CMP (Rs)': s.close ?? '',
      '% vs 30W Trend Line': s.pct_from_ma != null ? Number(s.pct_from_ma).toFixed(1) : '',
      'RS vs Nifty (%)': s.rs_vs_nifty ?? '',
      'Volume Ratio': s.vol_ratio ?? '',
      '1D Change %': s.price_change_1d ?? '',
      '7D Change %': s.price_change_7d ?? '',
      'Market Cap': s.cap_category || '',
    }))


  const sectorKey = sectorTf==='1D'?'change_1d':sectorTf==='1W'?'change_1w':sectorTf==='1M'?'change_1m':'change_3m'
  const sortedSectors = [...sectors].sort((a,b)=>(b[sectorKey]||0)-(a[sectorKey]||0))

  const closeSearch = () => { setSmartQuery(''); setSmartResults(null) }

  const SmartResultsPanel = () => {
    const { user } = useAuth()
    if (!smartResults) return null
    const results = smartResults

    // Sort the screener results by any value column. Price (CMP) is deliberately
    // not a sort option — absolute share price isn't a meaningful comparator
    // across stocks. State lives on the Home component so it survives across
    // result re-renders and new screens.
    const SCREENER_SORT_OPTS = [
      { key: 'rs', label: 'RS vs Nifty', get: (s) => s.rs_vs_nifty },
      { key: 'tl', label: '% from 30W Trend Line', get: (s) => (s.ma30w > 0 ? ((s.close - s.ma30w) / s.ma30w) * 100 : null) },
      { key: 'chg7', label: '1-week change %', get: (s) => s.price_change_7d },
      { key: 'pledge', label: 'Promoter pledge %', get: (s) => s.promoter_pledge_pct },
      { key: 'vol', label: 'Volume ratio', get: (s) => s.vol_ratio },
      { key: 'name', label: 'Name (A–Z)', get: (s) => s.name || s.symbol, str: true },
    ]
    const screenerSortOpt = SCREENER_SORT_OPTS.find((o) => o.key === screenerSortKey) || SCREENER_SORT_OPTS[0]
    const sortStocks = (stocks) => [...(stocks || [])].sort((a, b) => {
      const va = screenerSortOpt.get(a), vb = screenerSortOpt.get(b)
      const na = va == null || (typeof va === 'number' && Number.isNaN(va))
      const nb = vb == null || (typeof vb === 'number' && Number.isNaN(vb))
      if (na && nb) return 0
      if (na) return 1   // nulls always sink to the bottom
      if (nb) return -1
      const cmp = screenerSortOpt.str ? String(va).localeCompare(String(vb)) : (va - vb)
      return screenerSortDir === 'asc' ? cmp : -cmp
    })

    const SortBar = () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sort</span>
        <select value={screenerSortKey} onChange={(e) => setScreenerSortKey(e.target.value)}
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
          {SCREENER_SORT_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button onClick={() => setScreenerSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title={screenerSortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {screenerSortDir === 'asc' ? '↑ Ascending' : '↓ Descending'}
        </button>
      </div>
    )

    const ResultHeader = ({ label, count }) => (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
          {label}
          {count != null && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{count} stocks</span>}
        </span>
        <button onClick={closeSearch} style={{ background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="ti ti-x" style={{ fontSize: 12 }} /> Clear
        </button>
      </div>
    )

    const ResultTableHeader = () => (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '200px 90px 80px 60px 70px 70px',
        padding: '6px 20px',
        borderBottom: '2px solid var(--border)',
        gap: 0,
        background: 'var(--bg-primary)',
        position: 'sticky',
        top: 0,
        zIndex: 1,
      }}>
        {[
          { label: 'TICKER', align: 'left' },
          { label: 'CMP', align: 'right' },
          { label: '% 30W Trend Line', align: 'right' },
          { label: 'RS', align: 'right' },
          { label: '7D %', align: 'right' },
          { label: 'PLEDGE', align: 'right' },
        ].map(col => (
          <div key={col.label} style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--text-hint)',
            textAlign: col.align,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            {col.label}
          </div>
        ))}
      </div>
    )

    const ResultRow = ({ s }) => {
      const [open, setOpen] = useState(false)
      const rm = ruleMatch(s)
      const pctFromMa = s.ma30w > 0 ? ((s.close - s.ma30w) / s.ma30w * 100) : null
      // SwingX rows get a subtle green tint baseline + slightly
      // stronger tint on hover, so they stay visually distinct from
      // ordinary stage-2 names even after the row's hover handler
      // overrides the background. Warning rows (mid-grace exit)
      // keep their existing amber left-border treatment.
      const isSwingX = s.high_conviction === true
      const baselineBg = isSwingX ? 'rgba(0,200,5,0.04)' : 'transparent'
      const hoverBg = isSwingX ? 'rgba(0,200,5,0.10)' : 'var(--bg-input)'
      return (
        <>
        <div
          onClick={() => {
            // Anonymous-visitor gate: clicking a search result row
            // shouldn't deep-link them into /stock/* (which is itself
            // PublicGate'd anyway). Surface the signup bottom-sheet
            // here so the prompt fires at the click site instead of
            // an unexplained redirect.
            if (!requireAuth()) return
            navigate('/stock/' + s.symbol); trackSearch(s.symbol)
          }}
          style={{
            display: 'grid',
            gridTemplateColumns: '200px 90px 80px 60px 70px 70px',
            alignItems: 'center',
            padding: '7px 20px',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
            borderLeft: s.swingx_warning_level === 'caution' ? '3px solid var(--warning)' : isSwingX ? '3px solid #00C805' : '3px solid transparent',
            background: baselineBg,
            gap: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = hoverBg}
          onMouseLeave={e => e.currentTarget.style.background = baselineBg}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{s.symbol}</span>
              {/* Neutral rule-match score (no phase verdict, no go-green).
                  Click to expand the exact rules that matched. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
                title="Show which rules matched"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, color: 'var(--text-secondary)', background: 'rgba(148,163,184,0.12)', border: '1px solid var(--border)', whiteSpace: 'nowrap', letterSpacing: '0.03em', cursor: 'pointer' }}
              >
                {rm.score}/{rm.total} criteria
                <span style={{ fontSize: 8 }}>{open ? '▲' : '▼'}</span>
              </button>
              {isSwingX && (
                // ⚡ chip next to the stage badge to reinforce SwingX
                // membership at row level. The left border + tint
                // already signal it but the chip makes scanning the
                // table at a glance much easier.
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'rgba(0,200,5,0.15)',
                  color: '#00C805',
                  border: '1px solid rgba(0,200,5,0.3)',
                  flexShrink: 0,
                  lineHeight: 1.2,
                }}>
                  ⚡
                </span>
              )}
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name || s.sector}
            </span>
            {s.high_conviction && s.swingx_entry_date && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, display: 'flex', gap: 4 }}>
                <span>{s.swingx_days || 0}d on radar</span>
                {s.swingx_return_pct != null && (
                  <span style={{ color: s.swingx_return_pct >= 0 ? 'var(--accent)' : 'var(--negative)', fontWeight: 600 }}>
                    {s.swingx_return_pct >= 0 ? '+' : ''}{s.swingx_return_pct.toFixed(1)}%
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {s.close ? '₹' + s.close.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: pctFromMa == null ? 'var(--text-hint)' : pctFromMa > 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {/* `== null` catches BOTH null and undefined — the
                companies-table fallback rows (when mv_home_stocks is
                degraded) carry no ma30w / close, so pctFromMa can
                be undefined. The previous strict `!== null` let
                undefined slip past the guard and toFixed crashed. */}
            {pctFromMa != null ? (pctFromMa > 0 ? '+' : '') + pctFromMa.toFixed(1) + '%' : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: s.rs_vs_nifty == null ? 'var(--text-hint)' : s.rs_vs_nifty > 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {s.rs_vs_nifty != null ? (s.rs_vs_nifty > 0 ? '+' : '') + s.rs_vs_nifty.toFixed(1) + '%' : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: s.price_change_7d == null ? 'var(--text-hint)' : s.price_change_7d > 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {s.price_change_7d != null ? (s.price_change_7d > 0 ? '+' : '') + s.price_change_7d.toFixed(1) + '%' : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: s.promoter_pledge_pct === 0 || s.promoter_pledge_pct == null ? 'var(--accent)' : s.promoter_pledge_pct > 20 ? 'var(--negative)' : 'var(--warning)' }}>
            {s.promoter_pledge_pct == null ? '—' : s.promoter_pledge_pct === 0 ? '0%' : s.promoter_pledge_pct.toFixed(1) + '%'}
          </div>
        </div>
        {open && (
          <div style={{ padding: '8px 20px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-input)' }}>
            {rm.checks.map((c) => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span style={{ fontSize: 12, width: 14, flexShrink: 0, textAlign: 'center', color: c.pass ? 'var(--positive)' : 'var(--text-hint)' }}>{c.pass ? '✓' : '✗'}</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{c.detail}</span>
              </div>
            ))}
            <div style={{ fontSize: 9, color: 'var(--text-hint)', fontStyle: 'italic', marginTop: 4 }}>
              Objective rule match on EOD data · Data only · Not advice
            </div>
          </div>
        )}
        </>
      )
    }

    if (results.type === 'stock') {
      const s = results.stock
      const pctFromMa = s.ma30w > 0 ? ((s.close - s.ma30w) / s.ma30w * 100) : null
      const stageCfg = {
        'Stage 2': { c: 'var(--accent)', bg: 'var(--accent-dim)', label: 'Stage 2 parameters' },
        'Stage 1': { c: 'var(--info)', bg: 'var(--info-dim)', label: 'Stage 1 parameters' },
        'Stage 3': { c: 'var(--warning)', bg: 'var(--warning-dim)', label: 'Stage 3 parameters' },
        'Stage 4': { c: 'var(--negative)', bg: 'var(--negative-dim)', label: 'Stage 4 parameters' },
      }
      const sc = stageCfg[s.stage] || { c: 'var(--text-muted)', bg: 'var(--border)', label: s.stage || 'Unknown' }
      const metrics = [
        { label: 'Price', value: s.close ? '₹' + s.close.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—', color: 'var(--text-primary)' },
        { label: 'RS vs Nifty', value: s.rs_vs_nifty != null ? (s.rs_vs_nifty > 0 ? '+' : '') + s.rs_vs_nifty.toFixed(1) + '%' : '—', color: s.rs_vs_nifty > 0 ? 'var(--positive)' : 'var(--negative)' },
        { label: 'vs 30W Trend Line', value: pctFromMa != null ? (pctFromMa > 0 ? '+' : '') + pctFromMa.toFixed(1) + '%' : '—', color: pctFromMa > 0 ? 'var(--positive)' : 'var(--negative)' },
        { label: 'Delivery', value: s.avg_delivery_30d ? s.avg_delivery_30d.toFixed(0) + '%' : '—', color: (s.avg_delivery_30d || 0) > 50 ? 'var(--accent)' : 'var(--text-primary)' },
      ]
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label={s.symbol} />
          <div onClick={() => { if (!requireAuth()) return; navigate('/stock/' + s.symbol) }} style={{ margin: 16, padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{s.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>{s.sector}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: sc.bg, color: sc.c, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, marginBottom: 16 }}>
              {getBadgeLabel(s)}
              <span style={{ fontWeight: 400, fontSize: 11 }}>{sc.label}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {metrics.map(m => (
                <div key={m.label} style={{ background: 'var(--bg-primary)', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-hint)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: m.color, fontFamily: 'var(--font-mono)' }}>{m.value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--info)', textAlign: 'right' }}>View full analysis →</div>
          </div>
        </div>
      )
    }

    if (results.type === 'stock_list') {
      const limit = user ? null : FREE_LIMITS.stock_list
      const stocks = sortStocks(results.stocks)
      const visible = limit ? stocks.slice(0, limit) : stocks
      const hiddenCount = limit ? Math.max(0, stocks.length - limit) : 0
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label={results.label} count={results.stocks.length} />
          <SortBar />
          <ResultTableHeader />
          {visible.map(s => <ResultRow key={s.id || s.symbol} s={s} />)}
          {hiddenCount > 0 && <SigninGate total={stocks.length} shown={limit} />}
        </div>
      )
    }

    if (results.type === 'sector') {
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label={results.sector} count={results.stocks.length} />
          <div style={{ padding: '12px 16px', display: 'flex', gap: 12, borderBottom: '1px solid var(--border)' }}>
            {[
              { val: results.stage2, label: 'Advancing', color: 'var(--accent)' },
              { val: results.swingx, label: 'SwingX', color: 'var(--accent)' },
              { val: results.stocks.length, label: 'Total', color: 'var(--text-primary)' },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.val}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.label}</div>
              </div>
            ))}
          </div>
          <SortBar />
          <ResultTableHeader />
          {(() => {
            const limit = user ? null : FREE_LIMITS.sector
            const stocks = sortStocks(results.stocks)
            const visible = limit ? stocks.slice(0, limit) : stocks.slice(0, 25)
            const hiddenCount = limit ? Math.max(0, stocks.length - limit) : 0
            return (
              <>
                {visible.map(s => <ResultRow key={s.id || s.symbol} s={s} />)}
                {hiddenCount > 0 && <SigninGate total={stocks.length} shown={limit} />}
              </>
            )
          })()}
        </div>
      )
    }

    if (results.type === 'filter') {
      const isSwingX = results.label?.toLowerCase().includes('swingx')
      const limitKey = isSwingX ? 'swingx' : 'filter'
      const limit = user ? null : FREE_LIMITS[limitKey]
      const allFilterStocks = results.stocks || []
      // Optional delivery filter — client-side, SwingX only. Narrows the
      // already-fetched SwingX list to high-delivery names. Never gates SwingX.
      const filtered = (isSwingX && deliveryFilter)
        ? allFilterStocks.filter(s => s.high_delivery_conviction)
        : allFilterStocks
      const stocks = sortStocks(filtered)
      const visible = limit ? stocks.slice(0, limit) : stocks.slice(0, 50)
      const hiddenCount = limit ? Math.max(0, stocks.length - limit) : 0

      // FIX 1 — Loading skeleton for SwingX:
      // When the user opens the SwingX panel before the main
      // load() finishes (i.e. fresh visit with no cache), the
      // parseSmartQuery call ran against an empty allStocks and
      // results.stocks is []. Without this guard the panel would
      // show "0 stocks" until the auto-reparse fires. The skeleton
      // makes the in-flight state visually obvious.
      if (isSwingX && loading) {
        return (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <ResultHeader label={results.label} />
            <div style={{ padding: '12px 16px' }}>
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div
                  key={i}
                  style={{
                    height: 60,
                    borderRadius: 10,
                    background: 'var(--bg-elevated)',
                    marginBottom: 8,
                    animation: 'shimmer 1.5s infinite',
                  }}
                />
              ))}
            </div>
          </div>
        )
      }

      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label={results.label} count={stocks.length} />
          {/* When the filter is SwingX, anchor a green accent strip
              between the header and the table so the user knows
              they're looking at the cycle-criteria-aligned subset
              and not a generic stage filter. Includes the
              facts-only micro-disclaimer inline to match the
              editorial line. */}
          {isSwingX && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: 'rgba(0,200,5,0.06)',
              borderBottom: '1px solid rgba(0,200,5,0.15)',
              borderTop: '1px solid rgba(0,200,5,0.15)',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#00C805', whiteSpace: 'nowrap' }}>
                ⚡ SwingX
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {stocks.length} {stocks.length === 1 ? 'stock' : 'stocks'} · all cycle criteria met
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                Facts only · Not advice
              </span>
            </div>
          )}
          {/* Optional secondary filter row — high-delivery names only.
              India-specific, layered on top of the SwingX results. */}
          {isSwingX && (
            <div style={{
              padding: '6px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid var(--border)',
              background: 'rgba(0,200,5,0.04)',
            }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                Add filter:
              </span>
              <button
                onClick={() => setDeliveryFilter(d => !d)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 12,
                  border: `1px solid ${deliveryFilter ? 'rgba(0,200,5,0.4)' : 'var(--border)'}`,
                  background: deliveryFilter ? 'rgba(0,200,5,0.1)' : 'transparent',
                  color: deliveryFilter ? '#00C805' : 'var(--text-muted)',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {deliveryFilter ? '✓' : '+'} High delivery
              </button>
              {deliveryFilter && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  India-specific filter · Not part of core criteria
                </span>
              )}
            </div>
          )}
          <SortBar />
          <ResultTableHeader />
          {visible.map(s => <ResultRow key={s.id || s.symbol} s={s} />)}
          {hiddenCount > 0 && <SigninGate total={stocks.length} shown={limit} />}
        </div>
      )
    }

    if (results.type === 'market') {
      const m = results.market || {}
      const items = [
        { label: 'Nifty 50', value: m.nifty_close ? Number(m.nifty_close).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—', sub: m.nifty_change_1d != null ? (Number(m.nifty_change_1d) >= 0 ? '+' : '') + Number(m.nifty_change_1d).toFixed(1) + '% today' : '' },
        { label: 'Breadth (30W Trend Line)', value: m.above_ma150_pct != null ? Number(m.above_ma150_pct).toFixed(1) + '%' : '—', sub: 'NSE stocks above 30W Trend Line' },
        { label: 'India VIX', value: m.india_vix != null ? Number(m.india_vix).toFixed(1) : '—', sub: Number(m.india_vix) > 20 ? 'Elevated volatility' : Number(m.india_vix) > 15 ? 'Moderate' : 'Low volatility' },
        { label: 'Stage 2 Stocks', value: m.stage2_pct != null ? Number(m.stage2_pct).toFixed(0) + '%' : '—', sub: 'In established uptrend' },
      ]
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label="Market Overview" />
          <div style={{ padding: '0 16px' }}>
            {items.map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>{item.sub}</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (results.type === 'watchlist') {
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label="Watchlist" />
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <button onClick={() => { closeSearch(); navigate('/dashboard') }} style={{ fontSize: 13, color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer' }}>
              Open Watchlist →
            </button>
          </div>
        </div>
      )
    }

    if (results.type === 'sectors') {
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label="Sector Performance" />
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <button onClick={() => { closeSearch(); setHomeTab('sectors') }} style={{ fontSize: 13, color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer' }}>
              View Sectors tab →
            </button>
          </div>
        </div>
      )
    }

    if (results.type === 'no_match') {
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-hint)' }}>
          <i className="ti ti-search-off" style={{ fontSize: 32 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>No results for "{results.query}"</div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)', textAlign: 'center' }}>
            Try: stock name, sector, "swingx", "stage 2", "pharma", "delivery"
          </div>
          <button onClick={closeSearch} style={{ marginTop: 4, fontSize: 12, color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear search</button>
        </div>
      )
    }

    return null
  }

  const SigninGate = ({ total, shown }) => {
    const { user } = useAuth()
    return (
    <div style={{ position: 'relative', marginTop: -40 }}>
      <div style={{ height: 60, background: 'linear-gradient(to bottom, transparent, var(--bg-primary))', pointerEvents: 'none' }} />
      <div style={{
        margin: '0 16px 16px', padding: '14px 16px',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            {total - shown} more stocks
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Sign in free to see all {total}
          </div>
        </div>
        <button
          onClick={() => setShowAuthPrompt(true)}
          style={{
            padding: '8px 16px', borderRadius: 8,
            background: 'var(--accent)', border: 'none',
            color: '#000', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Sign in →
        </button>
      </div>
    </div>
  )
  }

  const TH = ({col, label, right}) => {
    const active = sortCol === col
    return (
      <th onClick={()=>handleSort(col)} style={{
        padding:'8px 12px', fontSize:11,
        color: active ? 'var(--accent)' : 'var(--text-hint)',
        textTransform:'uppercase', letterSpacing:'0.06em', fontWeight: active ? 700 : 500,
        textAlign: right?'right':'left', cursor:'pointer', whiteSpace:'nowrap',
        borderBottom: active ? '1px solid var(--accent-border)' : '1px solid var(--border)',
        userSelect:'none',
        background: active ? 'rgba(0,200,5,.04)' : 'var(--bg-surface)',
        transition: 'all 0.15s',
      }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:3 }}>
          {label}
          {active
            ? <i className={sortDir===-1 ? 'ti ti-arrow-down' : 'ti ti-arrow-up'} style={{ fontSize:10 }} />
            : <i className="ti ti-arrows-sort" style={{ fontSize:10, opacity:0.4 }} />
          }
        </span>
      </th>
    )
  }

  return (
    <>
      <Helmet>
        <title>
          {location.pathname === '/screener'
            ? 'Stock Screener — NSE Stage & Delivery | PineX'
            : 'PineX — NSE Stock Screener | Cycle Analysis & SwingX'}
        </title>
        <meta
          name="description"
          content={
            location.pathname === '/screener'
              ? 'Filter 2100+ NSE stocks by PineX cycle, delivery %, RS score and SwingX signals. Free screener for Indian investors.'
              : 'Screen 2100+ NSE stocks by PineX Cycle, delivery volume and SwingX signals. Free Indian stock market intelligence platform.'
          }
        />
      </Helmet>
    <AcademyNudgeBanner />
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{
                  background:C.bg, color:C.text,
                  fontSize:15, fontFamily:'DM Sans,system-ui,sans-serif',
                }}>

      <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0}}>

        {/* Mobile brand header — hidden on md+ where sidebar shows */}
        <div className="md:hidden" style={{
          display: 'flex', alignItems: 'center',
          padding: '10px 14px 8px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(96,165,250,0.15)',
              border: '1px solid rgba(96,165,250,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--info)' }}>p</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                <PineXMark />
              </p>
              <p style={{ margin: 0, fontSize: 9, color: 'var(--text-hint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Market Structure
              </p>
            </div>
          </div>
        </div>

        {/* TOPBAR — single compact scrollable row */}
        {(() => {
          const nc = market?.nifty_close
          const niftyStr = nc != null && nc !== ''
            ? Number(nc).toLocaleString('en-IN', { maximumFractionDigits: 0 })
            : '—'
          const n1d = market?.nifty_change_1d
          const n1dNum = n1d != null && n1d !== '' ? Number(n1d) : null
          const n1dStr = n1dNum != null && Number.isFinite(n1dNum) ? fmtPct(n1dNum) : ''
          const s2pct  = Number(market?.stage2_pct) || 0
          const rawAbove = Number(market?.above_ma150_pct)
          const breadth = (Number.isFinite(rawAbove) && rawAbove >= 1) ? rawAbove : s2pct
          const stageLabel =
            s2pct >= 50 && breadth >= 55 ? 'Stage 2' :
            s2pct >= 35 && breadth >= 40 ? 'Stage 1' :
            s2pct >= 20 && breadth >= 20 ? 'Stage 3' :
            'Stage 4'
          const consUp = Number(market?.nifty_consecutive_up) || 0
          const consDn = Number(market?.nifty_consecutive_down) || 0
          const vx = market?.india_vix
          const vxNum = vx != null && vx !== '' ? Number(vx) : null
          const vxStr = vxNum != null && Number.isFinite(vxNum) ? vxNum.toFixed(1) : '—'
          const vxMeta = vixBand(vxNum)
          const br = market?.above_ma150_pct
          const brRaw = br != null && br !== '' ? Number(br) : null
          const brNum = (brRaw != null && brRaw >= 1) ? brRaw : (s2pct > 0 ? s2pct : null)
          const brStr = brNum != null && Number.isFinite(brNum) ? `${brNum.toFixed(1)}%` : '—'
          const brColor = brNum == null || !Number.isFinite(brNum) ? C.muted
            : brNum > 60 ? 'var(--accent)' : brNum >= 40 ? 'var(--warning)' : 'var(--negative)'
          const hi = market?.new_52w_highs
          const lo = market?.new_52w_lows
          const hiStr = hi != null ? String(hi) : '—'
          const loStr = lo != null ? String(lo) : '—'
          const barW = brNum != null && Number.isFinite(brNum) ? `${Math.min(100, Math.max(0, brNum))}%` : '0%'
          const getDataLabel = () => {
            if (!market?.date) return 'EOD Data'
            const dataDate = new Date(market.date)
            const today = new Date()
            const day = dataDate.getDate()
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            const month = months[dataDate.getMonth()]
            const year = dataDate.getFullYear()
            const isToday = dataDate.toDateString() === today.toDateString()
            const yesterday = new Date(today)
            yesterday.setDate(today.getDate() - 1)
            const isYesterday = dataDate.toDateString() === yesterday.toDateString()
            if (isToday) return `EOD · Today ${day} ${month}`
            if (isYesterday) return `EOD · ${day} ${month}`
            return `EOD · ${day} ${month} ${year}`
          }
          const Divider = () => <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, alignSelf: 'center' }} />
          return (
            // `pinex-topbar-fade` adds a right-edge gradient mask on
            // mobile so users see there's more content to swipe to.
            // Without it the row truncates mid-word (e.g. "BREADTH"
            // cut off) and looks broken instead of scrollable.
            <div className="pinex-topbar-fade" style={{
              display: 'flex', flexDirection: 'row', alignItems: 'center',
              height: 44, flexShrink: 0,
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border)',
              overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none',
            }}>
              {/* NIFTY */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>NIFTY</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{niftyStr}</span>
                {n1dStr ? <span style={{ fontSize: 11, fontWeight: 700, color: chgColor(n1dNum) }}>{n1dStr}</span> : null}
                <StageBadge stage={stageLabel} />
                {consUp > 0 ? <span style={{ fontSize: 10, fontWeight: 700, color: C.green }}>↑{consUp}d</span> : null}
                {consDn > 0 ? <span style={{ fontSize: 10, fontWeight: 700, color: C.red }}>↓{consDn}d</span> : null}
              </div>
              <Divider />
              {/* VIX */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>VIX</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: vxMeta.color, fontVariantNumeric: 'tabular-nums' }}>{vxStr}</span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, border: `1px solid ${vxMeta.color}55`, color: vxMeta.color, background: `${vxMeta.color}14` }}>
                  {vxMeta.label}
                </span>
              </div>
              <Divider />
              {/* BREADTH */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>BREADTH</span>
                <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ height: '100%', width: barW, background: brColor, borderRadius: 99, transition: 'width .3s ease' }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 12, color: brColor, fontVariantNumeric: 'tabular-nums' }}>{brStr}</span>
              </div>
              {(Number(hi) > 0 || Number(lo) > 0) && (
                <>
                  <Divider />
                  {/* 52W H/L */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 14px', flexShrink: 0 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>52W</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      H:<span style={{ color: C.green, fontWeight: 700 }}>{hiStr}</span>
                      {' '}L:<span style={{ color: C.red, fontWeight: 700 }}>{loStr}</span>
                    </span>
                  </div>
                </>
              )}
              <Divider />
              {/* Cache age + refresh */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 0 8px', flexShrink: 0 }}>
                {loadingAll && (
                  <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>Loading all stocks…</span>
                )}
                {!loadingAll && (
                  <span style={{ fontSize: 9, color: 'var(--text-disabled)', flexShrink: 0, whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                    {getDataLabel()}
                  </span>
                )}
                <button
                  onClick={() => {
                    sessionStorage.removeItem(CACHE_KEY)
                    window.location.reload()
                  }}
                  title="Refresh data"
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', padding: 4, fontSize: 12,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <i className="ti ti-refresh" style={{ fontSize: 14 }} />
                  <span className="hidden md:inline" style={{ fontSize: 11 }}>Refresh</span>
                </button>
              </div>
            </div>
          )
        })()}

        {/* Market Snapshot bar — Structure / Participation / Volatility */}
        {market && (
          // Same fade treatment as the top NIFTY/VIX/BREADTH row so
          // "PARTICIPATION Moderate 236H 138L" doesn't truncate
          // silently mid-value on narrow screens.
          <div className="pinex-topbar-fade" style={{
            display: 'flex', alignItems: 'center',
            padding: '0 14px', height: 34, flexShrink: 0,
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border)',
            overflowX: 'auto', scrollbarWidth: 'none', gap: 0,
          }}>
            {(() => {
              const s2 = Number(market.stage2_pct) || 0
              const label = s2 >= 40 ? 'Advancing' : s2 >= 25 ? 'Mixed' : 'Declining'
              const color = s2 >= 40 ? C.green : s2 >= 25 ? C.amber : C.red
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 14, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Structure</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color }}>{label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{s2.toFixed(0)}% S2</span>
                </div>
              )
            })()}
            <div style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />
            {(() => {
              const rawBr = Number(market.above_ma150_pct)
              const breadth = (Number.isFinite(rawBr) && rawBr >= 1) ? rawBr : (Number(market.stage2_pct) || 0)
              const highs = Number(market.new_52w_highs) || 0
              const lows = Number(market.new_52w_lows) || 0
              const label = breadth >= 60 ? 'Broad' : breadth >= 40 ? 'Moderate' : 'Narrow'
              const color = breadth >= 60 ? C.green : breadth >= 40 ? C.amber : C.red
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Participation</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color }}>{label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{highs}H {lows}L</span>
                </div>
              )
            })()}
            <div style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />
            {(() => {
              const vx = Number(market.india_vix)
              if (!Number.isFinite(vx)) return null
              const meta = vixBand(vx)
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 14, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Volatility</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>VIX {vx.toFixed(1)}</span>
                </div>
              )
            })()}
          </div>
        )}

        {/* Market signals — collapsible single-line preview */}
        {marketSignals.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border)', background: C.bg, flexShrink: 0 }}>
            <button
              onClick={() => setSignalsOpen(o => !o)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <i className={`ti ${marketSignals[0].icon} shrink-0`} style={{ fontSize: 13, color: marketSignals[0].color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                {marketSignals[0].text}
              </span>
              {marketSignals.length > 1 && !signalsOpen && (
                <span style={{ fontSize: 10, color: C.textMuted, flexShrink: 0, marginRight: 2 }}>+{marketSignals.length - 1}</span>
              )}
              <i className={`ti ${signalsOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`} style={{ fontSize: 11, color: C.hint, flexShrink: 0 }} />
            </button>
            {signalsOpen && marketSignals.slice(1).map((sig, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 12px 8px' }}>
                <i className={`ti ${sig.icon}`} style={{ fontSize: 13, color: sig.color, flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{sig.text}</span>
              </div>
            ))}
          </div>
        )}


        {/* SCROLLABLE BODY */}
        <div className="md:!px-0 md:!pt-0 md:gap-0" style={{flex:1, overflowY:'auto', overflowX:'hidden',
          padding: homeTab==='search' && smartResults===null ? 0 : '12px 16px 96px',
          display:'flex', flexDirection:'column', gap: homeTab==='search' && smartResults===null ? 0 : 12}}>

          {/* Wow-moment modal — fires once per session when the user
              has a pending row in pending_wow_moments (written by
              the nightly check_classifications.py). position:fixed
              overlay, so the JSX placement here is just for mount
              ordering — render position doesn't affect layout. */}
          {user && <WowMoment />}

          {/* ── Top-of-Home invite card ──────────────────────────
              Rendered OUTSIDE the per-tab conditionals so users see
              it on Search (default landing), Sectors, Screens AND
              Watched. Shows the actual referral link + an inline
              Copy button so no navigation is needed. Persists a
              one-day dismiss in localStorage so it reappears
              tomorrow if dismissed today. Hidden when:
                - user not signed in
                - user has 0 credits left
                - profile has no invite_code yet
                - the user has dismissed it today
                - a search query is active (avoid hijacking results)
          */}
          {/* Legacy invite-credits banner removed — the pinex.in/invite/<code>
              share UI was replaced by the pinex.in/join/<referral_code>
              referral link surfaced on /rewards. inviteCode, inviteCredits
              and the dismissal state stay declared above but are no longer
              consumed by any visible JSX. The /invite/:code route still
              works (defensive — old shared links still resolve), it just
              isn't actively promoted anywhere on Home anymore. */}

          {user && (
            <div style={{ marginBottom: 12 }}>
              <MorningBrief userId={user?.id} />
            </div>
          )}

          {/* Daily question — earn points by writing a short response.
              Self-gates: renders null when no question is set for today,
              when loading, and when user isn't signed in. Optimistic
              submit with a +N pts award via the config-driven helper. */}
          {user && (
            <div style={{ marginBottom: 12 }}>
              <DailyQuestion showOnHome={true} />
            </div>
          )}

          {homeTab==='search' && (
            <>

          {/* Search section — the <input> element below is rendered in a
              STABLE position regardless of smartResults, so React keeps the
              same DOM node mounted across the hero ↔ compact transition.
              That prevents the mobile keyboard from losing its focus target
              (the bug where the cursor "deactivated" after 2 characters). */}
          <div style={
            smartResults === null
              ? {
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '0 16px 48px',
                }
              : { marginBottom: 4 }
          }>
            {/* Heading — hero only */}
            {smartResults === null ? (
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{
                  fontSize: 26, fontWeight: 800, color: 'var(--text-primary)',
                  letterSpacing: '-0.03em', lineHeight: 1.2, marginBottom: 8,
                }}>
                  Most traders ignore stage. You won't.
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
                  2100+ NSE stocks. Cycle analysis. Updated daily.
                </div>
              </div>
            ) : null}

            {/* Input wrapper — stable. Glow / icon / input / hint / clear
                are all here in the same order at all times; React reuses
                the input DOM node when smartResults toggles.

                Wrapped in motion.div so we can fire a one-shot amber
                glow when the user lands here after saving a Gemini key
                on Account. searchPulse flips true via the
                pinex_key_just_saved handoff, animates the boxShadow
                keyframes, then flips back false 2s later. */}
            <motion.div
              animate={searchPulse ? {
                boxShadow: [
                  '0 0 0px rgba(245,159,11,0)',
                  '0 0 20px rgba(245,159,11,0.55)',
                  '0 0 0px rgba(245,159,11,0)',
                ],
              } : { boxShadow: '0 0 0px rgba(245,159,11,0)' }}
              transition={{ duration: 2, ease: 'easeInOut' }}
              onAnimationComplete={() => { if (searchPulse) setSearchPulse(false) }}
              style={
                smartResults === null
                  ? { width: '100%', maxWidth: 640, position: 'relative', borderRadius: 16 }
                  : { position: 'relative', borderRadius: 12 }
              }
            >
              {/* Glow layer — hero only */}
              {smartResults === null ? (
                <div style={{
                  position: 'absolute', inset: -1, borderRadius: 18,
                  background: searchFocused
                    ? 'linear-gradient(135deg, rgba(0,200,5,0.35) 0%, rgba(0,160,4,0.15) 100%)'
                    : 'linear-gradient(135deg, rgba(0,200,5,0.12) 0%, rgba(30,37,48,0) 100%)',
                  filter: searchFocused ? 'blur(12px)' : 'blur(6px)',
                  transition: 'all 0.3s', zIndex: 0, pointerEvents: 'none',
                }} />
              ) : null}

              <i className="ti ti-search" style={
                smartResults === null
                  ? {
                      position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 20, color: searchFocused ? 'var(--accent)' : 'var(--text-muted)',
                      transition: 'color 0.2s', pointerEvents: 'none', zIndex: 2,
                    }
                  : {
                      position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 15, color: searchFocused ? 'var(--accent)' : 'var(--text-muted)',
                      transition: 'color 0.2s', pointerEvents: 'none', zIndex: 1,
                    }
              } />

              <input
                ref={searchInputRef}
                value={smartQuery}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={e => {
                  const v = e.target.value
                  // Anonymous-visitor gate: surface the signup
                  // bottom-sheet as soon as they start typing.
                  // requireAuth() returns false for anon users
                  // (and opens the prompt internally), so we bail
                  // before any actual search work happens. The
                  // input value still updates so the typed letter
                  // doesn't visually swallow.
                  if (v.length >= 1 && !requireAuth()) {
                    setSmartQuery(v)
                    setSmartResults(null)
                    return
                  }
                  setSmartQuery(v)
                  // Gate: typing "swingx" without
                  // access opens the same bottom
                  // sheet the chip / tile use.
                  const isSwingXQuery =
                    v.toLowerCase().includes('swingx') ||
                    v.toLowerCase().includes('swing x')
                  if (isSwingXQuery && !hasSwingXAccess) {
                    setShowSwingXGate(true)
                    setSmartResults(null)
                    return
                  }
                  if (v.length >= 2) {
                    const r = parseSmartQuery(v, allStocks, market)
                    setSmartResults(r)
                    if (r && r.type !== 'no_match') trackSearch(v)
                  } else {
                    setSmartResults(null)
                  }
                  setPage(0)
                }}
                onFocus={() => { setSearchFocused(true); setMostSearched(getMostSearched()) }}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSmartQuery(''); setSmartResults(null) }
                }}
                placeholder={
                  hasResearchKey
                    ? 'Search stocks or ask anything about markets…'
                    : 'Search stocks, sectors, stages or patterns'
                }
                style={
                  smartResults === null
                    ? {
                        position: 'relative', zIndex: 1,
                        width: '100%', boxSizing: 'border-box',
                        background: searchFocused ? 'var(--bg-overlay)' : 'var(--bg-input)',
                        border: searchFocused ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                        borderRadius: 16,
                        padding: '16px 80px 16px 54px',
                        fontSize: 16, color: 'var(--text-primary)', outline: 'none',
                        transition: 'background 0.25s, border-color 0.25s, box-shadow 0.25s',
                        boxShadow: searchFocused
                          ? '0 0 0 4px rgba(0,200,5,0.10), 0 8px 32px rgba(0,0,0,0.4)'
                          : '0 4px 20px rgba(0,0,0,0.3)',
                      }
                    : {
                        width: '100%', boxSizing: 'border-box',
                        background: searchFocused ? 'var(--bg-overlay)' : 'var(--bg-input)',
                        border: searchFocused ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                        borderRadius: 12,
                        padding: '11px 44px 11px 40px',
                        fontSize: 14, color: 'var(--text-primary)', outline: 'none',
                        transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s',
                        boxShadow: searchFocused ? '0 0 0 3px rgba(0,200,5,0.10)' : 'none',
                      }
                }
              />

              {/* ⌘K hint — hero only, desktop only, when idle */}
              {smartResults === null && !searchFocused && !smartQuery ? (
                // ⌘K is a desktop-only keyboard-shortcut hint; on
                // touch devices the symbol is meaningless and the
                // pill just adds visual noise. Tailwind `hidden`
                // on mobile, `inline-flex` from md (≥768px) up.
                <span className="hidden md:inline-flex" style={{
                  position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 11, color: 'var(--text-disabled)', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 5, padding: '3px 7px',
                  pointerEvents: 'none', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)',
                  zIndex: 2,
                }}>
                  ⌘K
                </span>
              ) : null}

              {/* Clear button */}
              {smartQuery ? (
                <button
                  onClick={() => { setSmartQuery(''); setSmartResults(null); setAiPanel(null) }}
                  style={
                    smartResults === null
                      ? { position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', zIndex: 2 }
                      : { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center' }
                  }
                >
                  <i className="ti ti-x" style={{ fontSize: smartResults === null ? 16 : 14 }} />
                </button>
              ) : null}
            </motion.div>

            {/* ── Research Assistant "Ask" CTA ─────────────────────────────
                Surfaces when the user has saved a Gemini key and the typed
                query reads like a question. Tapping opens the inline AI
                panel below — see <AnimatePresence> block. */}
            <AnimatePresence>
              {showAiCta && (
                <motion.div
                  key="ai-cta"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    marginTop: 10,
                    width: '100%',
                    maxWidth: smartResults === null ? 640 : '100%',
                    background: 'rgba(245,159,11,0.06)',
                    border: '1px solid rgba(245,159,11,0.30)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    boxSizing: 'border-box',
                  }}
                >
                  <div style={{
                    fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: C.amber, marginBottom: 6,
                  }}>
                    🔬 Ask your research assistant
                  </div>
                  <div style={{
                    fontSize: 14, color: 'var(--text-primary)',
                    fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                    fontStyle: 'italic', margin: '0 0 10px',
                    lineHeight: 1.5,
                  }}>
                    &ldquo;{smartQuery.trim()}&rdquo;
                  </div>
                  <button
                    type="button"
                    onClick={() => openAiPanel(smartQuery)}
                    style={{
                      padding: '8px 16px',
                      background: C.amber, color: '#000',
                      border: 'none', borderRadius: 8,
                      fontSize: 13, fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Ask about Indian markets →
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Inline AI panel ──────────────────────────────────────────
                Replaces the CTA once the user has clicked Ask. The search
                results below still render, but the panel takes visual
                priority and explicit attention. Close (×) tears it down. */}
            <AnimatePresence initial={false}>
              {aiPanel && (
                <motion.div
                  key="ai-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 35 }}
                  style={{
                    overflow: 'hidden',
                    width: '100%',
                    maxWidth: smartResults === null ? 640 : '100%',
                    marginTop: 12,
                  }}
                >
                  <div style={{
                    background: 'var(--bg-surface)',
                    border: `1px solid ${C.amber}55`,
                    borderRadius: 14,
                    padding: '16px 18px',
                  }}>
                    {/* Header + close */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 10,
                    }}>
                      <div style={{
                        fontSize: 12, fontWeight: 700,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        color: C.amber,
                      }}>
                        🔬 Research Assistant
                      </div>
                      <button
                        type="button"
                        onClick={() => setAiPanel(null)}
                        aria-label="Close"
                        style={{
                          background: 'transparent', border: 'none',
                          color: 'var(--text-muted)', cursor: 'pointer',
                          fontSize: 18, padding: 0, lineHeight: 1,
                        }}
                      >×</button>
                    </div>

                    {/* Question echo */}
                    <div style={{
                      fontSize: 13, color: 'var(--text-muted)',
                      marginBottom: 12, lineHeight: 1.5,
                    }}>
                      <span style={{ color: C.amber, fontWeight: 700 }}>Q:</span>{' '}
                      <span style={{
                        fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                        fontStyle: 'italic',
                      }}>
                        &ldquo;{aiPanel.question}&rdquo;
                      </span>
                    </div>

                    {/* Loading dots */}
                    {aiPanel.loading && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '10px 0',
                      }}>
                        {[0, 1, 2].map(i => (
                          <motion.span
                            key={i}
                            animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                            transition={{
                              duration: 0.9,
                              repeat: Infinity,
                              delay: i * 0.15,
                              ease: 'easeInOut',
                            }}
                            style={{
                              display: 'inline-block',
                              width: 6, height: 6, borderRadius: '50%',
                              background: C.amber,
                            }}
                          />
                        ))}
                        <span style={{
                          marginLeft: 8, fontSize: 12, color: 'var(--text-muted)',
                        }}>Thinking…</span>
                      </div>
                    )}

                    {/* Refusal banner — blocked question, never hit Gemini */}
                    {aiPanel.refused && (
                      <div style={{
                        padding: '12px 14px',
                        background: 'rgba(245,159,11,0.08)',
                        border: '1px solid rgba(245,159,11,0.30)',
                        borderRadius: 8,
                        color: C.amber, fontSize: 13, lineHeight: 1.55,
                        fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                      }}>
                        {REFUSAL_TEXT}
                      </div>
                    )}

                    {/* Answer */}
                    {aiPanel.answer && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.4 }}
                        style={{
                          padding: '12px 14px',
                          background: 'var(--bg-elevated)',
                          borderRadius: 8,
                          color: 'var(--text-primary)',
                          fontSize: 14, lineHeight: 1.7,
                          fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {aiPanel.answer}
                      </motion.div>
                    )}

                    {/* Error */}
                    {aiPanel.error && (
                      <div style={{
                        padding: '10px 12px',
                        background: 'rgba(248,113,113,0.10)',
                        border: '1px solid rgba(248,113,113,0.30)',
                        borderRadius: 8,
                        color: C.red, fontSize: 12, lineHeight: 1.5,
                      }}>
                        {aiPanel.error}
                      </div>
                    )}

                    {/* Footer disclaimer */}
                    <div style={{
                      marginTop: 12, paddingTop: 10,
                      borderTop: '1px solid var(--border)',
                      fontSize: 11, color: 'var(--text-hint)',
                      textAlign: 'center', fontStyle: 'italic', lineHeight: 1.55,
                    }}>
                      PineX data used as context · Not investment advice<br />
                      Consult a SEBI-registered adviser for buy/sell decisions.
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Suggestion chips + market health pill — hero only */}
            {smartResults === null ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 18, justifyContent: 'center', maxWidth: 560 }}>
                  {/* Pinned: SwingX → opens the Lab (user-run screen, no auto-list) */}
                  <button
                    onMouseDown={e => {
                      e.preventDefault()
                      if (!hasSwingXAccess) {
                        setShowSwingXGate(true)
                        return
                      }
                      navigate('/lab?template=swingx')
                    }}
                    style={{
                      padding: '6px 16px', borderRadius: 20,
                      border: '1px solid var(--accent-border)',
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                      opacity: hasSwingXAccess ? 1 : 0.6,
                    }}
                  >
                    {!hasSwingXAccess && <span style={{ fontSize: 10, marginRight: 1 }}>🔒</span>}
                    <i className="ti ti-bolt" style={{ fontSize: 11 }} />
                    SwingX
                  </button>
                  {/* Pinned: open the Lab (user-run screens replace the old
                      "Advancing" phase button — no verdict, no auto-list) */}
                  <button
                    onMouseDown={e => { e.preventDefault(); navigate('/lab') }}
                    style={{
                      padding: '6px 16px', borderRadius: 20,
                      border: '1px solid rgba(96,165,250,0.35)',
                      background: 'var(--info-dim)',
                      color: 'var(--info)',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <i className="ti ti-flask" style={{ fontSize: 11 }} />
                    Run a screen
                  </button>
                  {/* Curated categorical chips — sectors / phases / patterns.
                      Earlier this branch surfaced mostSearched entries, but
                      trackSearch() fires on every keystroke that produces a
                      match, so the chip row filled up with stock-name
                      fragments like "En", "Ent", "ENTERO" instead of the
                      cycle-analysis categories. Reverting to the curated
                      list keeps the surface predictable. */}
                  {SEARCH_SUGGESTIONS
                    .filter(s => !['swingx', 'stage 2'].includes(s.query))
                    .map(s => (
                    <button
                      key={s.query}
                      onMouseDown={e => {
                        e.preventDefault()
                        setSmartQuery(s.query)
                        const r = parseSmartQuery(s.query, allStocks, market)
                        setSmartResults(r)
                        if (r && r.type !== 'no_match') trackSearch(s.query)
                      }}
                      style={{
                        padding: '5px 14px', borderRadius: 20,
                        border: '1px solid var(--border)', background: 'var(--bg-surface)',
                        color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-dim)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-surface)' }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* Market health pill */}
                {market && (() => {
                  const rawBr = Number(market.above_ma150_pct)
                  const breadth = (Number.isFinite(rawBr) && rawBr >= 1) ? rawBr : (Number(market.stage2_pct) || 0)
                  const n1d = Number(market.nifty_change_1d)
                  const pillColor = breadth > 60 ? 'var(--accent)' : breadth > 40 ? 'var(--warning)' : 'var(--negative)'
                  const pillBg = breadth > 60 ? 'var(--accent-dim)' : breadth > 40 ? 'var(--warning-dim)' : 'var(--negative-dim)'
                  const pillBorder = breadth > 60 ? 'var(--accent-border)' : breadth > 40 ? 'rgba(251,191,36,.25)' : 'rgba(255,59,48,.25)'
                  const healthLabel = breadth > 60 ? 'Healthy' : breadth > 40 ? 'Mixed' : 'Weak'
                  return (
                    // flexWrap so the pill + label gracefully stack on narrow
                    // screens instead of squeezing the pill text onto two
                    // lines. whiteSpace:nowrap on the pill keeps "Market
                    // Mixed" on one line even when the parent shrinks.
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 24, justifyContent: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        background: pillBg, border: `1px solid ${pillBorder}`,
                        borderRadius: 20, padding: '4px 12px',
                        fontSize: 11, fontWeight: 700, color: pillColor, letterSpacing: '0.04em',
                        whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: pillColor, display: 'inline-block' }}/>
                        Market {healthLabel}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>
                        {breadth.toFixed(0)}% above 30W Trend Line
                        {Number.isFinite(n1d) && (
                          <span style={{ marginLeft: 8, color: n1d >= 0 ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                            · Nifty {n1d >= 0 ? '+' : ''}{n1d.toFixed(2)}%
                          </span>
                        )}
                        <span style={{ marginLeft: 8, opacity: 0.6 }}>· EOD</span>
                      </span>
                    </div>
                  )
                })()}
              </>
            ) : null}
          </div>

          {fetchError && !loading && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)',
              borderRadius: 8, padding: '12px 14px',
            }}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 16, color: 'var(--negative)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--negative)', margin: '0 0 2px' }}>Failed to load stock data</p>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 8px', wordBreak: 'break-word' }}>{fetchError}</p>
                <button
                  type="button"
                  onClick={() => { setFetchError(null); loadRef.current?.() }}
                  style={{ fontSize: 12, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          {smartResults !== null && <SmartResultsPanel />}
          </>
        )}

          {homeTab==='sectors' && (
          <div style={{background:C.surface, border:'1px solid var(--border)',
            borderRadius:8, overflow:'hidden'}}>
            <div style={{padding:'10px 12px', borderBottom:'1px solid var(--border)',
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:12, flexWrap:'wrap'}}>
              <span style={{fontSize:11, fontWeight:600, color:C.muted,
                textTransform:'uppercase', letterSpacing:'0.07em'}}>
                Nifty Sector Performance
              </span>
              <div style={{display:'flex', gap:4, flexWrap:'wrap', alignItems:'center'}}>
                {['1D','1W','1M','3M'].map(tf=>(
                  <button key={tf} onClick={()=>setSectorTf(tf)}
                    style={{fontSize:11, padding:'3px 8px', borderRadius:4,
                      border:'1px solid var(--border)',
                      background: sectorTf===tf ? C.border : 'transparent',
                      color: sectorTf===tf ? C.text : C.muted,
                      cursor:'pointer'}}>
                    {tf}
                  </button>
                ))}
                <button
                  onClick={() => navigate('/heatmap')}
                  style={{
                    fontSize:11, padding:'3px 9px', borderRadius:4,
                    border:'1px solid var(--border)',
                    background:'var(--bg-elevated)', color:'var(--text-muted)',
                    cursor:'pointer', display:'flex', alignItems:'center', gap:4,
                  }}
                >
                  <i className="ti ti-layout-grid" style={{fontSize:10}} />
                  Heatmap
                </button>
                <button
                  onClick={() => setShowSectorShare(true)}
                  disabled={sortedSectors.length === 0}
                  style={{
                    fontSize:11, padding:'3px 9px', borderRadius:4,
                    border:'1px solid var(--info-dim)',
                    background:'var(--info-dim)', color:'var(--info)',
                    cursor:'pointer', display:'flex', alignItems:'center', gap:4,
                    opacity: sortedSectors.length === 0 ? 0.4 : 1,
                  }}
                >
                  <i className="ti ti-share" style={{fontSize:10}} />
                  Share
                </button>
              </div>
            </div>
            {sortedSectors.length===0 ? (
              <div style={{padding:16, color:C.hint, fontSize:12, textAlign:'center'}}>
                No sector data available
              </div>
            ) : (
              <div style={{
                display:'grid',
                gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',
                gap:8,
                padding:12,
              }}>
                {sortedSectors.map(sec=>{
                  const chg = sec[sectorKey]
                  const isPos = (chg||0)>=0
                  const rowKey = sec.index_name || sec.display_name || ''
                  const isHover = sectorRowHover === rowKey
                  const sectorTitle = sec.display_name || sec.index_name || ''
                  return (
                    <div
                      key={rowKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSectorClick(sectorTitle)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSectorClick(sectorTitle)
                        }
                      }}
                      onMouseEnter={() => setSectorRowHover(rowKey)}
                      onMouseLeave={() => setSectorRowHover(null)}
                      style={{
                        padding:'10px 12px',
                        border:`1px solid ${isHover ? 'rgba(96,165,250,.35)' : C.border}`,
                        borderRadius:8,
                        background: isHover ? 'rgba(96,165,250,.05)' : C.card,
                        display:'flex', alignItems:'center', gap:10,
                        cursor:'pointer',
                        transition: 'background .12s, border-color .12s',
                      }}
                    >
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:12, color:C.text, fontWeight:500,
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                          {sectorTitle}
                        </div>
                        <div style={{width:'100%', height:4, background:C.border,
                          borderRadius:2, marginTop:6, overflow:'hidden'}}>
                          <div style={{height:'100%', borderRadius:2,
                            background: isPos ? C.green : C.red,
                            width: Math.min(Math.abs(chg||0)*8, 100)+'%'}}/>
                        </div>
                      </div>
                      <i
                        className="ti ti-arrow-right"
                        style={{
                          fontSize: 10,
                          color: 'var(--info)',
                          opacity: isHover ? 1 : 0,
                          transition: 'opacity .12s',
                          flexShrink: 0,
                        }}
                        aria-hidden
                      />
                      <span style={{fontSize:13, fontWeight:700, flexShrink:0, minWidth:56,
                        textAlign:'right', fontFamily:'DM Mono,monospace',
                        color: isPos ? C.green : C.red}}>
                        {chg!=null ? (isPos?'+':'')+chg.toFixed(2)+'%' : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )}

          {homeTab==='screens' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Screener toolbar — Export Excel of the current
                  sorted+filtered view. Pro affordance, ungated for now. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center' }}>
                  All NSE stocks · Screener<ProBadge />
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setShowFilters(true)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 8,
                      border: '1px solid var(--accent-border)', background: 'var(--accent-dim)',
                      color: 'var(--accent)', fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    <i className="ti ti-filter" style={{ fontSize: 14 }} /> Filters
                  </button>
                  <ExportMenu
                    label="Export"
                    align="right"
                    filename="PineX_Screener"
                    title="PineX Screener — All NSE"
                    getRows={screenerExportRows}
                  />
                </div>
              </div>
              <StockFilters
                open={showFilters}
                onClose={() => setShowFilters(false)}
                allStocks={allStocks}
                onApply={(stocks, label) => {
                  setSmartResults({ type: 'filter', label, stocks, filter: 'custom' })
                  setShowFilters(false)
                  setTimeout(() => { document.getElementById('screens-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 60)
                }}
              />
              {smartResults !== null && <div id="screens-results"><SmartResultsPanel /></div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

                {/* Invitation cards — route to the Lab (user-run screens).
                    No auto-populated counts/lists, no phase verdicts. */}
                <div
                  onClick={() => navigate('/lab?template=trend-convergence')}
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    🔵 Trend Convergence
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12, flex: 1 }}>
                    Run your own screen to see stocks matching these criteria.
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)' }}>Run screen →</span>
                </div>

                <div
                  onClick={() => { if (!hasSwingXAccess) { setShowSwingXGate(true); return } navigate('/lab?template=swingx') }}
                  style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 12, padding: '16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', opacity: hasSwingXAccess ? 1 : 0.8 }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {!hasSwingXAccess && <span style={{ fontSize: 11 }}>🔒</span>}
                    ⚡ SwingX Template<ProBadge />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12, flex: 1 }}>
                    All 5 criteria simultaneously — run the screen in the Lab.
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>Run screen →</span>
                </div>
              </div>

              {/* Daily Checklist — six self-checks the reader runs
                  before opening any stock. The component persists
                  ticks for the current calendar day; we never grade
                  or react to which boxes are checked. */}
              <DailyChecklist />

              {/* Heatmap shortcut */}
              <button
                onClick={() => navigate('/heatmap')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--info)'; e.currentTarget.style.background = 'var(--info-dim)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-surface)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <i className="ti ti-layout-grid" style={{ fontSize: 16, color: 'var(--info)' }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Sector Heatmap</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Visual sector performance overview</div>
                  </div>
                </div>
                <i className="ti ti-arrow-right" style={{ fontSize: 13, color: 'var(--info)' }} />
              </button>

              {/* Invite banner moved to top-of-Home (visible on every
                  tab, shows the actual link + Copy button inline).
                  Old buried-in-Screens banner removed. */}

              {/* SwingX sector breakdown */}
              {(() => {
                const swingxStocks = allStocks.filter(s => s.high_conviction)
                if (!swingxStocks.length) return null
                const sectorCount = {}
                swingxStocks.forEach(s => { const sec = s.sector || 'Other'; sectorCount[sec] = (sectorCount[sec] || 0) + 1 })
                const topSectors = Object.entries(sectorCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '2px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className="ti ti-bolt" style={{ fontSize: 13, color: 'var(--accent)' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{swingxStocks.length} stocks matching SwingX criteria · updated EOD</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--border-hover)' }}>·</span>
                    {topSectors.map(([sector, count]) => (
                      user ? (
                        <button
                          key={sector}
                          onClick={() => {
                            setSmartQuery(sector)
                            const r = parseSmartQuery(sector.toLowerCase(), allStocks, market)
                            setSmartResults(r)
                            trackSearch(sector.toLowerCase())
                          }}
                          style={{ padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-dim)' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--bg-surface)' }}
                        >
                          {sector} <span style={{ fontWeight: 700 }}>{count}</span>
                        </button>
                      ) : (
                        <span
                          key={sector}
                          onClick={() => setShowAuthPrompt(true)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 11, cursor: 'default', opacity: 0.8, whiteSpace: 'nowrap' }}
                          title="Sign in to explore sectors"
                        >
                          {sector} <span style={{ fontWeight: 700 }}>{count}</span>
                          <i className="ti ti-lock" style={{ fontSize: 9, color: 'var(--text-hint)' }} />
                        </span>
                      )
                    ))}
                    {swingxDelta !== null && swingxDelta > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>+{swingxDelta} entered</span>
                    )}
                    {swingxDelta !== null && swingxDelta < 0 && (
                      <span style={{ fontSize: 11, color: 'var(--negative)', fontWeight: 700 }}>{swingxDelta} exited</span>
                    )}
                  </div>
                )
              })()}

            </div>
          )}

          {homeTab==='watched' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Most Watched</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Stocks PineX members have added to their watchlists. Not a recommendation.</div>
                </div>
                <span style={{ fontSize: 10, color: C.hint, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '2px 8px' }}>
                  This week
                </span>
              </div>

              {mostWatched.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', gap: 10, color: C.hint, textAlign: 'center' }}>
                  <i className="ti ti-users" style={{ fontSize: 32, opacity: 0.4 }} />
                  <div style={{ fontSize: 13 }}>No watchlist data yet</div>
                </div>
              ) : mostWatched.map(({ symbol, count }, i) => {
                const stock = allStocks.find(s => s.symbol === symbol)
                return (
                  <div
                    key={symbol}
                    onClick={() => navigate(`/stock/${symbol}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10,
                      background: C.surface, border: `1px solid ${C.border}`,
                      cursor: 'pointer', transition: 'border-color .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                  >
                    {/* Rank */}
                    <span style={{ fontSize: 11, fontWeight: 700, color: i < 3 ? C.green : C.hint, width: 18, textAlign: 'center', flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    {/* Symbol + name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{symbol}</div>
                      {stock && (
                        <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stock.sector}</div>
                      )}
                    </div>
                    {/* Stage badge */}
                    {stock?.stage && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: stock.stage === 'Stage 2' ? 'var(--stage2-bg)' : 'var(--bg-elevated)',
                        color: stock.stage === 'Stage 2' ? 'var(--stage2-color)' : C.muted,
                        border: `1px solid ${stock.stage === 'Stage 2' ? 'var(--stage2-border)' : C.border}`,
                        flexShrink: 0,
                      }}>{stock.stage}</span>
                    )}
                    {/* Watcher count */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <i className="ti ti-users" style={{ fontSize: 11, color: C.muted }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{count}</span>
                      <span style={{ fontSize: 11, color: C.muted }}>{count === 1 ? 'member' : 'members'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        @keyframes shimmer {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.75; }
        }
        /* Right-edge gradient mask on horizontally-scrollable top
           bars — signals to the user that the row scrolls. We use
           a CSS mask so the fade doesn't paint a coloured overlay
           on top of the row's children (which would tint the
           BREADTH bar etc). Only applied below the md breakpoint;
           on desktop the row fits without truncation. */
        @media (max-width: 767px) {
          .pinex-topbar-fade {
            -webkit-mask-image: linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%);
                    mask-image: linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%);
          }
        }
        input::placeholder{color:var(--text-hint)}
        input:focus{border-color:var(--border-hover)!important}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
        .home-topbar::-webkit-scrollbar{display:none}
        .home-tab-btn { padding: 9px 16px; font-size: 13px; min-height: 40px; }
        @media (min-width: 768px) {
          .home-tab-btn { padding: 11px 22px; font-size: 14px; min-height: 44px; }
          .topbar-divider-md { display: block !important; }
        }
      `}</style>

      {/* Mobile footer links */}
      <div className="md:hidden" style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {[['About', '/about'], ['Privacy', '/privacy'], ['Terms', '/terms']].map(([label, path]) => (
          <Link
            key={path}
            to={path}
            style={{ color: 'var(--text-hint)', fontSize: 12, textDecoration: 'none' }}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Legal disclaimer */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--border)',
        fontSize: 10,
        color: 'var(--text-disabled)',
        textAlign: 'center',
        lineHeight: 1.6,
        flexShrink: 0,
      }}>
        PineX is not registered with SEBI as a Research Analyst or Investment Adviser. All data is end-of-day (EOD) and for educational purposes only.
      </div>

      {/* Sector share modal */}
      {showSectorShare && (
        <SectorShareModal
          sectors={sortedSectors}
          onClose={() => setShowSectorShare(false)}
        />
      )}

      {/* Auth prompt modal */}
      {showAuthPrompt && (
        <div
          onClick={() => setShowAuthPrompt(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: 72,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface)', borderRadius: 16,
              border: '1px solid var(--border)',
              padding: '28px 24px 24px',
              width: '100%', maxWidth: 360,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              textAlign: 'center',
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="ti ti-lock" style={{ fontSize: 22, color: 'var(--info)' }} />
            </div>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Sign in to unlock</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              This filter is available to registered users. Sign in or create a free account to access all screener filters.
            </p>
            <button
              onClick={() => navigate('/login')}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--info)', color: 'var(--bg-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 4,
              }}
            >Sign in</button>
            <button
              onClick={() => navigate('/register')}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}
            >Create free account</button>
          </div>
        </div>
      )}

    </div>

    {/* Academy-required bottom sheet — fires when
        a user without screener access clicks a
        sector card. AcademyRequired handles its
        own backdrop + animation. */}
    {showAcademyPrompt && (
      <AcademyRequired
        daysLeft={
          profile?.academy_deadline
            ? Math.ceil(
                (new Date(profile.academy_deadline) - new Date()) /
                  (1000 * 60 * 60 * 24),
              )
            : null
        }
        onClose={() => setShowAcademyPrompt(false)}
      />
    )}

    {/* SwingX gate — fires when a user without
        SwingX access clicks the chip / tile or
        types "swingx" in the search bar. Same
        component as above but with level="swingx"
        so the "Required to unlock" panel lists
        the 4 swingx-tier modules. */}
    {showSwingXGate && (
      <AcademyRequired
        level="swingx"
        daysLeft={
          profile?.academy_deadline
            ? Math.ceil(
                (new Date(profile.academy_deadline) - new Date()) /
                  (1000 * 60 * 60 * 24),
              )
            : null
        }
        onClose={() => setShowSwingXGate(false)}
      />
    )}
    </>
  )
}
