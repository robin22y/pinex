/**
 * /admin/studies/:id/quarterly — Quarterly update wizard (Phase 4b).
 *
 * One scrolling page (sections collapse on mobile), saved together through
 * the v5 RPC study_save_period_update in ONE transaction: if any part fails
 * the database keeps none of it. Period rows are append-only; re-entering
 * an existing quarter saves a new revision (a correction).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { finKey, latestRevisions, pickBasis, segKey, shKey } from '../../study/data.js'
import { formatDate, formatPct, unitLabel } from '../../study/format.js'
import { DEVELOPMENT_LABELS, HOLDER_TYPE_LABELS } from '../../study/labels.js'
import { Markdown } from '../../study/markdown.jsx'
import '../../../styles/study.css'
import { loadStudy, savePeriodUpdate } from './api.js'
import { CHILD_TABLES, SOURCE_KIND_LABELS } from './config.js'
import { scanText } from './contentCheck.js'
import { useLeaveGuard } from './dirty.js'
import {
  FIN_FIELDS,
  comparable,
  financialWarnings,
  parseNumberCell,
  parseRowsPaste,
  quarterLabel,
  looksLikeSheet,
  shareholdingTotal,
  shareholdingWarning,
  shiftMonths,
  suggestNextQuarter,
} from './periods.js'
import { FinancialInputs, NumberInput, SegmentInputs, ShareholdingInputs } from './PeriodInputs.jsx'
import { Button, ContentWarnings, ErrorBox, Field, Notice, PlainInput, Spinner } from './ui.jsx'

const num = (raw) => {
  const v = parseNumberCell(raw)
  return v === undefined ? null : v
}
const bad = (raw) => parseNumberCell(raw) === undefined
const str = (v) => (v === null || v === undefined ? '' : String(v))
const SOURCE_QUICK = CHILD_TABLES.sources.fields.filter((f) => ['kind', 'title', 'url', 'document_date'].includes(f.key))
const DEV_OPTS = Object.entries(DEVELOPMENT_LABELS)
const HOLDER_OPTS = Object.entries(HOLDER_TYPE_LABELS)

/** Latest shareholding period strictly before `end` → { end, map(category → pct), pledged }. */
function previousShareholding(rows, end) {
  const latest = latestRevisions(rows, shKey).filter((r) => r.period_end < end)
  const last = latest.map((r) => r.period_end).sort().pop()
  if (!last) return { end: null, map: new Map(), pledged: null }
  const promoter = latest.find((r) => r.period_end === last && r.category === 'promoter_insider')
  return {
    end: last,
    map: new Map(latest.filter((r) => r.period_end === last && r.pct != null).map((r) => [r.category, Number(r.pct)])),
    pledged: promoter?.pledged_pct != null ? Number(promoter.pledged_pct) : null,
  }
}

/** Latest segment rows of the period before `end` (same type/basis) → Map(name → row), ordered. */
function previousSegments(rows, end, basis) {
  const latest = latestRevisions(rows, segKey).filter((r) => r.period_type === 'Q' && r.basis === basis && r.period_end < end)
  const last = latest.map((r) => r.period_end).sort().pop()
  return new Map(
    latest
      .filter((r) => r.period_end === last)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((r) => [r.segment_name, r]),
  )
}

function initialForm(study) {
  const c = study.company
  const fy = c.fiscal_year_end_month || 12
  const sug = suggestNextQuarter(study.financial_periods, fy)
  const latestFin = latestRevisions(study.financial_periods, finKey)
  const basis = pickBasis(latestFin.filter((r) => r.period_type === 'Q')) || 'consolidated'
  const segs = previousSegments(study.segment_periods, sug.period_end, basis)
  const sh = previousShareholding(study.shareholding, sug.period_end)
  const cats = sh.map.size ? [...sh.map.keys()] : ['promoter_insider', 'institutional_foreign', 'institutional_domestic', 'mutual_funds', 'public_retail']
  return {
    period_end: sug.period_end,
    fiscal_label: sug.fiscal_label,
    labelTouched: false,
    basis,
    srcMode: 'new',
    source_id: '',
    newSource: { kind: 'quarterly_result', title: sug.fiscal_label ? `${sug.fiscal_label} results` : '', url: '', document_date: '' },
    fin: {},
    segments: [...segs.keys()].map((name) => ({ name, revenue: '', ebit: '' })),
    shEnd: sug.period_end,
    sh: {},
    shPledged: '',
    shCats: cats,
    own: [],
    note: '',
    devs: [],
    markReviewed: true,
  }
}

