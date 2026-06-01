import { useState, useEffect, useRef, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate, useParams } from 'react-router-dom'
import DeliveryPanel from '../components/DeliveryPanel'
import StockShareModal from '../components/StockShareCard'
import StockChart from '../components/StockChart'
import FactsOnlyDisclaimer from '../components/FactsOnlyDisclaimer'
import ObservationQuestion from '../components/ObservationQuestion'
import PineXMark from '../components/PineXMark'
import ProBadge from '../components/ProBadge'
import MyClassification from '../components/MyClassification'
import { supabase } from '../lib/supabaseClient'
import { consumeHomeNavigateFromStock } from '../lib/appNav'
import { stageBadge, stageDisplayName } from '../lib/stageUi'
import {
  sessionsInCurrentPhase,
  fetchPhaseHistory,
  formatPhaseAge,
} from '../lib/phaseHelpers'
import { useAuth } from '../context'
import {
  insertWatchlistRow,
  selectWatchMembership,
  deleteWatchlistRow,
} from '../lib/watchlistTable'

const C = {
  bg: 'var(--bg-primary)', surface: 'var(--bg-surface)', card: 'var(--bg-elevated)',
  border: 'var(--border)', borderHover: 'var(--border-hover)',
  text: 'var(--text-primary)', muted: 'var(--text-muted)', faint: 'var(--text-hint)',
  green: 'var(--positive)', greenDim: 'var(--stage2-bg)',
  red: 'var(--negative)', redDim: 'var(--negative-dim)',
  blue: 'var(--info)', blueDim: 'var(--info-dim)',
  amber: 'var(--warning)', amberDim: 'var(--warning-dim)',
  purple: '#A78BFA',
}

const QUARTER_MONTH_INDEX = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
  jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11,
}

function quarterLabelTime(row) {
  const raw = row?.quarter ?? row?.quarter_name ?? ''
  if (!raw) return 0
  const parsed = Date.parse(String(raw))
  if (!Number.isNaN(parsed)) return parsed
  const fy = String(raw).trim().match(/^FY(\d{4})$/i)
  if (fy) { const y = Number(fy[1]); if (Number.isFinite(y)) return new Date(y, 2, 31).getTime() }
  const match = String(raw).trim().match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (match) {
    const month = QUARTER_MONTH_INDEX[match[1].slice(0,3).toLowerCase()]
    const year = Number(match[2])
    if (month != null && Number.isFinite(year)) return new Date(year, month, 1).getTime()
  }
  return 0
}

function isFiscalYearRow(row) {
  return /^FY\d{4}$/i.test(String(row?.quarter ?? '').trim())
}

const fmt = (n, d=2) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: d })
const fmtPct = (n, d=1) => n == null ? '—' : (n > 0 ? '+' : '') + Number(n).toFixed(d) + '%'
const fmtCr = (n) => {
  if (!n) return '—'
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(1) + ' Cr'
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L'
  if (n >= 1000) return '₹' + (n / 1000).toFixed(0) + 'K'
  return '₹' + n.toFixed(0)
}
const formatPeriod = (q) => {
  if (!q) return '—'
  if (q.startsWith('FY')) return 'FY ' + q.replace('FY', '').trim()
  return q
}
const growthColor = (val) => {
  if (val == null) return 'var(--text-muted)'
  if (val > 15) return 'var(--positive)'
  if (val > 0) return 'var(--positive-soft)'
  if (val > -10) return 'var(--negative-soft)'
  return 'var(--negative)'
}
const marginColor = (val) => {
  if (val == null) return 'var(--text-muted)'
  if (val > 20) return 'var(--positive)'
  if (val > 10) return 'var(--positive-soft)'
  if (val > 0) return 'var(--text-primary)'
  return 'var(--negative)'
}

