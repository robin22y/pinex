/**
 * Number-entry blocks shared by the Quarterly update wizard and the
 * "Add period" forms. Values are kept as the raw typed/pasted strings and
 * parsed with parseNumberCell (commas stripped, "(123)" negative, "-" or
 * blank = empty). Each block accepts a tab-separated paste from Excel /
 * Google Sheets anywhere inside it.
 */
import { useState } from 'react'
import { DASH, formatFigure, formatPct, formatPp, formatSignedPct, toNum, unitLabel } from '../../study/format.js'
import { CATEGORY_LABELS } from '../../study/labels.js'
import {
  FIN_FIELDS,
  SH_CATEGORIES,
  liveStats,
  looksLikeSheet,
  matchShareCategory,
  parseFieldPaste,
  parseNumberCell,
  parseRowsPaste,
  shareholdingTotal,
  shareholdingWarning,
} from './periods.js'
import { Button, Notice } from './ui.jsx'

/** Raw string → number | null (invalid text counts as empty here; see isInvalid). */
const num = (raw) => {
  const v = parseNumberCell(raw)
  return v === undefined ? null : v
}
const isInvalid = (raw) => parseNumberCell(raw) === undefined

export function NumberInput({ value, onChange, unit, label, invalid, placeholder }) {
  const bad = invalid ?? isInvalid(value)
  return (
    <span className="sa-num">
      <input
        className={`sa-input sa-num-input${bad ? ' is-invalid' : ''}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="next"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={bad || undefined}
      />
      {unit && <span className="sa-unit">{unit}</span>}
    </span>
  )
}

/** Wraps a block; a spreadsheet-looking paste anywhere inside it calls onSheet(text). */
function PasteZone({ onSheet, hint, children }) {
  return (
    <div
      className="sa-pastezone"
      onPaste={(e) => {
        const text = e.clipboardData?.getData('text') || ''
        if (!looksLikeSheet(text)) return
        e.preventDefault()
        onSheet(text)
      }}
    >
      <p className="sa-help">{hint}</p>
      {children}
    </div>
  )
}

const asText = (v) => (v === null || v === undefined ? '' : String(v))

// ── Financials ──────────────────────────────────────────────────────────

/**
 * values: { metric: raw string } · setValues(updater)
 * prevQ / yearAgo: latest rows to compare against (optional)
 */
export function FinancialInputs({ values, setValues, currency, unit, prevQ, yearAgo, prevLabel, yearAgoLabel }) {
  const [note, setNote] = useState(null)
  const u = unitLabel(currency, unit)
  const fin = Object.fromEntries(FIN_FIELDS.map((f) => [f.key, num(values[f.key])]))
  const st = liveStats(fin, prevQ, yearAgo)
  const fmt = (f, v) => (f.perShare ? formatFigure(v, currency, null, { decimals: 2 }) : formatFigure(v, currency, unit))

  function onSheet(text) {
    const r = parseFieldPaste(text, FIN_FIELDS)
    setValues((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, asText(v)])) }))
    const n = Object.keys(r.values).length
    setNote(
      `Filled ${n} value${n === 1 ? '' : 's'} from the paste (${r.mode === 'column' ? 'single column, in field order' : 'matched by label'}).` +
        (r.unmatched.length ? ` Not matched: ${r.unmatched.join(', ')}.` : '') +
        (r.invalid.length ? ` Not numbers: ${r.invalid.join(', ')}.` : ''),
    )
  }

  return (
    <PasteZone
      onSheet={onSheet}
      hint={`All amounts in ${u || 'the reporting unit'} (EPS per share). Paste label + value columns, or one column in this order: ${FIN_FIELDS.map((f) => f.label).join(', ')}.`}
    >
      {note && <Notice kind="info" onDismiss={() => setNote(null)}>{note}</Notice>}
      <div className="sa-metrics">
        {FIN_FIELDS.map((f) => {
          const v = fin[f.key]
          const qoq = st.qoq(f.key)
          const big = prevQ && v !== null && toNum(prevQ[f.key]) && Math.abs(((v - toNum(prevQ[f.key])) / Math.abs(toNum(prevQ[f.key]))) * 100) > 50
          return (
            <div key={f.key} className="sa-metric">
              <label className="sa-metric-label">
                {f.label}
                <span className="sa-muted"> · {f.perShare ? `${u.split(' ')[0] || ''} per share` : u}</span>
              </label>
              <NumberInput label={f.label} value={values[f.key]} onChange={(x) => setValues((p) => ({ ...p, [f.key]: x }))} unit={f.perShare ? '' : unit} />
              {(prevQ || yearAgo) && (
                <p className="sa-compare">
                  <span>
                    {prevLabel || 'Last Q'}: {prevQ ? fmt(f, prevQ[f.key]) : DASH}
                  </span>
                  <span>
                    {yearAgoLabel || 'Year ago'}: {yearAgo ? fmt(f, yearAgo[f.key]) : DASH}
                  </span>
                  <span className={big ? 'sa-warn-text' : ''}>
                    YoY {formatSignedPct(st.yoy(f.key))} · QoQ {formatSignedPct(qoq)}
                  </span>
                </p>
              )}
              {isInvalid(values[f.key]) && <p className="sa-field-error">Not a number.</p>}
            </div>
          )
        })}
      </div>
      <p className="sa-compare sa-margins">
        <span>
          EBITDA margin {formatPct(st.ebitdaMargin)}
          {st.ebitdaMargin !== null && st.ebitdaMarginPrev !== null ? ` (${formatPp(st.ebitdaMargin - st.ebitdaMarginPrev)} QoQ)` : ''}
        </span>
        <span>
          PAT margin {formatPct(st.patMargin)}
          {st.patMargin !== null && st.patMarginPrev !== null ? ` (${formatPp(st.patMargin - st.patMarginPrev)} QoQ)` : ''}
        </span>
      </p>
    </PasteZone>
  )
}

// ── Segments ────────────────────────────────────────────────────────────

/** rows: [{ name, revenue, ebit }] raw strings */
export function SegmentInputs({ rows, setRows, currency, unit, prev }) {
  const [note, setNote] = useState(null)
  const u = unitLabel(currency, unit)
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  function onSheet(text) {
    const parsed = parseRowsPaste(text)
    if (parsed.length && parsed.every((p) => p.nums.length === 0 && parseNumberCell(p.name) !== undefined)) {
      // single column of numbers → revenue of the rows shown, in order
      setRows((rs) => rs.map((r, i) => (i < parsed.length ? { ...r, revenue: asText(parseNumberCell(parsed[i].name)) } : r)))
      setNote(`Filled revenue for ${Math.min(parsed.length, rows.length)} segment(s) in order.`)
      return
    }
    setRows((rs) => {
      const next = rs.slice()
      for (const p of parsed) {
        const i = next.findIndex((r) => r.name.trim().toLowerCase() === p.name.toLowerCase())
        const row = { name: p.name, revenue: asText(p.nums[0]), ebit: asText(p.nums[1]) }
        if (i >= 0) next[i] = { ...next[i], revenue: row.revenue, ebit: row.ebit || next[i].ebit }
        else next.push(row)
      }
      return next
    })
    setNote(`Filled ${parsed.length} segment row${parsed.length === 1 ? '' : 's'} from the paste.`)
  }

  return (
    <PasteZone onSheet={onSheet} hint={`In ${u || 'the reporting unit'}. Paste rows of: segment name, revenue, EBIT.`}>
      {note && <Notice kind="info" onDismiss={() => setNote(null)}>{note}</Notice>}
      {rows.length === 0 && <p className="sa-muted sa-small">No segments yet.</p>}
      {rows.map((r, i) => {
        const last = prev?.get(r.name.trim())
        return (
          <fieldset key={i} className="sa-segrow">
            <legend className="sa-sr">Segment {i + 1}</legend>
            <input className="sa-input" placeholder="Segment name" aria-label={`Segment ${i + 1} name`} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
            <NumberInput label={`${r.name || 'Segment'} revenue`} placeholder="Revenue" value={r.revenue} onChange={(v) => set(i, 'revenue', v)} unit={unit} />
            <NumberInput label={`${r.name || 'Segment'} EBIT`} placeholder="EBIT" value={r.ebit} onChange={(v) => set(i, 'ebit', v)} unit={unit} />
            <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.name || 'segment'}`}>
              Remove
            </Button>
            {last && (
              <p className="sa-compare">
                Last period: revenue {formatFigure(last.revenue, currency, unit)} · EBIT {formatFigure(last.ebit, currency, unit)}
              </p>
            )}
          </fieldset>
        )
      })}
      <Button size="sm" onClick={() => setRows((rs) => [...rs, { name: '', revenue: '', ebit: '' }])}>
        + Add segment
      </Button>
    </PasteZone>
  )
}

