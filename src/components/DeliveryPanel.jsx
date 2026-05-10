import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
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

function valueColor(v) {
  const n = valueNum(v)
  if (n > 50) return C.green
  if (n < 35) return C.red
  return C.amber
}

function barColor(pct) {
  return valueColor(pct)
}

function formatDisplayDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Axis ticks e.g. "06 May" */
function formatBarAxisDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  return `${day} ${mon}`
}

function formatVolume(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

function sortByDateDesc(rows) {
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

function ratioLine(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return 'Not enough history for comparison.'
  const r = ratio
  if (r > 1) return `Today is ${r.toFixed(1)}× above normal`
  if (r < 1) return `Today is ${r.toFixed(1)}× below normal`
  return `Today matches the 30-day average`
}

function ratioColor(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return C.textMuted
  if (ratio > 1.05) return C.green
  if (ratio < 0.95) return C.red
  return C.textMuted
}

/** Same thresholds as scripts/calc_delivery_signals.py (`np.polyfit` slope). */
const SLOPE_RISING = 0.5
const SLOPE_FALLING = -0.5

const TABS = [
  { id: '7', label: '7D', days: 7, avgDelivery: 'avg_delivery_7d', avgVol: 'avg_volume_7d', trend: 'delivery_trend_7d' },
  { id: '30', label: '30D', days: 30, avgDelivery: 'avg_delivery_30d', avgVol: 'avg_volume_30d', trend: 'delivery_trend_30d' },
  { id: '60', label: '60D', days: 60, avgDelivery: 'avg_delivery_60d', avgVol: 'avg_volume_60d', trend: 'delivery_trend_60d' },
  { id: '90', label: '90D', days: 90, avgDelivery: 'avg_delivery_90d', avgVol: 'avg_volume_90d', trend: 'delivery_trend_90d' },
]

/** Ordinary least-squares slope of y versus x = 0..n-1 (matches NumPy linear polyfit here). */
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

function deriveDeliveryWindow(sortedAscRows) {
  const pcts = sortedAscRows.map((r) => Number(r.delivery_pct)).filter((n) => Number.isFinite(n))
  const vols = sortedAscRows.map((r) => Number(r.total_volume)).filter((n) => Number.isFinite(n))

  const avgDelivery = pcts.length ? pcts.reduce((s, v) => s + v, 0) / pcts.length : null
  const avgVolume = vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : null

  if (!pcts.length) {
    return { avgDelivery: null, avgVolume: avgVolume ?? null, trend: null }
  }

  /** @type {'rising' | 'falling' | 'flat'} */
  let trend = 'flat'
  if (pcts.length >= 2) {
    const slope = linRegSlopeIndexSeq(pcts)
    if (slope > SLOPE_RISING) trend = 'rising'
    else if (slope < SLOPE_FALLING) trend = 'falling'
  }

  return { avgDelivery, avgVolume: avgVolume ?? null, trend }
}

function normalizeStageKey(stage) {
  return String(stage ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '')
}

/** Uses server `delivery_signals` 30d fields + latest stage — not chart-derived tab trend. */
function deliveryTrendContextRead(signalsRow, latestStage, signalsFetched) {
  const t30 = String(signalsRow?.delivery_trend_30d ?? '').toLowerCase()
  const pc30 = Number(signalsRow?.price_change_30d)
  const sk = normalizeStageKey(latestStage)

  if (!t30) {
    return {
      variant: 'neutral',
      lines:
        signalsFetched === false
          ? ['Loading 30d delivery read…']
          : ['No 30d delivery trend in delivery_signals yet for this stock.'],
    }
  }

  if (t30 === 'rising') {
    return {
      variant: 'green',
      lines: ['✅ Increasing delivery — sustained buying interest'],
    }
  }

  if (t30 === 'falling') {
    if (sk === 'stage2' && Number.isFinite(pc30) && pc30 > 0) {
      return {
        variant: 'blue',
        lines: ['📈 Delivery % diluted by momentum traders', 'Absolute buying volume is what matters here'],
      }
    }
    if (sk === 'stage3' || sk === 'stage4') {
      return {
        variant: 'red',
        lines: ['⚠️ Declining delivery in downtrend —', 'reduced conviction from buyers'],
      }
    }
    return {
      variant: 'amber',
      lines: ['Delivery % (30d) is falling — check absolute volume and stage for the full picture.'],
    }
  }

  return {
    variant: 'neutral',
    lines: ['Delivery % trend (30d) is flat — participation is steady relative to recent history.'],
  }
}

/** @type {Record<string, { border: string, bg: string, color: string }>} */
const TREND_CTX_STYLE = {
  green: { border: C.greenBorder, bg: C.greenBg, color: C.green },
  red: { border: C.redBorder, bg: C.redBg, color: C.red },
  blue: { border: 'rgba(56, 189, 248, 0.4)', bg: C.blueBg, color: C.blue },
  amber: { border: C.amberBorder, bg: C.amberBg, color: C.amber },
  neutral: { border: C.border, bg: C.surfaceCard, color: C.textMuted },
}

function TrendContextBlock({ variant, lines }) {
  const s = TREND_CTX_STYLE[variant] || TREND_CTX_STYLE.neutral
  return (
    <div
      className="w-full rounded-lg border px-2 py-2 text-left"
      style={{ borderColor: s.border, background: s.bg, color: s.color }}
    >
      {lines.map((line, i) => (
        <p key={i} className={`text-[11px] font-medium leading-snug sm:text-xs ${i > 0 ? 'mt-1' : ''}`}>
          {line}
        </p>
      ))}
    </div>
  )
}

function ChartTooltipBar({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div
      className="rounded-md border px-2 py-1.5 text-xs shadow-lg"
      style={{ background: C.surfaceCard, borderColor: C.border, color: C.text }}
    >
      <div style={{ color: C.textMuted }}>{p.dateLabel}</div>
      <div className="font-semibold tabular-nums">{pctDisplay(p.delivery_pct)}</div>
      {Number.isFinite(p.total_volume) && p.total_volume > 0 ? (
        <div className="tabular-nums" style={{ color: C.textMuted }}>
          Vol {formatVolume(p.total_volume)}
        </div>
      ) : null}
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
  const [signalsFetched, setSignalsFetched] = useState(false)
  const [deliveryHistoryDesc, setDeliveryHistoryDesc] = useState([])
  const [tabId, setTabId] = useState('30')

  const rowsDescFallback = sortByDateDesc(deliveryRows)
  const mergedDesc =
    deliveryHistoryDesc.length > 0 ? sortByDateDesc(deliveryHistoryDesc) : rowsDescFallback

  useEffect(() => {
    setSignalsRow(null)
    setSignalsFetched(false)
    if (!companyId || !hasSupabaseEnv) {
      setSignalsFetched(true)
      return
    }
    let cancel = false
    ;(async () => {
      const res = await supabase
        .from('delivery_signals')
        .select('*')
        .eq('company_id', companyId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!cancel) {
        setSignalsRow(res.data ?? null)
        setSignalsFetched(true)
      }
    })()
    return () => {
      cancel = true
    }
  }, [companyId])

  useEffect(() => {
    setDeliveryHistoryDesc([])
    if (!companyId || !hasSupabaseEnv) return
    let cancel = false
    ;(async () => {
      const res = await supabase
        .from('delivery_data')
        .select('date,delivery_pct,total_volume,ai_insight')
        .eq('company_id', companyId)
        .order('date', { ascending: false })
        .limit(220)
      if (!cancel) setDeliveryHistoryDesc(res.data ?? [])
    })()
    return () => {
      cancel = true
    }
  }, [companyId])

  const todayRow =
    mergedDesc.find((r) => String(r.date).slice(0, 10) === String(signalsRow?.date || '').slice(0, 10)) ||
    mergedDesc[0]

  const todayPct = valueNum(todayRow?.delivery_pct)

  const monthRows = mergedDesc.slice(0, 30)
  const avg30scratch = monthRows.length
    ? monthRows.reduce((s, r) => s + valueNum(r.delivery_pct), 0) / monthRows.length
    : 0
  const vsRatio = avg30scratch > 0 ? todayPct / avg30scratch : null
  const aiInsightFromRow = typeof todayRow?.ai_insight === 'string' ? todayRow.ai_insight.trim() : ''
  const aiInsightFallback =
    mergedDesc.map((r) => (typeof r.ai_insight === 'string' ? r.ai_insight.trim() : '')).find(Boolean) || ''

  const activeTab = TABS.find((t) => t.id === tabId) || TABS[1]

  const { chartBars, derivedWindow } = useMemo(() => {
    const n = activeTab.days
    const win = mergedDesc
      .slice(0, n)
      .sort((a, b) => new Date(String(a.date).slice(0, 10)).getTime() - new Date(String(b.date).slice(0, 10)).getTime())
    const bars = win.map((r) => ({
      date: r.date,
      delivery_pct: valueNum(r.delivery_pct),
      total_volume: valueNum(r.total_volume),
      dateLabel: formatBarAxisDate(r.date),
    }))
    return { chartBars: bars, derivedWindow: deriveDeliveryWindow(win) }
  }, [mergedDesc, activeTab.days])

  /** Stats + chart always match the selected N‑day window (last N trading rows). */
  const avgDeliveryShown = derivedWindow.avgDelivery
  const avgVolumeShown = derivedWindow.avgVolume

  const trendContext = useMemo(
    () => deliveryTrendContextRead(signalsRow, latestStage, signalsFetched),
    [signalsRow, latestStage, signalsFetched],
  )

  const explainContext =
    aiInsightFromRow ||
    aiInsightFallback ||
    'Delivery versus typical trading patterns — use tabs to compare 7D through 90D windows.'

  const shellClass = embedded ? '' : 'rounded-2xl border p-4'
  const shellStyle = embedded
    ? {}
    : {
        background: C.surfaceCard,
        borderColor: C.border,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.035)',
      }

  return (
    <div className={shellClass} style={shellStyle}>
      {!embedded ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold" style={{ color: C.textHeading }}>
            Delivery Analysis
          </h3>
          <ExplainButton context={explainContext} symbol={symbol} />
        </div>
      ) : !hideExplain ? (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <ExplainButton context={explainContext} symbol={symbol} />
        </div>
      ) : null}

      {!mergedDesc.length ? (
        <p className="text-sm" style={{ color: C.textMuted }}>
          No delivery history yet for this stock.
        </p>
      ) : (
        <>
          <div className="mb-4 flex min-h-[44px] rounded-lg border p-1" style={{ borderColor: C.border, background: C.surface2 }}>
            {TABS.map((t) => {
              const on = t.id === tabId
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTabId(t.id)}
                  className="flex min-h-[44px] flex-1 items-center justify-center rounded-md px-2 py-2 text-xs font-semibold transition-all duration-200 hover:opacity-95 sm:min-h-[44px] sm:py-1.5"
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

          <div className="grid min-h-[100px] grid-cols-3 gap-2 sm:gap-3">
            <div
              className="flex min-h-[88px] flex-col justify-center rounded-xl border px-2 py-2 text-center sm:px-3 sm:py-3"
              style={{ borderColor: C.border, background: C.surface2 }}
            >
              <p className="text-[11px] font-medium leading-tight sm:text-xs" style={{ color: C.textMuted }}>
                Avg delivery % ({activeTab.label})
              </p>
              <p
                className="mt-1.5 text-lg font-bold tabular-nums leading-none tracking-tight sm:text-2xl"
                style={{
                  color:
                    avgDeliveryShown != null && Number.isFinite(avgDeliveryShown)
                      ? valueColor(avgDeliveryShown)
                      : C.textMuted,
                }}
              >
                {pctOrDash(avgDeliveryShown)}
              </p>
            </div>
            <div
              className="flex min-h-[88px] flex-col justify-center rounded-xl border px-2 py-2 text-center sm:px-3 sm:py-3"
              style={{ borderColor: C.border, background: C.surface2 }}
            >
              <p className="text-[11px] font-medium leading-tight sm:text-xs" style={{ color: C.textMuted }}>
                Avg volume ({activeTab.label})
              </p>
              <p
                className="mt-1.5 break-all text-lg font-bold tabular-nums leading-none tracking-tight sm:text-2xl sm:break-normal sm:text-xl"
                style={{ color: C.text }}
              >
                {formatVolume(avgVolumeShown)}
              </p>
            </div>
            <div
              className="flex min-h-[88px] flex-col justify-center rounded-xl border px-2 py-2 sm:px-3 sm:py-3"
              style={{ borderColor: C.border, background: C.surface2 }}
            >
              <p className="mb-2 text-center text-[11px] font-medium leading-tight sm:text-xs" style={{ color: C.textMuted }}>
                Delivery read (30d)
              </p>
              <TrendContextBlock variant={trendContext.variant} lines={trendContext.lines} />
            </div>
          </div>

          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-snug" style={{ color: C.textMuted }}>
            <span>
              Latest session:{' '}
              <span className="font-semibold tabular-nums" style={{ color: valueColor(todayPct) }}>
                {pctDisplay(todayPct)}
              </span>
            </span>
            <span className="hidden sm:inline" aria-hidden style={{ opacity: 0.4 }}>
              |
            </span>
            <span style={{ color: ratioColor(vsRatio) }}>{ratioLine(vsRatio)}</span>
          </p>

          {chartBars.length ? (
            <div className="mt-4 h-[120px] w-full min-w-0 max-w-full overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartBars} margin={{ top: 6, right: 4, left: 0, bottom: 22 }}>
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: C.textMuted, fontSize: 9 }}
                    axisLine={{ stroke: C.border }}
                    tickLine={false}
                    interval={4}
                    height={28}
                  />
                  <Tooltip content={<ChartTooltipBar />} cursor={{ fill: `${C.border}33` }} />
                  <Bar dataKey="delivery_pct" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                    {chartBars.map((entry, i) => (
                      <Cell key={`c-${entry.date}-${i}`} fill={barColor(entry.delivery_pct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-xs" style={{ color: C.textMuted }}>
              Not enough trading days in this window for a chart yet.
            </p>
          )}

          {aiInsightFromRow || aiInsightFallback ? (
            <p className="mt-3 text-sm italic leading-relaxed" style={{ color: C.textMuted }}>
              {aiInsightFromRow || aiInsightFallback}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
