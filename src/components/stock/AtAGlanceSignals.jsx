const TAB_MUTED = '#64748B'

const DOT = {
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
  neutral: '#64748B',
}

function labelColor(st) {
  if (st === 'green') return DOT.green
  if (st === 'red') return DOT.red
  if (st === 'amber') return DOT.amber
  return TAB_MUTED
}

export default function AtAGlanceSignals({ rows = [] }) {
  const slots = Array.from({ length: 5 }, (_, i) => rows[i] || null)

  return (
    <div className="space-y-0">
      {slots.map((row, idx) => {
        if (!row) {
          return (
            <div
              key={`empty-${idx}`}
              className="border-b py-3 last:border-b-0"
              style={{ borderColor: '#1E293B' }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: '#475569' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-white">—</p>
                </div>
                <span style={{ color: TAB_MUTED, fontSize: 12 }}>—</span>
              </div>
            </div>
          )
        }
        const st = String(row.status || 'neutral').toLowerCase()
        const dot = DOT[st] || DOT.neutral
        return (
          <div
            key={`${row.name}-${idx}`}
            className="border-b py-3 last:border-b-0"
            style={{ borderColor: '#1E293B' }}
          >
            <div className="flex items-start gap-2">
              <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                  <p className="text-[13px] font-bold text-white">{row.name}</p>
                  <span
                    className="shrink-0 text-right text-[13px] font-semibold"
                    style={{ color: labelColor(st) }}
                  >
                    {row.label}
                  </span>
                </div>
                {row.description ? (
                  <p className="mt-1 text-[12px] leading-snug" style={{ color: TAB_MUTED }}>
                    {row.description}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
