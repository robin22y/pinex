import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Dot,
} from 'recharts'
import { C } from '../styles/tokens'

const COLORS = {
  promoter: '#F59E0B',
  fii: '#38BDF8',
  dii: '#A78BFA',
  retail: '#475569',
  red: '#EF4444',
}

function asNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function pct(value) {
  return `${asNumber(value).toFixed(2)}%`
}

function DropDot(props) {
  const { cx, cy, payload, dataKey, stroke } = props
  const dropKey = `${dataKey}Drop`
  const isDrop = Boolean(payload?.[dropKey])
  return <Dot cx={cx} cy={cy} r={isDrop ? 4 : 2.5} fill={isDrop ? COLORS.red : stroke} stroke="none" />
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
  const rows = data.map((row, idx) => {
    const prev = idx > 0 ? data[idx - 1] : null
    const promoter = asNumber(row?.promoter_pct)
    const fii = asNumber(row?.fii_pct)
    const dii = asNumber(row?.dii_pct)
    const retail = asNumber(row?.public_pct ?? row?.retail_pct)

    const promoterPrev = asNumber(prev?.promoter_pct)
    const fiiPrev = asNumber(prev?.fii_pct)
    const diiPrev = asNumber(prev?.dii_pct)
    const retailPrev = asNumber(prev?.public_pct ?? prev?.retail_pct)

    return {
      quarter: row?.quarter_name || row?.quarter || `Q${idx + 1}`,
      promoter,
      fii,
      dii,
      retail,
      promoterDrop: idx > 0 && promoterPrev - promoter > 1,
      fiiDrop: idx > 0 && fiiPrev - fii > 1,
      diiDrop: idx > 0 && diiPrev - dii > 1,
      retailDrop: idx > 0 && retailPrev - retail > 1,
      named_investors: Array.isArray(row?.named_investors) ? row.named_investors : [],
    }
  })

  const latest = rows[rows.length - 1] || {}
  const previous = rows[rows.length - 2] || {}
  const namedInvestors = Array.isArray(latest.named_investors) ? latest.named_investors.slice(0, 5) : []

  return (
    <div>
      <div style={{ width: '100%', height: '200px', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 2, bottom: 8 }}>
            <XAxis dataKey="quarter" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="promoter"
              stroke={COLORS.promoter}
              strokeWidth={2.5}
              dot={<DropDot dataKey="promoter" />}
            />
            <Line type="monotone" dataKey="fii" stroke={COLORS.fii} strokeWidth={2} dot={<DropDot dataKey="fii" />} />
            <Line type="monotone" dataKey="dii" stroke={COLORS.dii} strokeWidth={2} dot={<DropDot dataKey="dii" />} />
            <Line
              type="monotone"
              dataKey="retail"
              stroke={COLORS.retail}
              strokeWidth={2}
              dot={<DropDot dataKey="retail" />}
            />
          </LineChart>
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
