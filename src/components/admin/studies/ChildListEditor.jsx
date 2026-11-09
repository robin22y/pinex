/**
 * ChildListEditor — one generic editor for every study child table
 * (founders, timeline, products, TAM, developments, risks, watch items,
 * sources). Driven by a CHILD_TABLES config: fields, labels, input types,
 * required fields.
 *
 * Handles: list, add, inline edit, delete with confirm, reorder (drag on
 * desktop, ↑/↓ buttons everywhere) persisted to sort_order, saving, the
 * non-blocking content check, and the unsaved-changes flag.
 *
 * Rows are owned by the parent (so the Sources list stays shared with
 * every SourcePicker); changes go back through onRowsChange.
 */
import { useState } from 'react'
import { clean, deleteRow, insertRow, saveOrder, updateRow } from './api.js'
import { scanFields } from './contentCheck.js'
import { LEAVE_MESSAGE, useDirtyFlag } from './dirty.js'
import MediaField from './MediaPicker.jsx'
import SourcePicker from './SourcePicker.jsx'
import TamInputsEditor from './TamInputsEditor.jsx'
import { Button, ContentWarnings, ErrorBox, Field, PlainInput } from './ui.jsx'

const NEW = '__new__'

function normalise(field, v) {
  switch (field.type) {
    case 'number': {
      if (v === null || v === undefined || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : v
    }
    case 'checkbox':
      return Boolean(v)
    case 'tam_inputs':
      return (Array.isArray(v) ? v : [])
        .map((x) => ({ label: clean(x.label), value: x.value ?? null, unit: clean(x.unit), source_id: x.source_id ?? null }))
        .filter((x) => x.label)
    default:
      return clean(v)
  }
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export default function ChildListEditor({ config, studyId, rows, onRowsChange, sources, onSourceAdded }) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [original, setOriginal] = useState(null)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [busy, setBusy] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)

  const fields = config.fields
  const textFields = Object.fromEntries(fields.filter((f) => ['text', 'textarea'].includes(f.type)).map((f) => [f.key, f.label]))
  const dirty = Boolean(draft) && fields.some((f) => !same(normalise(f, draft[f.key]), normalise(f, original?.[f.key])))
  useDirtyFlag(`child:${config.table}`, dirty)

  function open(row) {
    if (dirty && !window.confirm(LEAVE_MESSAGE)) return
    setError(null)
    if (row === NEW) {
      const blank = { ...(config.defaults || {}) }
      setEditingId(NEW)
      setDraft(blank)
      setOriginal(blank)
    } else {
      setEditingId(row.id)
      setDraft({ ...row })
      setOriginal({ ...row })
    }
  }

  function close() {
    if (dirty && !window.confirm(LEAVE_MESSAGE)) return
    setEditingId(null)
    setDraft(null)
    setOriginal(null)
    setError(null)
  }

  async function save() {
    const missing = fields.filter((f) => f.required && (normalise(f, draft[f.key]) === null || normalise(f, draft[f.key]) === ''))
    if (missing.length) {
      setError(`Required: ${missing.map((f) => f.label).join(', ')}.`)
      return
    }
    const payload = {}
    for (const f of fields) payload[f.key] = normalise(f, draft[f.key])
    const hits = scanFields(payload, textFields, `${config.title} · ${config.summary(payload) || config.noun}`)
    setBusy(true)
    setError(null)
    const r =
      editingId === NEW
        ? await insertRow(config.table, { ...payload, study_company_id: studyId, sort_order: rows.length + 1 })
        : await updateRow(config.table, editingId, payload)
    setBusy(false)
    if (r.error) {
      setError(r.error)
      return
    }
    onRowsChange(editingId === NEW ? [...rows, r.data] : rows.map((x) => (x.id === editingId ? r.data : x)))
    setWarnings(hits)
    setEditingId(null)
    setDraft(null)
    setOriginal(null)
  }

  async function remove(row) {
    const extra = config.table === 'study_sources' ? ' Anything citing it will lose its source link.' : ''
    if (!window.confirm(`Delete ${config.noun} “${config.summary(row) || 'untitled'}”? This cannot be undone.${extra}`)) return
    setBusy(true)
    const r = await deleteRow(config.table, row.id)
    setBusy(false)
    if (r.error) {
      setError(r.error)
      return
    }
    if (editingId === row.id) {
      setEditingId(null)
      setDraft(null)
    }
    onRowsChange(rows.filter((x) => x.id !== row.id))
  }

  async function reorder(from, to) {
    if (from === to || to < 0 || to >= rows.length) return
    const prev = rows
    const next = rows.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onRowsChange(next.map((x, i) => ({ ...x, sort_order: i + 1 })))
    const r = await saveOrder(config.table, next)
    if (r.error) {
      setError(`${r.error}\nThe order was not fully saved; reload the tab to see the stored order.`)
      onRowsChange(prev)
    }
  }

  const renderInput = (f) => {
    const v = draft[f.key]
    const set = (val) => setDraft((d) => ({ ...d, [f.key]: val }))
    if (f.type === 'source') return <SourcePicker value={v ?? null} onChange={set} sources={sources} studyId={studyId} onSourceAdded={onSourceAdded} />
    if (f.type === 'media') return <MediaField value={v ?? null} onChange={set} />
    if (f.type === 'tam_inputs') return <TamInputsEditor value={v} onChange={set} sources={sources} studyId={studyId} onSourceAdded={onSourceAdded} />
    return <PlainInput field={f} value={v} onChange={set} />
  }

  const renderForm = () => (
    <div className="sa-rowform">
      <div className="sa-grid2">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} help={f.help} wide={['textarea', 'tam_inputs', 'media'].includes(f.type)}>
            {renderInput(f)}
          </Field>
        ))}
      </div>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <div className="sa-row">
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : editingId === NEW ? `Add ${config.noun}` : 'Save'}
        </Button>
        <Button variant="ghost" onClick={close} disabled={busy}>
          Cancel
        </Button>
        {dirty && <span className="sa-dirty">Unsaved changes</span>}
      </div>
    </div>
  )

  return (
    <section className="sa-childlist" aria-label={config.title}>
      <div className="sa-row sa-row-between">
        <h2 className="sa-h2">
          {config.title} <span className="sa-muted">({rows.length})</span>
        </h2>
        {editingId !== NEW && (
          <Button variant="primary" onClick={() => open(NEW)}>
            + Add {config.noun}
          </Button>
        )}
      </div>
      <ContentWarnings hits={warnings} onDismiss={() => setWarnings([])} />
      {!editingId && <ErrorBox error={error} onDismiss={() => setError(null)} />}
      {rows.length === 0 && editingId !== NEW && <p className="sa-muted">Nothing here yet.</p>}
      <ol className="sa-items">
        {rows.map((row, i) => (
          <li
            key={row.id}
            className={`sa-item${editingId === row.id ? ' is-editing' : ''}${dragIndex === i ? ' is-dragging' : ''}`}
            draggable={!editingId}
            onDragStart={(e) => {
              setDragIndex(i)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => dragIndex !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndex !== null) reorder(dragIndex, i)
              setDragIndex(null)
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            {editingId === row.id ? (
              renderForm()
            ) : (
              <div className="sa-item-row">
                <span className="sa-handle" aria-hidden="true" title="Drag to reorder">
                  ⋮⋮
                </span>
                <button type="button" className="sa-item-main" onClick={() => open(row)}>
                  <span className="sa-item-title">{config.summary(row) || <em>Untitled</em>}</span>
                  {config.meta?.(row) ? <span className="sa-item-meta">{config.meta(row)}</span> : null}
                </button>
                <div className="sa-item-actions">
                  <Button size="sm" variant="ghost" onClick={() => reorder(i, i - 1)} disabled={i === 0 || busy} aria-label="Move up">
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => reorder(i, i + 1)} disabled={i === rows.length - 1 || busy} aria-label="Move down">
                    ↓
                  </Button>
                  <Button size="sm" onClick={() => open(row)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(row)} disabled={busy}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
        {editingId === NEW && <li className="sa-item is-editing">{renderForm()}</li>}
      </ol>
    </section>
  )
}
