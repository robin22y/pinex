import { useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import DailyScanner from '../components/DailyScanner'
import HeatMap from '../components/HeatMap'
import HomeNavbar from '../components/home/HomeNavbar'
import Modal from '../components/ui/Modal'
import { useAuth } from '../context'
import { usePlan } from '../hooks/usePlan'
import { signInWithGoogle } from '../lib/auth'
import { getHealthBg, getHealthColor, getHealthDisplayLabel, normalizeSectorHealthKey } from '../lib/sectorHealth'
import { normalizeStageKey, stageBadge } from '../lib/stageUi'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

const SECTOR_CHANGE_TAB_KEYS = ['1d', '1w', '1m', '3m']
const SECTOR_TAB_TO_COL = Object.freeze({
  '1d': 'change_1d',
  '1w': 'change_1w',
  '1m': 'change_1m',
  '3m': 'change_3m',
})

const PAGE_BG = '#080C14'
const CARD_BG = '#0D1525'
const BORDER = '#1E293B'
const MUTED = '#64748B'
const TEXT = '#F1F5F9'
const BLUE = '#38BDF8'

/** --- helpers --- */
function timeOfDayWord() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function firstToken(name) {
  const s = String(name || 'there').trim().split(/\s+/)[0]
  return s || 'there'
}

function pctOrDash(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

function priceChgFmt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function deliveryMetricColor(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return MUTED
  if (n > 50) return '#34D399'
  if (n < 35) return '#F87171'
  return '#FBBF24'
}

function stageLabel(stage) {
  return stageBadge(stage).label
}

function stageColor(stage) {
  return stageBadge(stage).color
}

function obvTxt(t) {
  const s = String(t || '').toLowerCase()
  if (s === 'rising') return 'OBV trend: rising'
  if (s === 'falling') return 'OBV trend: falling'
  if (s === 'flat') return 'OBV trend: flat'
  return t ? `OBV: ${t}` : 'OBV: —'
}

function trendSecondary(t) {
  const s = String(t || '').toLowerCase()
  if (s === 'rising') return '↑ 30d delivery rising'
  if (s === 'falling') return '↓ 30d delivery falling'
  return '→ 30d delivery flat'
}

function pickSeverity(row) {
  const hs = row?.headline_severity
  if (hs != null && String(hs).trim()) return String(hs).toLowerCase()
  const ft = Array.isArray(row?.changes) ? row.changes.find((c) => c?.is_first_time) : null
  return ft?.severity ? String(ft.severity).toLowerCase() : 'medium'
}

function severityLabelStyles(severity) {
  const s = String(severity || 'low').toLowerCase()
  if (s === 'high') return { bg: '#2a1010', color: '#F87171' }
  if (s === 'medium') return { bg: '#1f1500', color: '#FBBF24' }
  return { bg: '#111620', color: '#94a3b8' }
}

function decorateSignalRow(r, map) {
  const id = r.company_id
  const c = map[id] || {}
  return {
    company_id: id,
    symbol: c.symbol || '',
    name: c.name || c.symbol || 'Unknown',
    sector: c.sector || '',
    delivery_trend_30d: r.delivery_trend_30d,
    avg_delivery_30d: r.avg_delivery_30d,
    price_change_30d: r.price_change_30d,
    price_change_7d: r.price_change_7d,
  }
}

const DELIVERY_DECLINING_SUBTITLE =
  'Excludes Stage 2 breakouts where volume increase dilutes delivery %'

/**
 * `delivery_signals` falling + latest `price_data.stage` / price_change_30d.
 * Drops Stage 2 + positive 30d price, drops strong rallies (>15% 30d), keeps Stage 3/4
 * OR falling delivery with price down more than 5%.
 */
function passesDeliveryPossibleWeaknessFilter(sigRow, priceRow) {
  if (!priceRow) return false
  if (String(sigRow?.delivery_trend_30d || '').toLowerCase() !== 'falling') return false
  const pc = Number(sigRow.price_change_30d)
  const stage = normalizeStageKey(priceRow.stage)

  if (stage === 'stage2' && Number.isFinite(pc) && pc > 0) return false
  if (Number.isFinite(pc) && pc > 15) return false

  if (stage === 'stage3' || stage === 'stage4') return true
  if (Number.isFinite(pc) && pc < -5) return true
  return false
}

/** --- Presentational --- */
function StockCard({ navigate, sector, name, symbol, mainMetric, metricColor = TEXT, secondaryMetric }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/stock/${symbol}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(`/stock/${symbol}`)
      }}
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: '12px',
        padding: '16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        minHeight: '120px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#334155'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = BORDER
      }}
    >
      <div style={{ fontSize: '12px', color: MUTED, marginBottom: '4px' }}>{sector || '—'}</div>
      <div
        style={{
          fontSize: '14px',
          fontWeight: 700,
          color: TEXT,
          marginBottom: '8px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: 'inline-block',
          background: '#0C2340',
          color: BLUE,
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '20px',
          marginBottom: '12px',
          width: 'fit-content',
        }}
      >
        {symbol}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: metricColor, marginTop: 'auto' }}>{mainMetric}</div>
      <div style={{ fontSize: '11px', color: MUTED, marginTop: '4px' }}>{secondaryMetric}</div>
    </div>
  )
}

function LockedCard() {
  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: '12px',
        padding: '16px',
        minHeight: '120px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        filter: 'blur(4px)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
      aria-hidden
    >
      <div style={{ fontSize: '20px' }}>🔒</div>
      <div style={{ fontSize: '11px', color: MUTED, marginTop: '8px' }}>Sign up to unlock</div>
    </div>
  )
}

