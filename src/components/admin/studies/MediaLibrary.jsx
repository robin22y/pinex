/**
 * MediaLibrary — grid of study_media with search (alt / credit / tags /
 * caption) and "used by". In page mode a tile opens an edit panel
 * (metadata, focal point, delete — blocked while the image is used).
 * In picker mode (onSelect) a tile returns the media row.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorText, listMedia, mediaUsage, removeFiles, thumbUrl, updateMedia } from './api.js'
import { supabase } from '../../../lib/supabase'
import FocalPicker from './FocalPicker.jsx'
import { Button, ErrorBox, Field, Notice, Spinner } from './ui.jsx'

export default function MediaLibrary({ onSelect, selectedId, refreshKey = 0 }) {
  const [rows, setRows] = useState(null)
  const [usage, setUsage] = useState(new Map())
  const [q, setQ] = useState('')
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    Promise.all([listMedia(), mediaUsage()]).then(([m, u]) => {
      if (!live) return
      setRows(m.data || [])
      setUsage(u.data || new Map())
      setError([m.error, u.error].filter(Boolean).join('\n') || null)
    })
    return () => {
      live = false
    }
  }, [refreshKey, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!rows) return []
    if (!term) return rows
    return rows.filter((m) =>
      [m.alt_text, m.credit, m.caption, ...(m.tags || [])].some((s) => String(s || '').toLowerCase().includes(term)),
    )
  }, [rows, q])

  return (
    <div className="sa-library">
      <div className="sa-row">
        <input
          className="sa-input sa-search"
          type="search"
          placeholder="Search alt text, credit, tags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search images"
        />
        <span className="sa-muted">{rows ? `${shown.length} of ${rows.length}` : ''}</span>
      </div>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      {!rows ? (
        <Spinner />
      ) : !shown.length ? (
        <p className="sa-muted">{rows.length ? 'No images match.' : 'No images yet. Upload one.'}</p>
      ) : (
        <ul className="sa-media-grid">
          {shown.map((m) => {
            const used = usage.get(m.id) || []
            return (
              <li key={m.id} className={`sa-media-tile${selectedId === m.id ? ' is-selected' : ''}`}>
                <button type="button" onClick={() => (onSelect ? onSelect(m) : setEditing(m))} aria-label={`${onSelect ? 'Use' : 'Edit'}: ${m.alt_text}`}>
                  <img src={thumbUrl(m)} alt="" loading="lazy" style={{ objectPosition: `${m.focal_x * 100}% ${m.focal_y * 100}%` }} />
                </button>
                <p className="sa-tile-alt">{m.alt_text}</p>
                <p className="sa-tile-meta">{m.credit}</p>
                <p className="sa-tile-meta">
                  {m.width}×{m.height} · {used.length ? `Used ${used.length}×` : 'Unused'}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {editing && (
        <MediaEditPanel
          media={editing}
          used={usage.get(editing.id) || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function MediaEditPanel({ media, used, onClose, onSaved }) {
  const [m, setM] = useState({ ...media, tags: (media.tags || []).join(', ') })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setM((x) => ({ ...x, [k]: e.target.value }))

  async function save() {
    if (!m.alt_text.trim() || !m.credit.trim()) {
      setError('Alt text and credit are required.')
      return
    }
    setBusy(true)
    const r = await updateMedia(media.id, {
      alt_text: m.alt_text.trim(),
      credit: m.credit.trim(),
      caption: m.caption?.trim() || null,
      source_url: m.source_url?.trim() || null,
      focal_x: m.focal_x,
      focal_y: m.focal_y,
      tags: m.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    })
    setBusy(false)
    if (r.error) setError(r.error)
    else onSaved()
  }

  async function remove() {
    setError(null)
    // Re-check usage right before deleting — another tab may have linked it.
    const fresh = await mediaUsage()
    if (fresh.error) {
      setError(`${fresh.error}\nNot deleted: couldn't confirm the image is unused.`)
      return
    }
    const now = fresh.data.get(media.id) || []
    if (now.length) {
      setError(`Can't delete: this image is used by ${now.map((u) => u.label).join('; ')}.`)
      return
    }
    if (!window.confirm('Delete this image and all its sizes from storage? This cannot be undone.')) return
    setBusy(true)
    const del = await supabase.from('study_media').delete().eq('id', media.id)
    if (del.error) {
      setBusy(false)
      setError(errorText(del.error, 'Deleting image'))
      return
    }
    const paths = [...new Set([media.storage_path, ...(media.variants || []).map((v) => v.path)].filter(Boolean))]
    const r = await removeFiles(paths)
    setBusy(false)
    if (r.error) {
      setError(`${r.error}\nThe library entry was deleted but these files remain in storage: ${paths.join(', ')}`)
      return
    }
    onSaved()
  }

  return (
    <div className="sa-panel sa-media-edit">
      <div className="sa-row sa-row-between">
        <h3>Edit image</h3>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <FocalPicker
        src={thumbUrl(media, 960)}
        alt={m.alt_text}
        x={Number(m.focal_x)}
        y={Number(m.focal_y)}
        onChange={(x, y) => setM((v) => ({ ...v, focal_x: x, focal_y: y }))}
      />
      <div className="sa-grid2">
        <Field label="Alt text" required wide>
          <input className="sa-input" value={m.alt_text} onChange={set('alt_text')} />
        </Field>
        <Field label="Credit" required wide>
          <input className="sa-input" value={m.credit} onChange={set('credit')} />
        </Field>
        <Field label="Caption" wide>
          <input className="sa-input" value={m.caption || ''} onChange={set('caption')} />
        </Field>
        <Field label="Source URL">
          <input className="sa-input" type="url" value={m.source_url || ''} onChange={set('source_url')} />
        </Field>
        <Field label="Tags" help="Comma separated">
          <input className="sa-input" value={m.tags} onChange={set('tags')} />
        </Field>
      </div>
      <div className="sa-usedby">
        <strong>Used by</strong>
        {used.length ? (
          <ul>
            {used.map((u, i) => (
              <li key={i}>{u.href ? <Link to={u.href}>{u.label}</Link> : u.label}</li>
            ))}
          </ul>
        ) : (
          <p className="sa-muted">Not used anywhere.</p>
        )}
      </div>
      <p className="sa-help">
        Sizes: {(media.variants || []).map((v) => `${v.width}w ${v.format}`).join(', ') || '—'}
      </p>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <div className="sa-row">
        <Button variant="primary" onClick={save} disabled={busy}>
          Save details
        </Button>
        <Button variant="danger" onClick={remove} disabled={busy || used.length > 0} title={used.length ? 'In use — remove it from those places first' : ''}>
          Delete
        </Button>
        {used.length > 0 && <Notice kind="info">Delete is blocked while the image is in use.</Notice>}
      </div>
    </div>
  )
}