function Section({ title, children, summary, defaultOpen = true }) {
  return (
    <details className="sa-wiz-sec" open={defaultOpen}>
      <summary>
        <span className="sa-h2">{title}</span>
        {summary && <span className="sa-muted sa-small">{summary}</span>}
      </summary>
      <div className="sa-wiz-body">{children}</div>
    </details>
  )
}

export default function QuarterlyWizard({ id }) {
  const [study, setStudy] = useState(null)
  const [form, setForm] = useState(null)
  const [initial, setInitial] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [ownNote, setOwnNote] = useState(null)

  useEffect(() => {
    let live = true
    loadStudy(id, { withPeriods: true }).then((r) => {
      if (!live) return
      if (!r.data) {
        setError(r.error)
        return
      }
      const f = initialForm(r.data)
      setStudy(r.data)
      setForm(f)
      setInitial(JSON.stringify(f))
      if (r.error) setError(r.error)
    })
    return () => {
      live = false
    }
  }, [id])

  const dirty = Boolean(form && initial && !result && JSON.stringify(form) !== initial)
  useLeaveGuard(dirty, false)

  const d = useMemo(() => {
    if (!study || !form) return null
    const c = study.company
    const latestFin = latestRevisions(study.financial_periods, finKey)
    const key = finKey({ period_end: form.period_end, period_type: 'Q', basis: form.basis })
    const exists = latestFin.some((r) => finKey(r) === key)
    const prevQ = comparable(latestFin, form.period_end, 3, form.basis)
    const yearAgo = comparable(latestFin, form.period_end, 12, form.basis)
    const prevSh = previousShareholding(study.shareholding, form.shEnd || form.period_end)
    const prevSeg = previousSegments(study.segment_periods, form.period_end, form.basis)
    // Each holder's last recorded position (latest period_to).
    const holders = new Map()
    for (const o of [...study.ownership_changes].sort((a, b) => String(a.period_to).localeCompare(String(b.period_to)))) {
      holders.set(String(o.holder_name || '').trim().toLowerCase(), o)
    }
    return { c, latestFin, exists, prevQ, yearAgo, prevSh, prevSeg, holders, fy: c.fiscal_year_end_month || 12 }
  }, [study, form])

  if (error && !study) {
    return (
      <div className="sa-page">
        <ErrorBox error={error} />
        <Link to="/admin/studies">← All studies</Link>
      </div>
    )
  }
  if (!study || !form || !d) return <Spinner />

  const c = d.c
  const set = (patch) => setForm((f) => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }))
  const setIn = (k) => (updater) => setForm((f) => ({ ...f, [k]: typeof updater === 'function' ? updater(f[k]) : updater }))

  function setPeriodEnd(v) {
    set((f) => ({
      period_end: v,
      fiscal_label: f.labelTouched ? f.fiscal_label : quarterLabel(v, d.fy),
      shEnd: f.shEnd === f.period_end ? v : f.shEnd,
    }))
  }

  // ── ownership helpers ──
  const defaultFrom = d.prevSh.end || shiftMonths(form.period_end, -3)
  function prefillHolder(row) {
    const last = d.holders.get(row.holder_name.trim().toLowerCase())
    if (!last) return row
    return {
      ...row,
      holder_name: last.holder_name, // the stored spelling, so the same holder groups together
      holder_type: row.holder_type || last.holder_type || '',
      pct_from: row.pct_from === '' ? str(last.pct_to) : row.pct_from,
      period_from: row.fromTouched ? row.period_from : last.period_to || row.period_from,
    }
  }
  const setOwn = (i, k, v) =>
    set((f) => ({
      own: f.own.map((r, j) => {
        if (j !== i) return r
        const next = { ...r, [k]: v, ...(k === 'period_from' ? { fromTouched: true } : {}) }
        return k === 'holder_name' ? prefillHolder(next) : next
      }),
    }))
  const newOwnRow = () => ({ holder_name: '', holder_type: '', period_from: defaultFrom, pct_from: '', pct_to: '', fromTouched: false })
  function onOwnPaste(e) {
    const text = e.clipboardData?.getData('text') || ''
    if (!looksLikeSheet(text)) return
    e.preventDefault()
    const rows = parseRowsPaste(text).map((p) => {
      const base = prefillHolder({ ...newOwnRow(), holder_name: p.name })
      const nums = p.nums
      return nums.length >= 2 ? { ...base, pct_from: str(nums[0]), pct_to: str(nums[1]) } : { ...base, pct_to: str(nums[0]) }
    })
    set((f) => ({ own: [...f.own.filter((r) => r.holder_name.trim()), ...rows] }))
    setOwnNote(`Added ${rows.length} holder row(s) from the paste. Start % was filled from each holder's last recorded % where known.`)
  }

  // ── checks ──
  const fin = Object.fromEntries(FIN_FIELDS.map((f) => [f.key, num(form.fin[f.key])]))
  const hasFin = Object.values(fin).some((v) => v !== null)
  const shVals = Object.fromEntries(form.shCats.map((k) => [k, num(form.sh[k])]))
  const shTotal = shareholdingTotal(shVals)
  const warnings = [
    ...financialWarnings(hasFin ? fin : {}, d.prevQ, { exists: d.exists && hasFin, label: form.fiscal_label || formatDate(form.period_end) }),
  ]
  const shWarn = shareholdingWarning(shTotal)
  if (shWarn) warnings.push(shWarn)
  const invalid = [
    ...FIN_FIELDS.filter((f) => bad(form.fin[f.key])).map((f) => f.label),
    ...form.segments.flatMap((s) => [bad(s.revenue) && `${s.name || 'Segment'} revenue`, bad(s.ebit) && `${s.name || 'Segment'} EBIT`]).filter(Boolean),
    ...form.shCats.filter((k) => bad(form.sh[k])).map((k) => `Shareholding ${k}`),
    ...(bad(form.shPledged) ? ['Pledged %'] : []),
    ...form.own.flatMap((o) => [bad(o.pct_from) && `${o.holder_name} start %`, bad(o.pct_to) && `${o.holder_name} end %`]).filter(Boolean),
  ]
  const wording = [
    ...scanText('What changed', form.note),
    ...form.devs.flatMap((dv, i) => scanText(`Development ${i + 1}`, dv.title)),
    ...form.own.flatMap((o) => scanText(`Ownership · ${o.holder_name}`, o.profile)),
  ]

  async function save() {
    setError(null)
    const problems = []
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.period_end || '')) problems.push('Period end date is required.')
    if (form.srcMode === 'existing' ? !form.source_id : !form.newSource.title.trim()) problems.push('Pick the results filing, or give the new source a title.')
    if (invalid.length) problems.push(`Not numbers: ${invalid.join(', ')}.`)
    const ownRows = form.own.filter((o) => o.holder_name.trim())
    if (ownRows.some((o) => !o.period_from || o.period_from >= (form.shEnd || form.period_end))) problems.push('Each ownership change needs a "from" date before the shareholding date.')
    if (problems.length) {
      setError(problems.join('\n'))
      return
    }
    const payload = {
      period_end: form.period_end,
      period_type: 'Q',
      fiscal_label: form.fiscal_label.trim() || null,
      basis: form.basis,
      require_source: true,
      ...(form.srcMode === 'existing'
        ? { source_id: form.source_id }
        : { new_source: Object.fromEntries(Object.entries(form.newSource).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v])) }),
      ...(hasFin ? { financials: fin } : {}),
      segments: form.segments.filter((s) => s.name.trim()).map((s) => ({ segment_name: s.name.trim(), revenue: num(s.revenue), ebit: num(s.ebit) })),
      shareholding_period_end: form.shEnd || form.period_end,
      shareholding: form.shCats
        .map((k) => ({ category: k, pct: shVals[k], pledged_pct: k === 'promoter_insider' ? num(form.shPledged) : null }))
        .filter((r) => r.pct !== null || r.pledged_pct !== null),
      ownership: ownRows.map((o) => ({
        holder_name: o.holder_name.trim(),
        holder_type: o.holder_type || null,
        period_from: o.period_from,
        period_to: form.shEnd || form.period_end,
        pct_from: num(o.pct_from),
        pct_to: num(o.pct_to),
        profile: o.profile?.trim() || null,
      })),
      note_md: form.note.trim() || null,
      developments: form.devs.filter((x) => x.title.trim()).map((x) => ({ event_date: x.event_date || null, title: x.title.trim(), category: x.category || 'other' })),
      mark_reviewed: form.markReviewed,
    }
    setSaving(true)
    const r = await savePeriodUpdate(id, payload)
    setSaving(false)
    if (r.error) {
      setError(`${r.error}\nNothing was saved — the whole update is rolled back together.`)
      return
    }
    setResult({ ...r.data, label: form.fiscal_label || formatDate(form.period_end), wording })
    window.scrollTo({ top: 0 })
  }

  if (result) {
    const parts = [
      result.financials && `financials${result.revisions?.financials > 1 ? ` (revision ${result.revisions.financials})` : ''}`,
      result.segments && `${result.segments} segment row${result.segments === 1 ? '' : 's'}`,
      result.shareholding && `${result.shareholding} shareholding row${result.shareholding === 1 ? '' : 's'}`,
      result.ownership && `${result.ownership} ownership change${result.ownership === 1 ? '' : 's'}`,
      result.note && 'the “what changed” note',
      result.developments && `${result.developments} development${result.developments === 1 ? '' : 's'}`,
    ].filter(Boolean)
    return (
      <div className="sa-page">
        <Helmet>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <div className="sa-panel sa-success">
          <h1 className="sa-h1">✓ {result.label} saved</h1>
          <p>
            {c.name}: saved {parts.length ? parts.join(', ') : 'nothing new'}
            {result.reviewed ? '; marked as reviewed' : ''}.
          </p>
          <ContentWarnings hits={result.wording} />
          <div className="sa-row">
            <Link className="sa-btn sa-btn-primary" to={`/admin/studies/${id}/preview`}>
              Preview study
            </Link>
            <Link className="sa-btn sa-btn-default" to="/admin/studies">
              Back to dashboard
            </Link>
            <Link className="sa-btn sa-btn-ghost" to={`/admin/studies/${id}?tab=latest-quarter`}>
              Open study
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const unitText = unitLabel(c.reporting_currency, c.reporting_unit)
  return (
    <div className="sa-page sa-wizard">
      <Helmet>
        <title>{`Quarterly update — ${c.name}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="sa-editor-head">
        <div className="sa-editor-title">
          <Link to={`/admin/studies/${id}`} className="sa-back">
            ← {c.name}
          </Link>
          <h1 className="sa-h1">Quarterly update</h1>
          {dirty && <span className="sa-dirty">Unsaved</span>}
        </div>
        <p className="sa-editor-meta">
          Suggested next period from the latest quarter on file and the fiscal year ending{' '}
          {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.fy - 1]}. Amounts in {unitText || 'the reporting unit (not set on Overview)'}.
        </p>
      </div>

      <Section title="Period" summary={`${form.fiscal_label} · ending ${formatDate(form.period_end)}`}>
        <div className="sa-grid3">
          <Field label="Period end" required>
            <input className="sa-input" type="date" value={form.period_end} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
          <Field label="Label" help="e.g. Q2 FY27">
            <input className="sa-input" value={form.fiscal_label} onChange={(e) => set({ fiscal_label: e.target.value, labelTouched: true })} />
          </Field>
          <Field label="Basis">
            <select className="sa-input" value={form.basis} onChange={(e) => set({ basis: e.target.value })}>
              <option value="consolidated">Consolidated</option>
              <option value="standalone">Standalone</option>
            </select>
          </Field>
        </div>
        {d.exists && hasFin && <Notice kind="warn">{form.fiscal_label || 'This period'} already exists. Saving adds a new revision; the earlier figures stay in history.</Notice>}
      </Section>

      <Section title="a. Source" summary="The results filing (required)">
        <div className="sa-subtabs" role="tablist">
          {[
            ['new', 'New filing'],
            ['existing', 'Existing source'],
          ].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={form.srcMode === k} className={form.srcMode === k ? 'is-active' : ''} onClick={() => set({ srcMode: k })}>
              {label}
            </button>
          ))}
        </div>
        {form.srcMode === 'existing' ? (
          <Field label="Source" required>
            <select className="sa-input" value={form.source_id} onChange={(e) => set({ source_id: e.target.value })}>
              <option value="">Choose…</option>
              {study.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {SOURCE_KIND_LABELS[s.kind] || s.kind}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="sa-grid2">
            {SOURCE_QUICK.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <PlainInput field={f} value={form.newSource[f.key]} onChange={(v) => set((x) => ({ newSource: { ...x.newSource, [f.key]: v } }))} />
              </Field>
            ))}
          </div>
        )}
      </Section>

      <Section title="b. Profit and loss, cash and debt" summary={unitText}>
        <FinancialInputs
          values={form.fin}
          setValues={setIn('fin')}
          currency={c.reporting_currency}
          unit={c.reporting_unit}
          prevQ={d.prevQ}
          yearAgo={d.yearAgo}
          prevLabel={d.prevQ ? d.prevQ.fiscal_label || formatDate(d.prevQ.period_end) : 'Last Q'}
          yearAgoLabel={d.yearAgo ? d.yearAgo.fiscal_label || formatDate(d.yearAgo.period_end) : 'Year ago'}
        />
      </Section>

      <Section title="c. Segments" summary={form.segments.length ? `${form.segments.length} segments (names from last period)` : 'none'}>
        <SegmentInputs rows={form.segments} setRows={setIn('segments')} currency={c.reporting_currency} unit={c.reporting_unit} prev={d.prevSeg} />
      </Section>

      <Section title="d. Shareholding" summary={shTotal === null ? 'not entered' : `total ${shTotal.toFixed(2)}%`}>
        <Field label="As of (period end)">
          <input className="sa-input" type="date" value={form.shEnd} onChange={(e) => set({ shEnd: e.target.value })} />
        </Field>
        <ShareholdingInputs
          values={form.sh}
          setValues={setIn('sh')}
          categories={form.shCats}
          setCategories={setIn('shCats')}
          prev={d.prevSh.map}
          pledged={form.shPledged}
          setPledged={(v) => set({ shPledged: v })}
          prevPledged={d.prevSh.pledged}
        />
      </Section>

      <Section title="e. Ownership changes" summary="Increases and decreases" defaultOpen={false}>
        <div className="sa-pastezone" onPaste={onOwnPaste}>
          <p className="sa-help">
            One row per holder whose stake changed. Start % fills from that holder's last recorded % (from {d.prevSh.end ? formatDate(defaultFrom) : 'the previous period'}). Paste rows of: holder, end % — or holder, start %, end %.
          </p>
          {ownNote && <Notice kind="info" onDismiss={() => setOwnNote(null)}>{ownNote}</Notice>}
          <datalist id="sa-known-holders">
            {[...d.holders.values()].map((h) => (
              <option key={h.id} value={h.holder_name} />
            ))}
          </datalist>
          {form.own.map((o, i) => (
            <fieldset key={i} className="sa-ownrow">
              <legend className="sa-sr">Holder {i + 1}</legend>
              <input className="sa-input" list="sa-known-holders" placeholder="Holder name" aria-label={`Holder ${i + 1}`} value={o.holder_name} onChange={(e) => setOwn(i, 'holder_name', e.target.value)} />
              <select className="sa-input" aria-label="Holder type" value={o.holder_type} onChange={(e) => setOwn(i, 'holder_type', e.target.value)}>
                <option value="">Type…</option>
                {HOLDER_OPTS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input className="sa-input" type="date" aria-label="From (period end)" value={o.period_from} onChange={(e) => setOwn(i, 'period_from', e.target.value)} />
              <NumberInput label="Start %" placeholder="Start %" value={o.pct_from} onChange={(v) => setOwn(i, 'pct_from', v)} unit="%" />
              <NumberInput label="End %" placeholder="End %" value={o.pct_to} onChange={(v) => setOwn(i, 'pct_to', v)} unit="%" />
              <p className="sa-compare">
                {num(o.pct_to) !== null || num(o.pct_from) !== null
                  ? `${formatPct(num(o.pct_from) ?? 0, 2)} → ${formatPct(num(o.pct_to) ?? 0, 2)}`
                  : 'Enter start and end %'}
              </p>
              <Button size="sm" variant="ghost" onClick={() => set((f) => ({ own: f.own.filter((_, j) => j !== i) }))}>
                Remove
              </Button>
            </fieldset>
          ))}
          <Button size="sm" onClick={() => set((f) => ({ own: [...f.own, newOwnRow()] }))}>
            + Add holder
          </Button>
        </div>
      </Section>

      <Section title="f. What changed" summary="Shown under the latest quarter">
        <div className="sa-story">
          <Field label="What changed (Markdown)" wide>
            <textarea className="sa-input" rows={8} value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          <div className="sa-story-preview">
            <p className="sa-label">Preview</p>
            <div className="study-surface">
              <article className="st-article">{form.note.trim() ? <Markdown source={form.note} keyPrefix="wiz" /> : <p className="sa-muted">Nothing yet.</p>}</article>
            </div>
          </div>
        </div>
      </Section>

      <Section title="g. Developments" summary={form.devs.length ? `${form.devs.length} to add` : 'quick add'} defaultOpen={false}>
        {form.devs.map((x, i) => (
          <fieldset key={i} className="sa-devrow">
            <legend className="sa-sr">Development {i + 1}</legend>
            <input className="sa-input" type="date" aria-label="Date" value={x.event_date} onChange={(e) => set((f) => ({ devs: f.devs.map((r, j) => (j === i ? { ...r, event_date: e.target.value } : r)) }))} />
            <input className="sa-input" placeholder="What happened" aria-label="Title" value={x.title} onChange={(e) => set((f) => ({ devs: f.devs.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)) }))} />
            <select className="sa-input" aria-label="Category" value={x.category} onChange={(e) => set((f) => ({ devs: f.devs.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)) }))}>
              {DEV_OPTS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => set((f) => ({ devs: f.devs.filter((_, j) => j !== i) }))}>
              Remove
            </Button>
          </fieldset>
        ))}
        <Button size="sm" onClick={() => set((f) => ({ devs: [...f.devs, { event_date: '', title: '', category: 'filing' }] }))}>
          + Add development
        </Button>
      </Section>

      <div className="sa-panel sa-wiz-save">
        <label className="sa-checkline">
          <input type="checkbox" className="sa-check" checked={form.markReviewed} onChange={(e) => set({ markReviewed: e.target.checked })} />
          <span>h. Mark reviewed (sets reviewed_at to now)</span>
        </label>
        {warnings.length > 0 && (
          <div className="sa-alert sa-alert-warn" role="status">
            <div>
              <strong>Check before saving</strong> (you can still save):
              <ul className="sa-warn-list">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {wording.length > 0 && <Notice kind="warn">Wording to check: {wording.map((w) => `“${w.term}” in ${w.where}`).join('; ')}.</Notice>}
        <ErrorBox error={error} onDismiss={() => setError(null)} />
        <div className="sa-row">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : `Save ${form.fiscal_label || 'update'}`}
          </Button>
          <Link className="sa-btn sa-btn-ghost" to={`/admin/studies/${id}`}>
            Cancel
          </Link>
        </div>
        <p className="sa-help">Everything above is saved in one go. If any part fails, nothing is saved.</p>
      </div>
    </div>
  )
}
