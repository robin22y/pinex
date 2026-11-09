/**
 * FinancialHistory — last 5 fiscal years: a table plus inline-SVG small
 * multiples (revenue, EBITDA, EBITDA margin, PAT, EPS, CFO, total debt).
 */
import { MiniBars, MiniLine } from './charts.jsx'
import { seriesSummary } from './labels.js'
import { fySeries } from './data.js'
import {
  currencySymbol,
  fiscalLabel,
  formatAmount,
  formatFigure,
  formatPct,
  margin,
  toNum,
  unitLabel,
} from './format.js'
import { Section, SourceRef } from './primitives.jsx'

const TABLE_ROWS = [
  ['revenue', 'Revenue'],
  ['ebitda', 'EBITDA'],
  ['ebitda_margin', 'EBITDA margin', 'pct'],
  ['other_income', 'Other income'],
  ['pat', 'Profit after tax'],
  ['pat_margin', 'PAT margin', 'pct'],
  ['eps', 'EPS', 'eps'],
  ['cfo', 'Cash from operations'],
  ['capex', 'Capital expenditure'],
  ['total_debt', 'Total debt'],
  ['cash', 'Cash and equivalents'],
]

const CHARTS = [
  ['revenue', 'Revenue', 'bars'],
  ['ebitda', 'EBITDA', 'bars'],
  ['ebitda_margin', 'EBITDA margin', 'line'],
  ['pat', 'Profit after tax', 'bars'],
  ['eps', 'EPS', 'bars'],
  ['cfo', 'Cash from operations', 'bars'],
  ['total_debt', 'Total debt', 'bars'],
]

function valueOf(row, key) {
  if (key === 'ebitda_margin') return margin(row.ebitda, row.revenue)
  if (key === 'pat_margin') return margin(row.pat, row.revenue)
  return toNum(row[key])
}

export default function FinancialHistory({ title, financial_periods, currency, unit, sourceNumbers, years = 5 }) {
  const series = fySeries({ financial_periods }).slice(-years)
  if (!series.length) return null
  const last = series[series.length - 1]
  const cur = last.currency || currency
  const u = last.unit || unit

  const cell = (row, key, kind) => {
    const v = valueOf(row, key)
    if (kind === 'pct') return formatPct(v)
    if (kind === 'eps') return formatFigure(v, cur, null, { decimals: 2 })
    return formatFigure(v, cur, u)
  }
  const visibleRows = TABLE_ROWS.filter(([key]) => series.some((r) => valueOf(r, key) !== null))

  const charts =
    series.length >= 2
      ? CHARTS.map(([key, title, kind]) => {
          const points = series.map((r) => ({ label: fiscalLabel(r), value: valueOf(r, key) }))
          if (points.filter((p) => p.value !== null).length < 2) return null
          const fmt =
            kind === 'line'
              ? (v) => formatPct(v)
              : key === 'eps'
                ? (v) => `${currencySymbol(cur)}${formatFigure(v, cur, null, { decimals: 2 })}`
                : (v) => formatAmount(v, cur, u)
          const short = kind === 'line' ? (v) => formatPct(v, 0) : (v) => formatFigure(v, cur, u)
          const Chart = kind === 'line' ? MiniLine : MiniBars
          return (
            <figure key={key} className="st-chart">
              <figcaption>{title}</figcaption>
              <Chart points={points} ariaLabel={seriesSummary(title, points, fmt)} formatValue={short} />
            </figure>
          )
        }).filter(Boolean)
      : []

  return (
    <Section id="financial-history" title={title}>
      <div className="st-table-wrap">
        <table>
          <caption>
            Fiscal years, {last.basis === 'standalone' ? 'standalone' : 'consolidated'}.{' '}
            {unitLabel(cur, u) || 'Reported figures'}; EPS in {currencySymbol(cur).trim() || 'reporting currency'}.
            Margins computed by PineX.
          </caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              {series.map((r) => (
                <th key={r.period_end} scope="col">
                  {fiscalLabel(r)}
                  <SourceRef id={r.source_id} sourceNumbers={sourceNumbers} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(([key, label, kind]) => (
              <tr key={key} className={kind === 'pct' ? 'st-sub' : undefined}>
                <th scope="row">{label}</th>
                {series.map((r) => (
                  <td key={r.period_end}>{cell(r, key, kind)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {charts.length > 0 && <div className="st-charts">{charts}</div>}
    </Section>
  )
}
