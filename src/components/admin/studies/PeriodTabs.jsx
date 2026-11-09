/**
 * Period tabs (Phase 4b): Latest quarter · Financials · Segments ·
 * Shareholding. Grids show the latest revision of each cell (same rule as
 * the *_latest views); corrections append a new revision.
 *
 * Single-row writes (a cell correction, a Financials "Add period") are one
 * insert each. Multi-row adds (Segments, Shareholding) go through the v5
 * RPC so they land in one transaction.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LatestQuarter from '../../study/LatestQuarter.jsx'
import '../../../styles/study.css'
import { finKey, financialSeries, latestRevisions, numberSources, pickBasis, segKey, shKey } from '../../study/data.js'
import { fiscalLabel, formatDate, formatFigure, formatPct, unitLabel } from '../../study/format.js'
import { CATEGORY_LABELS } from '../../study/labels.js'
import { insertRevision, loadPeriodTable, savePeriodUpdate } from './api.js'
import { useDirtyFlag } from './dirty.js'
import {
  FIN_FIELDS,
  SH_CATEGORIES,
  comparable,
  financialWarnings,
  nextRevision,
  parseNumberCell,
  quarterLabel,
  revisionsOf,
  shareholdingTotal,
  shareholdingWarning,
} from './periods.js'
import PeriodGrid from './PeriodGrid.jsx'
import { FinancialInputs, SegmentInputs, ShareholdingInputs } from './PeriodInputs.jsx'
import SourcePicker from './SourcePicker.jsx'
import { Button, ErrorBox, Field, Notice } from './ui.jsx'

const num = (raw) => {
  const v = parseNumberCell(raw)
  return v === undefined ? null : v
}
const desc = (a, b) => String(b).localeCompare(String(a))

/** Copy a period row for a new revision: drop id and timestamps. */
function revisionOf(row, patch, revision) {
  const next = { ...row, ...patch, revision }
  delete next.id
  delete next.created_at
  delete next.updated_at
  return next
}

function Filters({ type, setType, basis, setBasis, extra }) {
  return (
    <div className="sa-row sa-filters">
      <div className="sa-subtabs" role="group" aria-label="Period type">
        {[
          ['Q', 'Quarters'],
          ['H', 'Half-years'],
          ['FY', 'Years'],
        ].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={type === k} className={type === k ? 'is-active' : ''} onClick={() => setType(k)}>
            {l}
          </button>
        ))}
      </div>
      <select className="sa-input sa-select" aria-label="Basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
        <option value="consolidated">Consolidated</option>
        <option value="standalone">Standalone</option>
      </select>
      {extra}
    </div>
  )
}

function defaultLabel(end, type, fy) {
  if (!end) return ''
  if (type === 'Q') return quarterLabel(end, fy)
  const y = Number(end.slice(0, 4))
  return type === 'FY' ? (Number(fy) === 12 ? `FY${y}` : `FY${String(y).slice(-2)}`) : ''
}

// ── Latest quarter ──────────────────────────────────────────────────────

export function LatestQuarterTab({ studyId, study }) {
  const c = study.company
  const series = financialSeries(study.financial_periods, 'Q')
  const latest = series[series.length - 1]
  const src = latest?.source_id && study.sources.find((s) => s.id === latest.source_id)
  return (
    <div className="sa-tabpanel">
      <div className="sa-row sa-row-between">
        <h2 className="sa-h2">Latest quarter</h2>
        <Link className="sa-btn sa-btn-primary" to={`/admin/studies/${studyId}/quarterly`}>
          Edit via Quarterly update
        </Link>
      </div>
      {latest ? (
        <>
          <p className="sa-help">
            Exactly what the public page shows: {fiscalLabel(latest)} ({formatDate(latest.period_end)}), {latest.basis}, revision {latest.revision ?? 1}
            {src ? `, source “${src.title}”` : ', no source linked'}. Read-only here — correct a figure on the Financials tab.
          </p>
          <div className="study-surface sa-public-preview">
            <article className="st-article">
              <LatestQuarter
                title="Latest quarter"
                financial_periods={study.financial_periods}
                period_notes={study.period_notes}
                currency={c.reporting_currency}
                unit={c.reporting_unit}
                sourceNumbers={numberSources(study.sources).numbers}
              />
            </article>
          </div>
        </>
      ) : (
        <p className="sa-muted">No quarterly figures yet, so the public page shows no Latest quarter section. Use Quarterly update to add one.</p>
      )}
    </div>
  )
}

// ── Financials ──────────────────────────────────────────────────────────

