/**
 * TamInputsEditor — repeatable rows for study_tam.inputs (jsonb array of
 * { label, value, unit, source_id }).
 */
import SourcePicker from './SourcePicker.jsx'
import { Button } from './ui.jsx'

export default function TamInputsEditor({ value, onChange, sources, studyId, onSourceAdded }) {
  const rows = Array.isArray(value) ? value : []
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = rows.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="sa-taminputs">
      {rows.length === 0 && <p className="sa-muted sa-small">No inputs yet.</p>}
      {rows.map((r, i) => (
        <fieldset key={i} className="sa-taminput">
          <legend className="sa-sr">Input {i + 1}</legend>
          <input className="sa-input" placeholder="Label, e.g. Announced cell capacity" aria-label={`Input ${i + 1} label`} value={r.label ?? ''} onChange={(e) => set(i, 'label', e.target.value)} />
          <input
            className="sa-input"
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="Value"
            aria-label={`Input ${i + 1} value`}
            value={r.value ?? ''}
            onChange={(e) => set(i, 'value', e.target.value === '' ? null : Number(e.target.value))}
          />
          <input className="sa-input" placeholder="Unit, e.g. GWh" aria-label={`Input ${i + 1} unit`} value={r.unit ?? ''} onChange={(e) => set(i, 'unit', e.target.value)} />
          <SourcePicker value={r.source_id ?? null} onChange={(v) => set(i, 'source_id', v)} sources={sources} studyId={studyId} onSourceAdded={onSourceAdded} />
          <div className="sa-row">
            <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move input up">
              ↑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move input down">
              ↓
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              Remove input
            </Button>
          </div>
        </fieldset>
      ))}
      <Button size="sm" onClick={() => onChange([...rows, { label: '', value: null, unit: '', source_id: null }])}>
        + Add input
      </Button>
    </div>
  )
}
