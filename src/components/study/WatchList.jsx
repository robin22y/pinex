/** WatchList — "What we're watching". Inactive items are not shown. */
import { hasText, sortedRows } from './data.js'
import { Section } from './primitives.jsx'

export default function WatchList({ title, watch_items }) {
  const rows = sortedRows(watch_items).filter((w) => w?.is_active !== false && hasText(w?.label))
  if (!rows.length) return null
  return (
    <Section id="watching" title={title}>
      <ul>
        {rows.map((w, i) => (
          <li key={w.id ?? i}>
            <strong>{w.label}</strong>
            {hasText(w.note) ? ` — ${w.note}` : ''}
          </li>
        ))}
      </ul>
    </Section>
  )
}
