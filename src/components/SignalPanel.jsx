import { C, statusColor } from '../styles/tokens'

function dotColor(status) {
  if (status === 'green' || status === 'amber' || status === 'red') {
    return statusColor(status)
  }
  return C.textMuted
}

const PLACEHOLDER_NAMES = [
  'Revenue quality',
  'Margin trend',
  'Delivery behaviour',
  'Stage momentum',
  'Risk flags',
]

export default function SignalPanel({ signals = [], variant = 'stack', compact = false }) {
  if (variant === 'rows') {
    const slots = Array.from({ length: 5 }, (_, i) => signals[i] ?? null)
    return (
      <div className="space-y-0">
        {slots.map((signal, idx) => {
          const status = String(signal?.status || 'neutral').toLowerCase()
          const isEmpty = !signal
          const label = isEmpty
            ? 'Data pending'
            : String(signal?.label || signal?.status_label || '—')
          const name = signal?.name || PLACEHOLDER_NAMES[idx] || `Signal ${idx + 1}`

          return (
            <div
              key={`slot-${idx}`}
              className={`flex w-full items-center justify-between gap-2 border-b last:border-b-0 ${compact ? 'py-2' : 'gap-3 py-3'}`}
              style={{
                borderColor: C.border,
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`inline-block shrink-0 rounded-full ${compact ? 'h-2 w-2' : 'h-2.5 w-2.5'}`}
                  style={{ background: isEmpty ? 'var(--text-hint)' : dotColor(status) }}
                />
                <span
                  className={`truncate font-semibold ${compact ? 'text-[12px]' : 'text-[13px]'}`}
                  style={{ color: isEmpty ? 'var(--text-muted)' : C.text }}
                >
                  {name}
                </span>
              </div>
              <span
                className={`shrink-0 rounded-md border font-semibold ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}
                style={{
                  borderColor: isEmpty ? C.border : C.border,
                  color: isEmpty ? 'var(--text-muted)' : dotColor(status),
                  background: isEmpty ? 'rgba(15,23,42,0.5)' : 'rgba(15,23,42,0.8)',
                }}
              >
                {label}
              </span>
              {!compact ? (
                <span className="shrink-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  →
                </span>
              ) : null}
            </div>
          )
        })}
        {!compact ? (
          <p className="pt-2 text-[11px] italic" style={{ color: C.textMuted }}>
            Signal conditions based on public data only. Not investment advice.
          </p>
        ) : null}
      </div>
    )
  }

  const rootClass =
    variant === 'grid'
      ? 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5'
      : 'space-y-2'

  return (
    <div className={rootClass}>
      {signals.map((signal, idx) => {
        const status = String(signal?.status || 'neutral').toLowerCase()
        const label = signal?.label || signal?.status_label || ''
        const name = signal?.name || `Signal ${idx + 1}`

        return (
          <div
            key={`${name}-${idx}`}
            className="w-full rounded-xl border p-3 text-left"
            style={{
              borderColor: C.border,
              background: C.surface,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: dotColor(status), minWidth: 12, minHeight: 12 }}
                />
                <span className="text-sm font-bold" style={{ color: C.text }}>
                  {name}
                </span>
              </div>
              <span className="text-xs font-medium" style={{ color: dotColor(status) }}>
                {label}
              </span>
            </div>
          </div>
        )
      })}

      <p className="pt-1 text-xs italic" style={{ color: C.textMuted }}>
        Signal conditions based on public data only.
        <br />
        Not investment advice.
      </p>
    </div>
  )
}
