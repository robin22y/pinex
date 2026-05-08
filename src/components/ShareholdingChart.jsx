import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { C } from '../styles/tokens'

const COLORS = {
  promoter: '#16A34A',
  fii: '#2563EB',
  dii: '#4F46E5',
  retail: '#475569',
}

function asNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function pct(value) {
  return `${asNumber(value).toFixed(2)}%`
}

function parseRowDate(row) {
  const raw = row?.date || row?.quarter || row?.quarter_name || ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtAxisDate(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value || '')
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '")
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  const byKey = Object.fromEntries(payload.map((p) => [p.dataKey, p.value]))
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ background: C.surface, borderColor: C.border, color: C.text }}
    >
      <p className="mb-1 font-semibold">{label}</p>
      <p style={{ color: COLORS.promoter }}>Promoter: {pct(byKey.promoter)}</p>
      <p style={{ color: COLORS.fii }}>FII: {pct(byKey.fii)}</p>
      <p style={{ color: COLORS.dii }}>DII: {pct(byKey.dii)}</p>
      <p style={{ color: COLORS.retail }}>Retail: {pct(byKey.retail)}</p>
    </div>
  )
}

function changeArrow(change) {
  if (change > 0) return '↑'
  if (change < 0) return '↓'
  return '→'
}

export default function ShareholdingChart({ data = [] }) {
  const sortedSource = [...data]
    .map((row) => ({ ...row, _parsedDate: parseRowDate(row) }))
    .sort((a, b) => {
      const at = a._parsedDate ? a._parsedDate.getTime() : 0
      const bt = b._parsedDate ? b._parsedDate.getTime() : 0
      return at - bt
    })

  const rows = sortedSource.map((row, idx) => {
    const promoter = asNumber(row?.promoter_pct)
    const fii = asNumber(row?.fii_pct)
    const dii = asNumber(row?.dii_pct)
    const retail = asNumber(row?.public_pct ?? row?.retail_pct)

    return {
      quarter: row?._parsedDate ? row._parsedDate.toISOString() : (row?.quarter_name || row?.quarter || `Q${idx + 1}`),
      promoter,
      fii,
      dii,
      retail,
      named_investors: Array.isArray(row?.named_investors) ? row.named_investors : [],
    }
  })

  const latest = rows[rows.length - 1] || {}
  const previous = rows[rows.length - 2] || {}
  const namedInvestors = Array.isArray(latest.named_investors) ? latest.named_investors.slice(0, 5) : []

  return (
    <div>
      <div className="w-full h-[350px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" aspect={2}>
          <BarChart data={rows} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <XAxis
              type="category"
              dataKey="quarter"
              tick={{ fill: C.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmtAxisDate}
              minTickGap={30}
            />
            <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="promoter" name="Promoters" stackId="a" fill={COLORS.promoter} />
            <Bar dataKey="fii" name="FII" stackId="a" fill={COLORS.fii} />
            <Bar dataKey="dii" name="DII" stackId="a" fill={COLORS.dii} />
            <Bar dataKey="retail" name="Public" stackId="a" fill={COLORS.retail} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {namedInvestors.length ? (
        <div className="mt-2 space-y-1">
          {namedInvestors.map((inv, idx) => {
            const name = String(inv?.name || inv?.investor || `Investor ${idx + 1}`)
            const pctValue = asNumber(inv?.pct ?? inv?.holding_pct ?? inv?.percentage)
            const prevMatch = (Array.isArray(previous.named_investors) ? previous.named_investors : []).find(
              (p) => String(p?.name || p?.investor) === name,
            )
            const prevPct = asNumber(prevMatch?.pct ?? prevMatch?.holding_pct ?? prevMatch?.percentage)
            const delta = pctValue - prevPct
            return (
              <div key={`${name}-${idx}`} className="flex items-center justify-between text-xs" style={{ color: C.textMuted }}>
                <span>{name}</span>
                <span>
                  {pct(pctValue)} {changeArrow(delta)}
                </span>
              </div>
            )
          })}
          <p className="pt-1 text-[11px]" style={{ color: C.textFaint }}>
            Source: BSE quarterly filings
          </p>
        </div>
      ) : null}
    </div>
  )
}
