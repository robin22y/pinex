/**
 * SegmentTable — segment revenue for the last (up to) 3 periods of one
 * period type (FY preferred), plus share of revenue, EBIT and EBIT margin
 * for the latest period.
 */
import { byPeriodAsc, pickBasis, segmentRows } from './data.js'
import { fiscalLabel, formatFigure, formatPct, margin, toNum, unitLabel } from './format.js'
import { Section, SourceRef } from './primitives.jsx'

export default function SegmentTable({ title, segment_periods, currency, unit, sourceNumbers, periods = 3 }) {
  const all = segmentRows({ segment_periods })
  if (!all.length) return null
  const type = all.some((r) => r.period_type === 'FY') ? 'FY' : all.slice().sort(byPeriodAsc).pop().period_type
  const ofType = all.filter((r) => r.period_type === type)
  const basis = pickBasis(ofType)
  const rows = ofType.filter((r) => r.basis === basis)
  const periodEnds = [...new Set(rows.map((r) => r.period_end))].sort().slice(-periods)
  const latestEnd = periodEnds[periodEnds.length - 1]
  const latestRows = rows.filter((r) => r.period_end === latestEnd)
  const names = [...new Set(rows.filter((r) => periodEnds.includes(r.period_end)).map((r) => r.segment_name))]
  const get = (name, end) => rows.find((r) => r.segment_name === name && r.period_end === end)
  const totalLatest = latestRows.reduce((s, r) => s + (toNum(r.revenue) ?? 0), 0)
  const sample = latestRows[0] || rows[0]
  const cur = sample.currency || currency
  const u = sample.unit || unit
  const labelFor = (end) => fiscalLabel(rows.find((r) => r.period_end === end))
  const hasEbit = latestRows.some((r) => toNum(r.ebit) !== null)

  return (
    <Section id="segments" title={title}>
      <div className="st-table-wrap">
        <table>
          <caption>
            Segment revenue, {unitLabel(cur, u) || 'reported figures'} ({basis}). Share and margin computed by PineX.
          </caption>
          <thead>
            <tr>
              <th scope="col">Segment</th>
              {periodEnds.map((end) => (
                <th key={end} scope="col">
                  {labelFor(end)}
                </th>
              ))}
              <th scope="col">Share, {labelFor(latestEnd)}</th>
              {hasEbit && <th scope="col">EBIT, {labelFor(latestEnd)}</th>}
              {hasEbit && <th scope="col">EBIT margin</th>}
            </tr>
          </thead>
          <tbody>
            {names.map((name) => {
              const l = get(name, latestEnd)
              return (
                <tr key={name}>
                  <th scope="row">
                    {name}
                    <SourceRef id={l?.source_id} sourceNumbers={sourceNumbers} />
                  </th>
                  {periodEnds.map((end) => (
                    <td key={end}>{formatFigure(get(name, end)?.revenue, cur, u)}</td>
                  ))}
                  <td>{formatPct(totalLatest > 0 ? margin(l?.revenue, totalLatest) : null)}</td>
                  {hasEbit && <td>{formatFigure(l?.ebit, cur, u)}</td>}
                  {hasEbit && <td>{formatPct(margin(l?.ebit, l?.revenue))}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
