import { C } from '../styles/tokens'

function titleCase(text = '') {
  return text
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function toDisplayValue(value) {
  if (value === null || value === undefined || value === '') return 'N/A'
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return String(value)
}

/** Row icon: negative first-time 🔴, positive first-time 🟢, else neutral 🟡 */
function changeRowIcon(row) {
  const ft = Boolean(row?.is_first_time)
  if (!ft) return '🟡'
  const t = String(row?.type || '').toLowerCase()
  const neg = /declin|drop|fall|loss|down|cut|weak|shrink|contract|exit|pledge|debt|lawsuit|risk/i.test(t)
  const pos = /grow|gain|rise|record|beat|expan|strong|surge|up|increase|improv/i.test(t)
  if (neg) return '🔴'
  if (pos) return '🟢'
  const sev = String(row?.severity || '').toLowerCase()
  if (sev === 'high') return '🔴'
  return '🟢'
}

function headlineConfig(changes) {
  const hasMajor = Array.isArray(changes?.changes) && changes.changes.length > 0
  const severity = String(changes?.headline_severity || '').toLowerCase()
  const firstTimePositive = (changes?.changes || []).some(
    (c) => c?.is_first_time && String(c?.severity || '').toLowerCase() === 'high',
  )

  if (!hasMajor) {
    return {
      text: 'Stable quarter — no headline moves',
      color: C.textMuted,
    }
  }

  if (severity === 'high') {
    return {
      text: titleCase(changes?.headline || 'Major change detected'),
      color: C.red,
    }
  }

  if (firstTimePositive) {
    return {
      text: titleCase(changes?.headline || 'Positive first-time event'),
      color: C.green,
    }
  }

  return {
    text: titleCase(changes?.headline || 'Change detected this quarter'),
    color: C.amber,
  }
}

function parseSummaryText(changes) {
  const summary = changes?.ai_summary
  if (Array.isArray(summary)) return summary.map((x) => String(x || '').trim()).filter(Boolean).join('\n')
  if (typeof summary === 'string') return summary.trim()
  return ''
}

export default function WhatChanged({ changes = {} }) {
  const rows = Array.isArray(changes?.changes) ? changes.changes : []
  const head = headlineConfig(changes)
  const summaryText = parseSummaryText(changes)
  const watchRaw = String(changes?.watch_next || '').trim()
  const hasMajor = rows.length > 0

  if (!hasMajor) {
    return (
      <div
        className="rounded-[12px] border border-solid p-5"
        style={{ background: '#111620', borderColor: C.border, color: C.textMuted }}
      >
        <div className="flex gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
            style={{ background: '#1e293b', color: '#94a3b8' }}
            aria-hidden
          >
            ✓
          </span>
          <div>
            <p className="m-0 text-[15px] font-semibold leading-snug" style={{ color: C.textMuted }}>
              — Stable quarter. No significant changes detected.
            </p>
            {summaryText ? (
              <p className="mt-2 m-0 text-[13px] italic leading-relaxed" style={{ color: C.textFaint }}>
                {summaryText}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="m-0 text-[22px] font-extrabold leading-tight tracking-tight" style={{ color: head.color }}>
        {head.text}
      </p>

      {rows.map((row, idx) => {
        const icon = changeRowIcon(row)
        const description = titleCase(row?.type || 'Change')

        return (
          <div
            key={`${row?.type || 'change'}-${idx}`}
            className="rounded-[12px] border border-solid p-3 pr-4"
            style={{ background: C.surface, borderColor: C.border }}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-base leading-none" aria-hidden>
                {icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="m-0 text-[14px] font-semibold leading-snug" style={{ color: C.text }}>
                    {description}
                  </p>
                  {row?.is_first_time ? (
                    <span
                      className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: C.amber, borderColor: C.amberBorder || C.amber, background: C.amberBg }}
                    >
                      First time
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 m-0 text-[12px]" style={{ color: C.textMuted }}>
                  {toDisplayValue(row?.previous_value)} → {toDisplayValue(row?.current_value)}
                </p>
              </div>
            </div>
          </div>
        )
      })}

      {summaryText ? (
        <p className="m-0 text-[14px] italic leading-relaxed" style={{ color: C.textMuted }}>
          {summaryText}
        </p>
      ) : null}

      {watchRaw ? (
        <p className="m-0 flex items-start gap-2 text-[13px] font-medium leading-snug" style={{ color: C.blue }}>
          <span className="mt-0.5 shrink-0" aria-hidden>
            👁
          </span>
          <span>
            <span className="font-bold">Watch:</span> {watchRaw.replace(/^watch:\s*/i, '')}
          </span>
        </p>
      ) : null}
    </div>
  )
}