function SignupPromptRow() {
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        textAlign: 'center',
        padding: '16px',
        background: CARD_BG,
        borderRadius: '12px',
        border: `1px solid ${BORDER}`,
        marginTop: '8px',
      }}
    >
      <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '12px' }}>Sign up free to see all stocks</div>
      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        style={{
          background: 'white',
          color: '#0A0E17',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 20px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          margin: '0 auto',
        }}
      >
        <img src="https://www.google.com/favicon.ico" width={16} height={16} alt="" />
        Continue with Google
      </button>
    </div>
  )
}

function SkeletonCell() {
  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: '12px',
        minHeight: '120px',
        height: '100%',
        animation: 'homeSk 1.1s ease-in-out infinite',
        opacity: 0.75,
      }}
    />
  )
}

/** Nifty sectors: %-change styling for card + left border */
function sectorChangeStyle(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return { color: '#94A3B8', border: '#475569' }
  if (n > 3) return { color: '#22C55E', border: '#22C55E' }
  if (n > 1) return { color: '#86EFAC', border: '#4ADE80' }
  if (n >= -1) return { color: '#64748B', border: '#475569' }
  if (n >= -3) return { color: '#FCA5A5', border: '#F87171' }
  return { color: '#EF4444', border: '#EF4444' }
}

function vixLevelLabel(level) {
  const s = String(level || '').toLowerCase()
  if (s === 'low') return { text: 'Calm', color: '#22C55E' }
  if (s === 'moderate') return { text: 'Moderate', color: '#94A3B8' }
  if (s === 'elevated') return { text: 'Elevated', color: '#F59E0B' }
  if (s === 'high' || s === 'extreme') return { text: s === 'extreme' ? 'Extreme Fear' : 'High', color: '#EF4444' }
  return { text: '—', color: '#94A3B8' }
}

/** Tier colours (Strong / Mixed / Weak) for score badge only; text remains `score · market_phase`. */
function healthScoreBadgeStyle(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return { bg: '#111620', color: '#94A3B8', border: BORDER }
  if (n >= 60) return { bg: '#052E16', color: '#22C55E', border: '#166534' }
  if (n >= 45) return { bg: '#1C1A00', color: '#F59E0B', border: '#92400e' }
  return { bg: '#1C0000', color: '#EF4444', border: '#991B1B' }
}

function MarketHealthSkeleton() {
  return (
    <div
      aria-hidden
      style={{
        height: 120,
        borderRadius: 16,
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        animation: 'homePulseSkeleton 2s ease-in-out infinite',
        marginBottom: 24,
      }}
    />
  )
}