export function FinancialsTab({ studyId, study, setPeriodRows, onSourceAdded }) {
  const c = study.company
  const all = study.financial_periods
  const [type, setType] = useState('Q')
  const [basis, setBasis] = useState(() => pickBasis(latestRevisions(all, finKey)) || 'consolidated')
  const [adding, setAdding] = useState(false)
  const latest = useMemo(
    () => latestRevisions(all.filter((r) => r.period_type === type && r.basis === basis), finKey).sort((a, b) => desc(a.period_end, b.period_end)),
    [all, type, basis],
  )
  const byKey = new Map(latest.map((r) => [finKey(r), r]))
  const fmt = (v, k) => (k === 'eps' ? formatFigure(v, c.reporting_currency, null, { decimals: 2 }) : formatFigure(v, c.reporting_currency, c.reporting_unit))

  async function onCorrect(metric, key, value) {
    const base = byKey.get(key)
    const r = await insertRevision('study_financial_periods', revisionOf(base, { [metric]: value }, nextRevision(all, finKey, key)))
    if (r.error) return r.error
    setPeriodRows('financial_periods', [...all, r.data])
    return null
  }

  return (
    <div className="sa-tabpanel">
      <div className="sa-row sa-row-between">
        <h2 className="sa-h2">Financials</h2>
        <div className="sa-row">
          <Link className="sa-btn sa-btn-default" to={`/admin/studies/${studyId}/quarterly`}>
            Quarterly update
          </Link>
          <Button variant="primary" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Close' : '+ Add period'}
          </Button>
        </div>
      </div>
      <Filters type={type} setType={setType} basis={basis} setBasis={setBasis} />
      <p className="sa-help">{unitLabel(c.reporting_currency, c.reporting_unit) || 'Reporting unit not set'} (EPS per share). Tap a figure to correct it — corrections add a revision.</p>
      {adding && (
        <AddFinancialPeriod
          studyId={studyId}
          study={study}
          type={type}
          basis={basis}
          onSourceAdded={onSourceAdded}
          onDone={(row) => {
            setPeriodRows('financial_periods', [...all, row])
            setAdding(false)
          }}
        />
      )}
      <PeriodGrid
        caption="Financials"
        columns={latest.map((r) => ({ key: finKey(r), label: fiscalLabel(r), sub: formatDate(r.period_end) }))}
        rows={FIN_FIELDS.map((f) => ({ key: f.key, label: f.label }))}
        getCell={(metric, key) => {
          const row = byKey.get(key)
          return {
            value: row?.[metric] ?? null,
            revision: row?.revision ?? 1,
            history: revisionsOf(all, finKey, key).map((h) => ({ revision: h.revision ?? 1, value: h[metric], created_at: h.created_at })),
          }
        }}
        format={fmt}
        onCorrect={onCorrect}
        emptyText={`No ${type === 'Q' ? 'quarterly' : type === 'H' ? 'half-year' : 'annual'} ${basis} figures yet.`}
      />
    </div>
  )
}

function AddFinancialPeriod({ studyId, study, type, basis: basis0, onDone, onSourceAdded }) {
  const c = study.company
  const fy = c.fiscal_year_end_month || 12
  const [end, setEnd] = useState('')
  const [label, setLabel] = useState('')
  const [labelTouched, setLabelTouched] = useState(false)
  const [basis, setBasis] = useState(basis0)
  const [source, setSource] = useState(null)
  const [values, setValues] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useDirtyFlag('add-financial', Boolean(end || Object.values(values).some((v) => String(v).trim())))

  const all = study.financial_periods
  const latest = latestRevisions(all, finKey)
  const key = finKey({ period_end: end, period_type: type, basis })
  const exists = Boolean(end) && latest.some((r) => finKey(r) === key)
  const prevQ = type === 'Q' && end ? comparable(latest, end, 3, basis) : null
  const yearAgo = end ? comparable(latest, end, 12, basis, type) : null
  const fin = Object.fromEntries(FIN_FIELDS.map((f) => [f.key, num(values[f.key])]))
  const warnings = financialWarnings(fin, prevQ, { exists, label: label || end })

  async function save() {
    const invalid = FIN_FIELDS.filter((f) => parseNumberCell(values[f.key]) === undefined).map((f) => f.label)
    if (!end) return setError('Period end is required.')
    if (invalid.length) return setError(`Not numbers: ${invalid.join(', ')}.`)
    setBusy(true)
    const r = await insertRevision('study_financial_periods', {
      study_company_id: studyId,
      period_end: end,
      period_type: type,
      fiscal_label: label.trim() || null,
      basis,
      ...fin,
      currency: c.reporting_currency || null,
      unit: c.reporting_unit || null,
      source_id: source,
      revision: nextRevision(all, finKey, key),
    })
    setBusy(false)
    if (r.error) setError(r.error)
    else onDone(r.data)
  }

  return (
    <div className="sa-panel">
      <h3 className="sa-h2">Add {type === 'Q' ? 'a quarter' : type === 'H' ? 'a half-year' : 'a year'}</h3>
      <div className="sa-grid3">
        <Field label="Period end" required>
          <input
            className="sa-input"
            type="date"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value)
              if (!labelTouched) setLabel(defaultLabel(e.target.value, type, fy))
            }}
          />
        </Field>
        <Field label="Label">
          <input
            className="sa-input"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value)
              setLabelTouched(true)
            }}
          />
        </Field>
        <Field label="Basis">
          <select className="sa-input" value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="consolidated">Consolidated</option>
            <option value="standalone">Standalone</option>
          </select>
        </Field>
      </div>
      <Field label="Source">
        <SourcePicker value={source} onChange={setSource} sources={study.sources} studyId={studyId} onSourceAdded={onSourceAdded} />
      </Field>
      <FinancialInputs values={values} setValues={setValues} currency={c.reporting_currency} unit={c.reporting_unit} prevQ={prevQ} yearAgo={yearAgo} />
      {warnings.length > 0 && (
        <Notice kind="warn">
          <ul className="sa-warn-list">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <div className="sa-row">
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : exists ? 'Save as new revision' : 'Save period'}
        </Button>
      </div>
    </div>
  )
}

