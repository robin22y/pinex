import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Helmet } from 'react-helmet-async'
import { Link, useParams } from 'react-router-dom'
import DeliveryPanel from '../components/DeliveryPanel'
import RevenueChart from '../components/RevenueChart'
import MiniPriceChart from '../components/stock/MiniPriceChart'
import StockDetailChartColumn from '../components/stock/StockDetailChartColumn'
import StockDetailRightRail from '../components/stock/StockDetailRightRail'
import ShareCard from '../components/ShareCard'
import ShareholdingTrend from '../components/stock/ShareholdingTrend'
import AtAGlanceSignals from '../components/stock/AtAGlanceSignals'
import SwingConditions from '../components/SwingConditions'
import WhatChanged from '../components/WhatChanged'
import DataWarning from '../components/states/DataWarning'
import Badge from '../components/ui/Badge'
import ExplainButton from '../components/ui/ExplainButton'
import Modal from '../components/ui/Modal'
import Skeleton from '../components/ui/Skeleton'
import StagePill from '../components/StagePill'
import InfoHint from '../components/InfoHint'
import { useToast } from '../components/ui/toast-context'
import { C } from '../styles/tokens'
import { CONFIG } from '../config'
import { useAuth } from '../context'
import { useViewLimit } from '../hooks/useViewLimit'
import { getHealthDisplayLabel, normalizeSectorHealthKey, sectorHealthBadgeStatus } from '../lib/sectorHealth'
import { stagePeersSortOrder, stagePrettyFromDb } from '../lib/stageUi'
import { buildSyntheticSignals, mergeSignalPanel } from '../lib/stockSignals'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { countWatchlistForUser, insertWatchlistRow, selectWatchMembership } from '../lib/watchlistTable'

const PAGE_BG = '#080C14'
/** Sticky tab bar (match terminal pages e.g. Home) */
const STICKY_TAB_BG = '#0B0E11'
const STICKY_TAB_BORDER = '#1E2530'
const CARD_BG = '#0D1525'
const CARD_BORDER = '#1E293B'
const TAB_BORDER = '#38BDF8'
const TAB_MUTED = '#64748B'

const SECTION_TITLE_STYLE = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: '#64748B',
  marginBottom: '16px',
}

function SectionTitle({ children, as: Tag = 'h2' }) {
  return (
    <Tag className="m-0 font-bold" style={SECTION_TITLE_STYLE}>
      {children}
    </Tag>
  )
}

function StockSectionCard({ title, children, className = '', style = {} }) {
  return (
    <div
      className={`rounded-[12px] border border-solid ${className}`}
      style={{
        background: CARD_BG,
        borderColor: CARD_BORDER,
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
        ...style,
      }}
    >
      {title ? <SectionTitle>{title}</SectionTitle> : null}
      {children}
    </div>
  )
}

const MAIN_TABS = [
  { id: 'financials', label: 'Financials' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'technicals', label: 'Technicals' },
]

const RETURN_PERIODS = [
  { label: '1 Week', days: 5 },
  { label: '1 Month', days: 22 },
  { label: '3 Month', days: 66 },
  { label: '6 Month', days: 126 },
  { label: '1 Year', days: 252 },
]

function stagePretty(stage) {
  return stagePrettyFromDb(stage)
}

function obvBadgeStyle(trend) {
  const t = String(trend || '').toLowerCase()
  if (t === 'rising') return { background: 'rgba(34,197,94,0.15)', border: '1px solid #22c55e', color: '#bbf7d0' }
  if (t === 'falling') return { background: 'rgba(251,113,133,0.12)', border: '1px solid #fb7185', color: '#fecaca' }
  return { background: '#1e293b', border: `1px solid ${CARD_BORDER}`, color: '#94a3b8' }
}

function maBadgeStyle(above) {
  if (above == null) return { background: '#1e293b', border: `1px solid ${CARD_BORDER}`, color: '#64748B' }
  return above
    ? { background: 'rgba(34,197,94,0.15)', border: '1px solid #22c55e', color: '#bbf7d0' }
    : { background: 'rgba(251,113,133,0.12)', border: '1px solid #fb7185', color: '#fecaca' }
}

function valueNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Match RevenueChart: DB may be ₹ Cr or absolute INR. */
function inferCroreDisplayDivisor(samples) {
  const maxAbs = samples.reduce((m, v) => Math.max(m, Math.abs(valueNum(v))), 0)
  return maxAbs >= 1e7 ? 10000000 : 1
}

function formatCroresCell(value, displayDivisor) {
  if (value == null || value === '') return '—'
  const crores = valueNum(value) / displayDivisor
  const abs = Math.abs(crores)
  const frac = abs >= 100 ? 0 : abs >= 1 ? 2 : 3
  return `${crores.toLocaleString(undefined, { maximumFractionDigits: frac })} Cr`
}