function SectorStrengthSkeletonGrid() {
  return (
    <div
      className="home-sector-strength-sk"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 10,
        marginBottom: 24,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={`ssk-${i}`}
          aria-hidden
          style={{
            height: 100,
            borderRadius: 12,
            background: CARD_BG,
            border: `1px solid ${BORDER}`,
            animation: 'homePulseSkeleton 2s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  )
}

function MarketHealthPanel({ data }) {
  const score = Number(data.market_health_score)
  const badge = healthScoreBadgeStyle(score)

  const niftyVal = Number(data.nifty_close)
  const niftyStr = Number.isFinite(niftyVal)
    ? Math.round(niftyVal).toLocaleString('en-IN')
    : '—'

  const niftyVsAth = Number(data.nifty_pct_from_ath)
  const niftyChgKeys = ['nifty_change_pct', 'nifty_1d_change_pct', 'nifty_daily_change_pct']
  let niftyDayChg = null
  for (const k of niftyChgKeys) {
    const v = data[k]
    if (v != null && Number.isFinite(Number(v))) {
      niftyDayChg = Number(v)
      break
    }
  }

  const vixNum = Number(data.india_vix)
  const vixStr = Number.isFinite(vixNum) ? vixNum.toFixed(1) : '—'
  const vixLv = vixLevelLabel(data.vix_level)

  const stage2c = Number(data.stage2_count)
  const stage2p = Number(data.stage2_pct)

  const wow = data.stage2_pct_wow
  const wowNum = Number(wow)
  const wowLine =
    wow != null && Number.isFinite(wowNum) ? (
      <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600, color: wowNum >= 0 ? '#22C55E' : '#EF4444' }}>
        {wowNum >= 0 ? '↑' : '↓'} {wowNum >= 0 ? '+' : ''}
        {wowNum.toFixed(1)}% this week
      </div>
    ) : null

  const highs = Number(data.new_52w_highs)
  const highsColor =
    highs > 30 ? '#22C55E' : highs >= 10 ? '#F59E0B' : '#EF4444'

  const lows = Number(data.new_52w_lows)
  const lowsColor = lows > 30 ? '#EF4444' : lows >= 10 ? '#F59E0B' : '#22C55E'

  const ma150p = Number(data.above_ma150_pct)
  const ma150Color = ma150p > 55 ? '#22C55E' : ma150p >= 35 ? '#F59E0B' : '#EF4444'

  const s4count = Number(data.stage4_count)
  const s4pct = Number(data.stage4_pct)
  const stage4StatColor =
    s4pct > 35 ? '#EF4444' : s4pct > 25 ? '#F59E0B' : '#22C55E'

  const divActive = Boolean(data.divergence_active)
  const divSevere = String(data.divergence_severity || '').toLowerCase() === 'severe'

  const statBoxStyle = {
    background: '#080C14',
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    padding: '10px 14px',
  }

  return (
    <div
      style={{
        background: '#0D1525',
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: '20px 24px',
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: MUTED }}>
          MARKET HEALTH
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: 20,
            background: badge.bg,
            color: badge.color,
            border: `1px solid ${badge.border}`,
          }}
        >
          {`${Number.isFinite(score) ? `${Math.round(score)}/100` : '—'} · ${String(data.market_phase || '—')}`}
        </span>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 20, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px', minWidth: 120 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: MUTED }}>
            NIFTY 50
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: TEXT, marginTop: 6 }} className="font-data tabular-nums">
            {niftyStr}
          </div>
          {niftyDayChg != null ? (
            <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: niftyDayChg >= 0 ? '#22C55E' : '#EF4444' }}>
              {niftyDayChg >= 0 ? '+' : ''}
              {niftyDayChg.toFixed(1)}%
            </div>
          ) : null}
          {data.nifty_near_ath === true && Number.isFinite(niftyVsAth) ? (
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
              {niftyVsAth >= 0 ? '+' : ''}
              {niftyVsAth.toFixed(1)}% from ATH
            </div>
          ) : null}
        </div>
        <div style={{ flex: '1 1 140px', minWidth: 120 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: MUTED }}>
            INDIA VIX
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: TEXT, marginTop: 6 }} className="font-data tabular-nums">
            {vixStr}
          </div>
          <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: vixLv.color }}>
            {vixLv.text}
          </div>
        </div>
        <div style={{ flex: '1 1 140px', minWidth: 120 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: MUTED }}>
            STAGE 2 STOCKS
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: TEXT, marginTop: 6 }} className="font-data tabular-nums">
            {Number.isFinite(stage2c) ? stage2c : '—'}
          </div>
          <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: '#94A3B8' }}>
            {Number.isFinite(stage2p) ? `${stage2p.toFixed(1)}%` : '—'}
          </div>
          {wowLine}
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div style={statBoxStyle}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: MUTED }}>52W highs</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: highsColor }} className="font-data tabular-nums">
            {Number.isFinite(highs) ? highs : '—'}
          </div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: MUTED }}>52W lows</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: lowsColor }} className="font-data tabular-nums">
            {Number.isFinite(lows) ? lows : '—'}
          </div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: MUTED }}>Above MA150</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: ma150Color }} className="font-data tabular-nums">
            {Number.isFinite(ma150p) ? `${ma150p}%` : '—'}
          </div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: MUTED }}>Stage 4 stocks</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: stage4StatColor }} className="font-data tabular-nums">
            {Number.isFinite(s4count) ? s4count : '—'}
          </div>
        </div>
      </div>

      {divActive ? (
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            borderRadius: 8,
            border: divSevere ? '1px solid #EF4444' : '1px solid #F59E0B',
            background: divSevere ? '#1C0000' : '#1C1000',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>
            ⚠️ {String(data.divergence_type || 'Divergence')}
          </div>
          <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 6 }}>
            {String(data.divergence_notes || '').replace(/^"+|"+$/g, '')}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function stageDot(stage) {
  const { bg } = stageBadge(stage)
  return { bg, label: '' }
}

function NiftySectorCard({ row, colKey }) {
  const name = String(row.display_name || row.index_name || '—')
  const current = Number(row.current_value)
  const currentStr = Number.isFinite(current) ? `${Math.round(current).toLocaleString('en-IN')}` : '—'
  const chg = Number(row[colKey])
  const pctStr =
    Number.isFinite(chg) ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'
  const cs = sectorChangeStyle(chg)

  const isNifty =
    name === 'Nifty 50' ||
    row.index_name === 'Nifty 50' ||
    row.display_name === 'Nifty 50'

  const st = stageDot(row.stage)

  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        position: 'relative',
        cursor: 'pointer',
        padding: '14px 16px',
        borderRadius: 12,
        border: isNifty ? '1px solid #1E3A5F' : `1px solid ${BORDER}`,
        background: isNifty ? '#0C1929' : CARD_BG,
        borderLeft: `3px solid ${cs.border}`,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, paddingRight: 14 }}>{name}</div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{currentStr}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8, color: cs.color }} className="font-data tabular-nums">
        {pctStr}
      </div>
      <span
        title={String(row.stage || '')}
        style={{
          position: 'absolute',
          bottom: 10,
          right: 12,
          width: 8,
          height: 8,
          borderRadius: 99,
          background: st.bg,
        }}
      />
    </div>
  )
}

/** Sort sectors by chosen interval; Nifty 50 stays first. */
function useSortedSectorRows(rows, tab) {
  return useMemo(() => {
    if (!rows?.length) return []
    const col = SECTOR_TAB_TO_COL[tab] || 'change_1w'
    const isNifty50 = (r) =>
      String(r.display_name || r.index_name || '').trim().toUpperCase().replace(/\s+/g, ' ') === 'NIFTY 50'

    const nifty = rows.filter(isNifty50)
    const others = rows.filter((r) => !isNifty50(r))
    const sortedOthers = [...others].sort((a, b) => {
      const va = Number(a[col])
      const vb = Number(b[col])
      const fa = Number.isFinite(va)
      const fb = Number.isFinite(vb)
      if (!fa && !fb) return 0
      if (!fa) return 1
      if (!fb) return -1
      return vb - va
    })
    return [...nifty, ...sortedOthers]
  }, [rows, tab])
}

