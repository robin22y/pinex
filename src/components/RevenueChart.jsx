import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { C } from '../styles/tokens'

const BLUE = '#38BDF8'
const GREEN = '#22C55E'
const RED = '#EF4444'

function asNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function moneyCr(value) {
  return `₹${asNumber(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}cr`
}

function growthPct(current, previous) {
  const prev = asNumber(previous)
  const cur = asNumber(current)
  if (!prev) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null

  const revenueItem = payload.find((p) => p.dataKey === 'revenue')
  const patItem = payload.find((p) => p.dataKey === 'pat')

  const revGrowth = revenueItem?.payload?.revenueQoq
  const patGrowth = patItem?.payload?.patQoq

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ background: C.surface, borderColor: C.border, color: C.text }}
    >
      <p className="mb-1 font-semibold">{label}</p>
      {revenueItem ? (
        <p style={{ color: BLUE }}>
          Revenue: {moneyCr(revenueItem.value)}{' '}
          <span style={{ color: C.textMuted }}>
            ({revGrowth === null ? 'NA' : `${revGrowth >= 0 ? '+' : ''}${revGrowth.toFixed(1)}% QoQ`})
          </span>
        </p>
      ) : null}
      {patItem ? (
        <p style={{ color: GREEN }}>
          PAT: {moneyCr(patItem.value)}{' '}
          <span style={{ color: C.textMuted }}>
            ({patGrowth === null ? 'NA' : `${patGrowth >= 0 ? '+' : ''}${patGrowth.toFixed(1)}% QoQ`})
          </span>
        </p>
      ) : null}
    </div>
  )
}

export default function RevenueChart({ data = [] }) {
  const rows = data.map((row, idx) => {
    const prev = idx > 0 ? data[idx - 1] : null
    const revenue = asNumber(row?.revenue)
    const pat = asNumber(row?.net_profit ?? row?.pat)
    const prevRevenue = asNumber(prev?.revenue)
    const prevPat = asNumber(prev?.net_profit ?? prev?.pat)

    return {
      quarter: row?.quarter_name || row?.quarter || `Q${idx + 1}`,
      revenue,
      pat,
      revenueDown: idx > 0 && revenue < prevRevenue,
      patDown: idx > 0 && pat < prevPat,
      revenueQoq: idx > 0 ? growthPct(revenue, prevRevenue) : null,
      patQoq: idx > 0 ? growthPct(pat, prevPat) : null,
    }
  })

  const aiInsight =
    data.find((r) => typeof r?.ai_insight === 'string' && r.ai_insight.trim())?.ai_insight || ''

  return (
    <div>
      <div style={{ width: '100%', height: '220px', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
            <CartesianGrid stroke={C.border} strokeOpacity={0.35} vertical={false} />
            <XAxis dataKey="quarter" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: C.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `₹${asNumber(v)}cr`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
              {rows.map((entry, idx) => (
                <Cell key={`rev-${idx}`} fill={entry.revenueDown ? RED : BLUE} />
              ))}
            </Bar>
            <Bar dataKey="pat" radius={[4, 4, 0, 0]}>
              {rows.map((entry, idx) => (
                <Cell key={`pat-${idx}`} fill={entry.patDown ? RED : GREEN} />
              ))}
            </Bar>
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
