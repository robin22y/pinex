import { C } from '../../styles/tokens'

export default function Trend({ value = 0, suffix = '', showArrow = true }) {
  const num = Number(value) || 0
  const positive = num > 0
  const negative = num < 0
  const color = positive ? C.green : negative ? C.red : C.textMuted
  const arrow = positive ? '▲' : negative ? '▼' : '•'
  const formatted = `${Number(num).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix || ''}`

  return (
    <span style={{ color }} className="inline-flex items-center gap-1 font-medium">
      {showArrow ? <span>{arrow}</span> : null}
      <span>{formatted}</span>
    </span>
  )
}
