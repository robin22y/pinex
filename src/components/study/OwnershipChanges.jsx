/**
 * OwnershipChanges — disclosed holding changes, increases AND decreases,
 * in neutral factual wording. Never framed as "who is buying".
 */
import { Paras } from './markdown.jsx'
import { hasText, ownershipDirection, sortedRows } from './data.js'
import { formatMonthYear, formatPp, toNum } from './format.js'
import { Section, SourceRef } from './primitives.jsx'
import { HOLDER_TYPE_LABELS, ownershipSentence } from './labels.js'

const GROUPS = [
  ['increase', 'Increases'],
  ['decrease', 'Decreases'],
  ['new', 'Newly disclosed holdings'],
  ['exit', 'No longer disclosed'],
]

export default function OwnershipChanges({ title, ownership_changes, sourceNumbers }) {
  const rows = sortedRows(ownership_changes).filter((o) => hasText(o?.holder_name) && ownershipDirection(o))
  if (!rows.length) return null
  return (
    <Section id="ownership-changes" title={title}>
      <p className="st-note">
        Changes in holdings disclosed in shareholding filings. Disclosure thresholds vary by market, so a holding
        that drops below the threshold is shown as no longer disclosed.
      </p>
      {GROUPS.map(([dir, label]) => {
        const items = rows.filter((o) => ownershipDirection(o) === dir)
        if (!items.length) return null
        return (
          <div key={dir} className="st-own-group">
            <h3>{label}</h3>
            <ul className="st-own-list">
              {items.map((o, i) => {
                const typeLabel = HOLDER_TYPE_LABELS[o.holder_type] ?? (hasText(o.holder_type) ? o.holder_type : null)
                const change = dir === 'increase' || dir === 'decrease' ? formatPp(o.change_pct ?? (toNum(o.pct_to) ?? 0) - (toNum(o.pct_from) ?? 0), 2) : null
                return (
                  <li key={o.id ?? i}>
                    <p>
                      {ownershipSentence(o)}
                      <SourceRef id={o.source_id} sourceNumbers={sourceNumbers} />
                    </p>
                    <p className="st-small">
                      {[
                        typeLabel,
                        `${formatMonthYear(o.period_from)} to ${formatMonthYear(o.period_to)}`,
                        change ? `Change ${change}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {hasText(o.profile) && <Paras text={o.profile} className="st-small" />}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </Section>
  )
}
