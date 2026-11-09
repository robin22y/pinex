/** Series tab: checkbox list of active study_series; toggles save immediately. */
import { useEffect, useState } from 'react'
import { linkSeries, listSeries, studySeries, unlinkSeries } from './api.js'
import { ErrorBox, Spinner } from './ui.jsx'

export default function SeriesTab({ studyId }) {
  const [series, setSeries] = useState(null)
  const [linked, setLinked] = useState(new Set())
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let live = true
    Promise.all([listSeries(), studySeries(studyId)]).then(([s, l]) => {
      if (!live) return
      setSeries(s.data || [])
      setLinked(new Set((l.data || []).map((x) => x.series_id)))
      setError([s.error, l.error].filter(Boolean).join('\n') || null)
    })
    return () => {
      live = false
    }
  }, [studyId])

  async function toggle(s) {
    const on = linked.has(s.id)
    setBusy(s.id)
    const r = on ? await unlinkSeries(studyId, s.id) : await linkSeries(studyId, s.id)
    setBusy(null)
    if (r.error) {
      setError(r.error)
      return
    }
    setLinked((prev) => {
      const next = new Set(prev)
      if (on) next.delete(s.id)
      else next.add(s.id)
      return next
    })
  }

  if (!series) return <Spinner />
  // Active series, plus inactive ones this study is still linked to (so they can be removed).
  const rows = series.filter((s) => s.is_active || linked.has(s.id))
  return (
    <div className="sa-tabpanel">
      <h2 className="sa-h2">Series</h2>
      <p className="sa-help">Changes save as you tick. New series are added in the study_series table for now; there is no series editor yet.</p>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      {rows.length === 0 ? (
        <p className="sa-muted">No active series yet.</p>
      ) : (
        <ul className="sa-checklist">
          {rows.map((s) => (
            <li key={s.id}>
              <label>
                <input type="checkbox" className="sa-check" checked={linked.has(s.id)} disabled={busy === s.id} onChange={() => toggle(s)} />
                <span>
                  <strong>{s.name}</strong>
                  {!s.is_active && <span className="sa-muted"> (inactive)</span>}
                  {s.description && <span className="sa-muted sa-block">{s.description}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
