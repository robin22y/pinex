import ExplainButton from './ui/ExplainButton'
import { C } from '../styles/tokens'

function asNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function pct(value) {
  return `${asNumber(value).toFixed(1)}%`
}

function valueColor(v) {
  if (v > 50) return C.green
  if (v < 35) return C.red
  return C.amber
}

function ratioLine(ratio) {
  const r = asNumber(ratio)
  if (r > 1) return `Today is ${r.toFixed(1)}× above normal`
  return `Today is ${r.toFixed(1)}× below normal`
}

function ratioColor(ratio) {
  const r = asNumber(ratio)
  if (r > 1.5) return C.green
  if (r < 0.5) return C.red
  return C.textMuted
}

export default function DeliveryPanel({ delivery = {} }) {
  const today = asNumber(delivery?.today)
  const week = asNumber(delivery?.week_avg)
  const month = asNumber(delivery?.month_avg)
  const vs30d = asNumber(delivery?.vs_30d_avg)

  const stats = [
    { label: 'Today', value: today },
    { label: '7-day avg', value: week },
    { label: '30-day avg', value: month },
  ]

  return (
    <div className="rounded-xl border p-4" style={{ background: C.surface, borderColor: C.border }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold" style={{ color: C.text }}>
          Delivery
        </h3>
        <ExplainButton context={delivery?.ai_insight || ''} symbol={delivery?.symbol || ''} />
      </div>

      <div className="grid min-h-[160px] grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex min-h-[140px] flex-col justify-center rounded-lg border px-3 py-4 text-center"
            style={{ borderColor: C.border, background: C.surface2 }}
          >
            <p className="text-xs font-medium leading-tight" style={{ color: C.textMuted }}>
              {s.label}
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums leading-none tracking-tight" style={{ color: valueColor(s.value) }}>
              {pct(s.value)}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs leading-snug" style={{ color: ratioColor(vs30d) }}>
        {ratioLine(vs30d)}
      </p>

      {delivery?.ai_insight ? (
        <p className="mt-2 text-sm italic" style={{ color: C.textMuted }}>
          {delivery.ai_insight}
        </p>
      ) : null}
    </div>
  )
}
