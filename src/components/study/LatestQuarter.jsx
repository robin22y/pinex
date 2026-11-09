/**
 * LatestQuarter — the most recent 'Q' row, with YoY / QoQ against the
 * comparable quarters (matched by period_end month: 12 and 3 months back)
 * and margins computed from the row itself. Growth is not shown when the
 * comparison base is zero or negative.
 */
import { Markdown } from './markdown.jsx'
import { arr, financialSeries, hasText, monthIndex } from './data.js'
import {
  DASH,
  currencySymbol,
  fiscalLabel,
  formatFigure,
  formatPct,
  formatPp,
  formatSignedPct,
  growth,
  margin,
  toNum,
  unitLabel,
} from './format.js'
import { Section, SourceRef } from './primitives.jsx'

const AMOUNTS = [
  ['revenue', 'Revenue'],
  ['ebitda', 'EBITDA'],
  ['pat', 'Profit after tax'],
]

function findBack(series, latest, months) {
  const target = monthIndex(latest.period_end) - months
  return series.find((r) => monthIndex(r.period_end) === target) || null
}

export default function LatestQuarter({ title, financial_periods, period_notes, currency, unit, sourceNumbers }) {
  const series = financialSeries(financial_periods, 'Q')
  if (!series.length) return null
  const latest = series[series.length - 1]
  const yearAgo = findBack(series, latest, 12)
  const prevQ = findBack(series, latest, 3)
  const cur = latest.currency || currency
  const u = latest.unit || unit
  const fig = (v) => formatFigure(v, cur, u)
  const note = arr(period_notes).find((n) => n?.period_end === latest.period_end && hasText(n?.what_changed_md))

  const rows = []
  for (const [k, label] of AMOUNTS) {
    if (toNum(latest[k]) === null) continue
    rows.push({
      key: k,
      label,
      now: fig(latest[k]),
      then: yearAgo ? fig(yearAgo[k]) : DASH,
      yoy: formatSignedPct(growth(latest[k], yearAgo?.[k])),
      qoq: formatSignedPct(growth(latest[k], prevQ?.[k])),
    })
  }
  for (const [k, label] of [['ebitda', 'EBITDA margin'], ['pat', 'PAT margin']]) {
    const m = margin(latest[k], latest.revenue)
    if (m === null) continue
    const mY = yearAgo ? margin(yearAgo[k], yearAgo.revenue) : null
    const mQ = prevQ ? margin(prevQ[k], prevQ.revenue) : null
    rows.push({
      key: `${k}-margin`,
      label,
      sub: true,
      now: formatPct(m),
      then: formatPct(mY),
      yoy: mY === null ? DASH : formatPp(m - mY),
      qoq: mQ === null ? DASH : formatPp(m - mQ),
    })
  }
  if (toNum(latest.eps) !== null) {
    rows.push({
      key: 'eps',
      label: `EPS (${currencySymbol(cur).trim() || 'per share'})`,
      now: formatFigure(latest.eps, cur, null, { decimals: 2 }),
      then: yearAgo ? formatFigure(yearAgo.eps, cur, null, { decimals: 2 }) : DASH,
      yoy: formatSignedPct(growth(latest.eps, yearAgo?.eps)),
      qoq: formatSignedPct(growth(latest.eps, prevQ?.eps)),
    })
  }

  const label = fiscalLabel(latest)
  return (
    <Section id="latest-quarter" title={title}>
      <p className="st-small">
        {label} · {latest.basis === 'standalone' ? 'Standalone' : 'Consolidated'}
        <SourceRef id={latest.source_id} sourceNumbers={sourceNumbers} />
      </p>
      {rows.length > 0 && (
        <div className="st-table-wrap">
          <table>
            <caption>
              {unitLabel(cur, u) || 'Reported figures'}, unless stated. Margins and changes are computed by PineX
              from the reported figures.
            </caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">{label}</th>
                <th scope="col">{yearAgo ? fiscalLabel(yearAgo) : 'Year earlier'}</th>
                <th scope="col">YoY</th>
                <th scope="col">QoQ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.sub ? 'st-sub' : undefined}>
                  <th scope="row">{r.label}</th>
                  <td>{r.now}</td>
                  <td>{r.then}</td>
                  <td>{r.yoy}</td>
                  <td>{r.qoq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && (
        <div className="st-what-changed">
          <h3>What changed</h3>
          <Markdown source={note.what_changed_md} keyPrefix="lq" />
        </div>
      )}
    </Section>
  )
}
