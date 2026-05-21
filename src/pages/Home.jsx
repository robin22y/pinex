import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context'
import SectorShareModal from '../components/SectorShareCard'
import {
  markHomeBackToSectorsTab,
  clearHomeBackToSectorsTab,
} from '../lib/appNav'

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
  'Stage 2': 'Price above rising 30-week MA',
  'Stage 1': 'Price base forming',
  'Stage 3': 'Momentum slowing',
  'Stage 4': 'Price below declining 30-week MA',
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
    5: {
      text: 'May: Historically mixed — monitor breadth for direction cues',
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
      text: `Breadth fell sharply — stocks above 30W MA dropped from ${breadthPrev.toFixed(0)}% to ${breadthNow.toFixed(0)}% in recent sessions`,
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
      text: `Index level masking weakness — only ${breadthNow.toFixed(0)}% of stocks above 30-week MA while index remains elevated`,
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
        text: `Breadth recovering — stocks above 30W MA improved from ${breadthOlder.toFixed(0)}% to ${breadthNow.toFixed(0)}% over 3 sessions`,
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
  { label: 'SwingX', query: 'swingx' },
  { label: 'Stage 2', query: 'stage 2' },
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

const parseSmartQuery = (query, allStocks, market) => {
  const q = query.toLowerCase().trim()
  if (!q) return null

  // STOCK LOOKUP
  const exactMatch = allStocks.find(s => s.symbol?.toLowerCase() === q)
  if (exactMatch) return { type: 'stock', stock: exactMatch }

  if (q.length >= 2) {
    const matches = allStocks.filter(s =>
      s.symbol?.toLowerCase().startsWith(q) ||
      s.name?.toLowerCase().includes(q) ||
      s.symbol?.toLowerCase().includes(q)
    ).slice(0, 5)
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
    return { type: 'filter', label: 'Established Trend — Stage 2', stocks: s2, filter: 'stage2' }
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
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const PER_PAGE = 10

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
    else if (t === 'stocks' || t === 'search') setHomeTab('search')
  }, [searchParams])

  const handleSectorClick = (sectorName) => {
    const mapped = mapNiftySectorToFilter(sectorName)
    markHomeBackToSectorsTab(location.pathname)
    setSectorFilter(mapped)
    setActiveFilter('all')
    setSearch('')
    setSmartQuery('')
    setSmartResults(null)
    setPage(0)
    setHomeTab('search')
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('tab', 'search')
        return p
      },
      { replace: false },
    )
    requestAnimationFrame(() => {
      document.getElementById('stock-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const loadRef = React.useRef(null)
  const searchInputRef = useRef(null)

  useEffect(() => {
    const withTimeout = (promise, ms = 15000) => {
      const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s — Supabase may be unreachable`)), ms)
      )
      return Promise.race([promise, timer])
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
        ] = await Promise.all([
          withTimeout(supabase.from('mv_home_stocks').select('*').order('symbol').range(0, 999)),
          withTimeout(supabase.from('mv_home_stocks').select('*').order('symbol').range(1000, 1999)),
          withTimeout(supabase.from('mv_home_stocks').select('*').order('symbol').range(2000, 2999)),
          withTimeout(supabase.from('market_internals').select('*').order('date', { ascending: false }).limit(1)),
          withTimeout(supabase.from('market_internals')
            .select('date,nifty_close,new_52w_highs,new_52w_lows,above_ma150_pct,stage2_pct,india_vix,nifty_consecutive_up,nifty_consecutive_down')
            .order('date', { ascending: false }).limit(10)),
          withTimeout(supabase.from('nifty_sectors').select('*').order('date', { ascending: false }).limit(32)),
        ])
        const firstBatch = [...(p0 || []), ...(p1 || []), ...(p2 || [])]

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
            const merged = fallback.map(p => ({ ...p, ...(cMap[p.company_id] || {}) }))
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


  const sectorKey = sectorTf==='1D'?'change_1d':sectorTf==='1W'?'change_1w':sectorTf==='1M'?'change_1m':'change_3m'
  const sortedSectors = [...sectors].sort((a,b)=>(b[sectorKey]||0)-(a[sectorKey]||0))

  const closeSearch = () => { setSmartQuery(''); setSmartResults(null) }

  const SmartResultsPanel = () => {
    const { user } = useAuth()
    if (!smartResults) return null
    const results = smartResults

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
        gridTemplateColumns: '200px 90px 80px 60px 70px 70px 70px',
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
          { label: '% 30W MA', align: 'right' },
          { label: 'RS', align: 'right' },
          { label: 'DEL %', align: 'right' },
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
      const stageColors = { 'Stage 2': 'var(--accent)', 'Stage 1': 'var(--info)', 'Stage 3': 'var(--warning)', 'Stage 4': 'var(--negative)' }
      const sc = stageColors[s.stage] || 'var(--text-muted)'
      const pctFromMa = s.ma30w > 0 ? ((s.close - s.ma30w) / s.ma30w * 100) : null
      return (
        <div
          onClick={() => { navigate('/stock/' + s.symbol); trackSearch(s.symbol) }}
          style={{
            display: 'grid',
            gridTemplateColumns: '200px 90px 80px 60px 70px 70px 70px',
            alignItems: 'center',
            padding: '7px 20px',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
            borderLeft: s.swingx_warning_level === 'caution' ? '3px solid var(--warning)' : s.high_conviction ? '3px solid var(--accent-border)' : '3px solid transparent',
            gap: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{s.symbol}</span>
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, color: sc, background: sc + '18', border: `1px solid ${sc}35`, whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                {getBadgeLabel(s)}
              </span>
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
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: pctFromMa === null ? 'var(--text-hint)' : pctFromMa > 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {pctFromMa !== null ? (pctFromMa > 0 ? '+' : '') + pctFromMa.toFixed(1) + '%' : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: s.rs_vs_nifty === null ? 'var(--text-hint)' : s.rs_vs_nifty > 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {s.rs_vs_nifty !== null ? (s.rs_vs_nifty > 0 ? '+' : '') + s.rs_vs_nifty.toFixed(1) + '%' : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: (s.avg_delivery_30d || 0) > 55 ? 'var(--accent)' : (s.avg_delivery_30d || 0) > 35 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {s.avg_delivery_30d ? s.avg_delivery_30d.toFixed(0) + '%' : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: s.price_change_7d === null ? 'var(--text-hint)' : s.price_change_7d > 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {s.price_change_7d !== null ? (s.price_change_7d > 0 ? '+' : '') + s.price_change_7d.toFixed(1) + '%' : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: s.promoter_pledge_pct === 0 || s.promoter_pledge_pct === null ? 'var(--accent)' : s.promoter_pledge_pct > 20 ? 'var(--negative)' : 'var(--warning)' }}>
            {s.promoter_pledge_pct === null ? '—' : s.promoter_pledge_pct === 0 ? '0%' : s.promoter_pledge_pct.toFixed(1) + '%'}
          </div>
        </div>
      )
    }

    if (results.type === 'stock') {
      const s = results.stock
      const pctFromMa = s.ma30w > 0 ? ((s.close - s.ma30w) / s.ma30w * 100) : null
      const stageCfg = {
        'Stage 2': { c: 'var(--accent)', bg: 'var(--accent-dim)', label: 'Established Trend' },
        'Stage 1': { c: 'var(--info)', bg: 'var(--info-dim)', label: 'Base Formation' },
        'Stage 3': { c: 'var(--warning)', bg: 'var(--warning-dim)', label: 'Topping Phase' },
        'Stage 4': { c: 'var(--negative)', bg: 'var(--negative-dim)', label: 'Downtrend Phase' },
      }
      const sc = stageCfg[s.stage] || { c: 'var(--text-muted)', bg: 'var(--border)', label: s.stage || 'Unknown' }
      const metrics = [
        { label: 'Price', value: s.close ? '₹' + s.close.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—', color: 'var(--text-primary)' },
        { label: 'RS vs Nifty', value: s.rs_vs_nifty != null ? (s.rs_vs_nifty > 0 ? '+' : '') + s.rs_vs_nifty.toFixed(1) + '%' : '—', color: s.rs_vs_nifty > 0 ? 'var(--positive)' : 'var(--negative)' },
        { label: 'vs 30W MA', value: pctFromMa != null ? (pctFromMa > 0 ? '+' : '') + pctFromMa.toFixed(1) + '%' : '—', color: pctFromMa > 0 ? 'var(--positive)' : 'var(--negative)' },
        { label: 'Delivery', value: s.avg_delivery_30d ? s.avg_delivery_30d.toFixed(0) + '%' : '—', color: (s.avg_delivery_30d || 0) > 50 ? 'var(--accent)' : 'var(--text-primary)' },
      ]
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label={s.symbol} />
          <div onClick={() => navigate('/stock/' + s.symbol)} style={{ margin: 16, padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer' }}>
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
      const stocks = results.stocks || []
      const visible = limit ? stocks.slice(0, limit) : stocks
      const hiddenCount = limit ? Math.max(0, stocks.length - limit) : 0
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label={results.label} count={results.stocks.length} />
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
              { val: results.stage2, label: 'Stage 2', color: 'var(--accent)' },
              { val: results.swingx, label: 'SwingX', color: 'var(--accent)' },
              { val: results.stocks.length, label: 'Total', color: 'var(--text-primary)' },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.val}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.label}</div>
              </div>
            ))}
          </div>
          <ResultTableHeader />
          {(() => {
            const limit = user ? null : FREE_LIMITS.sector
            const stocks = results.stocks || []
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
      const stocks = results.stocks || []
      const visible = limit ? stocks.slice(0, limit) : stocks.slice(0, 50)
      const hiddenCount = limit ? Math.max(0, stocks.length - limit) : 0
      return (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <ResultHeader label={results.label} count={results.stocks?.length} />
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
        { label: 'Breadth (30W MA)', value: m.above_ma150_pct != null ? Number(m.above_ma150_pct).toFixed(1) + '%' : '—', sub: 'NSE stocks above 30W MA' },
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
            <button onClick={() => { closeSearch(); navigate('/watchlist') }} style={{ fontSize: 13, color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer' }}>
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
            : 'PineX — NSE Stock Screener | Stage Analysis & SwingX'}
        </title>
        <meta
          name="description"
          content={
            location.pathname === '/screener'
              ? 'Filter 2100+ NSE stocks by Weinstein stage, delivery %, RS score and SwingX signals. Free screener for Indian investors.'
              : 'Screen 2100+ NSE stocks by Weinstein Stage, delivery volume and SwingX signals. Free Indian stock market intelligence platform.'
          }
        />
      </Helmet>
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
              <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--info)' }}>P</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                Pine<span style={{ color: 'var(--info)' }}>X</span>
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
            <div style={{
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
          <div style={{
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

        <div
          className="flex border-b"
          style={{
            flexShrink: 0,
            background: C.surface,
            borderColor: C.border,
          }}
        >
          {[
            {id:'search', label:'Search'},
            {id:'sectors', label:'Sectors'},
            {id:'screens', label:'Screens'},
            {id:'watched', label:'Most Watched'},
          ].map(tab=>(
            <button key={tab.id}
              type="button"
              className="home-tab-btn whitespace-nowrap"
              onClick={() => {
                setHomeTab(tab.id)
                setSearchParams(
                  (prev) => {
                    const p = new URLSearchParams(prev)
                    p.set('tab', tab.id)
                    return p
                  },
                  { replace: true },
                )
              }}
              style={{
                flex:'none',
                fontWeight:homeTab===tab.id ? 600 : 400,
                color:homeTab===tab.id ? C.text : C.textMuted,
                background:'none',
                border:'none',
                borderBottom:`2px solid ${
                  homeTab===tab.id ? C.green : 'transparent'}`,
                cursor:'pointer',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* SCROLLABLE BODY */}
        <div className="md:!px-0 md:!pt-0 md:gap-0" style={{flex:1, overflowY:'auto', overflowX:'hidden',
          padding: homeTab==='search' && smartResults===null ? 0 : '12px 16px 96px',
          display:'flex', flexDirection:'column', gap: homeTab==='search' && smartResults===null ? 0 : 12}}>

          {homeTab==='search' && (
            <>

          {/* SEARCH HERO — shown when no results */}
          {smartResults === null && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '0 16px 48px',
            }}>
              {/* Heading */}
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{
                  fontSize: 26, fontWeight: 800, color: 'var(--text-primary)',
                  letterSpacing: '-0.03em', lineHeight: 1.2, marginBottom: 8,
                }}>
                  Find any stock instantly
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
                  Search by name, ticker, sector, stage, or signal
                </div>
              </div>

              {/* Search input — large, centered, glowing */}
              <div style={{ width: '100%', maxWidth: 640, position: 'relative' }}>
                {/* Glow layer */}
                <div style={{
                  position: 'absolute', inset: -1, borderRadius: 18,
                  background: searchFocused
                    ? 'linear-gradient(135deg, rgba(0,200,5,0.35) 0%, rgba(0,160,4,0.15) 100%)'
                    : 'linear-gradient(135deg, rgba(0,200,5,0.12) 0%, rgba(30,37,48,0) 100%)',
                  filter: searchFocused ? 'blur(12px)' : 'blur(6px)',
                  transition: 'all 0.3s', zIndex: 0, pointerEvents: 'none',
                }} />
                <i className="ti ti-search" style={{
                  position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 20, color: searchFocused ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'color 0.2s', pointerEvents: 'none', zIndex: 2,
                }} />
                <input
                  ref={searchInputRef}
                  value={smartQuery}
                  onChange={e => {
                    const v = e.target.value
                    setSmartQuery(v)
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
                  placeholder="Search stocks, sectors, signals…"
                  style={{
                    position: 'relative', zIndex: 1,
                    width: '100%', boxSizing: 'border-box',
                    background: searchFocused ? 'var(--bg-overlay)' : 'var(--bg-input)',
                    border: searchFocused ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                    borderRadius: 16,
                    padding: '16px 80px 16px 54px',
                    fontSize: 16, color: 'var(--text-primary)', outline: 'none',
                    transition: 'all 0.25s',
                    boxShadow: searchFocused
                      ? '0 0 0 4px rgba(0,200,5,0.10), 0 8px 32px rgba(0,0,0,0.4)'
                      : '0 4px 20px rgba(0,0,0,0.3)',
                  }}
                />
                {!searchFocused && !smartQuery && (
                  <span style={{
                    position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 11, color: 'var(--text-disabled)', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 5, padding: '3px 7px',
                    pointerEvents: 'none', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)',
                    zIndex: 2,
                  }}>
                    ⌘K
                  </span>
                )}
                {smartQuery && (
                  <button
                    onClick={() => { setSmartQuery(''); setSmartResults(null) }}
                    style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', zIndex: 2 }}
                  >
                    <i className="ti ti-x" style={{ fontSize: 16 }} />
                  </button>
                )}
              </div>

              {/* Suggestion chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 18, justifyContent: 'center', maxWidth: 560 }}>
                {(mostSearched.length > 0
                  ? mostSearched.map(q => ({ label: q, query: q }))
                  : SEARCH_SUGGESTIONS
                ).map(s => (
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: pillBg, border: `1px solid ${pillBorder}`,
                      borderRadius: 20, padding: '4px 12px',
                      fontSize: 11, fontWeight: 700, color: pillColor, letterSpacing: '0.04em',
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: pillColor, display: 'inline-block' }}/>
                      Market {healthLabel}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>
                      {breadth.toFixed(0)}% above 30W MA
                      {Number.isFinite(n1d) && (
                        <span style={{ marginLeft: 8, color: n1d >= 0 ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                          · Nifty {n1d >= 0 ? '+' : ''}{n1d.toFixed(2)}%
                        </span>
                      )}
                    </span>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Compact search bar shown above results */}
          {smartResults !== null && (
            <div style={{ position: 'relative', marginBottom: 4 }}>
              <i className="ti ti-search" style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: 15, color: searchFocused ? 'var(--accent)' : 'var(--text-muted)',
                transition: 'color 0.2s', pointerEvents: 'none', zIndex: 1,
              }} />
              <input
                ref={searchInputRef}
                value={smartQuery}
                onChange={e => {
                  const v = e.target.value
                  setSmartQuery(v)
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
                placeholder="Search stocks, sectors, signals…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: searchFocused ? 'var(--bg-overlay)' : 'var(--bg-input)',
                  border: searchFocused ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                  borderRadius: 12,
                  padding: '11px 44px 11px 40px',
                  fontSize: 14, color: 'var(--text-primary)', outline: 'none',
                  transition: 'all 0.2s',
                  boxShadow: searchFocused ? '0 0 0 3px rgba(0,200,5,0.10)' : 'none',
                }}
              />
              <button
                onClick={() => { setSmartQuery(''); setSmartResults(null) }}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center' }}
              >
                <i className="ti ti-x" style={{ fontSize: 14 }} />
              </button>
            </div>
          )}
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
              {smartResults !== null && <SmartResultsPanel />}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

                {/* SwingX tile */}
                <div
                  onClick={() => {
                    setSmartQuery('SwingX')
                    const r = parseSmartQuery('swingx', allStocks, market)
                    setSmartResults(r)
                    trackSearch('swingx')
                  }}
                  style={{
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: 12, padding: '16px',
                    cursor: 'pointer', position: 'relative', overflow: 'hidden',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <div style={{ position: 'absolute', bottom: -8, right: -4, fontSize: 56, opacity: 0.06, pointerEvents: 'none', userSelect: 'none', lineHeight: 1 }}>⚡</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <i className="ti ti-bolt" style={{ fontSize: 12 }} />
                    SwingX
                  </div>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Technical criteria filter</span>
                  <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--accent)', lineHeight: 1, marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                    {loading ? '…' : counts.highconviction}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(0,200,5,.6)', lineHeight: 1.3 }}>All criteria met</div>
                  {swingxDelta !== null && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: swingxDelta > 0 ? C.green : swingxDelta < 0 ? C.red : C.muted, marginTop: 4 }}>
                      {swingxDelta > 0 ? '+' : ''}{swingxDelta} vs yesterday
                    </div>
                  )}
                </div>

                {/* Stage 2 tile */}
                <div
                  onClick={() => {
                    setSmartQuery('Stage 2')
                    const r = parseSmartQuery('stage 2', allStocks, market)
                    setSmartResults(r)
                    trackSearch('stage 2')
                  }}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12, padding: '16px',
                    cursor: 'pointer', position: 'relative', overflow: 'hidden',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <div style={{ position: 'absolute', bottom: -8, right: -4, fontSize: 56, opacity: 0.04, pointerEvents: 'none', userSelect: 'none', lineHeight: 1, color: 'var(--info)' }}>📈</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <i className="ti ti-trending-up" style={{ fontSize: 12 }} />
                    Stage 2
                  </div>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Established uptrend</span>
                  <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                    {loading ? '…' : counts.stage2}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-hint)', lineHeight: 1.3 }}>Stocks in Stage 2</div>
                  {market?.above_ma150_pct != null && (() => {
                    const pct = Number(market.above_ma150_pct)
                    const barColor = pct > 60 ? 'var(--accent)' : pct > 40 ? 'var(--warning)' : 'var(--negative)'
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 9, color: 'var(--text-disabled)' }}>Market breadth</span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: barColor }}>{pct.toFixed(0)}%</span>
                        </div>
                        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: barColor, borderRadius: 2 }} />
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>

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
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{swingxStocks.length} SwingX today</span>
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

              {/* STOCK LIST HEADER */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 2px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  All Stocks
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                  {filtered.length} · sorted by RS
                </span>
              </div>
          {/* ENGINE TABLE */}
          <div id="stock-table" style={{background:'var(--bg-surface)', border:'1px solid var(--border)',
            borderRadius:8, minHeight:200}}>

            {sectorFilter && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                background: 'var(--info-dim)',
                borderBottom: '1px solid var(--border)',
                fontSize: 14,
              }}>
                <i className="ti ti-filter" style={{ color: 'var(--info)', fontSize: 15 }} aria-hidden />
                <span style={{ color: 'var(--info)', fontWeight: 600 }}>Sector: {sectorFilter}</span>
                <span style={{ color: 'var(--text-hint)', fontSize: 13 }}>· {filtered.length} stocks</span>
                <button
                  type="button"
                  onClick={() => {
                    clearHomeBackToSectorsTab()
                    setSectorFilter(null)
                    setPage(0)
                  }}
                  style={{
                    marginLeft: 'auto',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <i className="ti ti-x" style={{ fontSize: 11 }} aria-hidden />
                  Clear
                </button>
              </div>
            )}


            {/* Desktop table */}
            <div className="home-desktop-table">
              <table style={{width:'100%', borderCollapse:'collapse', tableLayout:'fixed'}}>
                <colgroup>
                  <col style={{width:180}}/><col style={{width:110}}/><col style={{width:110}}/>
                  <col style={{width:90}}/><col style={{width:90}}/><col style={{width:100}}/>
                  <col style={{width:90}}/><col style={{width:95}}/><col style={{width:95}}/><col style={{width:95}}/>
                </colgroup>
                <thead>
                  <tr>
                    <TH col="symbol" label="Ticker"/>
                    <TH col="close" label="CMP" right/>
                    <TH col="pct_from_ma" label="% 30W MA" right/>
                    <TH col="rs_rating" label="RS" right/>
                    <TH col="volume" label="Volume" right/>
                    <TH col="delivery" label="Del %" right/>
                    <TH col="avg_volume_30d" label="Del Vol" right/>
                    <TH col="price_change_7d" label="7D %" right/>
                    <TH col="pledge" label="Pledge" right/>
                    <TH col="ai_pulse" label="Pulse" right/>
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array(8).fill(0).map((_,i)=>(
                    <tr key={i}>
                      {Array(10).fill(0).map((_,j)=>(
                        <td key={j} style={{padding:'8px 10px'}}>
                          <div style={{height:12, background:C.border, borderRadius:3,
                            animation:'pulse 1.5s ease infinite', opacity:.5}}/>
                        </td>
                      ))}
                    </tr>
                  )) : paginated.map(s => (
                    <tr key={s.symbol}
                      onClick={()=>navigate('/stock/'+s.symbol)}
                      style={{
                        borderBottom:`1px solid ${C.card}`, cursor:'pointer',
                        borderLeft: s.swingx_warning_level === 'caution' ? '3px solid var(--warning)' : s.high_conviction ? '3px solid var(--accent)' : '3px solid transparent',
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background=C.card}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'9px 12px 9px 10px'}}>
                        <div style={{display:'flex', alignItems:'center', gap:5}}>
                          <span style={{fontWeight:700, fontSize:14, color: s.high_conviction ? 'var(--text-primary)' : C.text}}>{s.symbol}</span>
                          {getStageBadge(s)}
                          {s.high_conviction && (
                            <i className="ti ti-bolt" style={{ fontSize:11, color:'var(--accent)', opacity:0.8 }} />
                          )}
                        </div>
                        <div style={{fontSize:11, color:C.muted, marginTop:2}}>{s.sector}</div>
                        {s.high_conviction && s.swingx_entry_date && (
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>On radar {s.swingx_days || 0}d</span>
                            {s.swingx_return_pct != null && (
                              <span style={{ color: s.swingx_return_pct >= 0 ? 'var(--accent)' : 'var(--negative)', fontWeight: 600 }}>
                                {s.swingx_return_pct >= 0 ? '+' : ''}{s.swingx_return_pct.toFixed(1)}%
                              </span>
                            )}
                            {s.swingx_warning_level === 'caution' && (
                              <span style={{ color: 'var(--warning)', fontSize: 8 }}>⚠️ below 50D</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right'}}>
                        <span style={{fontWeight:600, fontSize:14,
                          color: s.pct_from_ma>5 ? C.green : s.pct_from_ma<-5 ? C.red : C.text}}>
                          ₹{fmt(s.close)}
                        </span>
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right'}}>
                        <span style={{
                          fontSize:13, fontWeight:600, padding:'2px 7px', borderRadius:4,
                          background: s.pct_from_ma>5 ? 'var(--accent-dim)'
                            : s.pct_from_ma>-3 && s.pct_from_ma<5 ? 'var(--warning-dim)'
                            : 'var(--negative-dim)',
                          color: s.pct_from_ma>5 ? C.green
                            : s.pct_from_ma>-3 ? C.amber : C.red
                        }}>
                          {s.pct_from_ma!=null ? fmtPct(s.pct_from_ma) : '—'}
                        </span>
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right'}}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', gap:5}}>
                          <div style={{width:28, height:4, background:C.border, borderRadius:2, overflow:'hidden'}}>
                            <div style={{height:'100%', borderRadius:2,
                              width:(s.rs_rating||0)+'%',
                              background: s.rs_rating>80?C.green:s.rs_rating>60?C.blue:s.rs_rating>40?C.amber:C.red
                            }}/>
                          </div>
                          <span style={{fontSize:13, fontWeight:600, minWidth:24,
                            color: s.rs_rating>80?C.green:s.rs_rating>60?C.blue:s.rs_rating>40?C.amber:C.red}}>
                            {s.rs_rating||'—'}
                          </span>
                        </div>
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right', fontSize:13, color:C.muted}}>
                        {fmtVol(s.volume)}
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right'}}>
                        <span style={{fontSize:13, fontWeight: s.delivery>=60?600:400,
                          color: s.delivery>=60?C.green:s.delivery>=40?C.text:C.muted}}>
                          {s.delivery?.toFixed(1)||'—'}%
                        </span>
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right', fontSize:13, color:C.muted}}>
                        {fmtVol(s.avg_volume_30d)}
                        {s.delivery_trend==='rising' &&
                          <i className="ti ti-arrow-up" style={{color:C.green, marginLeft:4, fontSize:11}} />}
                        {s.delivery_trend==='falling' &&
                          <i className="ti ti-arrow-down" style={{color:C.red, marginLeft:4, fontSize:11}} />}
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right'}}>
                        <span style={{fontSize:13, fontWeight:500,
                          color: s.price_change_7d>3?C.green:s.price_change_7d<-3?C.red:C.muted}}>
                          {s.price_change_7d!=null ? fmtPct(s.price_change_7d) : '—'}
                        </span>
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right'}}>
                        {s.pledge>0
                          ? <span style={{color:C.red, fontWeight:700, fontSize:13}}>
                              {s.pledge.toFixed(1)}%
                            </span>
                          : <span style={{color:C.hint, fontSize:13}}>—</span>
                        }
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'right'}}>
                        <PulseTag pulse={s.ai_pulse}/>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile compact table */}
            <div className="home-mobile-list" style={{ overflowX: 'hidden' }}>
              {loading ? (
                Array(8).fill(0).map((_, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center',
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    gap: 8,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 14, width: '60%', background: C.border, borderRadius: 4, marginBottom: 6, animation: 'pulse 1.5s infinite' }} />
                      <div style={{ height: 10, width: '40%', background: C.border, borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
                    </div>
                    <div style={{ width: 40, height: 14, background: C.border, borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
                    <div style={{ width: 64, height: 14, background: C.border, borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
                  </div>
                ))
              ) : (
                <div>
                  {paginated.map(s => {
                    const pcm = s.pct_from_ma
                    return (
                      <button
                        key={s.symbol}
                        type="button"
                        onClick={() => navigate('/stock/' + s.symbol)}
                        className="flex items-center justify-between w-full px-3 py-2.5 border-b"
                        style={{ borderColor: C.border, background: 'transparent', textAlign: 'left' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold truncate" style={{ color: C.text }}>{s.symbol}</span>
                            {getStageBadge(s)}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs truncate" style={{ color: C.muted }}>{s.sector}</span>
                            {pcm != null && (
                              <span className="text-xs shrink-0" style={{ color: pcm > 0 ? C.green : C.red }}>
                                {pcm > 0 ? '+' : ''}{pcm.toFixed(1)}% MA
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right ml-3">
                          <p className="text-sm font-semibold" style={{ color: C.text, margin: 0 }}>₹{fmt(s.close, 0)}</p>
                          <p className="text-xs mt-0.5" style={{ color: C.muted, margin: 0 }}>{s.delivery != null ? s.delivery.toFixed(0) + '% del' : '—'}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages>1 && (
              <div
                className="flex items-center justify-between px-3 py-2.5 border-t text-xs"
                style={{ borderColor: C.border, color: C.muted }}
              >
                <button
                  type="button"
                  onClick={()=>setPage(p=>Math.max(0,p-1))}
                  disabled={page===0}
                  className="rounded border px-3 py-1.5 text-xs font-medium"
                  style={{
                    borderColor: C.border,
                    color: page === 0 ? C.hint : C.text,
                    background: 'transparent',
                    cursor: page === 0 ? 'default' : 'pointer',
                  }}
                >
                  ← Prev
                </button>
                <span style={{ color: C.muted, whiteSpace: 'nowrap' }}>
                  {page + 1}/{totalPages} · {filtered.length} stocks
                </span>
                <button
                  type="button"
                  onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))}
                  disabled={page>=totalPages-1}
                  className="rounded border px-3 py-1.5 text-xs font-medium"
                  style={{
                    borderColor: C.border,
                    color: page >= totalPages - 1 ? C.hint : C.text,
                    background: 'transparent',
                    cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
            </div>
          )}

          {homeTab==='watched' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Most Watched</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Stocks PineX members are tracking</div>
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
        PineX provides a structured view of market behavior using predefined technical and participation-based indicators. It does not provide investment advice. Data for educational purposes only.
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
    </>
  )
}