function formatPrice(v) {
  return `₹${valueNum(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function parseShareDate(row) {
  const raw = row?.date || row?.quarter || row?.quarter_name || ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatPct(v) {
  return `${valueNum(v).toFixed(2)}%`
}

/** TTM key metrics display (₹ Cr scale). */
function formatCr(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x <= 0) return '—'
  if (x >= 10000) return `${(x / 10000).toFixed(1)},000 Cr`
  if (x >= 1000) return `${x.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`
  return `${x.toFixed(0)} Cr`
}

const FIN_GRID_BORDER = '#1E2530'
const FIN_CELL_BG = '#0D1525'
const TERMINAL_TEXT = '#E2E8F0'
const TERMINAL_GREEN = '#00C805'
const TERMINAL_RED = '#FF3B30'
const TERMINAL_BLUE = '#60A5FA'
const TERMINAL_AMBER = '#FBBF24'
const TERMINAL_MUTED = '#64748B'

function MetricsGridCell({ label, value, valueColor = TERMINAL_TEXT, sub, subColor }) {
  return (
    <div style={{ background: FIN_CELL_BG, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: TERMINAL_MUTED }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: valueColor, marginTop: 4 }}>{value}</div>
      {sub != null && String(sub).trim() !== '' ? (
        <div style={{ fontSize: 11, color: subColor || TERMINAL_MUTED, marginTop: 2 }}>{sub}</div>
      ) : null}
    </div>
  )
}

function FinancialsCalculatedMetricsGrid({ financials, priceLatest }) {
  const latestFin = financials?.[0] || {}
  const slice4 = Array.isArray(financials) ? financials.slice(0, 4) : []
  const ttmRevenue = slice4.reduce((s, r) => s + valueNum(r?.revenue), 0)
  const ttmPAT = slice4.reduce((s, r) => s + valueNum(r?.pat ?? r?.net_profit), 0)

  const marginRows = slice4.filter((r) => r?.margin != null && Number.isFinite(Number(r.margin)))
  const avgMargin = marginRows.length
    ? marginRows.reduce((s, r) => s + Number(r.margin), 0) / marginRows.length
    : null

  const latestPrice = priceLatest?.close
  const high52w = priceLatest?.high_52w
  const low52w = priceLatest?.low_52w
  const rsiRaw = priceLatest?.rsi ?? priceLatest?.rsi14
  const rsi = rsiRaw != null && rsiRaw !== '' && Number.isFinite(Number(rsiRaw)) ? Number(rsiRaw) : null
  const rsRaw = priceLatest?.rs_vs_nifty
  const rs =
    rsRaw != null && rsRaw !== '' && Number.isFinite(Number(rsRaw)) ? Number(rsRaw) : null

  const lp = Number(latestPrice)
  const highN = Number(high52w)
  const lowN = Number(low52w)

  const pctFrom52wHigh =
    Number.isFinite(lp) && Number.isFinite(highN) && highN !== 0 ? ((lp - highN) / highN) * 100 : null
  const pctFrom52wLow =
    Number.isFinite(lp) && Number.isFinite(lowN) && lowN !== 0 ? ((lp - lowN) / lowN) * 100 : null

  const obvSlopeRaw = priceLatest?.obv_slope
  const obvSlope = Number(obvSlopeRaw)

  let obvTxt = '→ Flat'
  let obvColor = TERMINAL_MUTED
  if (priceLatest?.obv_slope != null && String(priceLatest.obv_slope).trim() !== '' && Number.isFinite(obvSlope)) {
    if (obvSlope > 0.02) {
      obvTxt = '↑ Rising'
      obvColor = TERMINAL_GREEN
    } else if (obvSlope < -0.02) {
      obvTxt = '↓ Falling'
      obvColor = TERMINAL_RED
    }
  }

  const stageRaw = priceLatest?.stage ?? ''
  const stageStr = String(stageRaw)
  let stageBg = 'rgba(100,116,139,.12)'
  let stageColor = TERMINAL_MUTED
  let stageBorder = 'rgba(100,116,139,.25)'
  if (/stage\s*4/i.test(stageStr) || stageStr.includes('4')) {
    stageBg = 'rgba(255,59,48,.12)'
    stageColor = TERMINAL_RED
    stageBorder = 'rgba(255,59,48,.25)'
  } else if (/stage\s*3/i.test(stageStr)) {
    stageBg = 'rgba(251,191,36,.12)'
    stageColor = TERMINAL_AMBER
    stageBorder = 'rgba(251,191,36,.25)'
  } else if (/stage\s*2/i.test(stageStr)) {
    stageBg = 'rgba(0,200,5,.12)'
    stageColor = TERMINAL_GREEN
    stageBorder = 'rgba(0,200,5,.25)'
  } else if (/stage\s*1/i.test(stageStr) || stageStr.includes('Emerging')) {
    stageBg = 'rgba(96,165,250,.12)'
    stageColor = TERMINAL_BLUE
    stageBorder = 'rgba(96,165,250,.25)'
  }

  const revYoy = latestFin?.revenue_growth_yoy
  const revYoyN = Number(revYoy)
  const patYoy = latestFin?.pat_growth_yoy
  const patYoyN = Number(patYoy)
  const epsN = Number(latestFin?.eps)

  const cells = []

  cells.push(
    <MetricsGridCell key="rv" label="Revenue TTM" value={ttmRevenue > 0 ? `₹${formatCr(ttmRevenue)}` : '—'} />,
    <MetricsGridCell
      key="pat"
      label="PAT TTM"
      value={
        Number.isFinite(ttmPAT) && ttmPAT !== 0
          ? `₹${ttmPAT < 0 ? '−' : ''}${formatCr(Math.abs(ttmPAT))}`
          : '—'
      }
      valueColor={ttmPAT < 0 ? TERMINAL_RED : TERMINAL_TEXT}
    />,
    <MetricsGridCell
      key="mg"
      label="Oper. Margin"
      value={avgMargin != null ? `${avgMargin.toFixed(1)}%` : '—'}
      valueColor={
        avgMargin == null ? TERMINAL_TEXT : avgMargin > 20 ? TERMINAL_GREEN : avgMargin > 10 ? TERMINAL_TEXT : TERMINAL_RED
      }
    />,
  )

  cells.push(
    <MetricsGridCell
      key="rgy"
      label="Revenue Growth (YoY)"
      value={
        Number.isFinite(revYoyN)
          ? `${revYoyN > 0 ? '+' : ''}${revYoyN.toFixed(1)}%`
          : '—'
      }
      valueColor={
        !Number.isFinite(revYoyN) ? TERMINAL_TEXT : revYoyN >= 0 ? TERMINAL_GREEN : TERMINAL_RED
      }
    />,
    <MetricsGridCell
      key="pgy"
      label="PAT Growth (YoY)"
      value={
        Number.isFinite(patYoyN)
          ? `${patYoyN > 0 ? '+' : ''}${patYoyN.toFixed(1)}%`
          : '—'
      }
      valueColor={
        !Number.isFinite(patYoyN) ? TERMINAL_TEXT : patYoyN >= 0 ? TERMINAL_GREEN : TERMINAL_RED
      }
    />,
    <MetricsGridCell
      key="eps"
      label="EPS (Latest Q)"
      value={Number.isFinite(epsN) ? `₹${epsN.toFixed(2)}` : '—'}
    />,
  )

  cells.push(
    <MetricsGridCell
      key="h52"
      label="52W High"
      value={
        Number.isFinite(highN)
          ? `₹${highN.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
          : '—'
      }
      sub={pctFrom52wHigh != null ? `${pctFrom52wHigh.toFixed(1)}% from now` : null}
      subColor={TERMINAL_RED}
    />,
    <MetricsGridCell
      key="l52"
      label="52W Low"
      value={
        Number.isFinite(lowN)
          ? `₹${lowN.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
          : '—'
      }
      sub={pctFrom52wLow != null ? `${pctFrom52wLow >= 0 ? '+' : ''}${pctFrom52wLow.toFixed(1)}% from low` : null}
      subColor={TERMINAL_GREEN}
    />,
    <MetricsGridCell
      key="rsi"
      label="RSI"
      value={rsi != null ? rsi.toFixed(1) : '—'}
      sub={rsi != null ? (rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral') : null}
      subColor={rsi != null ? (rsi > 70 ? TERMINAL_RED : rsi < 30 ? TERMINAL_GREEN : TERMINAL_MUTED) : TERMINAL_MUTED}
      valueColor={
        rsi != null ? (rsi > 70 ? TERMINAL_RED : rsi < 30 ? TERMINAL_GREEN : TERMINAL_TEXT) : TERMINAL_TEXT
      }
    />,
  )

  cells.push(
    <MetricsGridCell
      key="rvn"
      label="RS vs Nifty (1Y)"
      value={rs != null ? `${rs > 0 ? '+' : ''}${rs.toFixed(1)}%` : '—'}
      sub={rs != null ? (rs > 0 ? 'Outperforming' : 'Underperforming') : null}
      valueColor={rs != null ? (rs > 0 ? TERMINAL_GREEN : TERMINAL_RED) : TERMINAL_TEXT}
      subColor={rs != null ? (rs > 0 ? TERMINAL_GREEN : TERMINAL_RED) : TERMINAL_MUTED}
    />,
    <div key="stg" style={{ background: FIN_CELL_BG, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: TERMINAL_MUTED }}>Stage</div>
      <span
        style={{
          alignSelf: 'flex-start',
          fontSize: 13,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 4,
          background: stageBg,
          color: stageColor,
          border: `1px solid ${stageBorder}`,
        }}
      >
        {stagePretty(stageRaw)}
      </span>
    </div>,
    <MetricsGridCell key="obv" label="OBV Trend" value={obvTxt} valueColor={obvColor} />,
  )

  return (
    <div style={{ marginTop: 12 }}>
      <p className="m-0 font-bold" style={SECTION_TITLE_STYLE}>
        KEY METRICS
      </p>
      <p className="m-0 mt-1 text-[12px]" style={{ color: TERMINAL_MUTED }}>
        Calculated from quarterly filings
      </p>
      <div
        style={{
          marginTop: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 1,
          background: FIN_GRID_BORDER,
          border: `1px solid ${FIN_GRID_BORDER}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {cells}
      </div>
    </div>
  )
}

function ShareholdingSnapshotTab({ latest, prev }) {
  const cols = [
    { key: 'promoter_pct', label: 'PROMOTER' },
    { key: 'fii_pct', label: 'FII' },
    { key: 'dii_pct', label: 'DII' },
    { key: 'public_pct', label: 'PUBLIC' },
  ]

  function qoqChange(field) {
    const curr = latest?.[field]
    const p = prev?.[field]
    const cNum = curr != null && curr !== '' ? Number(curr) : null
    const pNum = p != null && p !== '' ? Number(p) : null
    if (cNum == null || !Number.isFinite(cNum) || pNum == null || !Number.isFinite(pNum)) return null
    return cNum - pNum
  }

  function qoqFmt(d) {
    if (d == null || !Number.isFinite(d)) {
      return { text: '→ 0.00%', color: TERMINAL_MUTED }
    }
    if (d > 0) return { text: `↑ +${Math.abs(d).toFixed(2)}%`, color: TERMINAL_GREEN }
    if (d < 0) return { text: `↓ -${Math.abs(d).toFixed(2)}%`, color: TERMINAL_RED }
    return { text: '→ 0.00%', color: TERMINAL_MUTED }
  }

  const quarterLabelRaw = latest?.quarter ?? latest?.quarter_name ?? latest?.date
  let quarterHuman = ''
  if (quarterLabelRaw) {
    const dt = parseShareDate({ quarter: latest?.quarter, quarter_name: latest?.quarter_name, date: latest?.date })
    quarterHuman = dt
      ? `As of ${dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
      : `As of ${String(quarterLabelRaw)}`
  }

  const pledge = latest?.promoter_pledge_pct != null ? Number(latest.promoter_pledge_pct) : null

  return (
    <div style={{ marginTop: 16 }}>
      <p className="m-0 font-bold" style={SECTION_TITLE_STYLE}>
        Shareholding snapshot
      </p>
      {quarterHuman ? (
        <p className="m-0 mt-1 text-[12px]" style={{ color: TERMINAL_MUTED }}>
          {quarterHuman}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2" style={{ gap: 8 }}>
        {cols.map((c) => {
          const v = latest?.[c.key]
          const vn = v != null && v !== '' ? Number(v) : null
          const q = qoqFmt(qoqChange(c.key))
          return (
            <div
              key={c.key}
              style={{
                flex: '1 1 140px',
                minWidth: 120,
                background: FIN_CELL_BG,
                border: `1px solid ${FIN_GRID_BORDER}`,
                borderRadius: 8,
                padding: '12px 14px',
              }}
            >
              <div
                className="flex items-center gap-0.5"
                style={{ fontSize: 10, color: TERMINAL_MUTED, letterSpacing: '0.04em', textTransform: 'uppercase' }}
              >
                <span>{c.label}</span>
                {c.key === 'promoter_pct' ? <InfoHint id="promoter_pct" size={11} /> : null}
              </div>
              <div
                style={{ fontSize: 16, fontWeight: 700, color: TERMINAL_TEXT, marginTop: 6 }}
                className="tabular-nums"
              >
                {vn != null && Number.isFinite(vn) ? `${vn.toFixed(1)}%` : '—'}
              </div>
              <div style={{ fontSize: 11, color: q.color, marginTop: 4 }}>{q.text}</div>
            </div>
          )
        })}
      </div>
      {pledge != null && pledge > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1"
          style={{
            marginTop: 8,
            background: 'rgba(255,59,48,0.08)',
            border: '1px solid rgba(255,59,48,0.25)',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            color: TERMINAL_RED,
          }}
        >
          <InfoHint id="promoter_pledge" size={12} />
          <span>
            ⚠️ Promoter pledge: {pledge.toFixed(2)}% — Monitor for forced selling risk
          </span>
        </div>
      ) : null}
    </div>
  )
}

function AnalystConsensusSummary({ company }) {
  const sb = valueNum(company?.analyst_strong_buy ?? company?.analystStrongBuy)
  const b = valueNum(company?.analyst_buy ?? company?.analystBuy)
  const h = valueNum(company?.analyst_hold ?? company?.analystHold)
  const sel = valueNum(company?.analyst_sell ?? company?.analystSell)
  const rawUpd =
    company?.analyst_updated_at ?? company?.analystUpdatedAt ?? company?.analyst_consensus_updated_at ?? null

  let updDate = rawUpd ? new Date(rawUpd) : null
  if (updDate && Number.isNaN(updDate.getTime())) updDate = null
  const within90 =
    /* eslint-disable-next-line react-hooks/purity -- staleness vs current time is intentional display gating */
    updDate != null && (Date.now() - updDate.getTime()) / 86400000 <= 90

  const total = sb + b + h + sel
  if (!within90 || total <= 0) return null

  const headlineCount =
    company?.analyst_count != null && Number.isFinite(Number(company.analyst_count))
      ? `${Number(company.analyst_count)} analysts`
      : `${total} ratings`

  const legend = [
    { label: 'Strong Buy', color: TERMINAL_GREEN, n: sb },
    { label: 'Buy', color: '#86EFAC', n: b },
    { label: 'Hold', color: TERMINAL_AMBER, n: h },
    { label: 'Sell', color: TERMINAL_RED, n: sel },
  ]

  const buyPct = ((sb + b) / total) * 100
  let badgeText = 'Mixed'
  let badgeBg = 'rgba(251,191,36,.15)'
  let badgeBorder = 'rgba(251,191,36,.35)'
  let badgeColor = TERMINAL_AMBER
  if (buyPct > 70) {
    badgeText = 'Strong Buy'
    badgeBg = 'rgba(0,200,5,.12)'
    badgeBorder = 'rgba(0,200,5,.25)'
    badgeColor = TERMINAL_GREEN
  } else if (buyPct > 50) {
    badgeText = 'Buy'
    badgeBg = 'rgba(134,239,172,.12)'
    badgeBorder = 'rgba(134,239,172,.35)'
    badgeColor = '#86EFAC'
  }

  const dateStr = updDate
    ? updDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''

  return (
    <StockSectionCard title="Analyst consensus" style={{ marginTop: '20px', marginBottom: '16px' }}>
      <p className="m-0 text-[12px]" style={{ color: TERMINAL_MUTED }}>
        {headlineCount} · Updated {dateStr}
      </p>
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {legend.map((seg) =>
          seg.n > 0 ? (
            <div
              key={seg.label}
              style={{
                width: `${(seg.n / total) * 100}%`,
                background: seg.color,
              }}
            />
          ) : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[12px]" style={{ color: TERMINAL_MUTED }}>
        {legend.map((seg) => (
          <span key={seg.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
            {seg.label}: <span style={{ color: TERMINAL_TEXT }} className="tabular-nums">{seg.n}</span>
          </span>
        ))}
      </div>
      <div className="mt-3 inline-block rounded px-3 py-1 text-[12px] font-semibold" style={{ background: badgeBg, border: `1px solid ${badgeBorder}`, color: badgeColor }}>
        {badgeText}
      </div>
    </StockSectionCard>
  )
}

/** Delivery % thresholds for heat colour (same as card). */
function deliveryStrengthColor(pct) {
  const t = valueNum(pct)
  if (t >= 45) return '#22C55E'
  if (t >= 30) return '#F59E0B'
  return '#EF4444'
}

function monthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getDownloadCount() {
  try {
    const k = `stockiq_downloads_${monthKey()}`
    return Number(localStorage.getItem(k) || 0)
  } catch {
    return 0
  }
}

function incrementDownloadCount() {
  try {
    const k = `stockiq_downloads_${monthKey()}`
    const current = Number(localStorage.getItem(k) || 0)
    localStorage.setItem(k, String(current + 1))
  } catch {
    // no-op
  }
}

function whatChangedAccent(changes) {
  const hasMajor = Array.isArray(changes?.changes) && changes.changes.length > 0
  const severity = String(changes?.headline_severity || '').toLowerCase()
  const firstTimePositive = (changes?.changes || []).some(
    (c) => c?.is_first_time && String(c?.severity || '').toLowerCase() === 'high',
  )
  if (!hasMajor) return C.border
  if (severity === 'high') return C.red
  if (firstTimePositive) return C.green
  return C.amber
}

function tradingDayReturnPct(rowsNewestFirst, dayOffset) {
  if (!rowsNewestFirst?.length) return null
  const i = Math.min(dayOffset, rowsNewestFirst.length - 1)
  const c0 = valueNum(rowsNewestFirst[0]?.close)
  const c1 = valueNum(rowsNewestFirst[i]?.close)
  if (!c1) return null
  return ((c0 - c1) / c1) * 100
}

function fmtSignedPct(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const v = valueNum(n)
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function stageSortKey(stage) {
  return stagePeersSortOrder(stage)
}

function cardClass(extra = '') {
  return `rounded-[12px] border border-solid p-5 mb-4 ${extra}`
}

function stageInfoHintId(stage) {
  const s = String(stage || '').trim()
  if (s === 'Stage 2') return 'stage2'
  if (s === 'Stage 1') return 'stage1'
  if (s === 'Stage 3') return 'stage3'
  return 'stage4'
}

function KeyMetricCell({ label, labelExtra, value, hint, valueNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-solid p-3" style={{ borderColor: CARD_BORDER, background: 'transparent' }}>
      <div className="flex items-center gap-0.5 text-[11px] font-medium uppercase tracking-wide" style={{ color: TAB_MUTED }}>
        <span>{label}</span>
        {labelExtra}
      </div>
      {valueNode != null ? (
        <div className="mt-1">{valueNode}</div>
      ) : (
        <p className="mt-1 break-words font-data text-lg font-bold tabular-nums text-white">{value}</p>
      )}
      {hint != null && hint !== '' ? (
        <div className="mt-0.5 text-[12px] leading-snug" style={{ color: TAB_MUTED }}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

function outlineLinkClass() {
  return 'inline-flex shrink-0 items-center justify-center rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90'
}

const surfaceButtonClass =
  'rounded-lg border px-3 py-2 text-sm font-medium transition-opacity appearance-none hover:opacity-90 disabled:cursor-not-allowed'
const surfaceButtonStyle = {
  borderColor: CARD_BORDER,
  background: CARD_BG,
  color: '#f8fafc',
}

export default function StockDetail() {
  const { symbol } = useParams()
  const { user, profile } = useAuth()
  const { showToast } = useToast()
  const { checkAndRecordView } = useViewLimit()
  const [loading, setLoading] = useState(true)
  const [shareOpen, setShareOpen] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [message, setMessage] = useState('')
  const shareCardRef = useRef(null)
  const tabContentRef = useRef(null)
  const [activeTab, setActiveTab] = useState('financials')

  const [company, setCompany] = useState(null)
  const [financials, setFinancials] = useState([])
  const [shareholding, setShareholding] = useState([])
  const [deliveryRows, setDeliveryRows] = useState([])
  const [changes, setChanges] = useState({})
  const [priceLatest, setPriceLatest] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [historyCount, setHistoryCount] = useState(0)
  const [swing, setSwing] = useState({})
  const [sectorRow, setSectorRow] = useState(null)
  const [peers, setPeers] = useState([])
  const [deliverySignalsRow, setDeliverySignalsRow] = useState(null)
  const [sectorPeersSidebar, setSectorPeersSidebar] = useState([])
  const [stockNewsArticles, setStockNewsArticles] = useState([])
  /** null = not checked yet */
  const [inWatchlist, setInWatchlist] = useState(null)
  const [watchlistSaving, setWatchlistSaving] = useState(false)

  const normalizedSymbol = String(symbol || '').toUpperCase().trim()
  const stockUrl = `https://pinex.in/stock/${normalizedSymbol}`
  const isPaid = profile?.plan === 'paid'

  const handleTabChange = useCallback((tab) => {
    if (typeof window !== 'undefined' && window.history?.scrollRestoration != null) {
      window.history.scrollRestoration = 'manual'
    }
    setActiveTab(tab)
    window.setTimeout(() => {
      tabContentRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 50)
  }, [])

  useEffect(() => {
    if (!normalizedSymbol) return
    let active = true

    async function run() {
      setLoading(true)
      setMessage('')

      if (!hasSupabaseEnv) {
        setLoading(false)
        return
      }

      try {
        const companyRes = await supabase.from('companies').select('*').eq('symbol', normalizedSymbol).single()
        const loadedCompany = companyRes.data
        const companyId = loadedCompany?.id
        if (!companyId) {
          setCompany(null)
          setFinancials([])
          setShareholding([])
          setDeliveryRows([])
          setChanges({})
          setPriceLatest(null)
          setPriceHistory([])
          setHistoryCount(0)
          setSwing({})
          setSectorRow(null)
          setPeers([])
          setDeliverySignalsRow(null)
          setSectorPeersSidebar([])
          setStockNewsArticles([])
          return
        }

        await checkAndRecordView(companyId)
        if (!active) return

        const [
          financialRes,
          shareRes,
          deliveryRes,
          changesRes,
          priceHistoryRes,
          swingRes,
          deliverySigRes,
          stockNewsRes,
        ] = await Promise.all([
          supabase
            .from('financials')
            .select('*')
            .eq('company_id', companyId)
            .order('quarter', { ascending: false })
            .limit(8),
          supabase
            .from('shareholding')
            .select('*')
            .eq('company_id', companyId)
            .order('quarter', { ascending: false })
            .limit(8),
          supabase
            .from('delivery_data')
            .select('*')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(100),
          supabase
            .from('quarterly_changes')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('price_data')
            .select('*')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(252),
          supabase
            .from('swing_conditions')
            .select('*')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('delivery_signals')
            .select('*')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('stock_news').select('*').eq('company_id', companyId).order('published_at', { ascending: false }).limit(8),
        ])

        const latestPrice = priceHistoryRes.data?.[0] || null
        const sector = loadedCompany?.sector

        let sectorData = null
        if (sector) {
          const latestSectorDateRes = await supabase
            .from('sectors')
            .select('last_updated')
            .eq('name', sector)
            .order('last_updated', { ascending: false })
            .limit(1)
          const latestSectorDate = latestSectorDateRes.data?.[0]?.last_updated
          if (latestSectorDate) {
            const s = await supabase
              .from('sectors')
              .select('*')
              .eq('name', sector)
              .eq('last_updated', latestSectorDate)
              .maybeSingle()
            sectorData = s.data
          }
        }

        let peerRows = []
        let sectorPeersSidebar = []
        if (sector && companyId) {
          const allInSectorRes = await supabase.from('companies').select('id,symbol,name').eq('sector', sector).limit(40)
          const allInSector = allInSectorRes.data || []
          const allIds = allInSector.map((c) => c.id).filter(Boolean)
          let byCoFull = {}
          if (allIds.length) {
            const pricesAllRes = await supabase
              .from('price_data')
              .select('company_id,date,close,stage')
              .in('company_id', allIds)
              .order('date', { ascending: false })
            for (const r of pricesAllRes.data || []) {
              if (!byCoFull[r.company_id]) byCoFull[r.company_id] = []
              if (byCoFull[r.company_id].length < 10) byCoFull[r.company_id].push(r)
            }
            sectorPeersSidebar = allInSector.map((c) => {
              const prRows = byCoFull[c.id] || []
              const t5 = tradingDayReturnPct(prRows, 5)
              let arrow = '→'
              if (t5 != null) {
                if (t5 > 0.5) arrow = '↑'
                else if (t5 < -0.5) arrow = '↓'
              }
              return {
                id: c.id,
                symbol: String(c.symbol || '').toUpperCase(),
                stage: prRows[0]?.stage,
                trendArrow: arrow,
                isCurrent: c.id === companyId,
              }
            })
            sectorPeersSidebar.sort((a, b) => {
              if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
              const ra = stageSortKey(a.stage)
              const rb = stageSortKey(b.stage)
              if (ra !== rb) return ra - rb
              return a.symbol.localeCompare(b.symbol)
            })
            sectorPeersSidebar = sectorPeersSidebar.slice(0, 5)
          }

          const peerCompanies = allInSector.filter((c) => c.id !== companyId)
          const pids = peerCompanies.map((c) => c.id).filter(Boolean)
          if (pids.length) {
            const [deliveriesRes, finRes] = await Promise.all([
              supabase
                .from('delivery_data')
                .select('company_id,date,delivery_pct')
                .in('company_id', pids)
                .order('date', { ascending: false }),
              supabase
                .from('financials')
                .select('company_id,quarter,revenue')
                .in('company_id', pids)
                .order('quarter', { ascending: false }),
            ])
            const delFirst = {}
            for (const r of deliveriesRes.data || []) {
              if (!delFirst[r.company_id]) delFirst[r.company_id] = r
            }
            const finByCo = {}
            for (const r of finRes.data || []) {
              const id = r.company_id
              if (!finByCo[id]) finByCo[id] = []
              if (finByCo[id].length < 2) finByCo[id].push(r)
            }
            peerRows = peerCompanies.map((c) => {
              const pq = finByCo[c.id] || []
              const r0 = valueNum(pq[0]?.revenue)
              const r1 = valueNum(pq[1]?.revenue)
              const revenueTrendPct = r1 ? ((r0 - r1) / r1) * 100 : null
              const rows = byCoFull[c.id] || []
              return {
                id: c.id,
                symbol: String(c.symbol || '').toUpperCase(),
                name: c.name,
                stage: rows[0]?.stage,
                deliveryPct: valueNum(delFirst[c.id]?.delivery_pct),
                revenueTrendPct,
              }
            })
            peerRows.sort((a, b) => {
              const ra = stageSortKey(a.stage)
              const rb = stageSortKey(b.stage)
              if (ra !== rb) return ra - rb
              return a.symbol.localeCompare(b.symbol)
            })
            peerRows = peerRows.slice(0, 5)
          }
        }

        if (!active) return
        setCompany(loadedCompany || null)
        setFinancials(financialRes.data || [])
        setShareholding(shareRes.data || [])
        setDeliveryRows(deliveryRes.data || [])
        const changeRow = changesRes.data || {}
        setChanges({
          ...changeRow,
          headline: changeRow.headline_change || changeRow.headline || '',
        })
        setPriceLatest(latestPrice)
        setPriceHistory(priceHistoryRes.data || [])
        setHistoryCount((priceHistoryRes.data || []).length)
        setSwing(swingRes.data || {})
        setSectorRow(sectorData)
        setPeers(peerRows)
        setDeliverySignalsRow(deliverySigRes.data ?? null)
        setSectorPeersSidebar(sectorPeersSidebar)
        const newsRaw = Array.isArray(stockNewsRes.data) ? stockNewsRes.data : []
        newsRaw.sort((a, b) => {
          const ta = new Date(a?.published_at || a?.fetched_date || 0).getTime()
          const tb = new Date(b?.published_at || b?.fetched_date || 0).getTime()
          return tb - ta
        })
        setStockNewsArticles(newsRaw.slice(0, 8))
      } finally {
        if (active) setLoading(false)
      }
    }

    void run()
    return () => {
      active = false
    }
  }, [normalizedSymbol, checkAndRecordView])

  useEffect(() => {
    queueMicrotask(() => setInWatchlist(null))
  }, [normalizedSymbol])

  useEffect(() => {
    let on = true
    async function checkWatchlistMembership() {
      if (!hasSupabaseEnv || !user?.id) {
        if (on) queueMicrotask(() => setInWatchlist(null))
        return
      }
      if (!company?.id) {
        if (on) queueMicrotask(() => setInWatchlist(false))
        return
      }
      const { data } = await selectWatchMembership(user.id, company.id)
      if (on) queueMicrotask(() => setInWatchlist(!!data?.id))
    }
    void checkWatchlistMembership()
    return () => {
      on = false
    }
  }, [user?.id, company?.id])

  const delivery = useMemo(() => {
    const sortedDesc = [...deliveryRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const today = valueNum(sortedDesc[0]?.delivery_pct)
    const avg = (rows) => (rows.length ? rows.reduce((s, r) => s + valueNum(r.delivery_pct), 0) / rows.length : 0)
    const avgLastN = (n) => avg(sortedDesc.slice(0, Math.min(n, sortedDesc.length)))
    const weekRows = sortedDesc.slice(0, 7)
    const monthRows = sortedDesc.slice(0, 30)
    const monthAvg = avg(monthRows)
    const vs_30d_ratio = monthAvg > 0 ? today / monthAvg : 0
    return {
      symbol: normalizedSymbol,
      today,
      week_avg: avg(weekRows),
      month_avg: monthAvg,
      /** Rolling averages over last N sessions (1d = latest session only). */
      day1: today,
      day7: avgLastN(7),
      day30: avgLastN(30),
      day60: avgLastN(60),
      day90: avgLastN(90),
      vs_30d_avg: vs_30d_ratio,
      ai_insight: sortedDesc[0]?.ai_insight || '',
    }
  }, [deliveryRows, normalizedSymbol])

  const deliveryTrendLabel = useMemo(() => {
    const w = delivery.week_avg
    const m = delivery.month_avg
    if (!m || !deliveryRows.length) return '—'
    if (w > m * 1.05) return 'Rising'
    if (w < m * 0.95) return 'Falling'
    return 'Flat'
  }, [delivery, deliveryRows.length])

  const deliveryTodayColor = useMemo(() => {
    const t = delivery.today
    if (!deliveryRows.length) return '#94a3b8'
    if (t >= 45) return '#22C55E'
    if (t >= 30) return '#F59E0B'
    return '#EF4444'
  }, [delivery.today, deliveryRows.length])

  const deliveryTrendVisual = useMemo(() => {
    if (deliveryTrendLabel === 'Rising') return { text: 'Rising ↑', color: '#22C55E' }
    if (deliveryTrendLabel === 'Falling') return { text: 'Falling ↓', color: '#EF4444' }
    if (deliveryTrendLabel === '—') return { text: '—', color: '#94a3b8' }
    return { text: 'Flat →', color: '#94a3b8' }
  }, [deliveryTrendLabel])

  const deliveryRatioPhrase = useMemo(() => {
    const vs = delivery.vs_30d_avg
    if (!deliveryRows.length || !(vs > 0)) return ''
    if (vs >= 1) return `Today is ${vs.toFixed(1)}× above normal`
    return `Today is ${(1 / vs).toFixed(1)}× below normal`
  }, [delivery.vs_30d_avg, deliveryRows.length])

  const financialWarning =
    financials.find((r) => r?.data_quality_flag || r?.data_quality_warning || r?.is_quality_flagged)?.data_quality_warning ||
    ''
  const shareholdingWarning =
    shareholding.find((r) => r?.data_quality_flag || r?.data_quality_warning || r?.is_quality_flagged)?.data_quality_warning ||
    ''

  const latestTimestamp =
    priceLatest?.date ||
    deliveryRows[0]?.date ||
    changes?.created_at ||
    new Date().toISOString()

  const prevClose = valueNum(priceHistory?.[1]?.close)
  const latestClose = valueNum(priceLatest?.close)
  const dayChangePct = prevClose ? ((latestClose - prevClose) / prevClose) * 100 : 0
  const dayChangeRupees = latestClose - prevClose
  const dayChangeUp = dayChangePct >= 0

  const priceRowsDesc = priceHistory || []

  const ma20 = valueNum(priceLatest?.ma20)
  const ma50 = valueNum(priceLatest?.ma50)
  const ma150 = valueNum(priceLatest?.ma150)

  const rsiVal = valueNum(priceLatest?.rsi ?? priceLatest?.rsi14)

  const sortedShareholdingRaw = useMemo(() => {
    return [...shareholding].sort((a, b) => {
      const at = parseShareDate(a)
      const bt = parseShareDate(b)
      return (bt ? bt.getTime() : 0) - (at ? at.getTime() : 0)
    })
  }, [shareholding])

  const latestShareRow = sortedShareholdingRaw[0]
  const prevShareRow = sortedShareholdingRaw[1]

  const atAGlanceRows = useMemo(() => {
    const synthetic = buildSyntheticSignals({
      financials,
      deliveryAvg: deliverySignalsRow?.avg_delivery_30d ?? null,
      priceLatest,
      latestShare: latestShareRow,
      prevShare: prevShareRow,
    })
    return mergeSignalPanel(changes?.signal_panel, synthetic)
  }, [financials, deliverySignalsRow, priceLatest, latestShareRow, prevShareRow, changes?.signal_panel])

  const obvTrendNode = useMemo(() => {
    const raw = priceLatest?.obv_slope
    const hasSlope = raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw))
    const slope = valueNum(priceLatest?.obv_slope)
    let text = '—'
    let color = '#94a3b8'
    if (hasSlope) {
      if (slope > 0.02) {
        text = 'Rising ↑'
        color = '#22C55E'
      } else if (slope < -0.02) {
        text = 'Falling ↓'
        color = '#EF4444'
      } else {
        text = 'Flat →'
        color = '#94a3b8'
      }
    } else {
      const t = String(priceLatest?.obv_trend || '').toLowerCase()
      if (t === 'rising') {
        text = 'Rising ↑'
        color = '#22C55E'
      } else if (t === 'falling') {
        text = 'Falling ↓'
        color = '#EF4444'
      } else if (t === 'flat') {
        text = 'Flat →'
        color = '#94a3b8'
      }
    }
    return <span className="font-data text-lg font-bold tabular-nums" style={{ color }}>{text}</span>
  }, [priceLatest])

  const rsiValueNode = useMemo(() => {
    if (!(rsiVal > 0)) return <span className="font-data text-lg font-bold tabular-nums text-white">—</span>
    const n = rsiVal.toFixed(1)
    let label = 'Neutral'
    let color = '#94a3b8'
    if (rsiVal > 70) {
      label = 'Overbought'
      color = '#EF4444'
    } else if (rsiVal < 30) {
      label = 'Oversold'
      color = '#22C55E'
    }
    return (
      <span className="font-data text-lg font-bold tabular-nums" style={{ color }}>
        {n} — {label}
      </span>
    )
  }, [rsiVal])

  const rsVsNiftyNode = useMemo(() => {
    const raw = priceLatest?.rs_vs_nifty
    if (raw == null || raw === '' || !Number.isFinite(Number(raw))) {
      return <span className="font-data text-lg font-bold tabular-nums text-white">—</span>
    }
    const n = Number(raw)
    const formatted = `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
    let sub = 'Inline with market'
    let color = '#94a3b8'
    if (n > 0.5) {
      sub = 'Outperforming'
      color = '#22C55E'
    } else if (n < -0.5) {
      sub = 'Underperforming'
      color = '#EF4444'
    }
    return (
      <span className="font-data text-lg font-bold tabular-nums" style={{ color }}>
        {formatted} — {sub}
      </span>
    )
  }, [priceLatest?.rs_vs_nifty])

  const deliveryKeyTrend = useMemo(() => {
    const w = delivery.week_avg
    const m = delivery.month_avg
    if (!m || !deliveryRows.length) return { text: '—', color: '#94a3b8' }
    let label = 'Flat'
    if (w > m * 1.05) label = 'Rising'
    else if (w < m * 0.95) label = 'Falling'
    const color = label === 'Rising' ? '#22C55E' : label === 'Falling' ? '#EF4444' : '#94a3b8'
    const arrow = label === 'Rising' ? '↑' : label === 'Falling' ? '↓' : '→'
    return { text: `${label} ${arrow}`, color }
  }, [delivery, deliveryRows.length])

  const namedInvestorsSorted = useMemo(() => {
    const raw = Array.isArray(latestShareRow?.named_investors) ? [...latestShareRow.named_investors] : []
    return raw.sort((a, b) => valueNum(b?.pct ?? b?.holding_pct) - valueNum(a?.pct ?? a?.holding_pct))
  }, [latestShareRow])

  const promoterPct = valueNum(latestShareRow?.promoter_pct)
  const prevPromoterPct = valueNum(prevShareRow?.promoter_pct)
  const promoterDelta = promoterPct - prevPromoterPct
  const promoterTrendWord =
    promoterDelta > 0.05 ? 'Buying' : promoterDelta < -0.05 ? 'Selling' : 'Stable'
  const pledgePct = valueNum(latestShareRow?.promoter_pledge_pct)
  const shareAiInsight = typeof latestShareRow?.ai_insight === 'string' ? latestShareRow.ai_insight.trim() : ''
  const promoterOneLiner = shareAiInsight
    ? shareAiInsight.split(/(?<=[.!?])\s+/)[0] || shareAiInsight.slice(0, 140)
    : ''

  const fiiPct = valueNum(latestShareRow?.fii_pct)
  const prevFiiPct = valueNum(prevShareRow?.fii_pct)
  const fiiDelta = fiiPct - prevFiiPct

  const keyQuarters = useMemo(() => {
    const slice = financials.slice(0, 4)
    const flatNums = slice.flatMap((row) => [row?.revenue, row?.pat, row?.net_profit])
    const displayDivisor = inferCroreDisplayDivisor(flatNums)
    return slice.map((row, i) => {
      const next = financials[i + 1]
      const rev = valueNum(row?.revenue)
      const prevRev = valueNum(next?.revenue)
      const pat = valueNum(row?.pat ?? row?.net_profit)
      const margin = row?.margin != null ? valueNum(row.margin) : rev > 0 ? (pat / rev) * 100 : null
      const qoq =
        next && prevRev
          ? ((rev - prevRev) / prevRev) * 100
          : null
      return {
        id: row?.id ?? row?.quarter ?? i,
        quarter: row?.quarter_name || row?.quarter || '—',
        revenue: rev,
        pat,
        margin,
        qoq,
        displayDivisor,
      }
    })
  }, [financials])

  const ttmMetrics = useMemo(() => {
    const slice = financials.slice(0, 4)
    const revSum = slice.reduce((s, r) => s + valueNum(r?.revenue), 0)
    const patSum = slice.reduce((s, r) => s + valueNum(r?.pat ?? r?.net_profit), 0)
    const flatNums = slice.flatMap((r) => [r?.revenue, r?.pat, r?.net_profit])
    const displayDivisor = inferCroreDisplayDivisor(flatNums.length ? flatNums : [revSum, patSum])
    return { revSum, patSum, displayDivisor, quarterCount: slice.length }
  }, [financials])

  const maxAbsReturn = useMemo(() => {
    let m = 1
    for (const row of RETURN_PERIODS) {
      const p = tradingDayReturnPct(priceRowsDesc, row.days)
      if (p != null) m = Math.max(m, Math.abs(p))
    }
    return m
  }, [priceRowsDesc])

  async function addToWatchlist() {
    if (!user?.id) {
      showToast('Please sign in to add watchlist stocks.', 'error')
      return
    }
    if (!company?.id) {
      showToast('Company data not loaded yet.', 'info')
      return
    }
    if (inWatchlist === true) return

    setWatchlistSaving(true)
    try {
      const existing = await selectWatchMembership(user.id, company.id)
      if (existing?.data?.id) {
        showToast('Already in watchlist', 'info')
        setInWatchlist(true)
        return
      }

      const limit = CONFIG.limits.watchlistStocks
      const countRes = await countWatchlistForUser(user.id)
      const count = countRes.count ?? 0
      if (!isPaid && count >= limit) {
        showToast(`Watchlist limit reached (${limit} stocks).`, 'error')
        return
      }

      const currentRaw = priceLatest?.close
      const currentPrice = currentRaw != null && String(currentRaw).trim() !== '' ? Number(currentRaw) : NaN
      const nowIso = new Date().toISOString()
      const referenceDate = nowIso.split('T')[0]
      const sym = String(company.symbol || normalizedSymbol).toUpperCase().trim()

      const primary = {
        user_id: user.id,
        company_id: company.id,
        symbol: sym,
        added_at: nowIso,
        group_name: 'My Watchlist',
        reference_date: referenceDate,
      }
      if (Number.isFinite(currentPrice)) {
        primary.price_at_add = currentPrice
        primary.reference_price = currentPrice
      }

      const fallbackLegacy = {
        user_id: user.id,
        company_id: company.id,
        symbol: sym,
        created_at: nowIso,
        group_name: 'My Watchlist',
        reference_date: referenceDate,
      }
      if (Number.isFinite(currentPrice)) {
        fallbackLegacy.price_at_add = currentPrice
        fallbackLegacy.reference_price = currentPrice
      }

      const insertRes = await insertWatchlistRow(primary, fallbackLegacy)
      const insertErr = insertRes.error

      console.log('[watchlist insert]', insertRes.table, insertErr || 'ok')

      if (insertErr) {
        const msg = insertErr.message || ''
        if (insertErr.code === '23505' || msg.toLowerCase().includes('duplicate')) {
          showToast('Already in watchlist', 'info')
          setInWatchlist(true)
          return
        }
        console.error('[watchlist insert]', insertErr)
        showToast('Could not add to watchlist right now.', 'error')
        return
      }

      setInWatchlist(true)
      const priceLabel = Number.isFinite(currentPrice)
        ? `₹${currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
        : '—'
      showToast(`${sym} added to watchlist at ${priceLabel}`, 'success')
    } finally {
      setWatchlistSaving(false)
    }
  }

  function openShare() {
    setShareOpen(true)
  }

  function watchLineText() {
    const watch = String(changes?.watch_next || '').trim()
    return watch ? `WATCH: ${watch}` : 'WATCH: Monitor next quarter results.'
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(stockUrl)
      setMessage('Share link copied.')
    } catch {
      setMessage('Could not copy link.')
    } finally {
      setShareOpen(false)
    }
  }

  async function downloadPdf() {
    setPdfLoading(true)
    const limit = CONFIG.limits.downloadsMonthly
    const count = getDownloadCount()
    if (!isPaid && count >= limit) {
      setMessage(`Download limit reached (${limit}/month).`)
      setPdfLoading(false)
      return
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const payload = {
        symbol: normalizedSymbol,
        companyData: company || {},
        financials,
        shareholding,
        changes,
        signals: atAGlanceRows,
        delivery,
        swingConditions: swing,
      }

      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errText = await res.text()
        setMessage(errText || 'Could not generate PDF.')
        setPdfLoading(false)
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const d = new Date()
      const dd = String(d.getDate()).padStart(2, '0')
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const yyyy = d.getFullYear()
      const link = document.createElement('a')
      link.href = url
      link.download = `${normalizedSymbol}_PineX_${dd}${mm}${yyyy}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      incrementDownloadCount()
      setMessage('PDF downloaded successfully.')
    } catch {
      setMessage('Failed to generate PDF right now.')
    } finally {
      setPdfLoading(false)
    }
  }

  async function captureCardBlob() {
    const node = shareCardRef.current
    if (!node) return null
    const canvas = await html2canvas(node, { backgroundColor: null, scale: 2 })
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  }

  async function downloadShareCardImage() {
    try {
      const blob = await captureCardBlob()
      if (!blob) {
        setMessage('Could not create share card image.')
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${normalizedSymbol}_PineX.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage('Share card image downloaded.')
    } catch {
      setMessage('Could not download share card image.')
    }
  }

  async function shareOnWhatsapp() {
    await downloadShareCardImage()
    window.open(`https://wa.me/?text=${encodeURIComponent(`Check ${normalizedSymbol} on PineX: ${stockUrl}`)}`, '_blank')
    setShareOpen(false)
  }

  function shareOnTelegram() {
    const headline = String(changes?.headline || '').replaceAll('_', ' ') || 'Stock update'
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(stockUrl)}&text=${encodeURIComponent(headline)}`,
      '_blank',
    )
    setShareOpen(false)
  }

  const website = company?.website || null
  const bseUrl = company?.bse_code ? `https://www.bseindia.com/stock-share-price/stockreach.aspx?scripcode=${company.bse_code}` : null
  const screenerUrl = `https://www.screener.in/company/${normalizedSymbol}/consolidated/`

  const whatAccent = whatChangedAccent(changes)

  const revenueTtmStr = formatCroresCell(ttmMetrics.revSum, ttmMetrics.displayDivisor)
  const patTtmStr = formatCroresCell(ttmMetrics.patSum, ttmMetrics.displayDivisor)
  const promoterHint =
    prevShareRow != null
      ? `${promoterDelta > 0.01 ? '↑' : promoterDelta < -0.01 ? '↓' : '→'}${fmtSignedPct(promoterDelta)}`
      : null
  const fiiHint =
    prevShareRow != null
      ? `${fiiDelta > 0.01 ? '↑' : fiiDelta < -0.01 ? '↓' : '→'}${fmtSignedPct(fiiDelta)}`
      : null

  function renderStockRightGlance({ omitAtGlance = false } = {}) {
    const deliveryPeriods = deliveryRows.length
      ? [
          { label: '1 day', value: delivery.day1 },
          { label: '7 day', value: delivery.day7 },
          { label: '30 day', value: delivery.day30 },
          { label: '60 day', value: delivery.day60 },
          { label: '90 day', value: delivery.day90 },
        ]
      : []
    const maxBar = Math.max(
      delivery.day1,
      delivery.day7,
      delivery.day30,
      delivery.day60,
      delivery.day90,
      0.01,
    )

    return (
      <>
        {!omitAtGlance ? (
          <StockSectionCard title="At a glance">
            <div className="min-w-0">
              <AtAGlanceSignals rows={atAGlanceRows} />
            </div>
          </StockSectionCard>
        ) : null}
        <SwingConditions
          title="Swing setup"
          stage={priceLatest?.stage}
          ma30w={priceLatest?.ma30w}
          conditions={{
            is_stage2: swing?.condition_stage2,
            is_delivery_above_avg: swing?.condition_delivery_above_avg,
            is_near_ma20: swing?.condition_near_ma20,
            is_rsi_healthy: swing?.condition_rsi_healthy,
            is_volume_contracting: swing?.condition_volume_contracting,
            breakout_52w: swing?.breakout_52w,
            stage2_entered_this_week: swing?.stage2_new_this_week,
          }}
        />
        <StockSectionCard title="Sector context">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#64748B' }}>
            Sector
          </p>
          <p className="mt-1 m-0 text-[15px] font-semibold text-white">{company?.sector || '—'}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge
              status={sectorHealthBadgeStatus(sectorRow?.health)}
              text={getHealthDisplayLabel(normalizeSectorHealthKey(sectorRow?.health))}
            />
            <span style={{ color: TAB_MUTED, fontSize: 12 }}>
              {sectorRow?.stage2_count || 0} of {sectorRow?.total_companies || sectorRow?.total_count || 0} in Stage 2
            </span>
          </div>
          <p className="mt-4 m-0 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#64748B' }}>
            Sector companies this week
          </p>
          <div className="mt-2 space-y-1">
            {sectorPeersSidebar.length ? (
              sectorPeersSidebar.map((p) => (
                <Link
                  key={p.id}
                  to={`/stock/${p.symbol}`}
                  className="flex items-center gap-2 rounded-lg border border-solid py-2 pl-3 pr-2 transition-opacity hover:opacity-90"
                  style={{
                    borderColor: '#1E293B',
                    background: '#080f1a',
                    borderLeftWidth: 3,
                    borderLeftColor: p.isCurrent ? TAB_BORDER : 'transparent',
                  }}
                >
                  <span className="min-w-[3.5rem] font-semibold text-white">{p.symbol}</span>
                  <StagePill stage={p.stage} />
                  <span className="ml-auto font-data text-lg tabular-nums" style={{ color: '#e2e8f0' }}>
                    {p.trendArrow}
                  </span>
                </Link>
              ))
            ) : (
              <p className="m-0 text-[12px]" style={{ color: TAB_MUTED }}>
                No peer samples in this sector yet.
              </p>
            )}
          </div>
          {company?.sector ? (
            <Link
              to={`/sector/${encodeURIComponent(company.sector)}`}
              className="mt-4 inline-block text-[13px] font-medium"
              style={{ color: TAB_BORDER }}
            >
              See all {company.sector} stocks →
            </Link>
          ) : null}
        </StockSectionCard>
        <StockSectionCard
          title={
            <span className="flex items-center gap-1">
              <span>Delivery trend</span>
              <InfoHint id="delivery_pct" size={13} />
            </span>
          }
        >
          {!deliveryRows.length ? (
            <p className="m-0 text-[13px]" style={{ color: TAB_MUTED }}>
              No delivery data yet.
            </p>
          ) : (
            <>
              <div className="mt-1 grid grid-cols-2 gap-3 text-center sm:grid-cols-3 md:grid-cols-5">
                {deliveryPeriods.map((p) => (
                  <div key={p.label}>
                    <p
                      className="font-data text-xl font-bold tabular-nums leading-tight sm:text-2xl"
                      style={{ color: deliveryStrengthColor(p.value) }}
                    >
                      {Number.isFinite(p.value) ? p.value.toFixed(1) : '—'}%
                    </p>
                    <p className="mt-1 m-0 text-[10px] font-medium uppercase tracking-wide sm:text-[11px]" style={{ color: TAB_MUTED }}>
                      {p.label}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t pt-4 text-center" style={{ borderColor: CARD_BORDER }}>
                <p className="font-data text-xl font-bold tabular-nums leading-tight sm:text-2xl" style={{ color: deliveryTrendVisual.color }}>
                  {deliveryTrendVisual.text}
                </p>
                <p className="mt-1 m-0 text-[11px] font-medium uppercase tracking-wide" style={{ color: TAB_MUTED }}>
                  Trend
                </p>
              </div>
              {deliveryRatioPhrase ? (
                <p
                  className="mt-3 m-0 text-center text-[14px] font-semibold"
                  style={{ color: deliveryTodayColor }}
                >
                  {deliveryRatioPhrase}
                </p>
              ) : null}
              <div className="mt-4 space-y-2.5">
                {deliveryPeriods.map((p) => {
                  const pct = Number.isFinite(p.value) ? (p.value / maxBar) * 100 : 0
                  const barColor = deliveryStrengthColor(p.value)
                  return (
                    <div key={`bar-${p.label}`}>
                      <div className="mb-1 flex justify-between text-[11px]" style={{ color: TAB_MUTED }}>
                        <span>{p.label}</span>
                        <span className="font-data tabular-nums text-white">{Number.isFinite(p.value) ? `${p.value.toFixed(1)}%` : '—'}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full" style={{ background: '#1e293b' }}>
                        <div
                          className="h-full rounded-full transition-[width]"
                          style={{ width: `${pct}%`, background: barColor }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
              {delivery?.ai_insight ? (
                <p className="mt-4 m-0 border-t pt-3 text-[13px] italic leading-relaxed" style={{ color: '#cbd5e1', borderColor: CARD_BORDER }}>
                  {String(delivery.ai_insight).split(/(?<=[.!?])\s+/)[0] || delivery.ai_insight}
                </p>
              ) : null}
            </>
          )}
        </StockSectionCard>
      </>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen pb-10 text-[13px]" style={{ background: PAGE_BG, color: '#e2e8f0' }}>
        <div
          className="sticky top-0 z-40 border-b"
          style={{
            background: `${PAGE_BG}ee`,
            borderColor: CARD_BORDER,
            backdropFilter: 'blur(10px)',
          }}
        >
          <div className="mx-auto max-w-[1200px] px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton height={36} width={72} />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton height={22} width="55%" />
                <Skeleton height={14} width="40%" />
              </div>
              <Skeleton height={36} width={56} />
            </div>
            <div className="mt-3 flex gap-2 border-t pt-3" style={{ borderColor: CARD_BORDER }}>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={44} width={88} />
              ))}
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6 md:px-6">
          <Skeleton height={120} />
          <Skeleton height={200} />
          <Skeleton height={160} />
        </div>
      </div>
    )
  }

  if (!company) {
    return (
      <div className="min-h-screen px-4 py-10 text-[13px]" style={{ background: PAGE_BG, color: '#e2e8f0' }}>
        <Helmet>
          <title>{`${normalizedSymbol} — PineX`}</title>
        </Helmet>
        <Link to="/" className="inline-flex items-center gap-1 text-[13px]" style={{ color: TAB_BORDER }}>
          ← Back
        </Link>
        <p className="mt-6 text-base font-medium">Stock not found</p>
        <p className="mt-2 text-[13px]" style={{ color: TAB_MUTED }}>
          We could not load a company for symbol {normalizedSymbol}.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-8 text-[13px] leading-snug" style={{ background: PAGE_BG, color: '#e2e8f0' }}>
      <Helmet>
        <title>{`${company?.name || normalizedSymbol} (${normalizedSymbol}) — PineX`}</title>
        <meta
          name="description"
          content={String(company?.description || company?.description_ai || 'Stock analysis').slice(0, 120)}
        />
        <meta property="og:title" content={`${company?.name || normalizedSymbol} Analysis — PineX`} />
        <meta
          property="og:description"
          content={String(changes?.headline || '').replaceAll('_', ' ') || 'Stock update'}
        />
        <meta property="og:url" content={`https://pinex.in/stock/${normalizedSymbol}`} />
        <meta property="og:image" content="/og-default.png" />
        <meta name="twitter:card" content="summary" />
      </Helmet>

      <div
        className="border-b"
        style={{
          background: `${PAGE_BG}f2`,
          borderColor: CARD_BORDER,
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="shrink-0 text-[13px] font-medium" style={{ color: TAB_BORDER }}>
            ← Back
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={addToWatchlist}
              disabled={watchlistSaving || !company?.id || inWatchlist === true}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-opacity ${
                inWatchlist === true ? '' : 'hover:opacity-90'
              }`}
              style={
                inWatchlist === true
                  ? {
                      borderColor: TERMINAL_GREEN,
                      color: TERMINAL_GREEN,
                      background: 'rgba(0,200,5,0.1)',
                      cursor: 'default',
                      opacity: 1,
                    }
                  : { borderColor: CARD_BORDER, color: '#e2e8f0' }
              }
              title={inWatchlist === true ? 'In your watchlist' : 'Add to watchlist'}
              aria-label={inWatchlist === true ? 'In watchlist' : 'Add to watchlist'}
            >
              {inWatchlist === true ? '✓ Watching' : '+ Watchlist'}
            </button>
            <button
              type="button"
              onClick={openShare}
              className="rounded-lg px-2 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
              title="Share"
            >
              Share
            </button>
          </div>
        </div>
      </div>

      {message ? (
        <p className="mx-auto max-w-[1200px] px-4 pt-3 text-[13px]" style={{ color: TAB_MUTED }}>
          {message}
        </p>
      ) : null}

      <main className="mx-auto max-w-[1200px] px-4 pb-8 pt-6">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight text-white">{company?.name || normalizedSymbol}</h1>
          <p className="mt-1 truncate text-[13px]" style={{ color: TAB_MUTED }}>
            {normalizedSymbol} · {company?.sector || '—'} · {company?.exchange || 'NSE'}
          </p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-data text-[28px] font-bold tabular-nums tracking-tight text-white">
                {formatPrice(priceLatest?.close)}
              </span>
              <span
                className="font-data text-[15px] font-semibold tabular-nums"
                style={{ color: dayChangeUp ? '#34d399' : '#fb7185' }}
              >
                {dayChangeUp ? '+' : ''}
                {dayChangeRupees.toFixed(2)} ({fmtSignedPct(dayChangePct)})
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <StagePill stage={priceLatest?.stage} className="px-3 py-1.5 text-[11px] sm:text-[12px]" />
              <InfoHint id={stageInfoHintId(priceLatest?.stage)} size={13} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={addToWatchlist}
              disabled={watchlistSaving || !company?.id || inWatchlist === true}
              className={outlineLinkClass()}
              style={
                inWatchlist === true
                  ? {
                      borderColor: TERMINAL_GREEN,
                      color: TERMINAL_GREEN,
                      background: 'rgba(0,200,5,0.1)',
                      cursor: 'default',
                    }
                  : { borderColor: CARD_BORDER, color: '#e2e8f0', opacity: watchlistSaving ? 0.65 : 1 }
              }
            >
              {inWatchlist === true ? '✓ Watching' : '+ Watchlist'}
            </button>
            <button type="button" onClick={openShare} className={outlineLinkClass()} style={{ borderColor: CARD_BORDER, color: '#e2e8f0' }}>
              Share
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={pdfLoading}
              className={outlineLinkClass()}
              style={{ borderColor: CARD_BORDER, color: '#e2e8f0', opacity: pdfLoading ? 0.6 : 1 }}
            >
              {pdfLoading ? 'PDF…' : 'PDF'}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap" style={{ gap: 8 }}>
            {website ? (
              <a href={website} target="_blank" rel="noreferrer" className={outlineLinkClass()} style={{ borderColor: CARD_BORDER, color: '#94a3b8' }}>
                Website
              </a>
            ) : null}
            {bseUrl ? (
              <a href={bseUrl} target="_blank" rel="noreferrer" className={outlineLinkClass()} style={{ borderColor: CARD_BORDER, color: '#94a3b8' }}>
                BSE
              </a>
            ) : null}
            <a href={screenerUrl} target="_blank" rel="noreferrer" className={outlineLinkClass()} style={{ borderColor: CARD_BORDER, color: '#94a3b8' }}>
              Screener
            </a>
          </div>
        </div>

        <div className="grid min-w-0 lg:[grid-template-columns:70fr_30fr]" style={{ gap: 16, padding: 16 }}>
          <div className="min-w-0">
            <StockDetailChartColumn priceHistoryNewestFirst={priceHistory} deliveryRows={deliveryRows} />
          </div>
          <StockDetailRightRail
            stage={priceLatest?.stage}
            deliveryPct={deliveryRows.length ? delivery.today : null}
            pledgePct={pledgePct}
            companyDescription={company?.description || company?.description_ai || ''}
            descriptionPending={company?.description_approved === false}
            shareAiInsight={shareAiInsight}
            deliveryAiInsight={typeof delivery?.ai_insight === 'string' ? delivery.ai_insight.trim() : ''}
            articles={stockNewsArticles}
          />
        </div>

        <div className="mt-8 min-w-0 space-y-8">
          <AnalystConsensusSummary company={company} />

          <section
            className="min-w-0 max-w-full overflow-hidden rounded-lg border border-solid"
            style={{
              background: CARD_BG,
              borderColor: CARD_BORDER,
              borderLeftWidth: 4,
              borderLeftColor: whatAccent,
              padding: '16px',
              marginBottom: '16px',
            }}
          >
            <SectionTitle>What changed</SectionTitle>
            <div className="min-w-0">
              <WhatChanged changes={changes} />
            </div>
          </section>

          <StockSectionCard title="Signals" style={{ marginTop: '8px', marginBottom: '16px' }}>
            <div className="min-w-0">
              <AtAGlanceSignals rows={atAGlanceRows} />
            </div>
          </StockSectionCard>

          <StockSectionCard title="Key metrics" style={{ marginTop: '8px', marginBottom: '16px' }}>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <KeyMetricCell
                label="Revenue (TTM)"
                labelExtra={<InfoHint id="revenue_ttm" size={12} />}
                value={ttmMetrics.quarterCount ? revenueTtmStr : '—'}
              />
              <KeyMetricCell
                label="PAT (TTM)"
                labelExtra={<InfoHint id="pat_ttm" size={12} />}
                value={ttmMetrics.quarterCount ? patTtmStr : '—'}
              />
              <KeyMetricCell
                label="Promoter Hold"
                labelExtra={<InfoHint id="promoter_pct" size={12} />}
                value={latestShareRow ? formatPct(promoterPct) : '—'}
                hint={promoterHint}
              />
              <KeyMetricCell label="FII Hold" value={latestShareRow ? formatPct(fiiPct) : '—'} hint={fiiHint} />
              <KeyMetricCell
                label="Delivery (30d)"
                labelExtra={<InfoHint id="delivery_pct" size={12} />}
                valueNode={
                  deliveryRows.length ? (
                    <p className="font-data text-lg font-bold tabular-nums">
                      <span className="text-white">{delivery.month_avg.toFixed(1)}% avg </span>
                      <span style={{ color: deliveryKeyTrend.color }}>{deliveryKeyTrend.text}</span>
                    </p>
                  ) : (
                    <p className="font-data text-lg font-bold tabular-nums text-white">—</p>
                  )
                }
              />
              <KeyMetricCell
                label="Stage"
                valueNode={<StagePill stage={priceLatest?.stage} className="rounded-md px-2.5 py-1 text-[11px]" />}
              />
              <KeyMetricCell label="OBV trend" labelExtra={<InfoHint id="obv" size={12} />} valueNode={obvTrendNode} />
              <KeyMetricCell label="RSI" valueNode={rsiValueNode} />
              <KeyMetricCell
                label="RS vs Nifty (1Y)"
                labelExtra={<InfoHint id="rs_vs_nifty" size={12} />}
                valueNode={rsVsNiftyNode}
              />
            </div>
          </StockSectionCard>

          {renderStockRightGlance({ omitAtGlance: true })}
        </div>

        <nav
          className="mt-10 w-full"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 40,
            background: STICKY_TAB_BG,
            borderBottom: `1px solid ${STICKY_TAB_BORDER}`,
          }}
        >
          <div className="mx-auto flex w-full max-w-[1200px]">
            {MAIN_TABS.map((t) => {
              const on = activeTab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTabChange(t.id)}
                  className="min-h-[44px] flex-1 border-none bg-transparent px-2 text-[13px] font-semibold"
                  style={{
                    padding: '14px 0',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: 'none',
                    color: on ? '#F1F5F9' : TAB_MUTED,
                    border: 'none',
                    borderBottom: on ? '3px solid #38BDF8' : '3px solid transparent',
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </nav>

        <div
          ref={tabContentRef}
          style={{ scrollMarginTop: 52 }}
          className="outline-none"
        >
          <div key={activeTab} className="stock-detail-tab-panel mt-6 flex flex-col gap-4 md:gap-6">
          {activeTab === 'ownership' ? (
            <>
              <section className={`relative ${cardClass('min-w-0 max-w-full overflow-hidden')}`} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-[13px] font-semibold text-white">Shareholding trend</h2>
                  <ExplainButton context="Explain this shareholding pattern simply." symbol={normalizedSymbol} />
                </div>
                {shareholding?.length ? (
                  <ShareholdingTrend data={shareholding} />
                ) : (
                  <p style={{ color: TAB_MUTED }}>No shareholding data yet.</p>
                )}
                {shareAiInsight ? (
                  <p className="mt-3 text-[13px] italic leading-relaxed" style={{ color: TAB_MUTED }}>
                    {shareAiInsight}
                  </p>
                ) : null}
                {shareholdingWarning ? (
                  <div className="absolute bottom-3 right-4">
                    <DataWarning message={shareholdingWarning} />
                  </div>
                ) : null}
              </section>

              <section className={cardClass()} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <h2 className="text-[13px] font-semibold text-white">Named investors</h2>
                {namedInvestorsSorted.length ? (
                  <ul className="mt-3 divide-y" style={{ borderColor: CARD_BORDER }}>
                    {namedInvestorsSorted.map((inv, idx) => {
                      const ch = inv?.change
                      const chStr = ch != null && ch !== '' ? String(ch) : ''
                      let arrow = ''
                      let chColor = TAB_MUTED
                      if (chStr && /^[+-]?\d/.test(chStr)) {
                        const n = Number(String(chStr).replace(/[^0-9.-]/g, ''))
                        if (Number.isFinite(n)) {
                          arrow = n >= 0 ? '↑' : '↓'
                          chColor = n >= 0 ? '#34d399' : '#fb7185'
                        }
                      }
                      return (
                        <li
                          key={`${inv?.name}-${idx}`}
                          className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]"
                        >
                          <span className="min-w-0 flex-1 truncate" style={{ color: '#cbd5e1' }}>
                            {String(inv?.name || inv?.investor || '—')}
                          </span>
                          <span className="font-data shrink-0 tabular-nums text-white">
                            {formatPct(inv?.pct ?? inv?.holding_pct)}
                          </span>
                          <span className="font-data shrink-0 tabular-nums" style={{ color: chColor }}>
                            {chStr ? `${arrow} ${chStr}`.trim() : '—'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px]" style={{ color: TAB_MUTED }}>
                    No named investors above 1% threshold this quarter
                  </p>
                )}
                <p className="mt-3 text-[12px]" style={{ color: TAB_MUTED }}>
                  Source: BSE quarterly filings
                </p>
              </section>

              <section className={cardClass()} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <h2 className="m-0 flex items-center gap-1 text-[13px] font-semibold text-white">
                  <span>Promoters</span>
                  <InfoHint id="promoter_pct" size={13} />
                </h2>
                <div className="mt-3 flex flex-wrap items-end gap-4">
                  <p className="font-data text-4xl font-bold tabular-nums text-white">{formatPct(promoterPct)}</p>
                  <span className="text-2xl leading-none" style={{ color: promoterDelta >= 0 ? '#34d399' : '#fb7185' }}>
                    {promoterDelta > 0 ? '↑' : promoterDelta < 0 ? '↓' : '→'}
                  </span>
                  <span
                    className="font-data text-lg font-semibold tabular-nums"
                    style={{ color: promoterDelta >= 0 ? '#34d399' : '#fb7185' }}
                  >
                    {fmtSignedPct(promoterDelta)} QoQ
                  </span>
                </div>
                <p className="mt-3 text-[14px] font-medium" style={{ color: '#cbd5e1' }}>
                  {promoterTrendWord}
                </p>
                {pledgePct > 0 ? (
                  <p className="mt-2 flex flex-wrap items-center gap-1 text-[13px] text-amber-300">
                    <InfoHint id="promoter_pledge" size={12} />
                    <span>Pledged: {formatPct(pledgePct)}</span>
                  </p>
                ) : null}
                {promoterOneLiner ? (
                  <p className="mt-3 text-[13px] leading-relaxed" style={{ color: '#94a3b8' }}>
                    {promoterOneLiner}
                    {shareAiInsight.length > promoterOneLiner.length ? '…' : ''}
                  </p>
                ) : null}
              </section>
            </>
          ) : null}

          {activeTab === 'technicals' ? (
            <>
              <section className={cardClass('min-w-0 max-w-full overflow-hidden')} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <h2 className="text-[13px] font-semibold text-white">Price trend (90D)</h2>
                <div className="mt-3 max-w-full overflow-hidden">
                  <MiniPriceChart priceHistory={priceHistory} latestClose={latestClose} ma150={ma150} />
                </div>
              </section>

              <section className={cardClass()} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <h2 className="text-[13px] font-semibold text-white">Price performance</h2>
                <div className="mt-3 min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[300px] border-collapse text-[13px]">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                        <th className="pb-2 text-left font-semibold text-white">Period</th>
                        <th className="pb-2 text-left font-semibold text-white">Stock</th>
                        <th className="pb-2 text-left font-semibold text-white">vs Nifty 500</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RETURN_PERIODS.map((row) => {
                        const stockPct = tradingDayReturnPct(priceRowsDesc, row.days)
                        const barW = stockPct == null ? 0 : Math.min(100, (Math.abs(stockPct) / maxAbsReturn) * 100)
                        const pos = stockPct != null && stockPct >= 0
                        return (
                          <tr key={row.label} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                            <td className="py-2.5 pr-2" style={{ color: '#cbd5e1' }}>
                              {row.label}
                            </td>
                            <td className="py-2.5">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                                <span
                                  className="font-data inline-block min-w-[4.5rem] tabular-nums font-medium"
                                  style={{ color: stockPct == null ? TAB_MUTED : pos ? '#34d399' : '#fb7185' }}
                                >
                                  {fmtSignedPct(stockPct)}
                                </span>
                                <div
                                  className="h-1.5 max-w-[140px] overflow-hidden rounded-full sm:max-w-[100px]"
                                  style={{ background: '#1e293b' }}
                                >
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${barW}%`,
                                      background: pos ? '#22c55e' : '#f43f5e',
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="font-data py-2.5 tabular-nums" style={{ color: TAB_MUTED }}>
                              --
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[12px] leading-snug" style={{ color: TAB_MUTED }}>
                  * Benchmark comparison coming soon
                </p>
              </section>

              <section className={cardClass('min-w-0 max-w-full overflow-hidden')} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="m-0 flex items-center gap-1 text-[13px] font-semibold text-white">
                    <span>Delivery Analysis</span>
                    <InfoHint id="delivery_pct" size={13} />
                  </h2>
                  <ExplainButton
                    context="Explain current delivery data and how unusual it is."
                    symbol={normalizedSymbol}
                  />
                </div>
                <DeliveryPanel
                  embedded
                  hideExplain
                  companyId={company?.id || ''}
                  deliveryRows={deliveryRows}
                  symbol={normalizedSymbol}
                  latestStage={priceLatest?.stage}
                />
              </section>

              <section className={cardClass()} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <h2 className="text-[13px] font-semibold text-white">Stage &amp; trend</h2>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: CARD_BORDER }}>
                    <span className="flex items-center gap-0.5" style={{ color: TAB_MUTED }}>
                      Stage
                      <InfoHint id={stageInfoHintId(priceLatest?.stage)} size={12} />
                    </span>
                    <StagePill stage={priceLatest?.stage} className="rounded-md px-2.5 py-1 text-[11px]" />
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: CARD_BORDER }}>
                    <span className="flex items-center gap-0.5" style={{ color: TAB_MUTED }}>
                      OBV
                      <InfoHint id="obv" size={12} />
                    </span>
                    <span
                      className="rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                      style={obvBadgeStyle(priceLatest?.obv_trend)}
                    >
                      {priceLatest?.obv_trend ? String(priceLatest.obv_trend).toUpperCase() : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: CARD_BORDER }}>
                    <span style={{ color: TAB_MUTED }}>vs MA20</span>
                    <span
                      className="rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                      style={maBadgeStyle(ma20 ? latestClose >= ma20 : null)}
                    >
                      {ma20 ? (latestClose >= ma20 ? 'ABOVE' : 'BELOW') : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: CARD_BORDER }}>
                    <span style={{ color: TAB_MUTED }}>vs MA50</span>
                    <span
                      className="rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                      style={maBadgeStyle(ma50 ? latestClose >= ma50 : null)}
                    >
                      {ma50 ? (latestClose >= ma50 ? 'ABOVE' : 'BELOW') : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: TAB_MUTED }}>vs MA150</span>
                    <span
                      className="rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                      style={maBadgeStyle(ma150 ? latestClose >= ma150 : null)}
                    >
                      {ma150 ? (latestClose >= ma150 ? 'ABOVE' : 'BELOW') : '—'}
                    </span>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {activeTab === 'financials' ? (
            <>
              <section className={`relative ${cardClass('min-w-0 max-w-full overflow-hidden')}`} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <span className="m-0 font-bold" style={SECTION_TITLE_STYLE}>
                    Revenue &amp; profit
                  </span>
                  <ExplainButton context="Explain revenue and PAT trend in plain language." symbol={normalizedSymbol} />
                </div>
                {financials?.length ? (
                  <RevenueChart chartHeight={180} data={[...financials].reverse()} />
                ) : (
                  <p style={{ color: TAB_MUTED }}>No financial data yet.</p>
                )}
                {financialWarning ? (
                  <div className="absolute bottom-3 right-4">
                    <DataWarning message={financialWarning} />
                  </div>
                ) : null}
              </section>

              <section className={cardClass('min-w-0 max-w-full overflow-hidden')} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <FinancialsCalculatedMetricsGrid financials={financials} priceLatest={priceLatest} />
              </section>

              <section className={cardClass()} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <ShareholdingSnapshotTab latest={sortedShareholdingRaw[0]} prev={sortedShareholdingRaw[1]} />
              </section>

              <section className={cardClass()} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <SectionTitle>Key metrics</SectionTitle>
                {keyQuarters.length ? (
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[320px] border-collapse text-[13px]">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                          <th className="pb-2 text-left font-semibold text-white">Quarter</th>
                          <th className="pb-2 text-right font-semibold text-white">Revenue</th>
                          <th className="pb-2 text-right font-semibold text-white">PAT</th>
                          <th className="pb-2 text-right font-semibold text-white">Margin</th>
                          <th className="pb-2 text-right font-semibold text-white">vs Last Q</th>
                        </tr>
                      </thead>
                      <tbody>
                        {keyQuarters.map((q) => {
                          const marginNum = valueNum(q.margin)
                          const marginStyle =
                            marginNum > 15 ? '#34d399' : marginNum >= 10 ? '#fbbf24' : marginNum != null ? '#fb7185' : TAB_MUTED
                          const qoqUp = q.qoq != null && q.qoq >= 0
                          return (
                            <tr key={q.id} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                              <td className="py-2.5 pr-2" style={{ color: '#cbd5e1' }}>
                                {q.quarter}
                              </td>
                              <td className="font-data py-2.5 text-right tabular-nums text-white">
                                {formatCroresCell(q.revenue, q.displayDivisor)}
                              </td>
                              <td className="font-data py-2.5 text-right tabular-nums text-white">
                                {formatCroresCell(q.pat, q.displayDivisor)}
                              </td>
                              <td
                                className="font-data py-2.5 text-right tabular-nums font-medium"
                                style={{ color: marginStyle }}
                              >
                                {q.margin != null ? `${marginNum.toFixed(1)}%` : '—'}
                              </td>
                              <td
                                className="font-data py-2.5 text-right tabular-nums"
                                style={{
                                  color: q.qoq == null ? TAB_MUTED : qoqUp ? '#34d399' : '#fb7185',
                                }}
                              >
                                {q.qoq == null ? (
                                  '—'
                                ) : (
                                  <>
                                    <span className="mr-1">{qoqUp ? '↑' : '↓'}</span>
                                    {fmtSignedPct(q.qoq)}
                                  </>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2" style={{ color: TAB_MUTED }}>
                    No quarterly metrics available.
                  </p>
                )}
                <p className="mt-2 text-[12px]" style={{ color: TAB_MUTED }}>
                  Units: ₹ Cr (approx., from reported figures)
                </p>
              </section>

              <section className={cardClass()} style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                <SectionTitle>Sector peers</SectionTitle>
                {peers.length ? (
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[300px] border-collapse text-[13px]">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                          <th className="pb-2 text-left font-semibold text-white">Company</th>
                          <th className="pb-2 text-left font-semibold text-white">Stage</th>
                          <th className="pb-2 text-right font-semibold text-white">Delivery %</th>
                          <th className="pb-2 text-right font-semibold text-white">Rev. trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peers.map((p) => (
                          <tr key={p.id} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                            <td className="py-2.5">
                              <Link
                                to={`/stock/${p.symbol}`}
                                className="block font-medium text-white underline-offset-2 hover:underline"
                                style={{ color: TAB_BORDER }}
                              >
                                {p.name || p.symbol}
                              </Link>
                            </td>
                            <td className="py-2.5">
                              <StagePill stage={p.stage} />
                            </td>
                            <td className="font-data py-2.5 text-right tabular-nums text-white">
                              {p.deliveryPct ? `${p.deliveryPct.toFixed(2)}%` : '—'}
                            </td>
                            <td
                              className="font-data py-2.5 text-right tabular-nums"
                              style={{
                                color:
                                  p.revenueTrendPct == null
                                    ? TAB_MUTED
                                    : p.revenueTrendPct >= 0
                                      ? '#34d399'
                                      : '#fb7185',
                              }}
                            >
                              {p.revenueTrendPct == null ? '—' : fmtSignedPct(p.revenueTrendPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2" style={{ color: TAB_MUTED }}>
                    Peer comparison appears when other companies exist in this sector.
                  </p>
                )}
              </section>
            </>
          ) : null}
          </div>
        </div>
      </main>

      <footer
        className="mx-auto mt-8 max-w-[1200px] rounded-[12px] border px-4 py-4 text-[12px] leading-relaxed md:px-6"
        style={{ borderColor: CARD_BORDER, background: CARD_BG, color: TAB_MUTED }}
      >
        <p>Data: NSE, BSE, public filings.</p>
        <p className="mt-1">AI summaries for information only.</p>
        <p className="mt-1">Not investment advice.</p>
        <p className="mt-2 font-data tabular-nums">
          Last updated: {new Date(latestTimestamp).toLocaleString()} · sessions: {historyCount}
        </p>
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12px] underline-offset-2 hover:underline"
          style={{ color: TAB_BORDER }}
          onClick={() => {
            window.location.href = `mailto:support@pinex.in?subject=Data%20error%20report%20-${normalizedSymbol}`
          }}
        >
          🚩 Report error
        </button>
      </footer>

      <Modal isOpen={shareOpen} onClose={() => setShareOpen(false)} title="Share this stock">
        <p className="text-sm" style={{ color: C.textMuted }}>
          Choose an option:
        </p>
        <div className="mt-3 grid gap-2">
          <button type="button" onClick={copyLink} className={`${surfaceButtonClass} text-left`} style={surfaceButtonStyle}>
            Option A: Copy link
          </button>
          <button type="button" onClick={shareOnWhatsapp} className={`${surfaceButtonClass} text-left`} style={surfaceButtonStyle}>
            Option B: Share on WhatsApp
          </button>
          <button type="button" onClick={shareOnTelegram} className={`${surfaceButtonClass} text-left`} style={surfaceButtonStyle}>
            Option C: Share on Telegram
          </button>
          <button
            type="button"
            onClick={downloadShareCardImage}
            className={`${surfaceButtonClass} text-left`}
            style={surfaceButtonStyle}
          >
            Option D: Download card image
          </button>
        </div>
        <p className="mt-3 break-all rounded border px-2 py-1 text-xs" style={{ borderColor: CARD_BORDER, color: '#e2e8f0' }}>
          {stockUrl}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => setShareOpen(false)} className={surfaceButtonClass} style={surfaceButtonStyle}>
            Close
          </button>
        </div>
      </Modal>

      <div className="pointer-events-none fixed -left-[9999px] -top-[9999px] opacity-0">
        <div ref={shareCardRef}>
          <ShareCard
            companyName={company?.name || normalizedSymbol}
            symbol={normalizedSymbol}
            headline={changes?.headline}
            headlineSeverity={changes?.headline_severity}
            signals={atAGlanceRows}
            swingCount={Number(swing?.conditions_met) || 0}
            deliveryPct={delivery?.today}
            deliveryVs={delivery?.vs_30d_avg}
            watchText={watchLineText()}
            quarter={changes?.current_quarter || financials?.[0]?.quarter || ''}
          />
        </div>
      </div>
    </div>
  )
}
