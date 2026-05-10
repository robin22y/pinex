import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const BORDER = '#1E293B'
const MUTED = '#64748B'

function fmtMonth(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short' })
}

/** priceHistory: newest first; ma150 & last close from latest row for stroke color */
export default function MiniPriceChart({ priceHistory = [], latestClose = 0, ma150 = 0 }) {
  const asc = [...priceHistory].slice(0, 90).reverse()
  const rows = asc.map((r) => ({
    t: r?.date,
    close: Number(r?.close) || 0,
  }))
  const above = ma150 > 0 && Number(latestClose) >= ma150
  const stroke = above ? '#22c55e' : '#ef4444'
  const fillId = above ? 'miniGreen' : 'miniRed'

  if (!rows.length) {
    return (
      <div className="flex h-[140px] w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-lg border text-[13px]" style={{ borderColor: BORDER, color: MUTED }}>
        Not enough price history
      </div>
    )
  }

  return (
    <div className="h-[140px] w-full min-w-0 max-w-full overflow-hidden">
      <div style={{ width: '100%', height: 140, minWidth: 0, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="t"
            tickFormatter={fmtMonth}
            tick={{ fill: MUTED, fontSize: 10 }}
            axisLine={{ stroke: BORDER }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const p = payload[0].payload
              return (
                <div className="rounded-md border px-2 py-1 text-xs" style={{ background: '#0D1525', borderColor: BORDER, color: '#e2e8f0' }}>
                  <div style={{ color: MUTED }}>{String(p.t).slice(0, 10)}</div>
                  <div className="font-data font-semibold">₹{p.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                </div>
              )
            }}
          />
          <Area type="monotone" dataKey="close" stroke={stroke} strokeWidth={2} fill={`url(#${fillId})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
