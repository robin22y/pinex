/**
 * SourcePicker — this study's sources as a dropdown, plus "Add new source"
 * inline (inserts into study_sources without leaving the tab).
 */
import { useState } from 'react'
import { insertRow } from './api.js'
import { CHILD_TABLES, SOURCE_KIND_LABELS } from './config.js'
import { Button, ErrorBox, PlainInput } from './ui.jsx'

const ADD = '__add__'
const QUICK_FIELDS = CHILD_TABLES.sources.fields.filter((f) => ['kind', 'title', 'url', 'document_date', 'page'].includes(f.key))

export default function SourcePicker({ value, onChange, sources, studyId, onSourceAdded }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ kind: 'annual_report' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const list = sources || []
  const missing = value && !list.some((s) => s.id === value)

  async function add() {
    if (!draft.title?.trim()) {
      setError('A source needs a title.')
      return
    }
    setBusy(true)
    const row = { study_company_id: studyId, sort_order: list.length + 1 }
    for (const f of QUICK_FIELDS) row[f.key] = typeof draft[f.key] === 'string' ? draft[f.key].trim() || null : (draft[f.key] ?? null)
    const r = await insertRow('study_sources', row)
    setBusy(false)
    if (r.error) {
      setError(r.error)
      return
    }
    onSourceAdded?.(r.data)
    onChange(r.data.id)
    setAdding(false)
    setDraft({ kind: 'annual_report' })
    setError(null)
  }

  return (
    <div className="sa-sourcepicker">
      <select
        className="sa-input"
        value={adding ? ADD : (value ?? '')}
        onChange={(e) => {
          if (e.target.value === ADD) setAdding(true)
          else {
            setAdding(false)
            onChange(e.target.value || null)
          }
        }}
      >
        <option value="">— No source —</option>
        {missing && <option value={value}>(deleted source)</option>}
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
            {s.kind ? ` · ${SOURCE_KIND_LABELS[s.kind] || s.kind}` : ''}
          </option>
        ))}
        <option value={ADD}>+ Add new source…</option>
      </select>
      {adding && (
        <div className="sa-inline-form">
          {QUICK_FIELDS.map((f) => (
            <label key={f.key} className="sa-field">
              <span className="sa-label">
                {f.label}
                {f.required && <span className="sa-req"> *</span>}
              </span>
              <PlainInput field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
            </label>
          ))}
          <ErrorBox error={error} />
          <div className="sa-row">
            <Button size="sm" variant="primary" onClick={add} disabled={busy}>
              {busy ? 'Adding…' : 'Add source'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
