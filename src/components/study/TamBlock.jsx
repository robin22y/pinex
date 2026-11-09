/**
 * TamBlock — market sizing. Every row states what kind of estimate it is,
 * shows its inputs and arithmetic, and the result.
 */
import { Paras } from './markdown.jsx'
import { arr, hasText, sortedRows } from './data.js'
import { formatAmount, formatNumber, toNum } from './format.js'
import { Section, SourceRef } from './primitives.jsx'
import { ESTIMATE_LABELS, LEVEL_LABELS } from './labels.js'

function inputValue(inp) {
  const n = toNum(inp?.value)
  const v = n !== null ? formatNumber(n) : hasText(inp?.value) ? inp.value : '—'
  return hasText(inp?.unit) ? `${v} ${inp.unit}` : v
}

export default function TamBlock({ title, tam, sourceNumbers }) {
  const rows = sortedRows(tam).filter((t) => hasText(t?.market))
  if (!rows.length) return null
  return (
    <Section id="market" title={title}>
      <ul className="st-cards">
        {rows.map((t, i) => {
          const inputs = arr(t.inputs).filter((x) => x && hasText(x.label))
          const result =
            toNum(t.result_value) !== null
              ? formatAmount(t.result_value, t.result_currency, t.result_unit)
              : null
          return (
            <li key={t.id ?? i} className="st-card">
              <p>
                {LEVEL_LABELS[t.level] && <span className="st-badge">{LEVEL_LABELS[t.level]}</span>}
                {ESTIMATE_LABELS[t.estimate_type] && (
                  <span className="st-badge">{ESTIMATE_LABELS[t.estimate_type]}</span>
                )}
              </p>
              <h3>
                {t.market}
                {hasText(t.geography) ? `, ${t.geography}` : ''}
                <SourceRef id={t.source_id} sourceNumbers={sourceNumbers} />
              </h3>
              <dl className="st-dl">
                {inputs.length > 0 && (
                  <>
                    <dt>Inputs</dt>
                    <dd>
                      <ul>
                        {inputs.map((inp, j) => (
                          <li key={j}>
                            {inp.label}: <span className="st-num">{inputValue(inp)}</span>
                            <SourceRef id={inp.source_id} sourceNumbers={sourceNumbers} />
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
                {hasText(t.calculation) && (
                  <>
                    <dt>Calculation</dt>
                    <dd>
                      <Paras text={t.calculation} />
                    </dd>
                  </>
                )}
                {result && (
                  <>
                    <dt>Result</dt>
                    <dd>
                      <strong className="st-num">{result}</strong>
                      {toNum(t.as_of_year) !== null ? ` (${t.as_of_year})` : ''}
                    </dd>
                  </>
                )}
                {hasText(t.notes) && (
                  <>
                    <dt>Notes</dt>
                    <dd>
                      <Paras text={t.notes} />
                    </dd>
                  </>
                )}
              </dl>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
