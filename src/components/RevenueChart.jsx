import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { C } from '../styles/tokens'

const REVENUE_BLUE = '#38BDF8'
const PAT_GREEN = '#22C55E'

function asNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function formatCurrency(value) {
  const crores = asNumber(value) / 10000000
  return `${crores.toLocaleString(undefined, { maximumFractionDigits: 2 })} Cr`
}

function growthPct(current, previous) {
  const prev = asNumber(previous)
  const cur = asNumber(current)
  if (!prev) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

function parseRowDate(row) {
  const raw = row?.date || row?.quarter || row?.quarter_name || ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Quarter labels on X axis, e.g. "Dec 24", "Mar 25" */
function fmtAxisDate(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value || '')
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  const revenueItem = payload.find((p) => p.dataKey === 'revenue')
  const patItem = payload.find((p) => p.dataKey === 'pat')
  const revGrowth = revenueItem?.payload?.revenueQoq
  const patGrowth = patItem?.payload?.patQoq
  const quarterLabel = fmtAxisDate(label)

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ background: C.surface, borderColor: C.border, color: C.text }}
    >
      <p className="mb-1 font-semibold">{quarterLabel}</p>
      {revenueItem ? (
        <p style={{ color: REVENUE_BLUE }}>
          Revenue: {formatCurrency(revenueItem.value)}{' '}
          <span style={{ color: C.textMuted }}>
            ({revGrowth === null ? 'NA' : `${revGrowth >= 0 ? '+' : ''}${revGrowth.toFixed(1)}% QoQ`})
          </span>
        </p>
      ) : null}
      {patItem ? (
        <p style={{ color: PAT_GREEN }}>
          PAT: {formatCurrency(patItem.value)}{' '}
          <span style={{ color: C.textMuted }}>
            ({patGrowth === null ? 'NA' : `${patGrowth >= 0 ? '+' : ''}${patGrowth.toFixed(1)}% QoQ`})
          </span>
        </p>
      ) : null}
    </div>
  )
}

export default function RevenueChart({ data = [] }) {
  const sortedSource = [...data]
    .map((row) => ({ ...row, _parsedDate: parseRowDate(row) }))
    .sort((a, b) => {
      const at = a._parsedDate ? a._parsedDate.getTime() : 0
      const bt = b._parsedDate ? b._parsedDate.getTime() : 0
      return at - bt
    })

  const rows = sortedSource.map((row, idx) => {
    const prev = idx > 0 ? sortedSource[idx - 1] : null
    const revenue = asNumber(row?.revenue)
    const pat = asNumber(row?.pat ?? row?.net_profit)
    const prevRevenue = asNumber(prev?.revenue)
    const prevPat = asNumber(prev?.pat ?? prev?.net_profit)

    return {
      quarter: row?._parsedDate ? row._parsedDate.toISOString() : (row?.quarter_name || row?.quarter || `Q${idx + 1}`),
      revenue,
      pat,
      revenueQoq: idx > 0 ? growthPct(revenue, prevRevenue) : null,
      patQoq: idx > 0 ? growthPct(pat, prevPat) : null,
    }
  })

  const aiInsight =
    data.find((r) => typeof r?.ai_insight === 'string' && r.ai_insight.trim())?.ai_insight || ''

  return (
    <div>
      <div className="h-[220px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 12, right: 12, left: 8, bottom: 8 }}
            barGap={2}
            barCategoryGap="22%"
          >
            <CartesianGrid stroke={C.border} strokeOpacity={0.35} vertical={false} />
            <XAxis
              type="category"
              dataKey="quarter"
              tick={{ fill: C.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmtAxisDate}
              minTickGap={24}
              padding={{ left: 8, right: 8 }}
            />
            <YAxis
              tick={{ fill: C.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatCurrency}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Bar dataKey="revenue" name="Revenue" fill={REVENUE_BLUE} radius={[4, 4, 0, 0]} maxBarSize={48} />
            <Bar dataKey="pat" name="PAT" fill={PAT_GREEN} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {aiInsight ? (
        <p className="mt-2 text-sm italic" style={{ color: C.textMuted }}>
          {aiInsight}
        </p>
      ) : null}
    </div>
  )
}
