/**
 * ShareholdingTable — categories as rows, the last 4–6 periods as columns,
 * a sparkline per row. Pledged share of the promoter/insider holding is a
 * sub-row when disclosed.
 */
import { Fragment } from 'react'
import { Sparkline } from './charts.jsx'
import { shareholdingRows } from './data.js'
import { formatMonthYear, formatPct, toNum } from './format.js'
import { Section, SourceRef } from './primitives.jsx'
import { CATEGORY_LABELS } from './labels.js'

const ORDER = Object.keys(CATEGORY_LABELS)

export default function ShareholdingTable({ title, shareholding, sourceNumbers, periods = 6 }) {
  const rows = shareholdingRows({ shareholding })
  if (!rows.length) return null
  const ends = [...new Set(rows.map((r) => r.period_end))].sort().slice(-Math.max(1, Math.min(periods, 6)))
  const get = (cat, end) => rows.find((r) => r.category === cat && r.period_end === end)
  const cats = ORDER.filter((c) => ends.some((e) => get(c, e))).concat(
    [...new Set(rows.map((r) => r.category))].filter((c) => !ORDER.includes(c) && ends.some((e) => get(c, e))),
  )
  const pledged = ends.some((e) => toNum(get('promoter_insider', e)?.pledged_pct) !== null)
  const latestSource = rows.find((r) => r.period_end === ends[ends.length - 1] && r.source_id)?.source_id

  const trendLabel = (label, vals) => {
    const known = vals.map(toNum).filter((v) => v !== null)
    if (known.length < 2) return label
    return `${label}: ${formatPct(known[0])} to ${formatPct(known[known.length - 1])} over ${known.length} periods`
  }

  return (
    <Section id="shareholding" title={title}>
      <div className="st-table-wrap">
        <table>
          <caption>
            Disclosed shareholding, % of total shares. Categories follow the company&rsquo;s filings and can
            overlap (for example, mutual funds are usually part of domestic institutions).
            <SourceRef id={latestSource} sourceNumbers={sourceNumbers} />
          </caption>
          <thead>
            <tr>
              <th scope="col">Holder</th>
              {ends.map((e) => (
                <th key={e} scope="col">
                  {formatMonthYear(e)}
                </th>
              ))}
              {ends.length > 1 && (
                <th scope="col">
                  <span className="st-sr">Trend</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {cats.map((cat) => {
              const vals = ends.map((e) => get(cat, e)?.pct)
              const label = CATEGORY_LABELS[cat] ?? cat
              return (
                <Fragment key={cat}>
                  <tr>
                    <th scope="row">{label}</th>
                    {vals.map((v, i) => (
                      <td key={ends[i]}>{formatPct(v)}</td>
                    ))}
                    {ends.length > 1 && (
                      <td className="st-trend">
                        <Sparkline values={vals} ariaLabel={trendLabel(label, vals)} />
                      </td>
                    )}
                  </tr>
                  {cat === 'promoter_insider' && pledged && (
                    <tr className="st-sub">
                      <th scope="row">of which pledged</th>
                      {ends.map((e) => (
                        <td key={e}>{formatPct(get(cat, e)?.pledged_pct)}</td>
                      ))}
                      {ends.length > 1 && <td />}
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
