/**
 * MediaPicker — modal with the library grid and an upload tab; returns a
 * media id via onPick. MediaField wraps it for an image_id form field.
 */
import { useEffect, useState } from 'react'
import { getMediaByIds, thumbUrl } from './api.js'
import MediaLibrary from './MediaLibrary.jsx'
import MediaUploader from './MediaUploader.jsx'
import { Button, Modal } from './ui.jsx'

export function MediaPicker({ selectedId, onPick, onClose }) {
  const [tab, setTab] = useState('library')
  return (
    <Modal title="Choose image" onClose={onClose} wide>
      <div className="sa-subtabs" role="tablist">
        {[
          ['library', 'Library'],
          ['upload', 'Upload new'],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'library' ? (
        <MediaLibrary selectedId={selectedId} onSelect={(m) => onPick(m.id, m)} />
      ) : (
        <MediaUploader onUploaded={(m) => onPick(m.id, m)} />
      )}
    </Modal>
  )
}

export default function MediaField({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [media, setMedia] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    if (!value) return
    getMediaByIds([value]).then((r) => {
      if (!live) return
      setMedia(r.data.get(value) || null)
      setError(r.error || (r.data.has(value) ? null : 'This image no longer exists in the library.'))
    })
    return () => {
      live = false
    }
  }, [value])

  const shown = value && media?.id === value ? media : null
  return (
    <div className="sa-mediafield">
      {value ? (
        shown ? (
          <img src={thumbUrl(shown)} alt="" className="sa-mediafield-thumb" style={{ objectPosition: `${shown.focal_x * 100}% ${shown.focal_y * 100}%` }} />
        ) : (
          <span className="sa-mediafield-thumb sa-mediafield-empty">{error ? '!' : '…'}</span>
        )
      ) : (
        <span className="sa-mediafield-thumb sa-mediafield-empty">No image</span>
      )}
      <div className="sa-mediafield-body">
        {shown && (
          <p className="sa-small">
            {shown.alt_text}
            <br />
            <span className="sa-muted">{shown.credit}</span>
          </p>
        )}
        {value && error && <p className="sa-field-error">{error}</p>}
        <div className="sa-row">
          <Button size="sm" onClick={() => setOpen(true)}>
            {value ? 'Change' : 'Choose image'}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {open && (
        <MediaPicker
          selectedId={value}
          onClose={() => setOpen(false)}
          onPick={(id, m) => {
            setMedia(m)
            onChange(id)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