function SectorStrengthSection({ rows, sectorTab, setSectorTab }) {
  const sortedRows = useSortedSectorRows(rows, sectorTab)

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: TEXT,
          marginBottom: 12,
        }}
      >
        📊 SECTOR STRENGTH
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {SECTOR_CHANGE_TAB_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSectorTab(k)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: sectorTab === k ? 700 : 500,
              border: sectorTab === k ? `1px solid ${BLUE}` : `1px solid ${BORDER}`,
              background: sectorTab === k ? 'rgba(56,189,248,0.12)' : '#080C14',
              color: sectorTab === k ? BLUE : MUTED,
              cursor: 'pointer',
            }}
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        {sortedRows.map((row, idx) => (
          <NiftySectorCard
            key={`${row.index_name || row.display_name}-${row.date}-${idx}`}
            row={row}
            colKey={SECTOR_TAB_TO_COL[sectorTab]}
          />
        ))}
      </div>
    </div>
  )
}

function SectionHeader({ title, subtitle, onSeeAll }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: MUTED,
            flex: 1,
            minWidth: 0,
          }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={onSeeAll}
          style={{
            fontSize: '12px',
            color: BLUE,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          See all →
        </button>
      </div>
      {subtitle ? (
        <p style={{ fontSize: '12px', lineHeight: 1.5, color: '#94a3b8', margin: '10px 0 0', maxWidth: 720 }}>
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}

function SectorCard({ sector, onNavigate }) {
  const hKey = normalizeSectorHealthKey(sector.health)
  const healthColor = getHealthColor(hKey)
  const healthBg = getHealthBg(hKey)
  const healthLabel = getHealthDisplayLabel(hKey)
  const total = sector.total_companies ?? 0
  const s2 = sector.stage2_count ?? 0
  const s2Meta = stageBadge('Stage 2')
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(sector.name)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onNavigate(sector.name)
      }}
      style={{
        background: CARD_BG,
        border: `1px solid ${healthColor}33`,
        borderLeft: `3px solid ${healthColor}`,
        borderRadius: '10px',
        padding: '14px',
        cursor: 'pointer',
        height: '100%',
        minHeight: '100px',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, color: TEXT }}>{sector.display_name || sector.name}</div>
      <div
        style={{
          marginTop: '8px',
          fontSize: '10px',
          padding: '2px 8px',
          borderRadius: '20px',
          background: healthBg,
          color: healthColor,
          display: 'inline-block',
          fontWeight: 600,
        }}
      >
        {healthLabel}
      </div>
      <div style={{ fontSize: '11px', color: MUTED, marginTop: '6px' }}>
        <span style={{ fontWeight: 700, color: s2Meta.color }} className="font-data tabular-nums">{s2}</span>
        <span>/{total} in Stage 2</span>
      </div>
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { isPaid } = usePlan()
  const loggedIn = Boolean(user)

  const [loadingPulse, setLoadingPulse] = useState(true)
  const [pulse, setPulse] = useState({
    unusualAccumulation: [],
    breakingOut: [],
    newStage2: [],
    deliveryRising: [],
    deliveryFalling: [],
    changes: [],
    sectors: [],
    companiesTracked: 0,
    stage2Count: 0,
    emergingCount: 0,
    unusualDeliveryCount: 0,
  })

  const [explorer, setExplorer] = useState(null)
  const [explorerQ, setExplorerQ] = useState('')
  const [signupGate, setSignupGate] = useState('')

  const [marketsTopLoading, setMarketsTopLoading] = useState(true)
  const [marketInternalsRow, setMarketInternalsRow] = useState(null)
  const [sectorStrengthRowsRaw, setSectorStrengthRowsRaw] = useState([])
  const [sectorStrengthTab, setSectorStrengthTab] = useState('1w')

  const displayName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name?.trim() ||
    user?.user_metadata?.name?.trim() ||
    user?.email ||
    'there'

  const firstName = firstToken(displayName)
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null

  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  useEffect(() => {
    if (!explorer) return
    const esc = (e) => {
      if (e.key === 'Escape') setExplorer(null)
    }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [explorer])

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setMarketsTopLoading(false)
      return
    }
    let alive = true
    setMarketsTopLoading(true)

    Promise.all([
      supabase.from('market_internals').select('*').order('date', { ascending: false }).limit(1),
      supabase.from('nifty_sectors').select('*').order('date', { ascending: false }).limit(120),
    ])
      .then(([internalsRes, sectorsRes]) => {
        if (!alive) return
        setMarketInternalsRow(internalsRes.data?.[0] ?? null)
        const srows = sectorsRes.data || []
        if (srows.length) {
          const latestDate = srows[0]?.date
          setSectorStrengthRowsRaw(srows.filter((s) => s.date === latestDate))
        } else {
          setSectorStrengthRowsRaw([])
        }
      })
      .catch(() => {
        if (!alive) return
        setMarketInternalsRow(null)
        setSectorStrengthRowsRaw([])
      })
      .finally(() => {
        if (alive) setMarketsTopLoading(false)
      })

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setLoadingPulse(false)
      return
    }
    let alive = true

    async function run() {
      setLoadingPulse(true)
      try {
        const [
          countRes,
          swingDateRes,
          sigDateRes,
          latestDeliveryDateRes,
          companiesRes,
        ] = await Promise.all([
          supabase.from('companies').select('id', { count: 'exact', head: true }),
          supabase.from('swing_conditions').select('date').order('date', { ascending: false }).limit(1),
          supabase.from('delivery_signals').select('date').order('date', { ascending: false }).limit(1),
          supabase.from('delivery_data').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('companies').select('id,symbol,name,sector').limit(4000),
        ])

        const latestSwingDate = swingDateRes.data?.[0]?.date ?? null
        const latestSignalsDate = sigDateRes.data?.[0]?.date ?? null
        const latestDeliveryDate = latestDeliveryDateRes.data?.date ?? null
        const companyMap = Object.fromEntries((companiesRes.data || []).map((c) => [c.id, c]))
        const companiesTracked = countRes.count ?? (companiesRes.data || []).length

        const [
          unusualSig,
          risingSig,
          fallingSig,
          priceBreakout,
          priceStage2New,
          swingStage2,
          quarterlyRes,
          sectorsRes,
          deliveryTodayRes,
          stage2CountRes,
          emergingCountRes,
        ] = await Promise.all([
          latestSignalsDate
            ? supabase
                .from('delivery_signals')
                .select('company_id,delivery_trend_30d,avg_delivery_30d,price_change_30d,price_change_7d')
                .eq('date', latestSignalsDate)
                .eq('delivery_rising_price_flat_30d', true)
                .order('avg_delivery_30d', { ascending: false })
                .limit(200)
            : Promise.resolve({ data: [] }),
          latestSignalsDate
            ? supabase
                .from('delivery_signals')
                .select('company_id,delivery_trend_30d,avg_delivery_30d,price_change_7d')
                .eq('date', latestSignalsDate)
                .eq('delivery_trend_30d', 'rising')
                .order('avg_delivery_30d', { ascending: false })
                .limit(200)
            : Promise.resolve({ data: [] }),
          latestSignalsDate
            ? supabase
                .from('delivery_signals')
                .select('company_id,delivery_trend_30d,avg_delivery_30d,price_change_7d,price_change_30d')
                .eq('date', latestSignalsDate)
                .eq('delivery_trend_30d', 'falling')
                .order('avg_delivery_30d', { ascending: true })
                .limit(200)
            : Promise.resolve({ data: [] }),
          supabase
            .from('price_data')
            .select('company_id,stage,obv_trend,breakout_52w')
            .eq('is_latest', true)
            .eq('breakout_52w', true)
            .limit(500),
          supabase
            .from('price_data')
            .select('company_id,stage,obv_trend')
            .eq('is_latest', true)
            .eq('stage2_new_this_week', true)
            .limit(500),
          latestSwingDate
            ? supabase
                .from('swing_conditions')
                .select('company_id')
                .eq('date', latestSwingDate)
                .eq('stage2_new_this_week', true)
                .limit(500)
            : Promise.resolve({ data: [] }),
          supabase
            .from('quarterly_changes')
            .select('company_id,headline_change,changes,ai_summary,created_at,headline_severity')
            .not('changes', 'is', null)
            .order('created_at', { ascending: false })
            .limit(200),
          supabase
            .from('sectors')
            .select('name,display_name,health,stage2_count,total_companies,last_updated')
            .order('last_updated', { ascending: false })
            .limit(120),
          latestDeliveryDate
            ? supabase
                .from('delivery_data')
                .select('company_id,vs_30d_avg,is_unusual')
                .eq('date', latestDeliveryDate)
            : Promise.resolve({ data: [] }),
          supabase
            .from('price_data')
            .select('id', { count: 'exact', head: true })
            .eq('is_latest', true)
            .ilike('stage', 'Stage 2'),
          supabase
            .from('price_data')
            .select('id', { count: 'exact', head: true })
            .eq('is_latest', true)
            .eq('stage', 'Stage 1+'),
        ])

        let newStageRows = []
        if (!priceStage2New.error && (priceStage2New.data || []).length) {
          newStageRows = priceStage2New.data || []
        } else {
          newStageRows = (swingStage2.data || []).map((r) => ({
            company_id: r.company_id,
            stage: 'Stage 2',
            obv_trend: null,
          }))
          const ids = [...new Set(newStageRows.map((r) => r.company_id).filter(Boolean))]
          if (ids.length) {
            const obvRes = await supabase
              .from('price_data')
              .select('company_id,obv_trend,stage')
              .eq('is_latest', true)
              .in('company_id', ids)
            const obMap = Object.fromEntries((obvRes.data || []).map((x) => [x.company_id, x]))
            newStageRows = newStageRows.map((r) => ({
              ...r,
              obv_trend: obMap[r.company_id]?.obv_trend ?? null,
              stage: obMap[r.company_id]?.stage ?? r.stage,
            }))
          }
        }

        const decoratePriceRow = (p) => {
          const c = companyMap[p.company_id] || {}
          return {
            company_id: p.company_id,
            symbol: c.symbol || '',
            name: c.name || c.symbol || 'Unknown',
            sector: c.sector || '',
            stage: p.stage,
            obv_trend: p.obv_trend,
          }
        }

        const breakingOut = (priceBreakout.data || []).map(decoratePriceRow).filter((r) => r.symbol)
        const newStage2 = newStageRows.map(decoratePriceRow).filter((r) => r.symbol)

        const unusualAccumulation = (unusualSig.data || []).map((r) => decorateSignalRow(r, companyMap)).filter((r) => r.symbol)
        const deliveryRising = (risingSig.data || []).map((r) => decorateSignalRow(r, companyMap)).filter((r) => r.symbol)

        const fallingCandidates = fallingSig.data || []
        const fallingIds = [...new Set(fallingCandidates.map((r) => r.company_id).filter(Boolean))]
        let priceLatestByCompany = {}
        if (fallingIds.length) {
          const priceLatestRes = await supabase
            .from('price_data')
            .select('company_id,stage')
            .eq('is_latest', true)
            .in('company_id', fallingIds)
          priceLatestByCompany = Object.fromEntries(
            (priceLatestRes.data || []).map((row) => [row.company_id, row]),
          )
        }
        const deliveryFallingFiltered = fallingCandidates.filter((sigRow) =>
          passesDeliveryPossibleWeaknessFilter(sigRow, priceLatestByCompany[sigRow.company_id]),
        )
        const deliveryFalling = deliveryFallingFiltered.map((r) => decorateSignalRow(r, companyMap)).filter((r) => r.symbol)

        const changes = (quarterlyRes.data || [])
          .map((q) => {
            const c = companyMap[q.company_id] || {}
            return {
              company_id: q.company_id,
              symbol: c.symbol || '',
              name: c.name || 'Unknown',
              sector: c.sector || '',
              headline: q.headline_change || q.ai_summary || '',
              severity: pickSeverity(q),
            }
          })
          .filter((r) => r.symbol)

        const seen = new Set()
        const sectors = (sectorsRes.data || []).filter((s) => {
          if (!s?.name || seen.has(s.name)) return false
          seen.add(s.name)
          return true
        })

        const unusualDeliveryCount = (deliveryTodayRes.data || []).filter(
          (d) => Number(d.vs_30d_avg) > 1.8 || Boolean(d.is_unusual),
        ).length

        const stage2Count = stage2CountRes.error ? 0 : (stage2CountRes.count ?? 0)
        const emergingCount = emergingCountRes.error ? 0 : (emergingCountRes.count ?? 0)

        if (!alive) return
        setPulse({
          unusualAccumulation,
          breakingOut,
          newStage2,
          deliveryRising,
          deliveryFalling,
          changes,
          sectors,
          companiesTracked,
          stage2Count,
          emergingCount,
          unusualDeliveryCount,
        })
      } catch {
        if (!alive) return
        setPulse({
          unusualAccumulation: [],
          breakingOut: [],
          newStage2: [],
          deliveryRising: [],
          deliveryFalling: [],
          changes: [],
          sectors: [],
          companiesTracked: 0,
          stage2Count: 0,
          emergingCount: 0,
          unusualDeliveryCount: 0,
        })
      } finally {
        if (alive) setLoadingPulse(false)
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [])

  const filteredExplorer = useMemo(() => {
    const raw = explorer?.items || []
    const q = explorerQ.trim().toLowerCase()
    if (!q) return raw
    return raw.filter((item) =>
      `${item.name ?? ''} ${item.symbol ?? ''} ${item.display_name ?? ''} ${item.sector ?? ''}`.toLowerCase().includes(q),
    )
  }, [explorer, explorerQ])

  const handleSeeAll = useCallback(
    (title, items, kind = 'stock', slug = '') => {
      if (!loggedIn) {
        setSignupGate(title)
        return
      }
      setExplorerQ('')
      setExplorer({ title, items, kind, slug })
    },
    [loggedIn],
  )

  /** Horizontal CSS grid: 2 / 3 / 5 cols; equal-height rows via stretch + card height 100% */
  const renderStockSection = (key, slug, title, items, renderInner, subtitle = null) => {
    if (!loadingPulse && (!items || items.length === 0)) return null

    const body = () => {
      if (loadingPulse) {
        return (
          <div className="home-pulse-grid">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCell key={`${key}-sk-${i}`} />
            ))}
          </div>
        )
      }

      const cells = []

      if (!loggedIn && items.length >= 3) {
        for (let i = 0; i < 3; i += 1) {
          const st = items[i]
          if (st) {
            cells.push(
              <div key={`${key}-r-${st.symbol}-${i}`} style={{ height: '100%', minHeight: 0 }}>
                {renderInner(st)}
              </div>,
            )
          }
        }
        cells.push(<LockedCard key={`${key}-l1`} />)
        cells.push(<LockedCard key={`${key}-l2`} />)
      } else {
        const slice = items.slice(0, 5)
        for (let i = 0; i < slice.length; i += 1) {
          const st = slice[i]
          cells.push(
            <div key={`${key}-r-${st.symbol}-${i}`} style={{ height: '100%', minHeight: 0 }}>
              {renderInner(st)}
            </div>,
          )
        }
      }

      return (
        <div className="home-pulse-grid">
          {cells}
          {!loggedIn && items.length >= 3 ? <SignupPromptRow key={`${key}-su`} /> : null}
        </div>
      )
    }

    return (
      <div key={key} style={{ marginBottom: '40px' }}>
        <SectionHeader title={title} subtitle={subtitle} onSeeAll={() => handleSeeAll(title, items, 'stock', slug)} />
        {body()}
      </div>
    )
  }

  return (
    <div
      style={{
        background: PAGE_BG,
        minHeight: '100vh',
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <Helmet>
        <title>PineX — Indian Stock Intelligence</title>
      </Helmet>
      <style>{`@keyframes homeSk { 0%,100%{opacity:.45} 50%{opacity:.95} } @keyframes homePulseSkeleton { 0%,100%{opacity:0.4} 50%{opacity:0.8} }`}</style>

      <HomeNavbar
        loggedIn={loggedIn}
        displayName={displayName}
        avatarUrl={avatarUrl}
        userEmail={user?.email}
        onAccountClick={() => navigate('/account')}
      />

      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 16px' }}>
        <div style={{ padding: '24px 0 32px' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: TEXT }}>
            Good {timeOfDayWord()}, {firstName}
          </div>
          <div style={{ fontSize: '13px', color: MUTED, marginTop: '4px' }}>
            {dateLine} — Updated after market close
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {[
              { label: 'Companies tracked', value: String(pulse.companiesTracked || '—') },
              { label: 'In Stage 2', value: String(pulse.stage2Count ?? '—'), valueColor: stageBadge('Stage 2').color },
              { label: 'Emerging', value: String(pulse.emergingCount ?? '—'), valueColor: stageBadge('Stage 1+').color },
              { label: 'Unusual delivery', value: String(pulse.unusualDeliveryCount ?? '—') },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: '20px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  color: '#94A3B8',
                }}
              >
                <span style={{ color: stat.valueColor ?? TEXT, fontWeight: 600 }}>{stat.value}</span> {stat.label}
              </div>
            ))}
          </div>
        </div>

        {marketsTopLoading ? (
          <>
            <MarketHealthSkeleton />
            <SectorStrengthSkeletonGrid />
          </>
        ) : (
          <>
            {marketInternalsRow ? <MarketHealthPanel data={marketInternalsRow} /> : null}
            {sectorStrengthRowsRaw.length > 0 ? (
              <SectorStrengthSection
                rows={sectorStrengthRowsRaw}
                sectorTab={sectorStrengthTab}
                setSectorTab={setSectorStrengthTab}
              />
            ) : null}
          </>
        )}

        <div style={{ marginBottom: 36 }}>
          <HeatMap navigate={navigate} />
        </div>

        <div style={{ marginBottom: '40px' }}>
          <DailyScanner loggedIn={loggedIn} isPaid={isPaid} />
        </div>

        {renderStockSection(
          'u',
          'unusual',
          '🔍 UNUSUAL ACCUMULATION',
          pulse.unusualAccumulation,
          (row) => (
            <StockCard
              navigate={navigate}
              sector={row.sector}
              name={row.name}
              symbol={row.symbol}
              mainMetric={pctOrDash(row.avg_delivery_30d)}
              metricColor={deliveryMetricColor(row.avg_delivery_30d)}
              secondaryMetric={`30d price ${priceChgFmt(row.price_change_30d)}`}
            />
          ),
        )}

        {renderStockSection('bo', 'breakout', '🚀 BREAKING OUT TODAY', pulse.breakingOut, (row) => (
          <StockCard
            navigate={navigate}
            sector={row.sector}
            name={row.name}
            symbol={row.symbol}
            mainMetric={stageLabel(row.stage)}
            metricColor={stageColor(row.stage)}
            secondaryMetric={obvTxt(row.obv_trend)}
          />
        ))}

        {renderStockSection('ns2', 'stage2', '📈 NEW STAGE 2 THIS WEEK', pulse.newStage2, (row) => (
          <StockCard
            navigate={navigate}
            sector={row.sector}
            name={row.name}
            symbol={row.symbol}
            mainMetric="STAGE 2"
            metricColor="#34D399"
            secondaryMetric={obvTxt(row.obv_trend)}
          />
        ))}

        {renderStockSection('dr', 'rising', '⚡ RISING DELIVERY — 30 DAYS', pulse.deliveryRising, (row) => (
          <StockCard
            navigate={navigate}
            sector={row.sector}
            name={row.name}
            symbol={row.symbol}
            mainMetric={pctOrDash(row.avg_delivery_30d)}
            metricColor={deliveryMetricColor(row.avg_delivery_30d)}
            secondaryMetric={trendSecondary(row.delivery_trend_30d)}
          />
        ))}

        {renderStockSection(
          'df',
          'falling',
          '⚠️ Delivery Declining — Possible Weakness',
          pulse.deliveryFalling,
          (row) => (
            <StockCard
              navigate={navigate}
              sector={row.sector}
              name={row.name}
              symbol={row.symbol}
              mainMetric={pctOrDash(row.avg_delivery_30d)}
              metricColor={deliveryMetricColor(row.avg_delivery_30d)}
              secondaryMetric={<span style={{ color: '#F87171' }}>{trendSecondary(row.delivery_trend_30d)}</span>}
            />
          ),
          DELIVERY_DECLINING_SUBTITLE,
        )}

        {renderStockSection('wc', 'changes', '🔄 WHAT CHANGED', pulse.changes, (row) => {
          const sev = severityLabelStyles(row.severity)
          return (
            <StockCard
              navigate={navigate}
              sector={row.sector}
              name={row.name}
              symbol={row.symbol}
              mainMetric={
                <span style={{ fontSize: '16px', lineHeight: '1.3', whiteSpace: 'normal' }} className="line-clamp-2">
                  {String(row.headline || '').replaceAll('_', ' ')}
                </span>
              }
              metricColor={TEXT}
              secondaryMetric={
                <span style={{ ...sev, borderRadius: '20px', padding: '2px 8px', display: 'inline-block' }}>
                  {String(row.severity || '').toUpperCase()}
                </span>
              }
            />
          )
        })}

        {!loadingPulse && pulse.sectors.length === 0
          ? null
          : (
          <div style={{ marginBottom: '40px' }}>
            <SectionHeader
              title="🏭 SECTOR PULSE"
              onSeeAll={() => handleSeeAll('Sector pulse', pulse.sectors, 'sector', 'sectors')}
            />
            {loadingPulse ? (
              <div className="home-sector-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonCell key={`sec-sk-${i}`} />
                ))}
              </div>
            ) : (
              <div className="home-sector-grid">
                {pulse.sectors.map((s, i) => (
                  <SectorCard key={`${s.name}-${i}`} sector={s} onNavigate={(name) => navigate(`/sector/${encodeURIComponent(name)}`)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full list modal */}
      {explorer ? (
        <div
          role="presentation"
          className="home-explorer-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            padding: 0,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setExplorer(null)
          }}
        >
          <div
            role="dialog"
            style={{
              width: '100%',
              maxWidth: 960,
              maxHeight: '88vh',
              overflow: 'auto',
              background: PAGE_BG,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              border: `1px solid ${BORDER}`,
              padding: '20px',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div style={{ color: TEXT, fontWeight: 700, fontSize: 16 }}>{explorer.title}</div>
              <button
                type="button"
                onClick={() => setExplorer(null)}
                style={{ border: 'none', background: 'transparent', color: MUTED, fontSize: 22, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
            <input
              type="search"
              value={explorerQ}
              onChange={(e) => setExplorerQ(e.target.value)}
              placeholder={explorer.slug === 'sectors' ? 'Filter sectors…' : 'Search symbol or company…'}
              style={{
                width: '100%',
                marginBottom: 16,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${BORDER}`,
                background: CARD_BG,
                color: TEXT,
                fontSize: 14,
              }}
            />

            {explorer.slug === 'sectors' ? (
              filteredExplorer.length ? (
                <div className="home-sector-grid">
                  {filteredExplorer.map((s, i) => (
                    <SectorCard
                      key={`${s.name}-m-${i}`}
                      sector={s}
                      onNavigate={(name) => {
                        navigate(`/sector/${encodeURIComponent(name)}`)
                        setExplorer(null)
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p style={{ textAlign: 'center', color: MUTED, padding: '32px 8px' }}>No sectors match.</p>
              )
            ) : filteredExplorer.length ? (
              <div className="home-pulse-grid-modal">
                {filteredExplorer.map((row, idx) => {
                  const cardKey = `${explorer.slug}-${row.symbol}-${idx}`
                  if (explorer.slug === 'unusual')
                    return (
                      <div key={cardKey} style={{ height: '100%', minHeight: 0 }}>
                        <StockCard
                          navigate={navigate}
                          sector={row.sector}
                          name={row.name}
                          symbol={row.symbol}
                          mainMetric={pctOrDash(row.avg_delivery_30d)}
                          metricColor={deliveryMetricColor(row.avg_delivery_30d)}
                          secondaryMetric={`30d price ${priceChgFmt(row.price_change_30d)}`}
                        />
                      </div>
                    )
                  if (explorer.slug === 'breakout')
                    return (
                      <div key={cardKey} style={{ height: '100%', minHeight: 0 }}>
                        <StockCard
                          navigate={navigate}
                          sector={row.sector}
                          name={row.name}
                          symbol={row.symbol}
                          mainMetric={stageLabel(row.stage)}
                          metricColor={stageColor(row.stage)}
                          secondaryMetric={obvTxt(row.obv_trend)}
                        />
                      </div>
                    )
                  if (explorer.slug === 'stage2')
                    return (
                      <div key={cardKey} style={{ height: '100%', minHeight: 0 }}>
                        <StockCard
                          navigate={navigate}
                          sector={row.sector}
                          name={row.name}
                          symbol={row.symbol}
                          mainMetric={stageBadge('Stage 2').label}
                          metricColor={stageBadge('Stage 2').color}
                          secondaryMetric={obvTxt(row.obv_trend)}
                        />
                      </div>
                    )
                  if (explorer.slug === 'rising')
                    return (
                      <div key={cardKey} style={{ height: '100%', minHeight: 0 }}>
                        <StockCard
                          navigate={navigate}
                          sector={row.sector}
                          name={row.name}
                          symbol={row.symbol}
                          mainMetric={pctOrDash(row.avg_delivery_30d)}
                          metricColor={deliveryMetricColor(row.avg_delivery_30d)}
                          secondaryMetric={trendSecondary(row.delivery_trend_30d)}
                        />
                      </div>
                    )
                  if (explorer.slug === 'falling')
                    return (
                      <div key={cardKey} style={{ height: '100%', minHeight: 0 }}>
                        <StockCard
                          navigate={navigate}
                          sector={row.sector}
                          name={row.name}
                          symbol={row.symbol}
                          mainMetric={pctOrDash(row.avg_delivery_30d)}
                          metricColor={deliveryMetricColor(row.avg_delivery_30d)}
                          secondaryMetric={
                            <span style={{ color: '#F87171' }}>{trendSecondary(row.delivery_trend_30d)}</span>
                          }
                        />
                      </div>
                    )
                  if (explorer.slug === 'changes') {
                    const sev = severityLabelStyles(row.severity)
                    return (
                      <div key={cardKey} style={{ height: '100%', minHeight: 0 }}>
                        <StockCard
                          navigate={navigate}
                          sector={row.sector}
                          name={row.name}
                          symbol={row.symbol}
                          mainMetric={
                            <span style={{ fontSize: '16px', lineHeight: '1.25', whiteSpace: 'normal' }} className="line-clamp-3">
                              {String(row.headline || '').replaceAll('_', ' ')}
                            </span>
                          }
                          metricColor={TEXT}
                          secondaryMetric={
                            <span style={{ ...sev, borderRadius: '20px', padding: '2px 8px', display: 'inline-block' }}>
                              {String(row.severity || '').toUpperCase()}
                            </span>
                          }
                        />
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            ) : (
              <p style={{ textAlign: 'center', color: MUTED, padding: '32px 8px' }}>No stocks match.</p>
            )}
          </div>
        </div>
      ) : null}

      <Modal isOpen={Boolean(signupGate)} onClose={() => setSignupGate('')} title="Sign up to see the full list">
        <p style={{ color: MUTED, fontSize: 14 }}>
          Create a free account to browse every stock in <strong style={{ color: TEXT }}>{signupGate}</strong>.
        </p>
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          style={{
            marginTop: 16,
            width: '100%',
            background: 'white',
            color: '#0A0E17',
            border: 'none',
            borderRadius: 8,
            padding: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Continue with Google
        </button>
      </Modal>
    </div>
  )
}