// ── Shareholding ────────────────────────────────────────────────────────

/** values: { category: raw pct } · categories: ordered keys shown */
export function ShareholdingInputs({ values, setValues, categories, setCategories, prev }) {
  const [note, setNote] = useState(null)
  const total = shareholdingTotal(Object.fromEntries(categories.map((c) => [c, num(values[c])])))
  const warn = shareholdingWarning(total)
  const missing = SH_CATEGORIES.filter((c) => !categories.includes(c))

  function onSheet(text) {
    const lines = parseRowsPaste(text)
    let filled = 0
    const unmatched = []
    const add = []
    const next = {}
    if (lines.every((l) => l.nums.length === 0)) {
      // single column, in the order shown
      lines.forEach((l, i) => {
        if (i < categories.length) {
          next[categories[i]] = asText(parseNumberCell(l.name) ?? '')
          filled++
        }
      })
    } else {
      for (const l of lines) {
        const c = matchShareCategory(l.name)
        if (!c) {
          unmatched.push(l.name)
          continue
        }
        next[c] = asText(l.nums.find((n) => n !== null) ?? '')
        filled++
        if (!categories.includes(c)) add.push(c)
      }
    }
    setValues((p) => ({ ...p, ...next }))
    if (add.length) setCategories((cs) => SH_CATEGORIES.filter((c) => cs.includes(c) || add.includes(c)))
    setNote(`Filled ${filled} categor${filled === 1 ? 'y' : 'ies'} from the paste.${unmatched.length ? ` Not matched: ${unmatched.join(', ')}.` : ''}`)
  }

  return (
    <PasteZone onSheet={onSheet} hint="Percent of shares. Paste category + % columns (Promoter, FPI, DII, MF, Public…), or one column in this order.">
      {note && <Notice kind="info" onDismiss={() => setNote(null)}>{note}</Notice>}
      <div className="sa-metrics">
        {categories.map((c) => (
          <div key={c} className="sa-metric">
            <label className="sa-metric-label">{CATEGORY_LABELS[c]}</label>
            <NumberInput label={CATEGORY_LABELS[c]} value={values[c]} onChange={(v) => setValues((p) => ({ ...p, [c]: v }))} unit="%" />
            {prev?.has(c) && (
              <p className="sa-compare">
                Last: {formatPct(prev.get(c), 2)}
                {num(values[c]) !== null ? ` · ${formatPp(num(values[c]) - prev.get(c), 2)}` : ''}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className={`sa-total${warn ? ' sa-warn-text' : ''}`} role="status">
        Total: {total === null ? DASH : `${total.toFixed(2)}%`}
        {warn ? ` — ${warn}` : total !== null ? ' ✓' : ''}
      </p>
      {missing.length > 0 && (
        <label className="sa-inline-label">
          <span className="sa-sr">Add category</span>
          <select
            className="sa-input sa-select"
            value=""
            onChange={(e) => e.target.value && setCategories((cs) => SH_CATEGORIES.filter((c) => cs.includes(c) || c === e.target.value))}
          >
            <option value="">+ Add category…</option>
            {missing.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      )}
    </PasteZone>
  )
}
