import { useState, useEffect, useRef, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate, useParams } from 'react-router-dom'
import DeliveryPanel from '../components/DeliveryPanel'
import StockShareModal from '../components/StockShareCard'
import StockChart from '../components/StockChart'
import { supabase } from '../lib/supabaseClient'
import { consumeHomeNavigateFromStock } from '../lib/appNav'
import { useAuth } from '../context'
import { insertWatchlistRow, selectWatchMembership } from '../lib/watchlistTable'

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
  'Stage 2': 'Price above rising 30-week MA',
  'Stage 1': 'Price base forming',
  'Stage 3': 'Momentum slowing',
  'Stage 4': 'Price below declining 30-week MA',
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

function TechnicalReport({ stock, company, sectorHealth }) {
  if (!stock) return null
  const reportRef = useRef(null)
  const [printing, setPrinting] = useState(false)

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
  const volRatio  = Number(stock.vol_ratio || 0)

  const pct = (a, b) => b > 0 ? (a - b) / b * 100 : null
  const fmtPct = (n, prefix = true) => n == null ? '—' : (prefix && n > 0 ? '+' : '') + n.toFixed(1) + '%'
  const fmtPrice = (n) => n > 0 ? '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'
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
    { label: 'Stage 2 confirmed',     pass: stock.stage === 'Stage 2',              note: stock.stage || 'Unknown' },
    { label: 'Price above 30W MA',    pass: ma30w > 0 && close > ma30w,             note: fmtPct(p30w) },
    { label: '30W MA slope rising',   pass: Number(stock.ma30w_slope || 0) > 0,     note: Number(stock.ma30w_slope || 0) > 0 ? 'Rising' : 'Flat/declining' },
    { label: 'RS positive vs Nifty',  pass: rs > 0,                                 note: fmtPct(rs) },
    { label: 'Volume above average',  pass: volRatio >= 1.0,                         note: volRatio > 0 ? volRatio.toFixed(2) + 'x avg' : '—' },
    { label: 'Price near 30W MA',      pass: p30w != null && p30w > 0 && p30w < 20,  note: p30w != null ? fmtPct(p30w) + ' from 30W MA' : '—' },
  ]
  const passCount = checks.filter(c => c.pass).length

  const stageExplain = {
    'Stage 1': 'Basing — the stock is consolidating after a downtrend. Institutions may be quietly accumulating. No confirmed uptrend yet; patience required.',
    'Stage 2': "In Weinstein's framework, Stage 2 represents the advancing phase — price trending above a rising 30W MA with broad participation and positive relative strength.",
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
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.02em' }}>P</span>
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>PineX</span>
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
            <button
              onClick={handleDownloadPdf}
              disabled={printing}
              style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, cursor: printing ? 'wait' : 'pointer', letterSpacing: '0.03em' }}
            >
              <i className="ti ti-file-type-pdf" style={{ fontSize: 12 }} />
              {printing ? 'Preparing…' : 'Download PDF'}
            </button>
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
        <ReportRow label="Weinstein Stage" value={stock.stage || '—'} valueColor={stock.stage === 'Stage 2' ? 'var(--stage2-color)' : stock.stage === 'Stage 1' ? 'var(--stage1-color)' : stock.stage === 'Stage 3' ? 'var(--stage3-color)' : stock.stage === 'Stage 4' ? 'var(--stage4-color)' : 'var(--text-muted)'} bold />
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
        <ReportRow label="30W Moving Average" value={fmtPrice(ma30w)} valueColor={pctColor(p30w)} sub={p30w != null ? { text: fmtPct(p30w) + ' vs current price', color: pctColor(p30w) } : null} />
        <ReportRow label="30W MA Slope" value={Number(stock.ma30w_slope || 0) > 0 ? 'Rising' : 'Flat / declining'} valueColor={Number(stock.ma30w_slope || 0) > 0 ? 'var(--positive)' : 'var(--text-muted)'} />
        {p30w != null && (
          <div style={{ padding: '2px 16px 10px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {p30w > 20
              ? `Stock is ${p30w.toFixed(1)}% extended above the 30W MA — historically associated with increased volatility in Weinstein's framework. High extension from the 30W MA has preceded pullbacks in prior Stage 2 cycles.`
              : p30w > 0
              ? `Stock is ${p30w.toFixed(1)}% above the 30W MA — within a range Weinstein associates with active Stage 2 conditions.`
              : `Stock is ${Math.abs(p30w).toFixed(1)}% below the 30W MA — wait for a reclaim of the average before considering entry.`}
          </div>
        )}
      </ReportSection>

      {/* Momentum */}
      <ReportSection title="Momentum">
        <ReportRow label="RS vs Nifty (119-day)" value={rs != null ? fmtPct(rs) : '—'} valueColor={pctColor(rs)} bold />
        {rs != null && (
          <div style={{ padding: '2px 16px 8px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {rs > 10
              ? `${company?.symbol || stock?.symbol || 'This stock'} is meaningfully outperforming Nifty (+${rs.toFixed(1)}%). Strong relative strength is a core Weinstein criterion for Stage 2 candidates.`
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
        <ReportRow label="OBV Slope" value={stock.obv_slope || '—'} valueColor={stock.obv_slope === 'up' ? 'var(--positive)' : stock.obv_slope === 'down' ? 'var(--negative)' : 'var(--text-muted)'} />
      </ReportSection>

      {/* Price Levels */}
      <ReportSection title="Price Levels">
        <ReportRow label="50D Moving Average" value={fmtPrice(ma50)} sub={p50 != null ? { text: fmtPct(p50), color: pctColor(p50) } : null} />
        <ReportRow label="20D Moving Average" value={fmtPrice(ma20)} sub={p20 != null ? { text: fmtPct(p20), color: pctColor(p20) } : null} />
        <ReportRow label="150D Moving Average" value={fmtPrice(ma150)} sub={p150 != null ? { text: fmtPct(p150), color: pctColor(p150) } : null} />
        <ReportRow label="52W High" value={fmtPrice(high52)} sub={pH != null ? { text: fmtPct(pH) + ' from high', color: pctColor(pH) } : null} />
        <ReportRow label="52W Low" value={fmtPrice(low52)} sub={pL != null ? { text: '+' + pL.toFixed(1) + '% from low', color: 'var(--positive)' } : null} />
      </ReportSection>

      {/* Volume & Participation */}
      <ReportSection title="Volume & Participation">
        <ReportRow label="Today's Volume" value={fmtVol(vol)} sub={volRatio > 0 ? { text: volRatio.toFixed(2) + 'x 30-day average', color: volRatio >= 1.5 ? 'var(--positive)' : volRatio >= 1.0 ? 'var(--text-muted)' : 'var(--negative)' } : null} />
        <ReportRow label="Avg Volume (30D)" value={fmtVol(avgVol30)} />
        <ReportRow
          label="Delivery % (30D avg)"
          value={avgDel30 > 0 ? avgDel30.toFixed(1) + '%' : '—'}
          valueColor={avgDel30 > 55 ? 'var(--positive)' : avgDel30 > 35 ? 'var(--text-primary)' : 'var(--text-muted)'}
          sub={avgDel30 > 0 ? { text: avgDel30 > 55 ? 'Above average institutional participation' : avgDel30 > 35 ? 'Normal participation' : 'Below average participation', color: 'var(--text-muted)' } : null}
        />
        <ReportRow label="Delivery Trend" value={stock.delivery_trend_30d || '—'} valueColor={stock.delivery_trend_30d === 'rising' ? 'var(--positive)' : stock.delivery_trend_30d === 'falling' ? 'var(--negative)' : 'var(--text-muted)'} />
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

      {/* Weinstein Checklist */}
      <ReportSection title={`Weinstein Checklist — ${passCount}/6 criteria met`}>
        {checks.map((c, i) => <CheckRow key={i} label={c.label} pass={c.pass} note={c.note} />)}
      </ReportSection>

      {/* How to Read This Report */}
      <ReportSection title="How to Read This Report">
        <div style={{ padding: '10px 16px 14px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.75 }}>
          <p style={{ margin: '0 0 8px' }}>This report follows Stan Weinstein's Stage Analysis framework. Stocks cycle through 4 stages — basing (1), advancing (2), topping (3), and declining (4). In Weinstein's methodology, Stage 2 represents the advancing phase and Stage 4 the declining phase. The framework focuses on identifying stocks in Stage 2 uptrends.</p>
          <p style={{ margin: '0 0 8px' }}>The 30-week moving average is the anchor. A Stage 2 stock trades above a rising 30W MA, shows positive RS vs the index, and is confirmed by rising volume and delivery.</p>
          <p style={{ margin: 0 }}>Use the checklist score as a filter, not a signal. 5–6 criteria met = high-quality setup. Below 3 = fewer Weinstein criteria are met. Higher scores indicate stronger alignment with the framework.</p>
        </div>
      </ReportSection>

      {/* AI Narrative — Coming Soon */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '8px 16px', fontSize: 10, fontWeight: 700, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>AI Narrative Summary</span>
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: 'var(--info-dim)', color: 'var(--info)', border: '1px solid var(--info-dim)', fontWeight: 700, letterSpacing: '0.06em' }}>PRO · COMING SOON</span>
        </div>
        <div style={{ padding: '12px 16px', filter: 'blur(3px)', userSelect: 'none', pointerEvents: 'none', opacity: 0.4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Over the past 4 months this stock has shown consistently rising 30-week moving average with above-average delivery participation in 6 of the last 8 weeks. The relative strength vs Nifty has been improving steadily since January 2026, indicating continued sector rotation into this space. Volume patterns suggest institutional accumulation over the last 3 weeks.
          </div>
        </div>
      </div>

      {/* Branded footer */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--accent)' }}>P</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '-0.01em' }}>PineX</span>
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

  const close   = Number(stock.close || 0)
  const ma30w   = Number(stock.ma30w || 0)
  const rs      = Number(stock.rs_vs_nifty || 0)
  const pctFromMa = ma30w > 0 ? (close - ma30w) / ma30w * 100 : null

  const stageColor =
    stock.stage === 'Stage 2' ? '#00C805'
    : stock.stage === 'Stage 1' ? '#60A5FA'
    : stock.stage === 'Stage 3' ? '#FBBF24'
    : '#FF3B30'

  const checks = [
    { label: 'Stage 2',         pass: stock.stage === 'Stage 2' },
    { label: 'Rising 30W MA',   pass: Number(stock.ma30w_slope || 0) > 0 },
    { label: 'RS positive',     pass: rs > 0 },
    { label: 'Volume confirmed',pass: Number(stock.vol_ratio || 0) >= 1.0 },
    { label: 'Entry zone',      pass: pctFromMa != null && pctFromMa > 0 && pctFromMa < 20 },
  ]
  const passCount = checks.filter(c => c.pass).length

  const handleShare = async () => {
    setCopying(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        backgroundColor: '#0B0E11',
        useCORS: true,
      })
      canvas.toBlob(async (blob) => {
        try {
          if (navigator.share && navigator.canShare({ files: [new File([blob], `${stock.symbol}-pinex.png`, { type: 'image/png' })] })) {
            await navigator.share({
              title: `${stock.symbol} — Technical Summary`,
              text: `${stock.symbol} is in ${stock.stage} with RS ${rs > 0 ? '+' : ''}${rs.toFixed(1)}% vs Nifty. Check full analysis on PineX.`,
              files: [new File([blob], `${stock.symbol}-pinex.png`, { type: 'image/png' })],
              url: `https://pinex.in/stock/${stock.symbol}`,
            })
          } else {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${stock.symbol}-pinex.png`
            a.click()
            URL.revokeObjectURL(url)
          }
        } catch (e) { console.error(e) }
        setCopying(false)
      }, 'image/png')
    } catch (e) {
      console.error(e)
      setCopying(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      {/* Card to capture */}
      <div
        ref={cardRef}
        onClick={e => e.stopPropagation()}
        style={{ width: 340, background: '#0B0E11', border: '1px solid #1E2530', borderRadius: 16, overflow: 'hidden', flexShrink: 0 }}
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
              <div style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: stageColor + '18', color: stageColor, border: `1px solid ${stageColor}35`, marginTop: 4, fontWeight: 700 }}>
                {stock.stage}
              </div>
            </div>
          </div>
        </div>

        {/* Key metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #1E2530' }}>
          {[
            { label: 'RS vs Nifty', value: rs != null ? (rs > 0 ? '+' : '') + rs.toFixed(1) + '%' : '—', color: rs > 0 ? '#00C805' : '#FF3B30' },
            { label: 'vs 30W MA',   value: pctFromMa != null ? (pctFromMa > 0 ? '+' : '') + pctFromMa.toFixed(1) + '%' : '—', color: (pctFromMa || 0) > 0 ? '#00C805' : '#FF3B30' },
            { label: 'Delivery',    value: stock.avg_delivery_30d ? stock.avg_delivery_30d.toFixed(0) + '%' : '—', color: (stock.avg_delivery_30d || 0) > 50 ? '#00C805' : '#94A3B8' },
          ].map((m, i) => (
            <div key={i} style={{ padding: '10px 12px', borderRight: i < 2 ? '1px solid #1E2530' : 'none', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 9, color: '#475569', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Weinstein checklist */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #1E2530' }}>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Weinstein Criteria</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {checks.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: c.pass ? '#E2E8F0' : '#475569' }}>
                <span style={{ color: c.pass ? '#00C805' : '#334155', fontSize: 12, fontWeight: 700 }}>{c.pass ? '✓' : '✗'}</span>
                {c.label}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: passCount >= 4 ? '#00C805' : '#64748B', fontWeight: 600 }}>
            {passCount}/5 criteria met
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0' }}>
            Pine<span style={{ color: '#00C805' }}>X</span>
            <span style={{ fontSize: 9, color: '#475569', fontWeight: 400, marginLeft: 6 }}>pinex.in</span>
          </div>
          <div style={{ fontSize: 9, color: '#334155', fontStyle: 'italic' }}>Educational data only</div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          onClick={handleShare}
          disabled={copying}
          style={{ padding: '10px 24px', borderRadius: 8, background: '#00C805', border: 'none', color: '#000', fontSize: 13, fontWeight: 700, cursor: copying ? 'wait' : 'pointer' }}
        >
          {copying ? 'Preparing...' : '📤 Share / Save'}
        </button>
        <button
          onClick={onClose}
          style={{ padding: '10px 24px', borderRadius: 8, background: 'transparent', border: '1px solid #1E2530', color: '#64748B', fontSize: 13, cursor: 'pointer' }}
        >
          Close
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: '#475569', textAlign: 'center' }}>
        Share on WhatsApp, Twitter, or save to photos
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
  const [watcherCount, setWatcherCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [deliveryTab, setDeliveryTab] = useState('1D')
  const [sectorHealth, setSectorHealth] = useState(null)
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
        supabase.from('price_data')
          .select('date,open,high,low,close,volume,ma20,ma50,ma150,rsi')
          .eq('company_id', co.id)
          .order('date', { ascending: false })
          .limit(252),
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
    if (!user) return
    if (watchLoading) return
    setWatchLoading(true)
    try {
      if (watching && watchlistRowId) {
        await supabase.from('watchlists').delete().eq('id', watchlistRowId)
        setWatching(false)
        setWatchlistRowId(null)
      } else {
        const { error } = await insertWatchlistRow({
          user_id: user.id,
          company_id: company.id,
          symbol: sym,
          added_at: new Date().toISOString(),
          price_at_add: price?.close ?? null,
        })
        if (!error) {
          const { data } = await selectWatchMembership(user.id, company.id)
          setWatching(true)
          setWatchlistRowId(data?.id ?? null)
        }
      }
    } finally {
      setWatchLoading(false)
    }
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
              {company.name} · {company.sector}
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

          <button
            onClick={() => setShowShareCard(true)}
            title="Share"
            style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, borderRadius: 8, transition: 'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = C.muted}
          >
            <i className="ti ti-share" style={{ fontSize: 17 }} />
          </button>
          <button
            onClick={handleWatchToggle}
            disabled={watchLoading || !user}
            title={!user ? 'Sign in to add to watchlist' : watching ? 'Remove from watchlist' : 'Add to watchlist'}
            style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: watchLoading || !user ? 'default' : 'pointer', color: watching ? C.blue : C.muted, borderRadius: 8, opacity: watchLoading ? 0.5 : 1, transition: 'opacity .15s' }}>
            <i className={watchLoading ? 'ti ti-loader-2' : watching ? 'ti ti-bookmark-filled' : 'ti ti-bookmark'} style={{ fontSize: 17, animation: watchLoading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Signal badges */}
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { show: true, color: price?.stage === 'Stage 2' ? C.green : price?.stage === 'Stage 4' ? C.red : C.blue, label: price?.stage || 'Unclassified' },
            { show: delivery?.avg_delivery_30d != null, color: delivery?.avg_delivery_30d > 55 ? C.green : C.muted, label: `Del ${delivery?.avg_delivery_30d?.toFixed(1) || '—'}% 30D` },
            { show: latest_sh.promoter_pledge_pct != null, color: latest_sh.promoter_pledge_pct > 0 ? C.red : C.green, label: latest_sh.promoter_pledge_pct > 0 ? `⚠ Pledge ${latest_sh.promoter_pledge_pct?.toFixed(1)}%` : '✓ No Pledge' },
            { show: rsVsNifty != null, color: rsVsNifty > 0 ? C.green : rsVsNifty < 0 ? C.red : C.muted, label: `RS ${fmtPct(rsVsNifty)}` },
            { show: Boolean(delivery?.high_conviction), color: C.green, label: '⚡ SwingX' },
          ].filter(b => b.show).map((b, i) => (
            <span key={i} style={{ background: b.color + '18', color: b.color, border: `1px solid ${b.color}33`, fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
              {b.label}
            </span>
          ))}
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
                style={{ flex: 'none', padding: '10px 18px', fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.text : C.muted, background: 'none', border: 'none', borderBottom: `2px solid ${active ? C.blue : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color .15s, border-color .15s' }}>
                {tab}
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
                    Analyst Consensus · {total} analysts
                  </p>
                  <span style={{ fontSize: 11, fontWeight: 700, color: buyPct > 70 ? C.green : buyPct > 50 ? 'var(--positive-soft)' : C.amber, padding: '2px 9px', borderRadius: 20, background: buyPct > 70 ? C.greenDim : C.amberDim }}>
                    {buyPct > 70 ? 'Strong Buy' : buyPct > 50 ? 'Buy' : 'Mixed'}
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
                <SectionLabel title="Technicals" sub="price_data · is_latest" />
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
                  label: 'Above rising 30W MA',
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
                  pass: deliveryData?.weeks_in_stage2 != null && deliveryData.weeks_in_stage2 < 39
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
                      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>Weinstein Checklist</p>
                      <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>Stage 2 health indicators</p>
                      <p style={{ fontSize: 10, color: C.faint, margin: '4px 0 0', lineHeight: 1.5, maxWidth: 220 }}>Score reflects how many of 5 Weinstein Stage 2 criteria are currently met. This is an educational filter, not a rating or recommendation.</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red }}>{passCount}/5</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                        background: passCount >= 4 ? C.greenDim : passCount >= 2 ? C.amberDim : C.redDim,
                        color: passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red,
                        border: `1px solid ${passCount >= 4 ? C.green : passCount >= 2 ? C.amber : C.red}33`
                      }}>
                        {passCount >= 4 ? 'Strong Setup' : passCount >= 2 ? 'Developing' : 'Weak Setup'}
                      </span>
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
                        ? 'All key Weinstein criteria align — high-probability setup.'
                        : passCount >= 2
                          ? 'Some criteria missing — watch for improvement before entry.'
                          : 'Multiple criteria failing — caution advised.'}
                    </p>
                  </div>
                </Card>
              )
            })()}
            <Card>
              <SectionLabel title="Technicals" sub="price_data · is_latest" />
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
                    { label: '30W MA', value: ma30 },
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
                    { show: delivery.breakout_30wma,    label: 'Above 30W MA', color: C.green, dim: C.greenDim },
                    { show: delivery.breakdown_30wma,   label: 'Below 30W MA',color: C.red,   dim: C.redDim },
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
        Data is for informational and educational purposes only. Not investment advice. Past performance does not guarantee future results. Please consult a SEBI-registered investment advisor before making any investment decisions.
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
