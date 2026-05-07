import { C } from '../styles/tokens'

const SEVERITY_ICON = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
}

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

function parseSummaryLines(changes) {
  const summary = changes?.ai_summary
  if (Array.isArray(summary)) return summary.slice(0, 3).map((x) => String(x || ''))
  if (typeof summary === 'string') {
    return summary
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 3)
  }
  return []
}

function headlineConfig(changes) {
  const hasMajor = Array.isArray(changes?.changes) && changes.changes.length > 0
  const severity = String(changes?.headline_severity || '').toLowerCase()
  const firstTimePositive = (changes?.changes || []).some(
    (c) => c?.is_first_time && String(c?.severity || '').toLowerCase() === 'high',
  )

  if (!hasMajor) {
    return {
      text: '— No major changes this quarter',
      prefix: '',
      bg: C.surface2,
      color: C.textMuted,
      border: C.border,
    }
  }

  if (severity === 'high') {
    return {
      text: titleCase(changes?.headline || 'Major change detected'),
      prefix: '⚠️ ',
      bg: C.redBg,
      color: C.red,
      border: C.red,
    }
  }

  if (firstTimePositive) {
    return {
      text: titleCase(changes?.headline || 'Positive first-time event'),
      prefix: '✅ ',
      bg: C.greenBg,
      color: C.green,
      border: C.greenBorder || C.green,
    }
  }

  return {
    text: titleCase(changes?.headline || 'Change detected this quarter'),
    prefix: '⚠️ ',
    bg: C.amberBg,
    color: C.amber,
    border: C.amberBorder || C.amber,
  }
}

export default function WhatChanged({ changes = {} }) {
  const rows = Array.isArray(changes?.changes) ? changes.changes : []
  const head = headlineConfig(changes)
  const summaryLines = parseSummaryLines(changes)

  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border p-4"
        style={{ background: head.bg, borderColor: head.border, color: head.color }}
      >
        <p className="text-lg font-extrabold leading-7">
          {head.prefix}
          {head.text}
        </p>
      </div>

      {rows.map((row, idx) => {
        const severity = String(row?.severity || 'low').toLowerCase()
        const icon = SEVERITY_ICON[severity] || SEVERITY_ICON.low
        const description = titleCase(row?.type || 'Change')
        const isFirstTime = Boolean(row?.is_first_time)

        return (
          <div
            key={`${row?.type || 'change'}-${idx}`}
            className="rounded-xl border p-3"
            style={{ background: C.surface, borderColor: C.border }}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-6" style={{ color: C.text }}>
                <span className="mr-2 text-base">{icon}</span>
                {description}
              </p>
              {isFirstTime ? (
                <span
                  className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: C.amber, borderColor: C.amberBorder || C.amber, background: C.amberBg }}
                >
                  First Time
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
              {toDisplayValue(row?.previous_value)} → {toDisplayValue(row?.current_value)}
            </p>
          </div>
        )
      })}

      {summaryLines.length > 0 ? (
        <div className="rounded-xl border p-4" style={{ background: C.surface2, borderColor: C.border }}>
          {summaryLines[0] ? (
            <p className="text-sm leading-6" style={{ color: C.text }}>
              {summaryLines[0]}
            </p>
          ) : null}
          {summaryLines[1] ? (
            <p className="mt-1 text-sm leading-6" style={{ color: C.text }}>
              {summaryLines[1]}
            </p>
          ) : null}
          {summaryLines[2] ? (
            <p className="mt-1 text-sm italic leading-6" style={{ color: C.textMuted }}>
              👁️ WATCH: {summaryLines[2].replace(/^WATCH:\s*/i, '')}
            </p>
          ) : null}
        </div>
      ) : null}

      {changes?.watch_next ? (
        <p className="text-xs" style={{ color: C.textMuted }}>
          Next results expected: ~{changes.watch_next}
        </p>
      ) : null}
    </div>
  )
}
