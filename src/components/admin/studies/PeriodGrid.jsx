/**
 * PeriodGrid — rows × periods (latest first). Tap a cell to correct it:
 * the correction is saved as a NEW revision row (append-only tables are
 * never UPDATEd). Cells on a revision > 1 show a "rev N" marker; the cell
 * sheet lists every earlier revision with its date.
 */
import { useState } from 'react'
import { DASH } from '../../study/format.js'
import { useDirtyFlag } from './dirty.js'
import { parseNumberCell } from './periods.js'
import { NumberInput } from './PeriodInputs.jsx'
import { Button, ErrorBox, Modal } from './ui.jsx'

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * columns  [{ key, label, sub }]
 * rows     [{ key, label, sub }]
 * getCell(rowKey, colKey) → { value, revision, history: [{ revision, value, created_at }] }
 * format(value, rowKey) → string
 * onCorrect(rowKey, colKey, number|null) → Promise<error string | null>
 * totals   optional { label, cells: { colKey: { text, warn } } }
 */
export default function PeriodGrid({ caption, columns, rows, getCell, format, onCorrect, totals, emptyText = 'No periods yet.' }) {
  const [edit, setEdit] = useState(null) // { row, col, raw, cell }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const changed = Boolean(edit) && edit.raw !== String(edit.cell?.value ?? '')
  useDirtyFlag('grid-cell', changed)

  if (!columns.length) return <p className="sa-muted">{emptyText}</p>

  async function save() {
    const v = parseNumberCell(edit.raw)
    if (v === undefined) {
      setError('That is not a number.')
      return
    }
    setBusy(true)
    const err = await onCorrect(edit.row.key, edit.col.key, v)
    setBusy(false)
    if (err) setError(err)
    else {
      setEdit(null)
      setError(null)
    }
  }

  return (
    <>
      <div className="sa-grid-wrap" role="region" aria-label={caption} tabIndex={0}>
        <table className="sa-pgrid">
          <caption className="sa-sr">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="sa-pgrid-rowhead">
                <span className="sa-sr">Metric</span>
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                  {c.sub && <span className="sa-block sa-muted">{c.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="sa-pgrid-rowhead">
                  {r.label}
                  {r.sub && <span className="sa-block sa-muted">{r.sub}</span>}
                </th>
                {columns.map((c) => {
                  const cell = getCell(r.key, c.key)
                  const rev = cell?.revision > 1 ? cell.revision : null
                  return (
                    <td key={c.key}>
                      <button
                        type="button"
                        className="sa-cell"
                        onClick={() => {
                          setError(null)
                          setEdit({ row: r, col: c, raw: cell?.value == null ? '' : String(cell.value), cell })
                        }}
                        aria-label={`${r.label}, ${c.label}: ${cell?.value == null ? 'empty' : format(cell.value, r.key)}${rev ? `, revision ${rev}` : ''}. Correct`}
                      >
                        {cell?.value == null ? DASH : format(cell.value, r.key)}
                        {rev && <span className="sa-rev">rev {rev}</span>}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
            {totals && (
              <tr className="sa-pgrid-total">
                <th scope="row" className="sa-pgrid-rowhead">
                  {totals.label}
                </th>
                {columns.map((c) => (
                  <td key={c.key} className={totals.cells[c.key]?.warn ? 'sa-warn-text' : ''} title={totals.cells[c.key]?.warn || undefined}>
                    {totals.cells[c.key]?.text ?? DASH}
                    {totals.cells[c.key]?.warn ? ' ⚠' : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={`${edit.row.label} · ${edit.col.label}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button variant="primary" onClick={save} disabled={busy || !changed}>
                {busy ? 'Saving…' : edit.cell?.revision ? `Save as revision ${(edit.cell.history?.[0]?.revision ?? edit.cell.revision) + 1}` : 'Save'}
              </Button>
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
            </>
          }
        >
          <p className="sa-help">
            {edit.cell?.revision
              ? 'Corrections never overwrite: a new revision is added with this value and every other figure of the period copied from the current revision.'
              : 'No figure yet for this period — this adds the first one.'}
          </p>
          <NumberInput label="Corrected value" value={edit.raw} onChange={(raw) => setEdit((e) => ({ ...e, raw }))} />
          <ErrorBox error={error} onDismiss={() => setError(null)} />
          {edit.cell?.history?.length > 0 && (
            <div className="sa-history">
              <p className="sa-label">History</p>
              <ol>
                {edit.cell.history.map((h, i) => (
                  <li key={h.revision}>
                    <span className="sa-rev">rev {h.revision}</span> {h.value == null ? DASH : format(h.value, edit.row.key)}
                    {h.value != null && String(Number(h.value)) !== format(h.value, edit.row.key).replace(/,/g, '') ? <span className="sa-muted"> (exact {Number(h.value)})</span> : null}{' '}
                    <span className="sa-muted">· {fmtWhen(h.created_at)}</span>
                    {i === 0 && <span className="sa-muted"> · current</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