const fmtShares = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (v >= 10000000) return (v / 10000000).toFixed(2) + ' Cr'
  if (v >= 100000) return (v / 100000).toFixed(2) + ' L'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K'
  return Math.round(v).toLocaleString('en-IN')
}
const fmtDeliveryDate = (d) => {
  if (!d) return '—'
  const dt = new Date(`${String(d).slice(0,10)}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
const timeAgo = (d) => {
  if (!d) return ''
  const diff = Date.now() - new Date(d)
  const h = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (h < 1) return Math.floor(diff / 60000) + 'm ago'
  if (h < 24) return h + 'h ago'
  if (days < 7) return days + 'd ago'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Shared UI primitives ──────────────────────────────────────────

const STAGE_STYLE = {
  'Stage 2': { bg: 'var(--stage2-bg)', c: 'var(--stage2-color)', b: 'var(--stage2-border)' },
  'Stage 1': { bg: 'var(--stage1-bg)', c: 'var(--stage1-color)', b: 'var(--stage1-border)' },
  'Stage 3': { bg: 'var(--stage3-bg)', c: 'var(--stage3-color)', b: 'var(--stage3-border)' },
  'Stage 4': { bg: 'var(--stage4-bg)', c: 'var(--stage4-color)', b: 'var(--stage4-border)' },
}

const SUBSTAGE_STYLE = {
  '2A+': { bg: 'var(--stage2-bg)', c: 'var(--stage2-color)', b: 'var(--stage2-border)', label: 'S2 A+' },
  '2A-': { bg: 'var(--stage2-bg)', c: 'var(--positive-soft)', b: 'var(--stage2-border)', label: 'S2 A-' },
  '2B+': { bg: 'var(--stage3-bg)', c: 'var(--stage3-color)', b: 'var(--stage3-border)', label: 'S2 B+' },
  '2B-': { bg: 'var(--stage3-bg)', c: 'var(--warning)',      b: 'var(--stage3-border)', label: 'S2 B-' },
}

const STAGE_TOOLTIPS = {
  'Stage 2': 'Price above rising 30W Trend Line',
  'Stage 1': 'Price base forming',
  'Stage 3': 'Momentum slowing',
  'Stage 4': 'Price below declining 30W Trend Line',
}

function StagePill({ stage }) {
  const s = STAGE_STYLE[stage] || { bg: C.card, c: C.muted, b: C.border }
  const tip = STAGE_TOOLTIPS[stage] || ''
  return (
    <span title={tip} style={{ background: s.bg, color: s.c, border: `1px solid ${s.b}`, fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {stage || 'Unclassified'}
    </span>
  )
}

/** Larger stage badge for Technicals tab */
function LargeStageBadge({ stage, substage }) {
  const sub = substage && SUBSTAGE_STYLE[substage]
  const s = sub || STAGE_STYLE[stage] || { bg: C.card, c: C.muted, b: C.border }
  const label = sub ? sub.label : (stage || 'Unclassified')
  const tip = STAGE_TOOLTIPS[stage] || ''
  return (
    <span
      title={tip}
      style={{
        display: 'inline-block',
        background: s.bg,
        color: s.c,
        border: `1px solid ${s.b}`,
        fontSize: 15,
        fontWeight: 800,
        padding: '10px 18px',
        borderRadius: 12,
        letterSpacing: '0.04em',
      }}
    >
      {label}
    </span>
  )
}

/** ₹… en-IN; null → em dash */
function fmtInrCell(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return '₹' + n.toLocaleString('en-IN')
}

function Card({ children, style }) {
  return (
    <div style={{ background: C.surface, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

function SectionLabel({ title, sub }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>{title}</p>
      {sub && <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>{sub}</p>}
    </div>
  )
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: color || C.text, margin: '0 0 3px' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>{sub}</p>}
    </div>
  )
}

// Ring chart for delivery % (SVG arc)
function DeliveryRing({ pct, label, size = 80 }) {
  const r = (size / 2) - 7
  const circ = 2 * Math.PI * r
  const val = pct != null && Number.isFinite(Number(pct)) ? Math.min(100, Math.max(0, Number(pct))) : null
  const offset = val != null ? circ * (1 - val / 100) : circ
  const color = val == null ? C.faint : val > 55 ? C.green : val < 35 ? C.red : C.amber

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.card} strokeWidth={6} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={val != null ? offset : circ}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={{ textAlign: 'center', marginTop: -size * 0.68, marginBottom: size * 0.68 - 8 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color, margin: 0, lineHeight: 1 }}>
          {val != null ? val.toFixed(0) + '%' : '—'}
        </p>
      </div>
      <p style={{ fontSize: 10, color: C.muted, textAlign: 'center', margin: 0, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</p>
    </div>
  )
}

function DeliveryBar({ label, value, suffix = '%', threshold = 50 }) {
  const val = value != null && Number.isFinite(Number(value)) ? Number(value) : null
  const pct = val != null ? Math.min(100, Math.abs(val)) : 0
  const color = val == null ? C.faint : val > threshold ? C.green : val < threshold * 0.6 ? C.red : C.amber

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <p style={{ fontSize: 11, color: C.muted, width: 100, flexShrink: 0, margin: 0 }}>{label}</p>
      <div style={{ flex: 1, height: 4, background: C.card, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 99, transition: 'width 0.5s ease' }} />
      </div>
      <p style={{ fontSize: 12, fontWeight: 700, color, width: 44, textAlign: 'right', flexShrink: 0, margin: 0 }}>
        {val != null ? val.toFixed(1) + suffix : '—'}
      </p>
    </div>
  )
}

// ── Technical Report helpers ──────────────────────────────────────

const ReportSection = ({ title, children }) => (
  <div style={{ borderBottom: '1px solid var(--border)' }}>
    <div style={{ padding: '8px 16px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--bg-elevated)' }}>
      {title}
    </div>
    <div style={{ padding: '4px 0' }}>{children}</div>
  </div>
)

const ReportRow = ({ label, value, sub, valueColor, bold }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 16px', borderBottom: '1px solid var(--bg-elevated)' }}>
    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
    <div style={{ textAlign: 'right' }}>
      <span style={{ fontSize: 12, fontWeight: bold ? 700 : 500, color: valueColor || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {value}
      </span>
      {sub && (
        <div style={{ fontSize: 10, color: sub.color || 'var(--text-muted)', marginTop: 1 }}>{sub.text}</div>
      )}
    </div>
  </div>
)

const CheckRow = ({ label, pass, note }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 16px', borderBottom: '1px solid var(--bg-elevated)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 13, color: pass ? 'var(--positive)' : 'var(--text-disabled)' }}>{pass ? '✓' : '✗'}</span>
      <span style={{ fontSize: 12, color: pass ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>
    </div>
    <span style={{ fontSize: 11, color: pass ? 'var(--positive)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{note}</span>
  </div>
)

// ── Market cap display helpers ───────────────
// Source: companies.market_cap (Cr) +
// companies.cap_category (one of the keys
// below), populated by
// scripts/fetch_market_cap.py.

const CAP_LABELS = {
  large_cap: 'Large Cap',
  mid_cap:   'Mid Cap',
  small_cap: 'Small Cap',
  micro_cap: 'Micro Cap',
  nano_cap:  'Nano Cap',
}

const CAP_COLORS = {
  large_cap: 'var(--positive)',
  mid_cap:   'var(--info)',
  small_cap: 'var(--warning)',
  micro_cap: 'var(--text-muted)',
  nano_cap:  'var(--text-hint)',
}

// HOW IT'S DERIVED — formatMcap
//   Input is market cap in Crores.
//   >= 1,00,000 Cr  → "₹X.YY L Cr" (lakh crore)
//   >= 1,000 Cr     → "₹X,000 Cr"
//   smaller         → "₹X Cr"
const formatMcap = (crores) => {
  if (!crores || crores <= 0) return '—'
  if (crores >= 100000)
    return '₹' + (crores / 100000).toFixed(2) + ' L Cr'
  if (crores >= 1000)
    return '₹' + Math.round(crores / 1000) + ',000 Cr'
  return '₹' + Math.round(crores) + ' Cr'
}

function TechnicalReport({ stock, company, sectorHealth }) {
  if (!stock) return null
  const reportRef = useRef(null)
  const [printing, setPrinting] = useState(false)
  // Phase history for the Three Timeframes section — fetched once
  // per stock so the Medium-term phase-age label and Long-term phase
  // count both read from the same trailing window.
  const [phaseRows, setPhaseRows] = useState(null)
  // The "How to Read This Report" section is a long-form glossary
  // that's useful on first visit but visually noisy on every reload.
  // Collapsed by default; users opt-in to read it.
  const [showHowTo, setShowHowTo] = useState(false)
  useEffect(() => {
    if (!company?.id) return
    let cancelled = false
    fetchPhaseHistory([company.id], 180).then((grouped) => {
      if (cancelled) return
      setPhaseRows(grouped?.[company.id] || [])
    })
    return () => { cancelled = true }
  }, [company?.id])

  const handleDownloadPdf = async () => {
    if (!reportRef.current || printing) return
    setPrinting(true)
    const el = reportRef.current
    const LIGHT = {
      '--bg-surface': '#ffffff', '--bg-primary': '#f8fafc', '--bg-elevated': '#f1f5f9',
      '--border': '#e2e8f0',
      '--text-primary': '#0f172a', '--text-secondary': '#334155', '--text-muted': '#64748b',
      '--text-hint': '#94a3b8', '--text-disabled': '#cbd5e1',
      '--positive': '#16a34a', '--negative': '#dc2626', '--warning': '#d97706',
      '--info': '#0284c7', '--info-dim': '#e0f2fe', '--accent-dim': '#dcfce7',
      '--accent-border': '#86efac', '--warning-dim': '#fef3c7',
      '--stage2-color': '#16a34a', '--stage2-bg': '#dcfce7', '--stage2-border': '#86efac',
      '--stage3-color': '#d97706', '--stage3-bg': '#fef3c7', '--stage3-border': '#fde68a',
      '--stage4-color': '#dc2626', '--stage4-bg': '#fee2e2', '--stage4-border': '#fca5a5',
      '--stage1-color': '#6366f1', '--stage1-bg': '#ede9fe', '--stage1-border': '#c4b5fd',
      '--negative-dim': '#fee2e2',
    }
    const saved = {}
    Object.entries(LIGHT).forEach(([k, v]) => {
      saved[k] = el.style.getPropertyValue(k)
      el.style.setProperty(k, v)
    })
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const imgData = canvas.toDataURL('image/png')
      const win = window.open('', '_blank')
      if (!win) return
      win.document.write(`<!DOCTYPE html><html><head><title>${company?.symbol || ''} — Technical Report</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #ffffff; display: flex; justify-content: center; padding: 20px; }
        img { max-width: 100%; height: auto; display: block; }
        @media print { body { padding: 0; } @page { margin: 0; size: auto; } }
      </style></head><body>
        <img src="${imgData}" />
        <script>window.onload=function(){window.print()}<\/script>
      </body></html>`)
      win.document.close()
    } catch (e) { console.error(e) }
    finally {
      Object.entries(LIGHT).forEach(([k]) => {
        if (saved[k]) el.style.setProperty(k, saved[k])
        else el.style.removeProperty(k)
      })
      setPrinting(false)
    }
  }

  const close   = Number(stock.close || 0)
  const ma30w   = Number(stock.ma30w || 0)
  const ma50    = Number(stock.ma50 || 0)
  const ma20    = Number(stock.ma20 || 0)
  const ma150   = Number(stock.ma150 || 0)
  const high52  = Number(stock.high_52w || 0)
  const low52   = Number(stock.low_52w || 0)
  const rs      = Number(stock.rs_vs_nifty || 0)
  const rsi     = Number(stock.rsi || 0)
  const vol     = Number(stock.volume || 0)
  const avgVol30  = Number(stock.avg_volume_30d || 0)
  const avgDel30  = Number(stock.avg_delivery_30d || 0)
  // WHY: stock.vol_ratio is null for almost every row because the
  // bhav-based daily pipeline (fetch_bhav_daily.py) doesn't compute
  // it — explicit "vol_ratio not available in bhav pipeline" comment
  // in that script. The "Volume above average" criterion was
  // therefore failing for EVERY stock in users' watchlists. We
  // already pull the last ~1260 daily rows into priceHistory (each
  // carries `volume`), so derive vol_ratio here from today's volume
  // vs the 30-day average. Falls through to the stored value when
  // the pipeline eventually populates it.
  const volRatio = (() => {
    const stored = Number(stock.vol_ratio || 0)
    if (stored > 0) return stored
    const recent = (priceHistory || [])
      .slice(0, 30)
      .map((r) => Number(r?.volume))
      .filter((v) => Number.isFinite(v) && v > 0)
    if (recent.length < 5) return 0
    const today = recent[0]
    const avg30 = recent.reduce((s, v) => s + v, 0) / recent.length
    return avg30 > 0 ? today / avg30 : 0
  })()

  const pct = (a, b) => b > 0 ? (a - b) / b * 100 : null
  const fmtPct = (n, prefix = true) => n == null ? '—' : (prefix && n > 0 ? '+' : '') + n.toFixed(1) + '%'
  const fmtPrice = (n) => n > 0 ? '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'

  /**
   * hasValue — single guard the Technicals rows use to skip
   * rendering when there's nothing useful to show. We treat null /
   * undefined / empty string / literal "—" / zero as "no value".
   * The NaN check only applies when the input is already a number
   * (string values like "rising" / "falling" are valid).
   *
   * WHY: Several rows previously rendered with a "—" placeholder
   * which carried no information and just added vertical noise.
   * Wrapping each row in {hasValue(...) && …} hides the entire
   * row when the underlying data isn't there.
   */
  const hasValue = (v) => {
    if (v == null) return false
    if (v === '' || v === '—' || v === 0) return false
    if (typeof v === 'number' && Number.isNaN(v)) return false
    return true
  }
  const fmtVol = (n) => {
    if (!n) return '—'
    if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr'
    if (n >= 100000) return (n / 100000).toFixed(1) + 'L'
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K'
    return String(Math.round(n))
  }
  const pctColor = (n) => n == null ? 'var(--text-muted)' : n > 0 ? 'var(--positive)' : 'var(--negative)'

  const p30w = pct(close, ma30w)
  const p50  = pct(close, ma50)
  const p20  = pct(close, ma20)
  const p150 = pct(close, ma150)
  const pH   = pct(close, high52)
  const pL   = pct(close, low52)

  const checks = [
    { label: 'Advancing confirmed',   pass: stock.stage === 'Stage 2',              note: stock.stage || 'Unknown' },
    { label: 'Price above 30W Trend Line',    pass: ma30w > 0 && close > ma30w,             note: fmtPct(p30w) },
    { label: '30W Trend Line slope rising',   pass: Number(stock.ma30w_slope || 0) > 0,     note: Number(stock.ma30w_slope || 0) > 0 ? 'Rising' : 'Flat/declining' },
    { label: 'RS positive vs Nifty',  pass: rs > 0,                                 note: fmtPct(rs) },
    { label: 'Volume above average',  pass: volRatio >= 1.0,                         note: volRatio > 0 ? volRatio.toFixed(2) + 'x avg' : '—' },
    { label: 'Price near 30W Trend Line',      pass: p30w != null && p30w > 0 && p30w < 20,  note: p30w != null ? fmtPct(p30w) + ' from 30W Trend Line' : '—' },
  ]
  const passCount = checks.filter(c => c.pass).length

  const stageExplain = {
    'Stage 1': 'Basing — the stock is consolidating after a downtrend. Institutions may be quietly accumulating. No confirmed uptrend yet; patience required.',
    'Stage 2': "In the PineX framework, the Advancing phase represents price trending above a rising 30W Trend Line with broad participation and positive relative strength.",
    'Stage 3': 'Topping — the uptrend is stalling and distribution may be underway. Risk/reward is poor for new entries.',
    'Stage 4': 'Declining — confirmed downtrend. Avoid new positions; existing holders should consider exits.',
  }

  return (
    <div ref={reportRef} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.02em' }}>p</span>
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}><PineXMark /></span>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', marginLeft: 5 }}>pinex.in</span>
            </div>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>
            {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        {/* Report title + score row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Technical Structure Report</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {stock?.symbol && <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>{stock.symbol}</span>}
              Educational data only
            </div>
            {/* Download PDF + Pro teaser. The PDF button stays
                fully functional today; the chip beside it sets
                expectation that richer report tools (CSV export,
                alerts, advanced filters) are landing under a
                future Pro tier — see usePlan.js → OPEN_FREE for
                the launch toggle. */}
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <button
                onClick={handleDownloadPdf}
                disabled={printing}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, cursor: printing ? 'wait' : 'pointer', letterSpacing: '0.03em' }}
              >
                <i className="ti ti-file-type-pdf" style={{ fontSize: 12 }} />
                {printing ? 'Preparing…' : 'Download PDF'}
              </button>
              <span
                title="Pro tier — coming soon. Watchlist + report tools stay free."
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'rgba(251,191,36,0.10)',
                  border: '1px solid rgba(251,191,36,0.20)',
                  color: '#FBBF24',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                }}
              >
                PRO · COMING SOON
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'center', background: passCount >= 5 ? 'var(--accent-dim)' : passCount >= 3 ? 'var(--warning-dim)' : 'var(--bg-elevated)', border: `1px solid ${passCount >= 5 ? 'var(--accent-border)' : passCount >= 3 ? 'var(--warning-dim)' : 'var(--border)'}`, borderRadius: 8, padding: '6px 14px', minWidth: 60 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: passCount >= 5 ? 'var(--accent)' : passCount >= 3 ? 'var(--warning)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{passCount}/6</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>criteria</div>
          </div>
        </div>
      </div>

      {/* Where is it now? */}
      <ReportSection title="Where is it now?">
        <ReportRow label="Current Price" value={fmtPrice(close)} bold />
        {company?.market_cap > 0 && (
          <ReportRow
            label="Market Cap"
            value={formatMcap(company.market_cap)}
            sub={
              company.cap_category
                ? {
                    text:
                      CAP_LABELS[company.cap_category] ||
                      company.cap_category,
                    color:
                      CAP_COLORS[company.cap_category] ||
                      'var(--text-muted)',
                  }
                : null
            }
          />
        )}
        <ReportRow label="Cycle Stage" value={stock.stage || '—'} valueColor={stock.stage === 'Stage 2' ? 'var(--stage2-color)' : stock.stage === 'Stage 1' ? 'var(--stage1-color)' : stock.stage === 'Stage 3' ? 'var(--stage3-color)' : stock.stage === 'Stage 4' ? 'var(--stage4-color)' : 'var(--text-muted)'} bold />
        <ReportRow
          label="Sub-stage"
          value={stock.weinstein_substage
            ? (stock.weinstein_substage === '2A+' ? 'S2 A+ — Early advancing'
            : stock.weinstein_substage === '2A-' ? 'S2 A- — Early, conditions partial'
            : stock.weinstein_substage === '2B+' ? 'S2 B+ — Extended, confirmed'
            : stock.weinstein_substage === '2B-' ? 'S2 B- — Extended, weakening'
            : stock.weinstein_substage)
            : '—'}
          valueColor="var(--text-secondary)"
        />
        {stock.stage && stageExplain[stock.stage] && (
          <div style={{ padding: '2px 16px 10px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {stageExplain[stock.stage]}
          </div>
        )}
        <ReportRow label="30W Trend Line" value={fmtPrice(ma30w)} valueColor={pctColor(p30w)} sub={p30w != null ? { text: fmtPct(p30w) + ' vs current price', color: pctColor(p30w) } : null} />
        <ReportRow label="30W Trend Line Slope" value={Number(stock.ma30w_slope || 0) > 0 ? 'Rising' : 'Flat / declining'} valueColor={Number(stock.ma30w_slope || 0) > 0 ? 'var(--positive)' : 'var(--text-muted)'} />
        {p30w != null && (
          <div style={{ padding: '2px 16px 10px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {p30w > 20
              ? `Stock is ${p30w.toFixed(1)}% extended above the 30W Trend Line — historically associated with increased volatility in the PineX framework. High extension from the 30W Trend Line has preceded pullbacks in prior Stage 2 cycles.`
              : p30w > 0
              ? `Stock is ${p30w.toFixed(1)}% above the 30W Trend Line — within a range PineX associates with active Stage 2 conditions.`
              : `Stock is ${Math.abs(p30w).toFixed(1)}% below the 30W Trend Line — wait for a reclaim of the average before considering entry.`}
          </div>
        )}
      </ReportSection>

      {/* Momentum */}
      <ReportSection title="Momentum">
        <ReportRow label="RS vs Nifty (119-day)" value={rs != null ? fmtPct(rs) : '—'} valueColor={pctColor(rs)} bold />
        {rs != null && (
          <div style={{ padding: '2px 16px 8px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {rs > 10
              ? `${company?.symbol || stock?.symbol || 'This stock'} is meaningfully outperforming Nifty (+${rs.toFixed(1)}%). Strong relative strength is a core PineX criterion for Advancing-phase candidates.`
              : rs > 0
              ? `${company?.symbol || stock?.symbol || 'This stock'} is slightly ahead of Nifty (+${rs.toFixed(1)}%). Positive, but not yet a strong divergence — watch for improvement.`
              : `${company?.symbol || stock?.symbol || 'This stock'} is underperforming Nifty (${rs.toFixed(1)}%). Positive RS is a core criterion — wait for improvement before entering.`}
          </div>
        )}
        <ReportRow
          label="RSI (14-day)"
          value={rsi > 0 ? rsi.toFixed(1) : '—'}
          valueColor={rsi > 70 ? 'var(--warning)' : rsi < 30 ? 'var(--negative)' : 'var(--positive)'}
          sub={rsi > 0 ? { text: rsi > 70 ? 'Overbought zone' : rsi < 30 ? 'Oversold zone' : 'Normal range', color: rsi > 70 ? 'var(--warning)' : rsi < 30 ? 'var(--negative)' : 'var(--text-muted)' } : null}
        />
        {hasValue(stock.obv_slope) && (
          <ReportRow label="OBV Slope" value={stock.obv_slope} valueColor={stock.obv_slope === 'up' ? 'var(--positive)' : stock.obv_slope === 'down' ? 'var(--negative)' : 'var(--text-muted)'} />
        )}
      </ReportSection>

      {/* Price Levels */}
      <ReportSection title="Price Levels">
        <ReportRow label="50D Moving Average" value={fmtPrice(ma50)} sub={p50 != null ? { text: fmtPct(p50), color: pctColor(p50) } : null} />
        <ReportRow label="20D Moving Average" value={fmtPrice(ma20)} sub={p20 != null ? { text: fmtPct(p20), color: pctColor(p20) } : null} />
        {hasValue(stock.ma150) && (
          <ReportRow label="150D Moving Average" value={fmtPrice(ma150)} sub={p150 != null ? { text: fmtPct(p150), color: pctColor(p150) } : null} />
        )}
        {hasValue(stock.high_52w) && (
          <ReportRow label="52W High" value={fmtPrice(high52)} sub={pH != null ? { text: fmtPct(pH) + ' from high', color: pctColor(pH) } : null} />
        )}
        {hasValue(stock.low_52w) && (
          <ReportRow label="52W Low" value={fmtPrice(low52)} sub={pL != null ? { text: '+' + pL.toFixed(1) + '% from low', color: 'var(--positive)' } : null} />
        )}
      </ReportSection>

      {/* Volume & Participation */}
      <ReportSection title="Volume & Participation">
        <ReportRow label="Today's Volume" value={fmtVol(vol)} sub={volRatio > 0 ? { text: volRatio.toFixed(2) + 'x 30-day average', color: volRatio >= 1.5 ? 'var(--positive)' : volRatio >= 1.0 ? 'var(--text-muted)' : 'var(--negative)' } : null} />
        {hasValue(stock.avg_volume_30d) && (
          <ReportRow label="Avg Volume (30D)" value={fmtVol(avgVol30)} />
        )}
        {hasValue(stock.avg_delivery_30d) && (
          <ReportRow
            label="Delivery % (30D avg)"
            value={avgDel30.toFixed(1) + '%'}
            valueColor={avgDel30 > 55 ? 'var(--positive)' : avgDel30 > 35 ? 'var(--text-primary)' : 'var(--text-muted)'}
            sub={{ text: avgDel30 > 55 ? 'Above average institutional participation' : avgDel30 > 35 ? 'Normal participation' : 'Below average participation', color: 'var(--text-muted)' }}
          />
        )}
        {hasValue(stock.delivery_trend_30d) && (
          <ReportRow label="Delivery Trend" value={stock.delivery_trend_30d} valueColor={stock.delivery_trend_30d === 'rising' ? 'var(--positive)' : stock.delivery_trend_30d === 'falling' ? 'var(--negative)' : 'var(--text-muted)'} />
        )}
      </ReportSection>

      {/* Sector Context */}
      <ReportSection title="Sector Context">
        <ReportRow label="Sector" value={company?.sector || '—'} />
        <ReportRow label="Industry / Sub-sector" value={company?.industry || '—'} />
        {sectorHealth && (
          <ReportRow
            label="Sector Momentum (1M)"
            value={sectorHealth}
            valueColor={
              sectorHealth === 'Strong' ? 'var(--positive)'
              : sectorHealth === 'Good' ? 'var(--positive)'
              : sectorHealth === 'Weak' ? 'var(--negative)'
              : 'var(--text-muted)'}
          />
        )}
        {(company?.sector || company?.industry) && (
          <div style={{ margin: '4px 16px 8px', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            {(() => {
              const sec = company?.sector || ''
              const ind = company?.industry || ''
              const health = sectorHealth || ''
              const sym = stock?.symbol || ''
              if (sec && ind) {
                if (health === 'Strong' || health === 'Good')
                  return `The ${sec} sector is showing ${health.toLowerCase()} momentum over the last month. Within this sector, ${sym} belongs to the ${ind} sub-group. When a sector shows broad strength, stocks in its sub-groups often benefit from increased institutional attention.`
                if (health === 'Weak')
                  return `The ${sec} sector has shown weak momentum over the last month. ${sym} is part of the ${ind} sub-group within this sector. Sector-wide weakness can affect individual stocks regardless of their own technical structure.`
                if (health === 'Neutral')
                  return `The ${sec} sector is showing neutral momentum over the last month. ${sym} belongs to the ${ind} sub-group. Watch whether sector-level participation improves alongside any individual stock moves.`
                return `${sym} is classified under ${ind}, which is part of the broader ${sec} sector. Sector and industry context helps understand whether a stock's move is isolated or part of a wider trend.`
              }
              if (sec) {
                if (health === 'Strong' || health === 'Good')
                  return `The ${sec} sector is showing ${health.toLowerCase()} momentum over the last month — a positive backdrop for stocks within this space.`
                if (health === 'Weak')
                  return `The ${sec} sector has been weak over the last month. Individual stock strength within a weak sector is harder to sustain.`
                return `${sym} is part of the ${sec} sector. Monitoring sector-level trends alongside individual stock data gives a fuller picture.`
              }
              return null
            })()}
          </div>
        )}
        {stock?.industry_stage2_pct > 0 && (
          <div style={{ margin: '0 16px 8px', padding: '8px 14px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.65 }}>
            <strong style={{ color: stock.industry_stage2_pct >= 50 ? 'var(--positive)' : 'var(--text-primary)' }}>
              {stock.industry_stage2_pct.toFixed(0)}%
            </strong>
            {' '}of stocks in the {company?.industry} group are currently in Stage 2 (uptrend phase).
            {stock.industry_stage2_pct >= 60
              ? ' The sub-sector shows broad participation.'
              : stock.industry_stage2_pct >= 40
              ? ' Mixed conditions within the sub-sector.'
              : ' Limited Stage 2 participation in this sub-group.'}
          </div>
        )}
      </ReportSection>

      {/* Three Timeframes — daily / weekly / monthly observation cards.
          Each timeframe stands alone; we never combine them into a
          single verdict. The reader compares the three pictures and
          answers the question for themselves. */}
      <ReportSection title="Three Timeframes">
        <div style={{ padding: '12px 16px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {/* Short term — daily */}
            {(() => {
              const p50 = pct(close, ma50)
              const rs20 = stock.rs_vs_nifty_20d
              const rs20Has = rs20 != null && rs20 !== '' && Number.isFinite(Number(rs20))
              const rsFallback = Number.isFinite(rs) && stock.rs_vs_nifty != null
              const volR = stock.vol_ratio != null && Number(stock.vol_ratio) > 0
                ? Number(stock.vol_ratio).toFixed(2) + 'x'
                : '—'
              const lo52 = low52 > 0 ? '₹' + Number(low52).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'
              return (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Short term · daily</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>50D MA position</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: pctColor(p50) }}>{fmtPct(p50)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>RS 20D</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {rs20Has
                          ? fmtPct(Number(rs20))
                          : (rsFallback
                              ? <>{fmtPct(rs)} <span style={{ color: 'var(--text-hint)', fontSize: 10 }}>(1Y window)</span></>
                              : '—')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Volume 5D</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{volR}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>52W low</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{lo52}</span>
                    </div>
                  </div>
                  <ObservationQuestion question="Where does the daily picture sit relative to your timeframe?" />
                </div>
              )
            })()}

            {/* Medium term — weekly */}
            {(() => {
              const badge = stageBadge(stock.stage)
              const pctFromMa = ma30w > 0 ? ((close - ma30w) / ma30w) * 100 : null
              const rs3m = stock.rs_vs_nifty_3m
              const rs3mHas = rs3m != null && rs3m !== '' && Number.isFinite(Number(rs3m))
              const rsFallback = Number.isFinite(rs) && stock.rs_vs_nifty != null
              const sessions = phaseRows == null ? null : sessionsInCurrentPhase(phaseRows)
              const ageLabel = phaseRows == null ? '—' : formatPhaseAge(sessions)
              return (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Medium term · weekly</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Current phase</span>
                      <span style={{ background: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{badge.label}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>30W Trend Line position</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: pctColor(pctFromMa) }}>{fmtPct(pctFromMa)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>RS 3M</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {rs3mHas
                          ? fmtPct(Number(rs3m))
                          : (rsFallback
                              ? <>{fmtPct(rs)} <span style={{ color: 'var(--text-hint)', fontSize: 10 }}>(1Y window)</span></>
                              : '—')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Phase age</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{ageLabel}</span>
                    </div>
                  </div>
                  <ObservationQuestion question="Does the weekly trend match what you saw daily?" />
                </div>
              )
            })()}

            {/* Long term — monthly */}
            {(() => {
              const fmtR = (v) => v > 0 ? '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'
              const rs12 = stock.rs_vs_nifty_12m
              const rs12Has = rs12 != null && rs12 !== '' && Number.isFinite(Number(rs12))
              const rsFallback = Number.isFinite(rs) && stock.rs_vs_nifty != null
              const distinctStages = phaseRows == null
                ? null
                : Array.from(new Set((phaseRows || []).map(r => r?.stage).filter(Boolean))).length
              const phaseCountLabel = distinctStages == null
                ? '—'
                : `${distinctStages} ${distinctStages === 1 ? 'phase' : 'phases'} in window`
              return (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Long term · monthly</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--text-muted)' }}>52W range</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', textAlign: 'right' }}>
                        {fmtR(low52)} – {fmtR(high52)}<br />
                        <span style={{ color: 'var(--text-hint)', fontSize: 10 }}>Now {fmtR(close)}</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>RS 12M</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {rs12Has
                          ? fmtPct(Number(rs12))
                          : (rsFallback
                              ? <>{fmtPct(rs)} <span style={{ color: 'var(--text-hint)', fontSize: 10 }}>(1Y window)</span></>
                              : '—')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Phase count</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{phaseCountLabel}</span>
                    </div>
                  </div>
                  <ObservationQuestion question="How does the long view compare to the short and medium signals?" />
                </div>
              )
            })()}
          </div>
          <div style={{ marginTop: 12 }}>
            <FactsOnlyDisclaimer />
          </div>
        </div>
      </ReportSection>

      {/* Weinstein Checklist */}
      <ReportSection title={`PineX Criteria — ${passCount}/6 criteria met`}>
        {checks.map((c, i) => <CheckRow key={i} label={c.label} pass={c.pass} note={c.note} />)}
      </ReportSection>

      {/* How to Read This Report — collapsed by default. The toggle
          uses the same row styling as the surrounding ReportSection
          headers so the visual rhythm stays consistent whether the
          glossary is open or closed. */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setShowHowTo(s => !s)}
          aria-expanded={showHowTo}
          style={{
            width: '100%',
            background: 'var(--bg-elevated)',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            padding: '8px 16px',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>How to Read This Report</span>
          <span aria-hidden="true" style={{ fontSize: 12 }}>{showHowTo ? '↑' : '↓'}</span>
        </button>
        {showHowTo && (
          <div style={{ padding: '10px 16px 14px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.75 }}>
            <p style={{ margin: '0 0 8px' }}>This report follows the PineX Cycle Analysis framework. Stocks cycle through 4 stages — basing (1), advancing (2), topping (3), and declining (4). In the PineX methodology, Stage 2 represents the advancing phase and Stage 4 the declining phase. The framework focuses on identifying stocks in Stage 2 uptrends.</p>
            <p style={{ margin: '0 0 8px' }}>The 30W trend line is the anchor. An Advancing-phase stock trades above a rising 30W Trend Line, shows positive RS vs the index, and is confirmed by rising volume and delivery.</p>
            <p style={{ margin: 0 }}>Use the checklist score as a filter, not a signal. 5–6 criteria met = high-quality setup. Below 3 = fewer PineX criteria are met. Higher scores indicate stronger alignment with the framework.</p>
          </div>
        )}
      </div>

      {/* AI Narrative — Coming Soon */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '8px 16px', fontSize: 10, fontWeight: 700, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>AI Narrative Summary</span>
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: 'var(--info-dim)', color: 'var(--info)', border: '1px solid var(--info-dim)', fontWeight: 700, letterSpacing: '0.06em' }}>PRO · COMING SOON</span>
        </div>
        <div style={{ padding: '12px 16px', filter: 'blur(3px)', userSelect: 'none', pointerEvents: 'none', opacity: 0.4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Over the past 4 months this stock has shown a consistently rising 30W trend line with above-average delivery participation in 6 of the last 8 weeks. The relative strength vs Nifty has been improving steadily since January 2026, indicating continued sector rotation into this space. Volume patterns suggest institutional accumulation over the last 3 weeks.
          </div>
        </div>
      </div>

      {/* Branded footer */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--accent)' }}>p</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '-0.01em' }}><PineXMark /></span>
          <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>· pinex.in</span>
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-hint)', letterSpacing: '0.03em' }}>India's Market Intelligence Platform</span>
      </div>

      {/* Disclaimer */}
      <div style={{ padding: '10px 16px', fontSize: 10, color: 'var(--text-disabled)', lineHeight: 1.6, fontStyle: 'italic' }}>
        This report contains factual technical data for educational purposes only. It does not constitute investment advice or a recommendation to buy or sell any security. PineX is not a SEBI registered investment advisor. Past technical patterns do not guarantee future performance.
      </div>
    </div>
  )
}

// ── Share Card ────────────────────────────────────────────────────

function ShareCard({ stock, company, onClose }) {
  const cardRef = useRef(null)
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)

  // hasValueLocal — same rule as the TechnicalReport helper:
  // hide null / undefined / '' / '—' / 0 / NaN, but keep
  // legitimate strings like "rising". The card's tile filter and
  // any future conditional renders should resolve through this so
  // the share image never carries a "—" placeholder.
  const hasValueLocal = (v) => {
    if (v == null) return false
    if (v === '' || v === '—' || v === 0) return false
    if (typeof v === 'number' && Number.isNaN(v)) return false
    return true
  }

  const close   = Number(stock.close || 0)
  const ma30w   = Number(stock.ma30w || 0)
  const rs      = Number(stock.rs_vs_nifty || 0)
  const pctFromMa = ma30w > 0 ? (close - ma30w) / ma30w * 100 : null

  const stageColor =
    stock.stage === 'Stage 2' ? '#00C805'
    : stock.stage === 'Stage 1' ? '#60A5FA'
    : stock.stage === 'Stage 3' ? '#FBBF24'
    : '#FF3B30'

  // WHY: "Entry zone" used to live in this checks array but was
  // removed because the label implies a buy-decision suggestion,
  // which crosses the line SEBI draws around unregistered advisory
  // content. The in-app PineX Criteria checklist (in TechnicalReport)
  // uses the neutral "Price near 30W Trend Line" wording instead.
  // The shareable card stays even more conservative — observation-
  // only flags, never anything that hints at action.
  const checks = [
    { label: 'Advancing',             pass: stock.stage === 'Stage 2' },
    { label: 'Rising 30W Trend Line', pass: Number(stock.ma30w_slope || 0) > 0 },
    { label: 'RS positive',           pass: rs > 0 },
    { label: 'Volume confirmed',      pass: Number(stock.vol_ratio || 0) >= 1.0 },
  ]
  const passCount = checks.filter(c => c.pass).length

  // Share payload reused across every channel
  const shareUrl  = `https://pinex.in/stock/${stock.symbol}`
  const shareText = `${stock.symbol} is in ${stock.stage} with RS ${rs > 0 ? '+' : ''}${rs.toFixed(1)}% vs Nifty. Cycle analysis on PineX.`

  // Save the captured card as a PNG. Returns the blob URL so the
  // caller can choose to download it OR pass it to navigator.share.
  const renderToBlob = async () => {
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(cardRef.current, {
      scale: 2,
      backgroundColor: '#0B0E11',
      useCORS: true,
    })
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('toBlob returned null'))
        resolve(blob)
      }, 'image/png')
    })
  }

  // "Save image" — downloads the captured PNG. Works everywhere
  // (no HTTPS / Web Share API required).
  const handleSaveImage = async () => {
    if (copying) return
    setCopying(true)
    try {
      const blob = await renderToBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${stock.symbol}-pinex.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[share] save image failed:', e)
    } finally {
      setCopying(false)
    }
  }

  // "Native share" — only meaningful on HTTPS + Web Share-capable
  // devices (mobile Safari, mobile Chrome). Silently skipped if
  // the device can't share files.
  const handleNativeShare = async () => {
    if (copying) return
    setCopying(true)
    try {
      const blob = await renderToBlob()
      const file = new File([blob], `${stock.symbol}-pinex.png`, { type: 'image/png' })
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `${stock.symbol} — Technical Summary`,
          text: shareText,
          files: [file],
          url: shareUrl,
        })
      } else if (navigator.share) {
        // No file support — share the URL + text only.
        await navigator.share({ title: stock.symbol, text: shareText, url: shareUrl })
      } else {
        // Fall back to download.
        await handleSaveImage()
      }
    } catch (e) {
      // User-cancel raises AbortError — silent. Anything else: log.
      if (e?.name !== 'AbortError') console.error('[share] native share failed:', e)
    } finally {
      setCopying(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (e) {
      // Older browsers / non-HTTPS: fallback to a temp textarea
      const ta = document.createElement('textarea')
      ta.value = `${shareText}\n${shareUrl}`
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1800) }
      catch (err) { console.error('[share] copy failed:', err) }
      document.body.removeChild(ta)
    }
  }

  // Direct deep-links — open the relevant app/web composer.
  // Always work (no permissions, no HTTPS requirement).
  const shareLinks = [
    {
      label: 'WhatsApp', icon: 'ti-brand-whatsapp', color: '#25D366',
      href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`,
    },
    {
      label: 'Twitter / X', icon: 'ti-brand-x', color: '#FFFFFF',
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
    },
    {
      label: 'Telegram', icon: 'ti-brand-telegram', color: '#26A5E4',
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
    },
  ]

  return (
    <div
      // Backdrop only closes when the click is on the backdrop
      // itself, not on a bubbled event from any child button.
      // Previous handler used `onClick={onClose}` which closed the
      // modal the moment the user tapped any action — html2canvas
      // then ran against a removed DOM ref and silently failed,
      // making the share button look unresponsive.
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Card to capture */}
      <div
        ref={cardRef}
        onClick={e => e.stopPropagation()}
        style={{ width: 340, maxWidth: '100%', background: '#0B0E11', border: '1px solid #1E2530', borderRadius: 16, overflow: 'hidden', flexShrink: 0 }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #1E2530', background: '#0F1217' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.02em' }}>{stock.symbol}</div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{company?.name || company?.sector}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#E2E8F0' }}>
                ₹{close.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
              </div>
              {/* Stage chip — uses the PineX vocab (Basing /
                  Advancing / Topping / Declining) so the shared
                  image speaks the same language as the rest of
                  the app. `stageDisplayName` falls back to the
                  raw DB string if it doesn't recognise the input. */}
              <div style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: stageColor + '18', color: stageColor, border: `1px solid ${stageColor}35`, marginTop: 4, fontWeight: 700 }}>
                {stageDisplayName(stock.stage) || stock.stage}
              </div>
            </div>
          </div>
        </div>

        {/* Key metrics — filter out tiles with no data so the card
            never shows a "—" placeholder. The grid column count
            adapts to the number of surviving tiles. */}
        {(() => {
          const tiles = [
            hasValueLocal(stock.rs_vs_nifty) && {
              label: 'RS vs Nifty',
              value: (rs > 0 ? '+' : '') + rs.toFixed(1) + '%',
              color: rs > 0 ? '#00C805' : '#FF3B30',
            },
            pctFromMa != null && Number.isFinite(pctFromMa) && {
              label: 'vs 30W Trend Line',
              value: (pctFromMa > 0 ? '+' : '') + pctFromMa.toFixed(1) + '%',
              color: pctFromMa > 0 ? '#00C805' : '#FF3B30',
            },
            hasValueLocal(stock.avg_delivery_30d) && {
              label: 'Delivery',
              value: Number(stock.avg_delivery_30d).toFixed(0) + '%',
              color: Number(stock.avg_delivery_30d) > 50 ? '#00C805' : '#94A3B8',
            },
          ].filter(Boolean)
          if (tiles.length === 0) return null
          const cols = `repeat(${tiles.length}, 1fr)`
          return (
            <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid #1E2530' }}>
              {tiles.map((m, i) => (
                <div key={i} style={{ padding: '10px 12px', borderRight: i < tiles.length - 1 ? '1px solid #1E2530' : 'none', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</div>
                  <div style={{ fontSize: 9, color: '#475569', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Weinstein checklist */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #1E2530' }}>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>PineX Criteria</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {checks.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: c.pass ? '#E2E8F0' : '#475569' }}>
                <span style={{ color: c.pass ? '#00C805' : '#334155', fontSize: 12, fontWeight: 700 }}>{c.pass ? '✓' : '✗'}</span>
                {c.label}
              </div>
            ))}
          </div>
          {/* Denominator derived from checks.length so we never
              get out of sync when criteria are added or removed
              (Entry zone was removed for SEBI-compliance). The
              "good" threshold drops to >=3 now that there are 4
              total criteria. */}
          <div style={{ marginTop: 10, fontSize: 11, color: passCount >= 3 ? '#00C805' : '#64748B', fontWeight: 600 }}>
            {passCount}/{checks.length} criteria met
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0' }}>
            <PineXMark />
            <span style={{ fontSize: 9, color: '#475569', fontWeight: 400, marginLeft: 6 }}>pinex.in</span>
          </div>
          <div style={{ fontSize: 9, color: '#334155', fontStyle: 'italic' }}>Educational data only</div>
        </div>
      </div>

      {/* Share sheet — explicit channel buttons, all wrapped in a
          stopPropagation container so taps never bubble to the
          backdrop close handler. Direct deep-links (WhatsApp / X /
          Telegram) always work; Copy / Save are first-class so
          desktop + non-HTTPS dev environments aren't stuck waiting
          on a Web Share API that won't fire. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: 16,
          width: 340,
          maxWidth: '100%',
          background: '#0F1217',
          border: '1px solid #1E2530',
          borderRadius: 14,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Channel link row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {shareLinks.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 4, padding: '10px 6px', borderRadius: 10,
                background: '#0B0E11', border: '1px solid #1E2530',
                color: s.color, textDecoration: 'none',
                fontSize: 11, fontWeight: 600,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = s.color + '66' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#1E2530' }}
            >
              <i className={`ti ${s.icon}`} style={{ fontSize: 18 }} />
              {s.label}
            </a>
          ))}
        </div>

        {/* Copy + Save row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              padding: '10px 12px', borderRadius: 10,
              background: copied ? 'rgba(0,200,5,0.15)' : '#0B0E11',
              border: `1px solid ${copied ? 'rgba(0,200,5,0.4)' : '#1E2530'}`,
              color: copied ? '#00C805' : '#E2E8F0',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            <i className={copied ? 'ti ti-check' : 'ti ti-link'} style={{ fontSize: 14 }} />
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button
            type="button"
            onClick={handleSaveImage}
            disabled={copying}
            style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#0B0E11', border: '1px solid #1E2530',
              color: '#E2E8F0', fontSize: 12, fontWeight: 600,
              cursor: copying ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: copying ? 0.7 : 1,
              transition: 'all 0.15s',
            }}
          >
            <i className={copying ? 'ti ti-loader-2' : 'ti ti-download'} style={{ fontSize: 14, animation: copying ? 'spin 1s linear infinite' : 'none' }} />
            {copying ? 'Saving…' : 'Save image'}
          </button>
        </div>

        {/* Native share (Web Share API) — only rendered when the
            browser actually supports it. On desktop / HTTP this
            button hides entirely so it never looks "broken". */}
        {typeof navigator !== 'undefined' && navigator.share && (
          <button
            type="button"
            onClick={handleNativeShare}
            disabled={copying}
            style={{
              padding: '11px 14px', borderRadius: 10,
              background: '#00C805', border: 'none',
              color: '#000', fontSize: 13, fontWeight: 700,
              cursor: copying ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: copying ? 0.7 : 1,
            }}
          >
            <i className="ti ti-share" style={{ fontSize: 15 }} />
            {copying ? 'Preparing…' : 'More share options'}
          </button>
        )}

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '8px', borderRadius: 10,
            background: 'transparent', border: '1px solid #1E2530',
            color: '#64748B', fontSize: 12, cursor: 'pointer',
          }}
        >
          Close
        </button>

        <div style={{ fontSize: 10, color: '#475569', textAlign: 'center', fontStyle: 'italic' }}>
          Sharing facts only · Not investment advice
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────

export default function StockDetail() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const tabRef = useRef(null)
  const { user } = useAuth()
  const [company, setCompany] = useState(null)
  const [price, setPrice] = useState(null)
  const [shareholding, setShareholding] = useState([])
  const [financials, setFinancials] = useState([])
  const [news, setNews] = useState([])
  const [delivery, setDelivery] = useState(null)
  const [latestDeliveryDay, setLatestDeliveryDay] = useState(null)
  const [quarterlyChanges, setQuarterlyChanges] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [swingConditions, setSwingConditions] = useState(null)
  const [showShare, setShowShare] = useState(false)
  const [showShareCard, setShowShareCard] = useState(false)
  const [watching, setWatching] = useState(false)
  const [watchlistRowId, setWatchlistRowId] = useState(null)
  const [watchLoading, setWatchLoading] = useState(false)
  const [watchError, setWatchError] = useState(null)
  const [watcherCount, setWatcherCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [deliveryTab, setDeliveryTab] = useState('1D')
  const [sectorHealth, setSectorHealth] = useState(null)
  // Compact sticky strip — appears when the user has scrolled past
  // the top of the page so the critical at-a-glance info (phase,
  // PineX score, % vs trend line) stays in view through Overview /
  // Technicals / Delivery / Financials / Ownership. The sentinel
  // sits at the very top of the page; once it leaves the viewport,
  // the compact strip pins to the top via position: fixed.
  const stickySentinelRef = useRef(null)
  const [isStickyStripVisible, setIsStickyStripVisible] = useState(false)
  const sym = symbol?.toUpperCase()

  useEffect(() => {
    if (!sym) return
    const load = async () => {
      setLoading(true)
      const { data: co } = await supabase.from('companies').select('*').eq('symbol', sym).single()
      if (!co) { setLoading(false); return }
      setCompany(co)
      const [
        { data: pd }, { data: sh }, { data: fin },
        { data: nws }, { data: del }, { data: latestDay },
        { data: qc }, { data: hist }, { data: swing },
        { data: secRows },
      ] = await Promise.all([
        supabase.from('price_data').select('*').eq('company_id', co.id).eq('is_latest', true).maybeSingle(),
        supabase.from('shareholding').select('*').eq('company_id', co.id).order('quarter', { ascending: false }).limit(6),
        supabase.from('financials').select('*').eq('company_id', co.id).order('quarter', { ascending: false }).limit(8),
        supabase.from('stock_news').select('*').eq('company_id', co.id).order('published_at', { ascending: false }).limit(10),
        supabase.from('delivery_signals').select('*').eq('company_id', co.id).order('date', { ascending: false }).maybeSingle(),
        supabase.from('delivery_data').select('date,delivery_pct,delivery_volume,total_volume,vs_30d_avg,ai_insight')
          .eq('company_id', co.id).order('date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('quarterly_changes').select('*').eq('company_id', co.id)
          .order('quarter', { ascending: false }).limit(1).maybeSingle(),
        // WHY: include rs_vs_nifty + mansfield_rs so the chart's
        // bottom pane can render the textbook Mansfield Relative
        // Strength time series (with rs_vs_nifty as a graceful
        // fallback for rows where Mansfield hasn't been computed
        // yet during the rollout).
        // Bumped the limit from 252 → 1260 so the 5-year history
        // landing in price_data is fully visible in the chart and
        // breadth / backtest queries can read it from the same
        // result set.
        supabase.from('price_data')
          .select('date,open,high,low,close,volume,ma20,ma50,ma150,rsi,rs_vs_nifty,mansfield_rs')
          .eq('company_id', co.id)
          .order('date', { ascending: false })
          .limit(1260),
        supabase.from('swing_conditions')
          .select('*')
          .eq('symbol', sym)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('nifty_sectors')
          .select('index_name, change_1m')
          .order('date', { ascending: false })
          .limit(100),
      ])
      setPrice(pd ?? null); setShareholding(sh || []); setFinancials(fin || [])
      setNews(nws || []); setDelivery(del ?? null); setLatestDeliveryDay(latestDay)
      setQuarterlyChanges(qc ?? null)
      setPriceHistory(hist || [])
      setSwingConditions(swing ?? null)
      if (secRows?.length && co.sector) {
        const norm = s => s.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim()
        const sectorLower = norm(co.sector)
        const match = secRows.find(r => {
          const idx = norm(r.index_name || '')
          const idxStripped = idx.replace(/^nifty\s*/, '')
          return idx.includes(sectorLower) || sectorLower.includes(idxStripped) || idxStripped.includes(sectorLower)
        })
        const c1m = match?.change_1m
        if (c1m != null) {
          setSectorHealth(c1m > 5 ? 'Strong' : c1m > 0 ? 'Good' : c1m > -5 ? 'Neutral' : 'Weak')
        }
      }
      const { data: countData } = await supabase
        .rpc('get_symbol_watcher_count', { p_symbol: sym })
      setWatcherCount(countData || 0)
      setLoading(false)
    }
    load()
  }, [sym])

  // Check watchlist membership whenever user or company changes
  useEffect(() => {
    if (!user?.id || !company?.id) {
      setWatching(false)
      setWatchlistRowId(null)
      return
    }
    selectWatchMembership(user.id, company.id).then(({ data }) => {
      setWatching(!!data)
      setWatchlistRowId(data?.id ?? null)
    })
  }, [user?.id, company?.id])

  const handleWatchToggle = async () => {
    // 1. Not signed in — route to login instead of silently doing
    //    nothing. The button used to early-return on !user with no
    //    user-visible feedback, which made it look broken.
    if (!user) {
      navigate('/login', { state: { next: `/stock/${sym}` } })
      return
    }
    // 2. Already mid-flight — ignore re-taps.
    if (watchLoading) return
    // 3. Company row hasn't finished loading yet — show a
    //    transient message rather than throwing on company.id.
    if (!company?.id) {
      setWatchError('Stock data is still loading — please try again in a moment.')
      return
    }

    setWatchLoading(true)
    setWatchError(null)
    try {
      if (watching && watchlistRowId) {
        // deleteWatchlistRow dispatches to
        // localStorage for the dev user and to
        // Supabase for real users — so the same
        // call works in both modes.
        const { error: delErr } = await deleteWatchlistRow(user.id, watchlistRowId)
        if (delErr) {
          console.error('watchlist delete failed:', delErr)
          setWatchError(humanizeWatchError(delErr))
          return
        }
        setWatching(false)
        setWatchlistRowId(null)
        // Optimistic decrement — keeps the
        // "N watchers" pill accurate without
        // a round-trip to the RPC.
        setWatcherCount((c) =>
          c == null ? c : Math.max(0, c - 1),
        )
      } else {
        const { data, error } = await insertWatchlistRow({
          user_id: user.id,
          company_id: company.id,
          symbol: sym,
          group_name: 'My Watchlist',
          added_at: new Date().toISOString(),
          price_at_add: price?.close ?? null,
        })
        if (error) {
          console.error('watchlist insert failed:', error)
          setWatchError(humanizeWatchError(error))
          return
        }
        setWatching(true)
        // insertWatchlistRow returns the inserted
        // row via .select().single(), so we can
        // grab the id directly.
        setWatchlistRowId(data?.id ?? null)
        // Optimistic increment.
        setWatcherCount((c) => (c == null ? c : c + 1))
      }
    } catch (e) {
      // Unexpected runtime error (network drop, etc.) — surface
      // it instead of letting it disappear into the void.
      console.error('watchlist toggle threw:', e)
      setWatchError(humanizeWatchError(e))
    } finally {
      setWatchLoading(false)
    }
  }

  // Translate a Supabase error into something
  // a human can read without opening DevTools.
  function humanizeWatchError(err) {
    const code = err?.code
    const msg = err?.message || ''
    if (code === '42501' || msg.includes('row-level security')) {
      return 'Permission denied — please sign in again.'
    }
    if (code === '23505') {
      return 'Already in your watchlist.'
    }
    if (msg.toLowerCase().includes('jwt') || msg.includes('401')) {
      return 'Session expired — please sign in again.'
    }
    return 'Could not update watchlist. Please try again.'
  }

  const shareholdingByQuarter = useMemo(
    () => [...shareholding].sort((a, b) => quarterLabelTime(b) - quarterLabelTime(a)),
    [shareholding],
  )
  const financialsByQuarter = useMemo(
    () => [...financials].sort((a, b) => quarterLabelTime(b) - quarterLabelTime(a)),
    [financials],
  )
  const quarterlyFinancials = useMemo(
    () => financialsByQuarter.filter((row) => !isFiscalYearRow(row)),
    [financialsByQuarter],
  )

  const isAnnual = useMemo(
    () => financials?.length > 0 && financials.every(f => f.quarter?.startsWith('FY')),
    [financials],
  )

  const sortedFinancials = useMemo(
    () => [...(financials || [])].sort((a, b) => {
      if (isAnnual) return b.quarter.localeCompare(a.quarter)
      return 0
    }),
    [financials, isAnnual],
  )

  const withGrowth = useMemo(
    () => sortedFinancials.map((row, idx, arr) => {
      if (!isAnnual) return row
      const prev = arr[idx + 1]
      const revYoY = prev?.revenue && row.revenue
        ? ((row.revenue - prev.revenue) / Math.abs(prev.revenue) * 100)
        : null
      const patYoY = prev?.pat && row.pat
        ? ((row.pat - prev.pat) / Math.abs(prev.pat) * 100)
        : null
      return {
        ...row,
        revenue_growth_yoy: revYoY != null ? parseFloat(revYoY.toFixed(1)) : null,
        pat_growth_yoy: patYoY != null ? parseFloat(patYoY.toFixed(1)) : null,
        revenue_growth_qoq: null,
        pat_growth_qoq: null,
      }
    }),
    [sortedFinancials, isAnnual],
  )

  // HOW IT'S DERIVED
  //   pct_from_ma = (close − ma30w) / ma30w × 100
  // > 0 = price trading above the 30-week SMA (Stage 2 territory)
  // 0–10 % = entry zone (SwingX requires ≤ 20)
  // > 20 % = extended; > 30 % usually means too late to enter
  // < 0  = price under the MA (Stage 1 base or Stage 4 decline)
  const pct_from_ma = useMemo(() => {
    const c = price?.close
    const m = price?.ma30w
    if (c == null || m == null || Number(m) === 0) return null
    return ((Number(c) - Number(m)) / Number(m)) * 100
  }, [price?.close, price?.ma30w])
  /** ma30w_slope is numeric in DB; coerce so .toFixed is safe if PostgREST sends a string. */
  const ma30wSlopeNum = useMemo(() => {
    const v = price?.ma30w_slope
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }, [price?.ma30w_slope])

  // PineX criteria score (0–6) — mirrors the checklist computed
  // inside TechnicalReport so the sticky strip can display it
  // without lifting the whole checks array. If any check's inputs
  // are unavailable the criterion just fails; we never throw on
  // missing data.
  // Six checks (same as the PineX Criteria section):
  //   1. Advancing phase  (stage === "Stage 2")
  //   2. Price > 30W trend line
  //   3. 30W trend line slope rising
  //   4. RS vs Nifty positive
  //   5. Today's volume >= 1.0× 30-day average
  //   6. Price within the 0–20 % above-MA "not extended" band
  const pinexScore = useMemo(() => {
    if (!price) return null
    const close = Number(price.close) || 0
    const ma30w = Number(price.ma30w) || 0
    const slope = Number(price.ma30w_slope) || 0
    const rs    = Number(price.rs_vs_nifty) || 0
    const vol   = Number(price.vol_ratio) || 0
    const p30w  = ma30w > 0 ? ((close - ma30w) / ma30w) * 100 : null
    let score = 0
    if (price.stage === 'Stage 2') score += 1
    if (ma30w > 0 && close > ma30w) score += 1
    if (slope > 0) score += 1
    if (rs > 0) score += 1
    if (vol >= 1.0) score += 1
    if (p30w != null && p30w > 0 && p30w < 20) score += 1
    return score
  }, [price])
  const pinexMax = 6

  // Sticky-strip visibility: observe a 1px sentinel placed at the
  // very top of the page. When the sentinel leaves the viewport,
  // the user has scrolled past the original header area and the
  // compact strip pins to the top of the viewport via
  // position: fixed. IntersectionObserver works regardless of
  // which ancestor element is the scroll container.
  useEffect(() => {
    const sentinel = stickySentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        // sentinel out of view ⇒ scrolled down ⇒ show compact strip
        setIsStickyStripVisible(!entry.isIntersecting)
      },
      { threshold: 0, rootMargin: '0px' },
    )
    obs.observe(sentinel)
    return () => obs.disconnect()
  }, [])

  // HOW IT'S DERIVED
  //   pctFrom52wHigh = (close − high_52w) / high_52w × 100
  // Always ≤ 0. −5 % = within reach of the 52W
  // high (often a breakout candidate). −20 % or
  // worse = in correction. The high_52w value
  // itself is recomputed in fetch_bhav_daily.py
  // from 252 trading days of close prices.
  const pctFrom52wHigh = useMemo(() => {
    const close = price?.close
    const hi = price?.high_52w
    if (close == null || hi == null || hi === '') return null
    const c = Number(close)
    const h = Number(hi)
    if (!Number.isFinite(c) || !Number.isFinite(h) || h === 0) return null
    return ((c - h) / h) * 100
  }, [price?.close, price?.high_52w])

  /** RS vs Nifty can be 0 or negative — only treat null/undefined as missing. */
  // HOW IT'S DERIVED (server-side, in
  // scripts/fetch_bhav_daily.py → calc_indicators)
  //   rs_vs_nifty = stock_return_180d − nifty_return_180d
  // where each return is % change over the same
  // 180 trading days. +10 = stock beat Nifty by
  // 10 percentage points. SwingX requires > 5,
  // high_conviction requires > 5 *and* a rising
  // slope (newest > oldest over ~20 days).
  const rsVsNifty = useMemo(() => {
    const v = price?.rs_vs_nifty
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }, [price?.rs_vs_nifty])

  const latest_sh = shareholdingByQuarter[0] || {}
  const prev_sh   = shareholdingByQuarter[1] || {}
  const latest_fin = quarterlyFinancials[0] || {}
  const ttm_rev = quarterlyFinancials.slice(0,4).reduce((s,r) => s + (r.revenue || 0), 0)
  const ttm_pat = quarterlyFinancials.slice(0,4).reduce((s,r) => s + (r.pat || 0), 0)
  const sessionDate   = latestDeliveryDay?.date || delivery?.date
  const sessionPct    = latestDeliveryDay?.delivery_pct ?? delivery?.delivery_pct_today
  const sessionDelVol = latestDeliveryDay?.delivery_volume
  const sessionTotalVol = latestDeliveryDay?.total_volume
  const sessionVs30d  = latestDeliveryDay?.vs_30d_avg

  const TABS = ['Overview', 'Technicals', 'Delivery', 'Financials', 'Ownership']

  function handleTabChange(tab) {
    setActiveTab(tab)
    setTimeout(() => { tabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 50)
  }

  if (loading) return (
    <div style={{ background: C.bg, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 14 }}>
      Loading {sym}…
    </div>
  )
  if (!company) return (
    <div style={{ background: C.bg, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 14, gap: 12 }}>
      <span>Stock not found: {sym}</span>
      <button onClick={() => navigate('/')} style={{ color: C.blue, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>← Back to Home</button>
    </div>
  )

  const priceData = price

  return (
    <>
      <Helmet>
        <title>
          {company?.symbol} — {company?.name} |{' '}
          {priceData?.weinstein_substage || priceData?.stage} | PineX
        </title>
        <meta
          name="description"
          content={
            company?.description
              ? `${company.description.slice(0, 150)}...`
              : `${company?.name} (${company?.symbol}) ${priceData?.stage} stage. RS vs Nifty: ${
                  priceData?.rs_vs_nifty != null
                    ? (priceData.rs_vs_nifty >= 0 ? '+' : '') + priceData.rs_vs_nifty.toFixed(1)
                    : '—'
                }%. Free analysis on PineX.`
          }
        />
      </Helmet>
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontSize: 13, width: '100%', maxWidth: '100%' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Sentinel for the compact sticky strip — when this 1-px
          element leaves the viewport (user scrolls past the top),
          the IntersectionObserver flips isStickyStripVisible and
          the strip below pins to the top via position: fixed. */}
      <div ref={stickySentinelRef} aria-hidden="true" style={{ height: 1, width: '100%' }} />

      {/* ── COMPACT STICKY STRIP ──
          Appears overlaid on top of the original sticky header once
          the user has scrolled past the page top. Carries the three
          numbers a Weinstein/cycle viewer wants visible at all
          times: phase, PineX criteria count, and % vs 30W trend
          line. Hides while the original header is in view so we're
          never doubling up the same info. */}
      {isStickyStripVisible && price && (
        <>
          <div
            role="region"
            aria-label="Stock summary (sticky)"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 100,
              background: 'rgba(15, 18, 23, 0.92)',
              borderBottom: '1px solid var(--border)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              padding: '8px 16px',
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 8,
              minHeight: 48,
            }}
          >
            {/* Left: symbol + phase */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
              <span style={{
                fontSize: 14,
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
              }}>
                {sym}
              </span>
              {price.stage && (() => {
                const badge = stageBadge(price.stage)
                return (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 5,
                    background: badge.bg,
                    color: badge.color,
                    whiteSpace: 'nowrap',
                  }}>
                    {stageDisplayName(price.stage)}
                  </span>
                )
              })()}
            </div>

            {/* Center: PineX criteria score */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
              <span style={{
                fontSize: 16,
                fontWeight: 800,
                color: pinexScore != null && pinexScore >= 5
                  ? 'var(--accent)'
                  : pinexScore != null && pinexScore >= 3
                  ? 'var(--warning)'
                  : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {pinexScore != null ? pinexScore : '—'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                /{pinexMax} criteria
              </span>
            </div>

            {/* Right: price + % vs trend line. We show "% vs MA"
                instead of a 1-day change because pct_from_ma is
                what the existing header shows and is the more
                analytically meaningful number for a cycle-analysis
                viewer; a 1-day delta isn't stored in price_data. */}
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <div style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                lineHeight: 1.1,
              }}>
                {price.close != null ? `₹${Number(price.close).toFixed(2)}` : '—'}
              </div>
              {pct_from_ma != null && (
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: pct_from_ma > 0 ? 'var(--positive)' : pct_from_ma < 0 ? 'var(--negative)' : 'var(--text-muted)',
                  lineHeight: 1.1,
                }}>
                  {pct_from_ma > 0 ? '+' : ''}{pct_from_ma.toFixed(1)}% vs MA
                </div>
              )}
            </div>
          </div>
          {/* Spacer so the page content doesn't visibly jump when
              the fixed strip appears. Matches the strip's minHeight
              (48px) so the layout stays exactly where the user left
              it as they scroll. */}
          <div style={{ height: 48 }} aria-hidden="true" />
        </>
      )}

      {/* ── STICKY HEADER ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: C.bg, borderBottom: '1px solid var(--border)' }}>

        {/* Nav row */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 52, gap: 8, maxWidth: '100%' }}>
          <button
            type="button"
            onClick={() => {
              if (!consumeHomeNavigateFromStock(navigate)) navigate(-1)
            }}
            style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, borderRadius: 8 }}
          >
            <i className="ti ti-arrow-left" style={{ fontSize: 18 }} />
          </button>

          {/* Stock identity */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', flexShrink: 0 }}>{sym}</span>
              <StagePill stage={price?.stage} />
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(() => {
                // Many NSE tickers have company.name === symbol (e.g.
                // "APOLLO" / "APOLLO"). Showing both produced the
                // "APOLLO · APOLLO · Defence" duplication. If they're
                // the same, drop name and keep sector only.
                const nm = (company.name || '').trim()
                const sec = (company.sector || '').trim()
                const sameAsSym = nm && sym && nm.toUpperCase() === sym.toUpperCase()
                if (sameAsSym) return sec || nm
                if (nm && sec) return `${nm} · ${sec}`
                return nm || sec || '—'
              })()}
            </p>
          </div>

          {/* Price */}
          <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 800, fontFamily: 'DM Mono,monospace', margin: 0, color: pct_from_ma > 5 ? C.green : pct_from_ma < -5 ? C.red : C.text }}>
              {fmt(price?.close)}
            </p>
            {pct_from_ma != null && (
              <p style={{ fontSize: 10, margin: 0, color: pct_from_ma > 0 ? C.green : pct_from_ma < 0 ? C.red : C.muted }}>
                {pct_from_ma > 0 ? '+' : ''}{pct_from_ma.toFixed(1)}% vs MA
              </p>
            )}
          </div>

          {/* Bookmark icon previously sat here as an icon-only
              button. It has been moved down into the redesigned
              info row below (stage + RS + watchlist pill) where
              it now has a visible label so users discover the
              watchlist affordance without guessing. */}
          {/* Share — promoted from a muted 32px icon to a
              highlighted pill on a tinted blue background, with
              a visible "Share" label. Same handler, just more
              discoverable. */}
          <button
            onClick={() => setShowShareCard(true)}
            title="Share this report"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 20,
              background: 'rgba(96,165,250,0.12)',
              border: '1px solid rgba(96,165,250,0.35)',
              color: 'var(--info)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.02em',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(96,165,250,0.22)'
              e.currentTarget.style.borderColor = 'rgba(96,165,250,0.55)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(96,165,250,0.12)'
              e.currentTarget.style.borderColor = 'rgba(96,165,250,0.35)'
            }}
          >
            <i className="ti ti-share" style={{ fontSize: 16 }} />
            Share
          </button>
        </div>

        {/* Inline watchlist error — auto-clears
            on next toggle attempt. */}
        {watchError && (
          <div
            role="alert"
            style={{
              margin: '0 12px 8px',
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(255,59,48,0.08)',
              border: '1px solid rgba(255,59,48,0.25)',
              color: 'var(--negative)',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>{watchError}</span>
            <button
              onClick={() => setWatchError(null)}
              aria-label="Dismiss"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: 2 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Stage · RS · Watchlist info row ──
            Replaces the older 5-chip signal-badges row. The
            other chips (Delivery %, Pledge, SwingX) used to live
            here too — they're still surfaced inside the Technical
            Structure Report below, so removing them from the
            sticky header tightens the surface without losing data.
            The watchlist control was previously an icon-only
            button in the nav row; moving it here with a label
            ("+ Watchlist" / "Watching") makes the affordance
            discoverable. */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 16px 8px',
          flexWrap: 'wrap',
        }}>
          {/* Stage label — colour-coded via the shared stage palette */}
          {price?.stage && (() => {
            const badge = stageBadge(price.stage)
            return (
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: badge.color,
                whiteSpace: 'nowrap',
              }}>
                {stageDisplayName(price.stage)}
              </span>
            )
          })()}

          {/* RS vs Nifty — positive = green, negative = red */}
          {rsVsNifty != null && Number.isFinite(Number(rsVsNifty)) && (
            <span style={{
              fontSize: 12,
              fontWeight: 600,
              color: rsVsNifty > 0 ? 'var(--positive)' : rsVsNifty < 0 ? 'var(--negative)' : 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}>
              RS {rsVsNifty >= 0 ? '+' : ''}{Number(rsVsNifty).toFixed(1)}%
            </span>
          )}

          {/* SwingX inline chip when applicable — kept here as a
              single one-line marker rather than a full chip row
              so SwingX membership is obvious in the sticky strip. */}
          {Boolean(delivery?.high_conviction) && (
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 4,
              background: 'rgba(0,200,5,0.12)',
              color: '#00C805',
              border: '1px solid rgba(0,200,5,0.28)',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}>
              ⚡ SwingX
            </span>
          )}

          {/* Push the watchlist pill to the right */}
          <div style={{ flex: 1, minWidth: 8 }} />

          {/* Watchlist toggle — labelled pill. The "+ Watchlist"
              state is rendered as a solid green call-to-action so
              new visitors see the primary affordance immediately;
              once added, the pill flips to a muted "Watching"
              confirmation so it stops competing visually with the
              rest of the report. */}
          <button
            onClick={handleWatchToggle}
            // Only "loading" disables the button at the HTML
            // level — the !user case is handled inside
            // handleWatchToggle by routing to /login, so the
            // button stays clickable and communicates intent.
            disabled={watchLoading}
            title={!user ? 'Sign in to add to watchlist' : watching ? 'Remove from watchlist' : 'Add to watchlist'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 20,
              // Solid CTA when not yet watching; soft confirmation
              // when already in the list.
              border: watching
                ? '1px solid rgba(0,200,5,0.45)'
                : '1px solid #00C805',
              background: watching
                ? 'rgba(0,200,5,0.12)'
                : '#00C805',
              color: watching ? '#00C805' : '#FFFFFF',
              fontSize: 12,
              fontWeight: 700,
              cursor: watchLoading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: watchLoading ? 0.6 : 1,
              boxShadow: watching
                ? 'none'
                : '0 2px 10px rgba(0,200,5,0.28)',
              transition: 'all 0.15s',
              flexShrink: 0,
              letterSpacing: '0.02em',
            }}
            onMouseEnter={e => {
              if (watchLoading) return
              if (watching) {
                e.currentTarget.style.background = 'rgba(0,200,5,0.18)'
              } else {
                e.currentTarget.style.background = '#00B005'
                e.currentTarget.style.boxShadow = '0 3px 14px rgba(0,200,5,0.38)'
              }
            }}
            onMouseLeave={e => {
              if (watching) {
                e.currentTarget.style.background = 'rgba(0,200,5,0.12)'
              } else {
                e.currentTarget.style.background = '#00C805'
                e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,200,5,0.28)'
              }
            }}
          >
            <i
              className={watchLoading ? 'ti ti-loader-2' : !user ? 'ti ti-lock' : watching ? 'ti ti-bookmark-filled' : 'ti ti-bookmark'}
              style={{ fontSize: 14, animation: watchLoading ? 'spin 1s linear infinite' : 'none' }}
            />
            {watchLoading ? 'Working…' : !user ? 'Sign in to add' : watching ? 'Watching' : '+ Add to Watchlist'}
          </button>
        </div>

        {/* Watcher count */}
        {watcherCount > 1 && (
          <div style={{ padding: '0 12px 8px' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              fontSize: 11, color: 'var(--text-muted)',
            }}>
              <i className="ti ti-users" style={{ fontSize: 12 }} />
              <span>
                On{' '}
                <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {watcherCount}
                </strong>
                {' '}
                {watcherCount === 1 ? "member's" : "members'"} radar
              </span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderTop: '1px solid var(--border)', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map(tab => {
            const key = tab.toLowerCase()
            const active = activeTab === key
            return (
              <button key={tab} onClick={() => handleTabChange(key)}
                style={{ flex: 'none', padding: '10px 18px', fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.text : C.muted, background: 'none', border: 'none', borderBottom: `2px solid ${active ? C.blue : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color .15s, border-color .15s', display: 'inline-flex', alignItems: 'center' }}>
                {tab}
                {(tab === 'Delivery' || tab === 'Financials') && <ProBadge />}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div ref={tabRef} style={{ maxWidth: 800, margin: '0 auto', padding: '16px 12px 90px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ═══ OVERVIEW ═══ */}
        {activeTab === 'overview' && (<>

          {/* Technical Structure Report */}
          <TechnicalReport stock={priceData} company={company} sectorHealth={sectorHealth} />

          {/* My Classification — user applies their own phase label.
              Placed directly below the criteria section. */}
          <MyClassification symbol={symbol} />

          {/* Analyst Consensus */}
          {(()=>{
            const sb = company.analyst_strong_buy || 0, b = company.analyst_buy || 0
            const h = company.analyst_hold || 0, s = company.analyst_sell || 0
            const total = sb + b + h + s
            if (!total) return null
            const segs = [
              { label: 'Strong Buy', count: sb, color: C.green },
              { label: 'Buy',        count: b,  color: 'var(--positive-soft)' },
              { label: 'Hold',       count: h,  color: C.amber },
              { label: 'Sell',       count: s,  color: C.red },
            ]
            const buyPct = (sb + b) / total * 100
            return (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>
                    External analyst ratings · {total} analysts
                  </p>
                  {/* Neutral factual stat — the % of external analysts rating
                      buy/strong-buy. NOT a PineX verdict or recommendation. */}
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', padding: '2px 9px', borderRadius: 20, background: 'rgba(148,163,184,0.12)' }}>
                    {buyPct.toFixed(0)}% rated Buy / Strong Buy
                  </span>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1, marginBottom: 12 }}>
                    {segs.map(sg => (
                      <div key={sg.label} style={{ flex: sg.count / total, background: sg.color, minWidth: sg.count ? 2 : 0 }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {segs.map(sg => (
                      <div key={sg.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: sg.color }} />
                        <span style={{ fontSize: 11, color: C.muted }}>{sg.label}:</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: sg.color }}>{sg.count}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 9, color: 'var(--text-hint)', fontStyle: 'italic', margin: '10px 0 0' }}>
                    Third-party analyst ratings shown as context · not PineX's view · not a recommendation
                  </p>
                </div>
              </Card>
            )
          })()}

          {/* Latest quarter change summary (quarterly_changes · latest by quarter) */}
          {(quarterlyChanges?.headline_change || quarterlyChanges?.ai_summary) && (
            <Card>
              <SectionLabel title="What changed" sub={quarterlyChanges?.quarter ? String(quarterlyChanges.quarter) : undefined} />
              <div style={{ padding: '14px 16px' }}>
                {quarterlyChanges.headline_change && (
                  <p style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: '0 0 8px', lineHeight: 1.45 }}>{quarterlyChanges.headline_change}</p>
                )}
                {quarterlyChanges.ai_summary && (
                  <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.55 }}>{quarterlyChanges.ai_summary}</p>
                )}
              </div>
            </Card>
          )}

          {/* News */}
          <Card>
            <SectionLabel title="Recent News" />
            {/* WHY: External news (Mint and similar) reflects the
                publication's framing, not PineX's. We surface it as
                context only — never as a PineX signal — and flag the
                provenance before the headlines so the reader knows
                what they're looking at. */}
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              padding: '6px 16px',
              fontStyle: 'italic',
              borderBottom: '1px solid var(--border)',
            }}>
              External news and analyst views. Not investment advice. Educational context only.
            </div>
            <div style={{ padding: '4px 0' }}>
              {news.length === 0 ? (
                <p style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: '20px 0', margin: 0 }}>No recent news available.</p>
              ) : news.map((item, i) => (
                <div key={i}
                  onClick={() => { const url = item.url?.startsWith('http') ? item.url : 'https://www.livemint.com' + (item.url || ''); window.open(url, '_blank') }}
                  style={{ display: 'flex', gap: 12, padding: '11px 16px', cursor: 'pointer', borderBottom: i < news.length - 1 ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = C.card}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {item.image_url && (
                    <img src={item.image_url} alt="" style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                      onError={e => e.target.style.display = 'none'} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 10, color: C.faint, margin: '0 0 3px' }}>{timeAgo(item.published_at)}{item.source && ` · ${item.source}`}</p>
                    <p style={{ fontSize: 13, fontWeight: 500, color: C.text, lineHeight: 1.4, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.title}</p>
                    {item.summary && <p style={{ fontSize: 11, color: C.muted, margin: '3px 0 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{item.summary}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>)}

        {/* ═══ OWNERSHIP ═══ */}
        {activeTab === 'ownership' && (<>

          {/* Shareholding snapshot */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>Shareholding Pattern</p>
              {latest_sh.quarter && <span style={{ fontSize: 11, color: C.faint }}>{latest_sh.quarter}</span>}
            </div>
            <div style={{ padding: '14px 16px' }}>
              <div className="grid-2-to-4" style={{ marginBottom: 14 }}>
                {[
                  { label: 'Promoter', val: latest_sh.promoter_pct, prev: prev_sh.promoter_pct, color: C.purple },
                  { label: 'FII',      val: latest_sh.fii_pct,      prev: prev_sh.fii_pct,      color: C.blue },
                  { label: 'DII',      val: latest_sh.dii_pct,      prev: prev_sh.dii_pct,      color: C.green },
                  { label: 'Public',   val: latest_sh.public_pct,   prev: prev_sh.public_pct,   color: C.muted },
                ].map(sh => {
                  const chg = sh.val != null && sh.prev != null ? (sh.val - sh.prev) : null
                  return (
                    <div key={sh.label} style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{sh.label}</p>
                      <p style={{ fontSize: 18, fontWeight: 700, color: sh.color, margin: '0 0 3px' }}>{sh.val?.toFixed(1) || '—'}%</p>
                      {chg != null && (
                        <p style={{ fontSize: 10, margin: '0 0 6px', color: chg > 0 ? C.green : chg < 0 ? C.red : C.faint }}>
                          {chg > 0 ? '↑ +' : '↓ '}{Math.abs(chg).toFixed(2)}% QoQ
                        </p>
                      )}
                      <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: sh.color, borderRadius: 2, width: Math.min(sh.val || 0, 100) + '%' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              {latest_sh.promoter_pledge_pct > 0 && (
                <div style={{ background: C.redDim, border: `1px solid var(--negative-dim)`, borderRadius: 8, padding: '10px 14px' }}>
                  <span style={{ color: C.red, fontSize: 13, fontWeight: 600 }}>⚠ Promoter pledge: {latest_sh.promoter_pledge_pct?.toFixed(1)}%</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11, marginLeft: 8 }}>Risk of forced selling</span>
                </div>
              )}
            </div>
          </Card>

          {/* Quarterly history */}
          {shareholdingByQuarter.length > 1 && (
            <Card>
              <SectionLabel title="Quarterly Trend" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                  <thead>
                    <tr style={{ background: C.card }}>
                      {['Quarter', 'Promoter', 'FII', 'DII', 'Public', 'Pledge'].map(h => (
                        <th key={h} style={{ padding: '9px 14px', fontSize: 10, color: C.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Quarter' ? 'left' : 'right', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shareholdingByQuarter.map((r, i) => {
                      const prev = shareholdingByQuarter[i + 1]
                      const chgP = prev ? (r.promoter_pct || 0) - (prev.promoter_pct || 0) : null
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '9px 14px', fontSize: 12, color: C.muted, fontWeight: 500 }}>{r.quarter}</td>
                          <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right' }}>
                            <span style={{ color: C.text, fontWeight: 500 }}>{r.promoter_pct?.toFixed(2) || '—'}%</span>
                            {chgP != null && <span style={{ fontSize: 10, marginLeft: 5, color: chgP > 0 ? C.green : chgP < 0 ? C.red : C.faint }}>{chgP > 0 ? '↑' : chgP < 0 ? '↓' : '→'}</span>}
                          </td>
                          {[r.fii_pct, r.dii_pct, r.public_pct].map((v, j) => (
                            <td key={j} style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: C.text }}>{v?.toFixed(2) || '—'}%</td>
                          ))}
                          <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: r.promoter_pledge_pct > 0 ? C.red : C.faint, fontWeight: r.promoter_pledge_pct > 0 ? 600 : 400 }}>
                            {r.promoter_pledge_pct?.toFixed(1) || '—'}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>)}

        {/* ═══ TECHNICALS ═══ */}
        {activeTab === 'technicals' && (() => {
          const priceData = price
          const rs = priceData?.rs_vs_nifty
          const rsNum = rs != null && rs !== '' ? Number(rs) : null
          const rsValid = rsNum != null && Number.isFinite(rsNum)
          const obvSlopeTech = parseFloat(String(priceData?.obv_slope ?? '')) || 0
          const rsiTech = priceData?.rsi
          const rsiForColor = rsiTech != null && rsiTech !== '' ? Number(rsiTech) : null
          const rsiFmt = rsiForColor != null && Number.isFinite(rsiForColor) ? rsiForColor.toFixed(1) : '—'
          const rsiColor = rsiForColor == null || !Number.isFinite(rsiForColor)
            ? C.muted
            : rsiForColor > 70 ? 'var(--negative)'
              : rsiForColor < 30 ? 'var(--accent)'
                : 'var(--text-primary)'
          const rsValueStr = rsValid ? (rsNum > 0 ? '+' : '') + rsNum.toFixed(1) + '%' : '—'
          const rsColor = !rsValid ? C.muted : rsNum > 0 ? 'var(--positive)' : 'var(--negative)'
          const rsSub = !rsValid ? '' : rsNum > 0 ? 'Outperforming Nifty' : 'Underperforming Nifty'
          const obvLabel = obvSlopeTech > 0.02 ? '↑ Rising' : obvSlopeTech < -0.02 ? '↓ Falling' : '→ Flat'
          const obvColor = obvSlopeTech > 0.02 ? 'var(--accent)' : obvSlopeTech < -0.02 ? 'var(--negative)' : 'var(--text-muted)'
          const ma30 = fmtInrCell(priceData?.ma30w)
          const ma50 = fmtInrCell(priceData?.ma50)
          const ma150 = fmtInrCell(priceData?.ma150)
          const slopeStr = ma30wSlopeNum != null ? ma30wSlopeNum.toFixed(2) + '%' : '—'
          const hi52Str = fmtInrCell(priceData?.high_52w)
          const lo52Str = fmtInrCell(priceData?.low_52w)
          const pct52Str = pctFrom52wHigh != null && Number.isFinite(pctFrom52wHigh)
            ? (pctFrom52wHigh > 0 ? '+' : '') + pctFrom52wHigh.toFixed(1) + '%'
            : '—'

          if (!priceData) {
            return (
              <Card>
                <SectionLabel title="Technicals" />
                <p style={{ padding: '20px 16px', margin: 0, color: C.muted, fontSize: 13 }}>
                  No latest price row for this symbol yet. Data will appear after the next price sync.
                </p>
              </Card>
            )
          }

          return (<>
            <StockChart
              priceHistory={priceHistory}
              symbol={sym}
              companyName={company?.name}
              stage={priceData?.stage}
              swing={swingConditions}
            />
            {priceData?.stage === 'Stage 2' && (() => {
              const deliveryData = delivery
              const weinsteinChecks = [
                {
                  label: 'Above rising 30W Trend Line',
                  pass: priceData?.close > priceData?.ma30w && (priceData?.ma30w_slope || 0) > 0,
                  detail: priceData?.ma30w ? `₹${Number(priceData.ma30w).toFixed(0)}` : '—',
                },
                {
                  label: 'Positive RS vs Nifty',
                  pass: (priceData?.rs_vs_nifty || 0) > 0,
                  detail: priceData?.rs_vs_nifty != null
                    ? `${priceData.rs_vs_nifty > 0 ? '+' : ''}${Number(priceData.rs_vs_nifty).toFixed(1)}%` : '—',
                },
                {
                  label: 'Volume confirmation',
                  pass: (deliveryData?.vol_ratio || 0) >= 2.0,
                  detail: deliveryData?.vol_ratio ? `${Number(deliveryData.vol_ratio).toFixed(1)}x average` : '—',
                },
                {
                  label: 'Early in uptrend',
                  // weeks_in_stage2 now stores ACTUAL WEEKS (was sessions); 8 weeks
                  // ≈ the old 39-session threshold for "still early in the move".
                  pass: deliveryData?.weeks_in_stage2 != null && deliveryData.weeks_in_stage2 < 8
                    && (deliveryData?.pct_from_30w || 0) < 15,
                  detail: deliveryData?.weeks_in_stage2 ? `Week ${deliveryData.weeks_in_stage2} of uptrend` : '—',
                },
                {
                  label: 'Sector in uptrend phase',
                  pass: sectorHealth === 'Strong' || sectorHealth === 'Good',
                  detail: sectorHealth ? `${company?.sector || '—'} · ${sectorHealth}` : (company?.sector || '—'),
                },
              ]
              const passCount = weinsteinChecks.filter(c => c.pass).length
              return (
                <Card>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>PineX Criteria</p>
                      <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>Advancing-phase health indicators</p>
                      <p style={{ fontSize: 10, color: C.faint, margin: '4px 0 0', lineHeight: 1.5, maxWidth: 220 }}>Score reflects how many of 5 PineX Advancing-phase criteria are currently met. This is an educational filter, not a rating or recommendation.</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      {/* Neutral count only — no "strong/weak" quality verdict
                          and no warning-red. This is a factual filter score. */}
                      <span style={{ fontSize: 22, fontWeight: 800, color: C.text, fontFamily: 'var(--font-mono)' }}>{passCount}/5</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>criteria met</span>
                    </div>
                  </div>
                  <div style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column' }}>
                    {weinsteinChecks.map((chk, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < weinsteinChecks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ fontSize: 16, color: chk.pass ? C.green : C.faint, flexShrink: 0, width: 20, textAlign: 'center' }}>
                          {chk.pass ? '✓' : '○'}
                        </span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: chk.pass ? C.text : C.muted, margin: 0 }}>{chk.label}</p>
                          <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>{chk.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ margin: '0 16px 16px', padding: '12px 16px', borderRadius: 10,
                    background: passCount >= 4 ? C.greenDim : passCount >= 2 ? C.amberDim : C.redDim,
                    border: `1px solid ${passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red}33`
                  }}>
                    <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 4px',
                      color: passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red
                    }}>
                      {passCount >= 4 ? '✓ Quality Stage 2 setup' : passCount >= 2 ? '⚠ Partial confirmation' : '✗ Setup lacks confirmation'}
                    </p>
                    <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
                      {passCount >= 4
                        ? 'All key PineX criteria align — high-probability setup.'
                        : passCount >= 2
                          ? 'Some criteria missing — watch for improvement before entry.'
                          : 'Multiple criteria failing — caution advised.'}
                    </p>
                  </div>
                </Card>
              )
            })()}
            <Card>
              <SectionLabel title="Technicals" />
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                  <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }} title="Relative Strength vs Nifty 500 — educational metric only">RS vs Nifty (1Y)</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: rsColor, margin: '0 0 4px' }}>{rsValueStr}</p>
                    <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>{rsSub}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>OBV Trend</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: obvColor, margin: 0 }}>{obvLabel}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>RSI</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: rsiColor, margin: 0 }}>{rsiFmt}</p>
                  </div>
                </div>

                <div>
                  <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>Stage</p>
                  <LargeStageBadge stage={priceData?.stage} substage={priceData?.weinstein_substage} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                  {[
                    { label: '30W Trend Line', value: ma30 },
                    { label: '50D MA', value: ma50 },
                    { label: '150D MA', value: ma150 },
                    { label: '30W Slope', value: slopeStr },
                  ].map((row) => (
                    <div key={row.label} style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: '1px solid var(--border)' }}>
                      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{row.label}</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{row.value}</p>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>52W High</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{hi52Str}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>52W Low</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{lo52Str}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>% from 52W High</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: pctFrom52wHigh != null ? C.text : C.muted, margin: 0 }}>{pct52Str}</p>
                  </div>
                  <div style={{ background: C.card, borderRadius: 10, padding: '10px 12px', border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Current close</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{fmt(priceData?.close)}</p>
                  </div>
                </div>
              </div>
            </Card>
          </>)
        })()}

        {/* ═══ DELIVERY ═══ */}
        {activeTab === 'delivery' && (<>

          {/* Delivery Snapshot */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>Delivery Snapshot</p>
                {sessionDate && <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>{fmtDeliveryDate(sessionDate)}</p>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {['1D', '7D', '30D', '60D', '90D'].map(tf => (
                  <button key={tf} type="button" onClick={() => setDeliveryTab(tf)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${deliveryTab === tf ? C.blue : C.border}`, background: deliveryTab === tf ? C.blueDim : 'transparent', color: deliveryTab === tf ? C.blue : C.muted, fontSize: 11, fontWeight: deliveryTab === tf ? 700 : 500, cursor: 'pointer' }}
                  >{tf}</button>
                ))}
              </div>
            </div>
            <div style={{ padding: '20px 16px' }}>
              {(() => {
                const tabs = {
                  '1D':  { pct: sessionPct,                  label: 'Today',   vol: sessionDelVol,         totalVol: sessionTotalVol, vs30d: sessionVs30d },
                  '7D':  { pct: delivery?.avg_delivery_7d,   label: '7D Avg',  vol: delivery?.avg_volume_7d },
                  '30D': { pct: delivery?.avg_delivery_30d,  label: '30D Avg', vol: delivery?.avg_volume_30d },
                  '60D': { pct: delivery?.avg_delivery_60d,  label: '60D Avg' },
                  '90D': { pct: delivery?.avg_delivery_90d,  label: '90D Avg' },
                }
                const t = tabs[deliveryTab]
                const statCards = deliveryTab === '1D'
                  ? [
                      { label: 'Del. Volume',  value: fmtShares(t.vol),     color: C.text },
                      { label: 'Total Volume', value: fmtShares(t.totalVol), color: C.muted },
                      { label: 'vs 30D Avg',   value: t.vs30d != null ? Number(t.vs30d).toFixed(2) + 'x' : '—', color: t.vs30d > 1.2 ? C.green : t.vs30d < 0.8 ? C.red : C.muted },
                    ]
                  : t.vol != null
                    ? [{ label: `Avg Del. Volume (${deliveryTab})`, value: fmtCr(t.vol), color: C.text }]
                    : []
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: statCards.length ? 20 : 0 }}>
                      <DeliveryRing pct={t.pct} label={t.label} size={100} />
                    </div>
                    {statCards.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                        {statCards.map(item => (
                          <div key={item.label} style={{ background: C.card, borderRadius: 10, padding: '11px 13px', border: '1px solid var(--border)' }}>
                            <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 5px' }}>{item.label}</p>
                            <p style={{ fontSize: 14, fontWeight: 700, color: item.color, margin: 0 }}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </Card>

          {/* Period comparison bars */}
          {delivery && (
            <Card>
              <SectionLabel title="Delivery Trends" />
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  <DeliveryBar label="7D Avg Del%" value={delivery.avg_delivery_7d} />
                  <DeliveryBar label="30D Avg Del%" value={delivery.avg_delivery_30d} />
                  <DeliveryBar label="60D Avg Del%" value={delivery.avg_delivery_60d} />
                  <DeliveryBar label="90D Avg Del%" value={delivery.avg_delivery_90d} />
                  <DeliveryBar label="Vol Ratio" value={delivery.vol_ratio} suffix="x" threshold={1.5} />
                </div>

                {/* Volume row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {[
                    { label: '7D Avg Volume', val: fmtCr(delivery.avg_volume_7d) },
                    { label: '30D Avg Volume', val: fmtCr(delivery.avg_volume_30d) },
                  ].map(d => (
                    <div key={d.label} style={{ background: C.card, borderRadius: 10, padding: '11px 13px', border: '1px solid var(--border)' }}>
                      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 5px' }}>{d.label}</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0 }}>{d.val}</p>
                    </div>
                  ))}
                </div>

                {/* Signal badges */}
                {(() => {
                  const sigs = [
                    { show: delivery.is_accumulation,  label: 'Institutional Base', color: C.green, dim: C.greenDim },
                    { show: delivery.is_distribution,   label: 'Volume Decline',    color: C.red,   dim: C.redDim },
                    { show: delivery.breakout_30wma,    label: 'Above 30W Trend Line', color: C.green, dim: C.greenDim },
                    { show: delivery.breakdown_30wma,   label: 'Below 30W Trend Line',color: C.red,   dim: C.redDim },
                    { show: delivery.breakout_50dma,    label: 'Above 50D MA', color: C.blue,  dim: C.blueDim },
                    { show: delivery.breakdown_50dma,   label: 'Below 50D MA',color: C.amber, dim: C.amberDim },
                  ].filter(s => s.show)

                  return sigs.length > 0 ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {sigs.map((s, i) => (
                        <span key={i} style={{ background: s.dim, color: s.color, border: `1px solid ${s.color}44`, fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20 }}>
                          {s.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>No active signals</p>
                  )
                })()}
              </div>
            </Card>
          )}

          {/* Detailed panel */}
          <Card>
            <SectionLabel title="Detailed Delivery Data" />
            <div style={{ padding: '14px 16px', maxWidth: '100%', overflowX: 'auto' }}>
              <DeliveryPanel companyId={company.id} symbol={sym} latestStage={price?.stage} embedded hideExplain />
            </div>
          </Card>
        </>)}

        {/* ═══ FINANCIALS ═══ */}
        {activeTab === 'financials' && (<>

          {/* TTM / latest summary */}
          <Card>
            <SectionLabel title={isAnnual ? 'Latest Annual' : 'Trailing 12 Months (TTM)'} />
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {isAnnual ? (<>
                <MetricCard label={`Revenue (${formatPeriod(withGrowth[0]?.quarter)})`} value={fmtCr(withGrowth[0]?.revenue)} />
                <MetricCard label={`PAT (${formatPeriod(withGrowth[0]?.quarter)})`} value={fmtCr(withGrowth[0]?.pat)} color={withGrowth[0]?.pat > 0 ? C.green : C.red} />
                {withGrowth[0]?.margin != null && <MetricCard label="Oper. Margin" value={withGrowth[0].margin?.toFixed(1) + '%'} color={withGrowth[0].margin > 20 ? C.green : withGrowth[0].margin > 10 ? C.text : C.red} />}
                {withGrowth[0]?.revenue_growth_yoy != null && <MetricCard label="Rev Growth YoY" value={fmtPct(withGrowth[0].revenue_growth_yoy)} color={withGrowth[0].revenue_growth_yoy > 0 ? C.green : C.red} />}
                {withGrowth[0]?.pat_growth_yoy != null && <MetricCard label="PAT Growth YoY" value={fmtPct(withGrowth[0].pat_growth_yoy)} color={withGrowth[0].pat_growth_yoy > 0 ? C.green : C.red} />}
              </>) : (<>
                <MetricCard label="Revenue TTM" value={fmtCr(ttm_rev)} sub="Last 4 quarters" />
                <MetricCard label="PAT TTM" value={fmtCr(ttm_pat)} sub="Net profit TTM" color={ttm_pat > 0 ? C.green : C.red} />
                {latest_fin?.margin != null && <MetricCard label="Oper. Margin" value={latest_fin.margin?.toFixed(1) + '%'} color={latest_fin.margin > 20 ? C.green : latest_fin.margin > 10 ? C.text : C.red} />}
                {latest_fin?.revenue_growth_yoy != null && <MetricCard label="Rev Growth YoY" value={fmtPct(latest_fin.revenue_growth_yoy)} color={latest_fin.revenue_growth_yoy > 0 ? C.green : C.red} />}
                {latest_fin?.pat_growth_yoy != null && <MetricCard label="PAT Growth YoY" value={fmtPct(latest_fin.pat_growth_yoy)} color={latest_fin.pat_growth_yoy > 0 ? C.green : C.red} />}
                {latest_fin?.eps != null && <MetricCard label="EPS (Latest Q)" value={'₹' + latest_fin.eps?.toFixed(2)} />}
              </>)}
            </div>
          </Card>

          {/* Results table */}
          {withGrowth.length > 0 && (
            <Card>
              <div style={{ padding: '14px 16px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {isAnnual ? 'Annual Results' : 'Quarterly Results'}
                  </span>
                  {isAnnual && (
                    <span style={{ fontSize: 10, color: 'var(--warning)', background: 'var(--warning-dim)', border: '1px solid var(--warning-dim)', padding: '2px 8px', borderRadius: 4 }}>
                      Annual data only
                    </span>
                  )}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isAnnual ? 480 : 580 }}>
                  <thead>
                    <tr style={{ background: C.card }}>
                      {[
                        isAnnual ? 'Year' : 'Quarter',
                        'Revenue', 'PAT', 'Margin',
                        ...(!isAnnual ? ['Rev QoQ'] : []),
                        'Rev YoY',
                        ...(!isAnnual ? ['PAT QoQ'] : []),
                        'PAT YoY',
                      ].map(h => (
                        <th key={h} style={{ padding: '9px 14px', fontSize: 10, color: C.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Year' || h === 'Quarter' ? 'left' : 'right', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {withGrowth.map((r, i) => (
                      <tr key={r.quarter ?? i} style={{ borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = C.card}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '9px 14px', fontSize: 12, color: C.muted, fontWeight: 500 }}>{formatPeriod(r.quarter)}</td>
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: C.text }}>{fmtCr(r.revenue)}</td>
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: r.pat > 0 ? C.green : C.red }}>{fmtCr(r.pat)}</td>
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', color: marginColor(r.margin) }}>{r.margin != null ? r.margin.toFixed(1) + '%' : '—'}</td>
                        {!isAnnual && <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.revenue_growth_qoq) }}>{r.revenue_growth_qoq != null ? fmtPct(r.revenue_growth_qoq) : '—'}</td>}
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.revenue_growth_yoy) }}>{r.revenue_growth_yoy != null ? fmtPct(r.revenue_growth_yoy) : '—'}</td>
                        {!isAnnual && <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.pat_growth_qoq) }}>{r.pat_growth_qoq != null ? fmtPct(r.pat_growth_qoq) : '—'}</td>}
                        <td style={{ padding: '9px 14px', fontSize: 12, textAlign: 'right', fontWeight: 500, color: growthColor(r.pat_growth_yoy) }}>{r.pat_growth_yoy != null ? fmtPct(r.pat_growth_yoy) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {financials.length === 0 && (
            <p style={{ textAlign: 'center', color: C.muted, fontSize: 13, padding: '32px 0' }}>No financial data available yet.</p>
          )}
        </>)}

      </div>

      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-hint)',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        All data is end-of-day (EOD) only. Not investment advice. Not a research report. PineX is not registered with SEBI as a Research Analyst or Investment Adviser. Users are solely responsible for their own investment decisions.
      </div>

      {showShare && (
        <StockShareModal
          symbol={symbol}
          company={company}
          price={price}
          delivery={delivery}
          shareholding={shareholding}
          pctFromMa={pct_from_ma}
          rsVsNifty={rsVsNifty}
          priceHistory={priceHistory}
          onClose={() => setShowShare(false)}
        />
      )}
      {showShareCard && (
        <ShareCard
          stock={priceData}
          company={company}
          onClose={() => setShowShareCard(false)}
        />
      )}
    </div>
    </>
  )
}
