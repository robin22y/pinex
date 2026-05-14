import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ExplainButton from './ui/ExplainButton'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

function valueNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pctDisplay(value) {
  const n = valueNum(value)
  return `${n.toFixed(1)}%`
}

function pctOrDash(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

/** Bar fill by delivery %. */
function barFillForPct(pct) {
  const n = valueNum(pct)
  if (n > 50) return '#22C55E'
  if (n >= 30) return '#38BDF8'
  return '#F59E0B'
}

/** Axis ticks e.g. "06 May". */
function formatBarAxisDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  return `${day} ${mon}`
}

/** Indian lakh / crore style for displayed share counts */
function formatVolume(num) {
  if (num == null || num === '') return '—'
  const n = Number(num)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1000) return String(Math.round(n))
  if (n >= 10000000) return (n / 10000000).toFixed(1) + ' Cr'
  if (n >= 100000) return (n / 100000).toFixed(2) + 'L'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(Math.round(n))
}

/** Right-axis ticks: abbreviate similarly */
function formatAxisVolumeTick(num) {
  if (!Number.isFinite(num) || num <= 0) return ''
  if (num >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`
  if (num >= 100000) return `${(num / 100000).toFixed(1)}L`
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
  return String(Math.round(num))
}

function sortByDateDesc(rows) {
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

function meanFinite(nums) {
  const ok = nums.filter((x) => Number.isFinite(x))
  return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null
}

/** Average delivery_pct and avg delivery_volume (shares) over first N rows of desc-sorted history. */
function windowDeliveryStats(rowsDesc, n) {
  const slice = rowsDesc.slice(0, n)
  const pcts = slice.map((r) => Number(r.delivery_pct)).filter((x) => Number.isFinite(x))
  const dv = slice.map((r) => Number(r.delivery_volume)).filter((x) => Number.isFinite(x))
  return {
    avgPct: meanFinite(pcts),
    avgDelVol: meanFinite(dv),
  }
}

/** Pull precomputed avg delivery % when present; fallback to computed from rows. */
function avgDeliveryPctForWindow(signalsRow, rowsDesc, days) {
  const key =
    /** @type {const} */ ({
      7: 'avg_delivery_7d',
      30: 'avg_delivery_30d',
      60: 'avg_delivery_60d',
      90: 'avg_delivery_90d',
    })[days]
  const fromSignals = signalsRow?.[key]
  const n = Number(fromSignals)
  if (Number.isFinite(n)) return n
  return windowDeliveryStats(rowsDesc, days).avgPct
}

function avgDeliveredSharesForWindow(rowsDesc, days) {
  return windowDeliveryStats(rowsDesc, days).avgDelVol
}

/** Same thresholds as scripts/calc_delivery_signals.py (`np.polyfit` slope). */
const SLOPE_RISING = 0.5
const SLOPE_FALLING = -0.5

/** Ordinary least-squares slope — matches NumPy linear polyfit on indices. */
function linRegSlopeIndexSeq(ySeries) {
  const n = ySeries.length
  if (n < 2) return 0
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i++) {
    const yi = ySeries[i]
    sumX += i
    sumY += yi
    sumXY += i * yi
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
}

function pctTrendArrowFromSlope(pctsAsc) {
  if (pctsAsc.length < 2) return { label: '—', accent: C.textMuted }
  const slope = linRegSlopeIndexSeq(pctsAsc)
  if (slope > SLOPE_RISING) return { label: 'Rising ↑', accent: '#22C55E' }
  if (slope < SLOPE_FALLING) return { label: 'Falling ↓', accent: '#EF4444' }
  return { label: 'Flat →', accent: '#64748B' }
}

function volumeTrendFromSignals(signalsRow) {
  const a7 = Number(signalsRow?.avg_volume_7d)
  const a30 = Number(signalsRow?.avg_volume_30d)
  if (!Number.isFinite(a7) || !Number.isFinite(a30) || a30 <= 0) return { label: '—', accent: C.textMuted }
  if (a7 > a30 * 1.15) return { label: 'Rising ↑', accent: '#22C55E' }
  if (a7 < a30 * 0.85) return { label: 'Falling ↓', accent: '#EF4444' }
  return { label: 'Stable →', accent: '#64748B' }
}

const TABS = [
  { id: '7', label: '7D', days: 7 },
  { id: '30', label: '30D', days: 30 },
  { id: '60', label: '60D', days: 60 },
  { id: '90', label: '90D', days: 90 },
]

function normalizeStageKey(stage) {
  return String(stage ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '')
}

/**
 * @param {Record<string, unknown> | null} signalsRow
 * @param {string | null} latestStage
 */
function getDeliverySignal(signalsRow, latestStage) {
  const a7 = Number(signalsRow?.avg_volume_7d)
  const a30 = Number(signalsRow?.avg_volume_30d)
  const d7 = String(signalsRow?.delivery_trend_7d ?? '').toLowerCase()

  const vol_up = Number.isFinite(a7) && Number.isFinite(a30) && a30 > 0 && a7 > a30 * 1.15
  const vol_down = Number.isFinite(a7) && Number.isFinite(a30) && a30 > 0 && a7 < a30 * 0.85
  const pct_up = d7 === 'rising'
  const pct_down = d7 === 'falling'
  const stage2 = normalizeStageKey(latestStage) === 'stage2'

  if (vol_up && pct_up) {
    return {
      icon: '⚡',
      color: '#22C55E',
      title: 'Sustained institutional base',
      text: 'Both delivery volume and percentage rising — sustained institutional participation.',
    }
  }
  if (vol_up && pct_down && stage2) {
    return {
      icon: '🚀',
      color: '#38BDF8',
      title: 'Above key level signature',
      text: 'Volume surging as participation broadens — delivery % diluted but absolute activity remains elevated.',
    }
  }
  if (vol_up && !pct_down) {
    return {
      icon: '📈',
      color: '#86EFAC',
      title: 'Increasing interest',
      text: 'More shares changing hands with delivery — buying pressure building.',
    }
  }
  if (vol_down && pct_down && !stage2) {
    return {
      icon: '⚠️',
      color: '#EF4444',
      title: 'Declining interest',
      text: 'Both volume and delivery falling — buyers stepping back.',
    }
  }
  return {
    icon: '→',
    color: '#64748B',
    title: 'Stable delivery',
    text: 'No significant change in delivery pattern.',
  }
}

function SignalInterpretationCard({ signalsRow, latestStage }) {
  const sig = getDeliverySignal(signalsRow, latestStage)
  return (
    <div
      className="w-full rounded-lg border px-3 py-3 text-left"
      style={{ borderColor: C.border, background: '#0f172abe' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: C.textMuted }}>
        Signal interpretation
      </p>
      <p className="mt-2 text-xs font-semibold leading-snug" style={{ color: sig.color }}>
        <span aria-hidden>{sig.icon}</span> {sig.title}
      </p>
      <p className="mt-1 text-[11px] leading-snug sm:text-xs" style={{ color: C.text }}>
        {sig.text}
      </p>
    </div>
  )
}

/** @param {React.ComponentProps<'div'>['className']} className */
function ChartTooltipCmp({ active, payload, className }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  const dv = Number(p.delivery_volume)
  return (
    <div
      className={`rounded-md border px-2 py-1.5 text-xs shadow-lg ${className || ''}`}
      style={{ background: C.surfaceCard, borderColor: C.border, color: C.text }}
    >
      <div style={{ color: C.textMuted }}>{p.dateLabelFull}</div>
      <div className="font-semibold tabular-nums">{pctDisplay(p.delivery_pct)}</div>
      <div className="tabular-nums" style={{ color: C.textMuted }}>
        Delivery vol {formatVolume(dv)}
      </div>
    </div>
  )
}

/**
 * @param {{ companyId?: string, deliveryRows?: Array<Record<string, unknown>>, symbol?: string, embedded?: boolean, hideExplain?: boolean, latestStage?: string | null }} props
 */
export default function DeliveryPanel({
  companyId = '',
  deliveryRows = [],
  symbol = '',
  embedded = false,
  hideExplain = false,
  latestStage = null,
}) {
  const [signalsRow, setSignalsRow] = useState(null)
  const [deliveryHistoryDesc, setDeliveryHistoryDesc] = useState([])
  /** Set false only while swapping `company_id` fetch in flight — parent `deliveryRows` can render immediately. */
  const [deliveryDataReady, setDeliveryDataReady] = useState(true)
  const [tabId, setTabId] = useState('30')

  const mergedDesc = useMemo(() => {
    const base = deliveryHistoryDesc.length > 0 ? deliveryHistoryDesc : deliveryRows
    return sortByDateDesc(base)
  }, [deliveryHistoryDesc, deliveryRows])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale signals when switching company
    setSignalsRow(null)
    if (!companyId || !hasSupabaseEnv) return
    let cancel = false
    ;(async () => {
      const res = await supabase
        .from('delivery_signals')
        .select('*')
        .eq('company_id', companyId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!cancel) setSignalsRow(res.data ?? null)
    })()
    return () => {
      cancel = true
    }
  }, [companyId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear cached rows when switching company
    setDeliveryHistoryDesc([])
    if (!companyId || !hasSupabaseEnv) return
    setDeliveryDataReady(false)
    let cancel = false
    ;(async () => {
      const res = await supabase
        .from('delivery_data')
        .select('date,delivery_pct,delivery_volume,total_volume,ai_insight')
        .eq('company_id', companyId)
        .order('date', { ascending: false })
        .limit(120)
      if (!cancel) {
        setDeliveryHistoryDesc(res.data ?? [])
        setDeliveryDataReady(true)
      }
    })()
    return () => {
      cancel = true
    }
  }, [companyId])

  const todayRow = mergedDesc[0]
  const todayPct = valueNum(todayRow?.delivery_pct)
  const todayDelVol = Number(todayRow?.delivery_volume)

  const activeTab = TABS.find((t) => t.id === tabId) || TABS[1]

  /** Column 2 & 3 windows per selected tab. */
  const statWindows = useMemo(() => {
    if (activeTab.days <= 7) return { w2: 7, w3: 30 }
    if (activeTab.days <= 30) return { w2: 7, w3: 30 }
    if (activeTab.days <= 60) return { w2: 30, w3: 60 }
    return { w2: 60, w3: 90 }
  }, [activeTab.days])

  const statCols = useMemo(() => {
    const w2 = statWindows.w2
    const w3 = statWindows.w3

    const colB = [
      pctOrDash(Number.isFinite(todayPct) ? todayPct : null),
      formatVolume(Number.isFinite(todayDelVol) ? todayDelVol : null),
    ]
    const p2 = avgDeliveryPctForWindow(signalsRow, mergedDesc, w2)
    const v2 = avgDeliveredSharesForWindow(mergedDesc, w2)
    const col2 = [pctOrDash(p2), formatVolume(v2)]
    const p3 = avgDeliveryPctForWindow(signalsRow, mergedDesc, w3)
    const v3 = avgDeliveredSharesForWindow(mergedDesc, w3)
    const col3 = [pctOrDash(p3), formatVolume(v3)]

    return {
      titles: [`Today`, `${w2}D avg`, `${w3}D avg`],
      cols: [
        {
          pct: colB[0],
          shares: colB[1],
        },
        {
          pct: col2[0],
          shares: col2[1],
        },
        {
          pct: col3[0],
          shares: col3[1],
        },
      ],
    }
  }, [mergedDesc, signalsRow, statWindows, todayDelVol, todayPct])

  const { chartBars, pctTrendDelivery } = useMemo(() => {
    const n = activeTab.days
    const winAsc = [...mergedDesc]
      .slice(0, n)
      .sort((a, b) => new Date(String(a.date).slice(0, 10)).getTime() - new Date(String(b.date).slice(0, 10)).getTime())

    const pctsAsc = winAsc.map((r) => valueNum(r.delivery_pct))

    /** @type {Array<Record<string, unknown>>} */
    const bars = winAsc.map((r, ix) => {
      const d = r.date
      return {
        ix,
        date: d,
        delivery_pct: valueNum(r.delivery_pct),
        delivery_volume: valueNum(r.delivery_volume),
        total_volume: valueNum(r.total_volume),
        dateLabel: formatBarAxisDate(d),
        dateLabelFull: formatBarAxisDate(d),
      }
    })

    const trendArrow = pctTrendArrowFromSlope(pctsAsc)

    return { chartBars: bars, pctTrendDelivery: trendArrow }
  }, [mergedDesc, activeTab.days])

  const volumeTrendSignals = volumeTrendFromSignals(signalsRow)

  const trendKeyPct =
    /** @type {const} */ ({
      7: 'delivery_trend_7d',
      30: 'delivery_trend_30d',
      60: 'delivery_trend_60d',
      90: 'delivery_trend_90d',
    })[activeTab.days]

  const deliveryPctTrendLabelServer = signalsRow?.[trendKeyPct]
    ? String(signalsRow[trendKeyPct]).toLowerCase() === 'rising'
      ? { label: 'Rising ↑', accent: '#22C55E' }
      : String(signalsRow[trendKeyPct]).toLowerCase() === 'falling'
        ? { label: 'Falling ↓', accent: '#EF4444' }
        : { label: 'Flat →', accent: '#64748B' }
    : pctTrendDelivery

  const aiInsightFromRow = typeof todayRow?.ai_insight === 'string' ? todayRow.ai_insight.trim() : ''
  const aiInsightFallback =
    mergedDesc.map((r) => (typeof r.ai_insight === 'string' ? r.ai_insight.trim() : '')).find(Boolean) || ''

  const explainContext =
    aiInsightFromRow ||
    aiInsightFallback ||
    `Delivery percentages and delivered-share volumes over ${activeTab.label} versus longer windows — compare tabs to spot divergences.`

  /** X-axis labels: sparse on long series */
  function xTickFormatter(ix) {
    const i = Number(ix)
    if (!chartBars.length) return ''
    if (chartBars.length <= 12) return chartBars[i]?.dateLabel ?? ''
    if (i === 0 || i === chartBars.length - 1 || i % 10 === 0) return chartBars[i]?.dateLabel ?? ''
    return ''
  }

  const shellClass = embedded ? '' : 'rounded-2xl border p-4'
  const shellStyle = embedded
    ? {}
    : {
        background: C.surfaceCard,
        borderColor: C.border,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.035)',
      }

  const chartH = embedded ? 'h-[150px] sm:h-[220px]' : 'h-[150px] sm:h-[260px]'
  const rightMax = chartBars.reduce((m, r) => Math.max(m, Number(r.delivery_volume) || 0), 0)

  const showEmptyState = deliveryDataReady && !mergedDesc.length
  const showLoadingDelivery = !deliveryDataReady && !mergedDesc.length

  return (
    <div className={shellClass} style={shellStyle}>
      {!embedded ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-wide uppercase" style={{ color: C.textHeading }}>
            Delivery analysis
          </h3>
          <ExplainButton context={explainContext} symbol={symbol} />
        </div>
      ) : !hideExplain ? (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <ExplainButton context={explainContext} symbol={symbol} />
        </div>
      ) : null}

      {showLoadingDelivery ? (
        <p className="text-sm" style={{ color: C.textMuted }}>
          Loading delivery…
        </p>
      ) : showEmptyState ? (
        <p className="text-sm" style={{ color: C.textMuted }}>
          No delivery history yet for this stock.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {statCols.titles.map((title, ti) => {
              const cell = statCols.cols[ti]
              return (
                <div
                  key={title}
                  className="flex flex-col justify-center rounded-xl border px-3 py-4 text-center"
                  style={{ borderColor: C.border, background: C.surface2 }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.textMuted }}>
                    {title}
                  </p>
                  <p
                    className="mt-2 text-xl font-bold tabular-nums leading-none sm:text-2xl"
                    style={{ color: C.textHeading }}
                  >
                    {cell.pct}
                  </p>
                  <p className="mt-1 text-[10px]" style={{ color: C.textMuted }}>
                    delivery
                  </p>
                  <p className="mt-3 text-lg font-bold tabular-nums leading-none sm:text-xl" style={{ color: C.text }}>
                    {cell.shares}
                  </p>
                  <p className="mt-1 text-[10px]" style={{ color: C.textMuted }}>
                    shares (delivery qty)
                  </p>
                </div>
              )
            })}
          </div>

          <div className="mt-4 grid gap-2 border-t pt-3 text-xs sm:grid-cols-2 sm:gap-4" style={{ borderColor: C.border }}>
            <div className="flex justify-between gap-2 sm:flex-col sm:justify-start">
              <span style={{ color: C.textMuted }}>Delivery %</span>
              <span className="font-semibold" style={{ color: deliveryPctTrendLabelServer.accent }}>
                {deliveryPctTrendLabelServer.label}
                <span className="sr-only">{` (${activeTab.label} window trend)`}</span>
              </span>
            </div>
            <div className="flex justify-between gap-2 sm:flex-col sm:justify-start">
              <span style={{ color: C.textMuted }}>
                Volume <span style={{ opacity: 0.75 }}>(7D vs 30D avg turnover)</span>
              </span>
              <span className="font-semibold" style={{ color: volumeTrendSignals.accent }}>
                {volumeTrendSignals.label}
              </span>
            </div>
          </div>

          <div className="mt-4">
            <SignalInterpretationCard signalsRow={signalsRow} latestStage={latestStage} />
          </div>

          <div
            className="mt-4 flex flex-col gap-3 rounded-lg border p-1 sm:flex-row"
            style={{ borderColor: C.border, background: C.surface2 }}
          >
            {TABS.map((t) => {
              const on = t.id === tabId
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTabId(t.id)}
                  className="min-h-[44px] flex-1 rounded-md px-2 py-2 text-xs font-semibold transition-colors sm:py-2"
                  style={{
                    background: on ? C.surfaceCard : 'transparent',
                    color: on ? C.text : C.textMuted,
                    border: on ? `1px solid ${C.border}` : '1px solid transparent',
                    boxShadow: on ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          {chartBars.length ? (
            <div className={`mt-4 w-full min-w-0 max-w-full overflow-hidden ${chartH}`}>
              <div style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartBars} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} opacity={0.35} vertical={false} />
                  <XAxis
                    dataKey="ix"
                    type="number"
                    domain={[0, 'dataMax']}
                    tickFormatter={xTickFormatter}
                    tick={{ fill: C.textMuted, fontSize: 9 }}
                    axisLine={{ stroke: C.border }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[0, 100]}
                    width={34}
                    tick={{ fill: C.textMuted, fontSize: 9 }}
                    axisLine={{ stroke: C.border }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    width={40}
                    domain={[0, rightMax <= 0 ? 1 : rightMax * 1.08]}
                    tick={{ fill: C.textMuted, fontSize: 9 }}
                    axisLine={{ stroke: C.border }}
                    tickFormatter={formatAxisVolumeTick}
                  />
                  <Tooltip content={<ChartTooltipCmp />} cursor={{ stroke: `${C.border}aa` }} />
                  <Bar dataKey="delivery_pct" yAxisId="left" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                    {chartBars.map((entry, i) => (
                      <Cell key={`c-${entry.date}-${i}`} fill={barFillForPct(entry.delivery_pct)} />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="delivery_volume"
                    yAxisId="right"
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs" style={{ color: C.textMuted }}>
              Not enough trading days in this window for a chart yet.
            </p>
          )}

          {aiInsightFromRow || aiInsightFallback ? (
            <p className="mt-4 text-sm italic leading-relaxed" style={{ color: C.textMuted }}>
              {aiInsightFromRow || aiInsightFallback}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