// ── Segments ────────────────────────────────────────────────────────────

export function SegmentsTab({ studyId, study, setPeriodRows, onSourceAdded }) {
  const c = study.company
  const all = study.segment_periods
  const [type, setType] = useState('Q')
  const [basis, setBasis] = useState(() => pickBasis(latestRevisions(all, segKey)) || 'consolidated')
  const [metric, setMetric] = useState('revenue')
  const [adding, setAdding] = useState(false)
  const latest = useMemo(() => latestRevisions(all.filter((r) => r.period_type === type && r.basis === basis), segKey), [all, type, basis])
  const periods = [...new Set(latest.map((r) => r.period_end))].sort(desc)
  const names = useMemo(() => {
    const ordered = latest.slice().sort((a, b) => desc(a.period_end, b.period_end) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return [...new Set(ordered.map((r) => r.segment_name))]
  }, [latest])
  const k = (name, pe) => segKey({ period_end: pe, period_type: type, basis, segment_name: name })
  const byKey = new Map(latest.map((r) => [segKey(r), r]))

  async function onCorrect(name, pe, value) {
    const key = k(name, pe)
    const base = byKey.get(key)
    const row = base
      ? revisionOf(base, { [metric]: value }, nextRevision(all, segKey, key))
      : {
          study_company_id: studyId,
          sort_order: names.indexOf(name) + 1,
          period_end: pe,
          period_type: type,
          basis,
          segment_name: name,
          revenue: null,
          ebit: null,
          [metric]: value,
          currency: c.reporting_currency || null,
          unit: c.reporting_unit || null,
          revision: 1,
        }
    const r = await insertRevision('study_segment_periods', row)
    if (r.error) return r.error
    setPeriodRows('segment_periods', [...all, r.data])
    return null
  }

  return (
    <div className="sa-tabpanel">
      <div className="sa-row sa-row-between">
        <h2 className="sa-h2">Segments</h2>
        <Button variant="primary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Close' : '+ Add period'}
        </Button>
      </div>
      <Filters
        type={type}
        setType={setType}
        basis={basis}
        setBasis={setBasis}
        extra={
          <select className="sa-input sa-select" aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="revenue">Revenue</option>
            <option value="ebit">EBIT</option>
          </select>
        }
      />
      {adding && (
        <AddMultiPeriod
          kind="segments"
          studyId={studyId}
          study={study}
          type={type}
          basis={basis}
          initialNames={names}
          onSourceAdded={onSourceAdded}
          onDone={(rows) => {
            setPeriodRows('segment_periods', rows)
            setAdding(false)
          }}
        />
      )}
      <p className="sa-help">{metric === 'revenue' ? 'Segment revenue' : 'Segment EBIT'}, {unitLabel(c.reporting_currency, c.reporting_unit) || 'reporting unit'}. Tap to correct.</p>
      <PeriodGrid
        caption="Segments"
        columns={periods.map((pe) => ({ key: pe, label: type === 'Q' ? quarterLabel(pe, c.fiscal_year_end_month || 12) : formatDate(pe), sub: formatDate(pe) }))}
        rows={names.map((n) => ({ key: n, label: n }))}
        getCell={(name, pe) => {
          const row = byKey.get(k(name, pe))
          return {
            value: row?.[metric] ?? null,
            revision: row ? (row.revision ?? 1) : 0,
            history: revisionsOf(all, segKey, k(name, pe)).map((h) => ({ revision: h.revision ?? 1, value: h[metric], created_at: h.created_at })),
          }
        }}
        format={(v) => formatFigure(v, c.reporting_currency, c.reporting_unit)}
        onCorrect={onCorrect}
        emptyText="No segment figures for this filter yet."
      />
    </div>
  )
}

// ── Shareholding ────────────────────────────────────────────────────────

export function ShareholdingTab({ studyId, study, setPeriodRows, onSourceAdded }) {
  const all = study.shareholding
  const [adding, setAdding] = useState(false)
  const latest = useMemo(() => latestRevisions(all, shKey), [all])
  const periods = [...new Set(latest.map((r) => r.period_end))].sort(desc)
  const cats = SH_CATEGORIES.filter((cat) => latest.some((r) => r.category === cat))
  const byKey = new Map(latest.map((r) => [shKey(r), r]))
  const key = (cat, pe) => shKey({ period_end: pe, category: cat })
  // Pledged shares live on the promoter_insider row (pledged_pct, % of the
  // promoter holding). Shown as their own grid row; not part of the total.
  const PLEDGED = 'promoter_insider:pledged'
  const field = (rowKey) => (rowKey === PLEDGED ? ['promoter_insider', 'pledged_pct'] : [rowKey, 'pct'])
  const gridRows = cats.flatMap((cat) =>
    cat === 'promoter_insider'
      ? [{ key: cat, label: CATEGORY_LABELS[cat] }, { key: PLEDGED, label: 'Pledged (% of promoter holding)', sub: 'optional · not in total' }]
      : [{ key: cat, label: CATEGORY_LABELS[cat] }],
  )

  async function onCorrect(rowKey, pe, value) {
    const [cat, col] = field(rowKey)
    const kk = key(cat, pe)
    const base = byKey.get(kk)
    const row = base
      ? revisionOf(base, { [col]: value }, nextRevision(all, shKey, kk))
      : { study_company_id: studyId, sort_order: cats.indexOf(cat) + 1, period_end: pe, category: cat, pct: null, pledged_pct: null, [col]: value, revision: 1 }
    const r = await insertRevision('study_shareholding', row)
    if (r.error) return r.error
    setPeriodRows('shareholding', [...all, r.data])
    return null
  }

  const totals = Object.fromEntries(
    periods.map((pe) => {
      const t = shareholdingTotal(Object.fromEntries(cats.map((cat) => [cat, byKey.get(key(cat, pe))?.pct ?? null])))
      return [pe, { text: t === null ? null : `${t.toFixed(2)}%`, warn: shareholdingWarning(t) }]
    }),
  )

  return (
    <div className="sa-tabpanel">
      <div className="sa-row sa-row-between">
        <h2 className="sa-h2">Shareholding</h2>
        <Button variant="primary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Close' : '+ Add period'}
        </Button>
      </div>
      {adding && (
        <AddMultiPeriod
          kind="shareholding"
          studyId={studyId}
          study={study}
          initialNames={cats}
          onSourceAdded={onSourceAdded}
          onDone={(rows) => {
            setPeriodRows('shareholding', rows)
            setAdding(false)
          }}
        />
      )}
      <p className="sa-help">% of shares by holder category. Tap to correct; the total row flags periods outside 99.5–100.5%.</p>
      <PeriodGrid
        caption="Shareholding"
        columns={periods.map((pe) => ({ key: pe, label: formatDate(pe) }))}
        rows={gridRows}
        getCell={(rowKey, pe) => {
          const [cat, col] = field(rowKey)
          const row = byKey.get(key(cat, pe))
          return {
            value: row?.[col] ?? null,
            revision: row ? (row.revision ?? 1) : 0,
            history: revisionsOf(all, shKey, key(cat, pe)).map((h) => ({ revision: h.revision ?? 1, value: h[col], created_at: h.created_at })),
          }
        }}
        format={(v) => formatPct(v, 2)}
        onCorrect={onCorrect}
        totals={{ label: 'Total', cells: totals }}
        emptyText="No shareholding periods yet."
      />
    </div>
  )
}

// ── Add a multi-row period (segments / shareholding) via the v5 RPC ─────

function AddMultiPeriod({ kind, studyId, study, type = 'Q', basis = 'consolidated', initialNames, onDone, onSourceAdded }) {
  const c = study.company
  const [end, setEnd] = useState('')
  const [source, setSource] = useState(null)
  const [segRows, setSegRows] = useState(() => initialNames.map((name) => ({ name, revenue: '', ebit: '' })))
  const [shValues, setShValues] = useState({})
  const [shPledged, setShPledged] = useState('')
  const [shCats, setShCats] = useState(() => (initialNames.length ? initialNames : ['promoter_insider', 'institutional_foreign', 'institutional_domestic', 'public_retail']))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const entered = kind === 'segments' ? segRows.some((r) => r.revenue || r.ebit) : Object.values(shValues).some((v) => String(v).trim()) || Boolean(shPledged.trim())
  useDirtyFlag(`add-${kind}`, Boolean(end) || entered)

  const prevSh = useMemo(() => {
    const latest = latestRevisions(study.shareholding, shKey)
    const last = latest.map((r) => r.period_end).filter((pe) => !end || pe < end).sort().pop()
    return {
      map: new Map(latest.filter((r) => r.period_end === last && r.pct != null).map((r) => [r.category, Number(r.pct)])),
      pledged: latest.find((r) => r.period_end === last && r.category === 'promoter_insider')?.pledged_pct ?? null,
    }
  }, [study.shareholding, end])
  const shTotal = shareholdingTotal(Object.fromEntries(shCats.map((k) => [k, num(shValues[k])])))
  const existsSh = kind === 'shareholding' && end && study.shareholding.some((r) => r.period_end === end)
  const existsSeg = kind === 'segments' && end && study.segment_periods.some((r) => r.period_end === end && r.period_type === type && r.basis === basis)

  async function save() {
    if (!end) return setError('Period end is required.')
    const bad =
      kind === 'segments'
        ? segRows.flatMap((r) => [parseNumberCell(r.revenue) === undefined && `${r.name} revenue`, parseNumberCell(r.ebit) === undefined && `${r.name} EBIT`]).filter(Boolean)
        : [...shCats.filter((k) => parseNumberCell(shValues[k]) === undefined).map((k) => CATEGORY_LABELS[k]), ...(parseNumberCell(shPledged) === undefined ? ['Pledged %'] : [])]
    if (bad.length) return setError(`Not numbers: ${bad.join(', ')}.`)
    const payload =
      kind === 'segments'
        ? { period_end: end, period_type: type, basis, source_id: source, segments: segRows.filter((r) => r.name.trim()).map((r) => ({ segment_name: r.name.trim(), revenue: num(r.revenue), ebit: num(r.ebit) })) }
        : { period_end: end, shareholding_period_end: end, source_id: source, shareholding: shCats.map((k) => ({ category: k, pct: num(shValues[k]), pledged_pct: k === 'promoter_insider' ? num(shPledged) : null })).filter((r) => r.pct !== null || r.pledged_pct !== null) }
    setBusy(true)
    const r = await savePeriodUpdate(studyId, payload)
    if (r.error) {
      setBusy(false)
      return setError(`${r.error}\nNothing was saved.`)
    }
    const table = kind === 'segments' ? 'study_segment_periods' : 'study_shareholding'
    const fresh = await loadPeriodTable(table, studyId)
    setBusy(false)
    if (fresh.error) return setError(`Saved, but reloading failed: ${fresh.error}`)
    onDone(fresh.data)
  }

  return (
    <div className="sa-panel">
      <h3 className="sa-h2">Add {kind === 'segments' ? 'segment figures' : 'a shareholding period'}</h3>
      <div className="sa-grid2">
        <Field label={kind === 'segments' ? `Period end (${type}, ${basis})` : 'As of (period end)'} required>
          <input className="sa-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Source">
          <SourcePicker value={source} onChange={setSource} sources={study.sources} studyId={studyId} onSourceAdded={onSourceAdded} />
        </Field>
      </div>
      {(existsSh || existsSeg) && <Notice kind="warn">This period already has figures. Saving adds new revisions; earlier values stay in history.</Notice>}
      {kind === 'segments' ? (
        <SegmentInputs rows={segRows} setRows={setSegRows} currency={c.reporting_currency} unit={c.reporting_unit} />
      ) : (
        <ShareholdingInputs
          values={shValues}
          setValues={setShValues}
          categories={shCats}
          setCategories={setShCats}
          prev={prevSh.map}
          pledged={shPledged}
          setPledged={setShPledged}
          prevPledged={prevSh.pledged}
        />
      )}
      {kind === 'shareholding' && shareholdingWarning(shTotal) && <Notice kind="warn">{shareholdingWarning(shTotal)} You can still save.</Notice>}
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <div className="sa-row">
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save period'}
        </Button>
      </div>
    </div>
  )
}
