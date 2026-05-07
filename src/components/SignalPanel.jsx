import { useState } from 'react'
import { C, statusBg, statusColor } from '../styles/tokens'

function dotColor(status) {
  if (status === 'green' || status === 'amber' || status === 'red') {
    return statusColor(status)
  }
  return C.textMuted
}

export default function SignalPanel({ signals = [] }) {
  const [openRows, setOpenRows] = useState({})

  const toggleRow = (idx) => {
    setOpenRows((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  return (
    <div className="space-y-2">
      {signals.map((signal, idx) => {
        const status = String(signal?.status || 'neutral').toLowerCase()
        const isOpen = Boolean(openRows[idx])
        const isRed = status === 'red'
        const label = signal?.label || signal?.status_label || ''
        const detail = signal?.detail || ''
        const name = signal?.name || `Signal ${idx + 1}`

        return (
          <button
            key={`${name}-${idx}`}
            type="button"
            onClick={() => toggleRow(idx)}
            className="w-full rounded-xl border p-3 text-left transition-colors"
            style={{
              borderColor: C.border,
              background: isRed ? statusBg('red') : C.surface,
              borderLeft: isRed ? `3px solid ${C.red}` : `1px solid ${C.border}`,
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

            <div
              className="overflow-hidden transition-all duration-300 ease-out"
              style={{
                maxHeight: isOpen ? '220px' : '0px',
                opacity: isOpen ? 1 : 0,
              }}
            >
              <p className="mt-2 text-sm leading-6" style={{ color: C.textMuted }}>
                {detail}
              </p>
            </div>
          </button>
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
