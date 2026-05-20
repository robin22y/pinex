import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const BORDER = '#1E293B'
const MUTED = 'var(--text-muted)'

const COLORS = {
  promoter: 'var(--warning)',
  fii: '#3B82F6',
  dii: '#A855F7',
  public: 'var(--text-secondary)',
}

function valueNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function parseRowDate(row) {
  const raw = row?.date || row?.quarter || row?.quarter_name || ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatQ(row, idx) {
  const d = parseRowDate(row)
  if (d) return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '")
  return row?.quarter_name || row?.quarter || `Q${idx + 1}`
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border px-3 py-2 text-xs" style={{ background: '#0D1525', borderColor: BORDER, color: '#e2e8f0' }}>
      <p className="mb-1 font-semibold" style={{ color: MUTED }}>
        {label}
      </p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {valueNum(p.value).toFixed(2)}%
        </p>
      ))}
    </div>
  )
}

/**
 * Line chart + quarterly wide table. `data`: shareholding rows, any order.
 */
export default function ShareholdingTrend({ data = [] }) {
  const sorted = [...data].sort((a, b) => {
    const at = parseRowDate(a)?.getTime() ?? 0
    const bt = parseRowDate(b)?.getTime() ?? 0
    return at - bt
  })

  const chartRows = sorted.map((row, idx) => ({
    label: formatQ(row, idx),
    promoter: valueNum(row?.promoter_pct),
    fii: valueNum(row?.fii_pct),
    dii: valueNum(row?.dii_pct),
    public: valueNum(row?.public_pct ?? row?.retail_pct),
  }))

  const lastQ = [...data].sort((a, b) => (parseRowDate(b)?.getTime() ?? 0) - (parseRowDate(a)?.getTime() ?? 0))
  const colQuarters = lastQ.slice(0, 4)
  const categories = [
    { key: 'promoter', label: 'Promoter' },
    { key: 'fii', label: 'FII' },
    { key: 'dii', label: 'DII' },
    { key: 'public', label: 'Public', field: 'public_pct' },
  ]

  function pctAt(row, cat) {
    if (cat.key === 'public') return valueNum(row?.public_pct ?? row?.retail_pct)
    return valueNum(row?.[`${cat.key}_pct`])
  }

  if (!chartRows.length) {
    return <p className="text-[13px]" style={{ color: MUTED }}>No shareholding history.</p>
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-auto">
      <div className="h-[200px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={BORDER} strokeOpacity={0.4} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 10 }} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis
              tick={{ fill: MUTED, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="promoter" name="Promoter" stroke={COLORS.promoter} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="fii" name="FII" stroke={COLORS.fii} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="dii" name="DII" stroke={COLORS.dii} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="public" name="Public" stroke={COLORS.public} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              <th className="py-2 pr-2 font-semibold text-white">Category</th>
              {colQuarters.map((q, i) => (
                <th
                  key={q?.id ?? i}
                  className="py-2 px-2 text-right font-semibold"
                  style={{
                    color: i === 0 ? '#F1F5F9' : MUTED,
                    background: i === 0 ? 'rgba(56,189,248,0.08)' : undefined,
                  }}
                >
                  {formatQ(q, i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, ri) => (
              <tr
                key={cat.key}
                style={{
                  borderBottom: `1px solid ${BORDER}`,
                  background: ri % 2 === 0 ? 'rgba(15,23,42,0.5)' : 'transparent',
                }}
              >
                <td className="py-2.5 pr-2 font-medium" style={{ color: COLORS[cat.key === 'public' ? 'public' : cat.key] }}>
                  {cat.label}
                </td>
                {colQuarters.map((q, ci) => {
                  const cur = pctAt(q, cat)
                  const prevQ = colQuarters[ci + 1]
                  const prev = prevQ ? pctAt(prevQ, cat) : null
                  const d = prev != null ? cur - prev : null
                  return (
                    <td
                      key={`${cat.key}-${ci}`}
                      className="font-data py-2.5 px-2 text-right tabular-nums text-white"
                      style={{ background: ci === 0 ? 'rgba(56,189,248,0.06)' : undefined }}
                    >
                      {cur.toFixed(2)}%
                      {d != null && Math.abs(d) > 0.005 ? (
                        <span className="ml-1 text-[11px]" style={{ color: d >= 0 ? '#34d399' : '#fb7185' }}>
                          {d >= 0 ? '↑' : '↓'}
                        </span>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
