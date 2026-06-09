import { useEffect, useState } from 'react'
import FactsOnlyDisclaimer from './FactsOnlyDisclaimer'
import ObservationQuestion from './ObservationQuestion'

import Icon from './ui/Icon'
/**
 * DailyChecklist — six questions the reader runs themselves before
 * opening any stock. The questions enforce the PineX editorial line:
 * each prompt nudges the reader to look at breadth, sectors, their
 * own watchlist, multiple timeframes, an invalidation level, and
 * position size — never a directive instruction.
 *
 * State persists for the current calendar day via localStorage. When
 * the date rolls over, the storage key changes and ticks reset
 * naturally — no scheduled task, no midnight handler needed.
 *
 * Hard rule: the component never grades, counts, or reacts to which
 * boxes are checked. The user is checking themselves, not us
 * checking them.
 */

const QUESTIONS = [
  "Have you checked today's market breadth?",
  'Do you know which sectors are leading and lagging this week?',
  "Have you reviewed your watchlist's phase distribution today?",
  'Are you about to act on a single chart or on a full timeframe view?',
  'Have you noted what would invalidate the criteria match you’re looking at?',
  "Are you sized so a single position can't change your week?",
]

function todayKey() {
  // YYYY-MM-DD in local time — when the date rolls over the key
  // changes, so the persisted ticks naturally expire.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `pinex_daily_checklist_${y}-${m}-${day}`
}

function readChecked() {
  try {
    const raw = localStorage.getItem(todayKey())
    if (!raw) return Array(QUESTIONS.length).fill(false)
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return Array(QUESTIONS.length).fill(false)
    // Pad / trim defensively in case the question count changes.
    const next = Array(QUESTIONS.length).fill(false)
    for (let i = 0; i < QUESTIONS.length; i++) next[i] = !!arr[i]
    return next
  } catch {
    return Array(QUESTIONS.length).fill(false)
  }
}

export default function DailyChecklist() {
  const [checked, setChecked] = useState(() => readChecked())

  // If the page stays open past midnight, refresh the visible state
  // from the new day's storage key on next interaction. We don't
  // schedule a midnight timer — that's overkill for a static list.
  useEffect(() => {
    const sync = () => setChecked(readChecked())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  const toggle = (i) => {
    setChecked((prev) => {
      const next = prev.slice()
      next[i] = !next[i]
      try { localStorage.setItem(todayKey(), JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="list-check" style={{ fontSize: 14, color: 'var(--text-muted)' }} aria-hidden="true" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
            }}
          >
            Today’s Checklist
          </span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>resets at midnight</span>
      </div>

      <div style={{ padding: '8px 4px 12px' }}>
        {QUESTIONS.map((q, i) => {
          const isChecked = !!checked[i]
          const id = `pinex-daily-q-${i}`
          return (
            <label
              key={i}
              htmlFor={id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 12px',
                cursor: 'pointer',
                borderRadius: 8,
              }}
            >
              <input
                id={id}
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(i)}
                style={{
                  marginTop: 2,
                  width: 16,
                  height: 16,
                  accentColor: 'var(--text-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  color: isChecked ? 'var(--text-muted)' : 'var(--text-primary)',
                  lineHeight: 1.5,
                  textDecoration: isChecked ? 'line-through' : 'none',
                }}
              >
                {q}
              </span>
            </label>
          )
        })}
      </div>

      <div style={{ padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)' }}>
        <ObservationQuestion question="What would change your mind by close today?" />
        <FactsOnlyDisclaimer compact />
      </div>
    </div>
  )
}
