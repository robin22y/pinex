/**
 * MediaUploader — pick or drop an image, fill in alt text + credit (both
 * required), set the focal point, then upload. The browser resizes to
 * 480/960/1600 (never upscaling) and encodes WebP (+ AVIF where possible);
 * only those variants are uploaded, to study-media/<yyyy>/<mm>/<uuid>-<w>.<ext>.
 */
import { useEffect, useRef, useState } from 'react'
import { EXT, encodeVariants, plannedWidths } from './imageResize.js'
import { insertMedia, removeFiles, uploadFile } from './api.js'
import FocalPicker from './FocalPicker.jsx'
import { Button, ErrorBox, Field, Notice } from './ui.jsx'

const MIME = { webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg' }
const EMPTY = { alt_text: '', credit: '', caption: '', source_url: '', tags: '' }

export default function MediaUploader({ onUploaded }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dims, setDims] = useState(null)
  const [meta, setMeta] = useState(EMPTY)
  const [focal, setFocal] = useState({ x: 0.5, y: 0.5 })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [notes, setNotes] = useState([])
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  function choose(f) {
    setError(null)
    setNotes([])
    if (!f) return
    if (!/^image\//.test(f.type)) {
      setError('That file is not an image. Use a JPEG, PNG, WebP or AVIF file.')
      return
    }
    setFile(f)
    setDims(null)
    setFocal({ x: 0.5, y: 0.5 })
    setPreview(URL.createObjectURL(f))
  }

  const set = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }))
  const ready = file && meta.alt_text.trim() && meta.credit.trim() && !busy

  async function upload() {
    if (!ready) return
    setError(null)
    setNotes([])
    const uploaded = []
    try {
      setBusy('Resizing…')
      const enc = await encodeVariants(file)
      const now = new Date()
      const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
      const id = crypto.randomUUID()
      const variants = []
      for (const [i, v] of enc.variants.entries()) {
        setBusy(`Uploading ${i + 1} of ${enc.variants.length}…`)
        const path = `${dir}/${id}-${v.width}.${EXT[v.format]}`
        const r = await uploadFile(path, v.blob, MIME[v.format])
        if (r.error) throw new Error(r.error)
        uploaded.push(path)
        variants.push({ width: v.width, height: v.height, format: v.format, path, bytes: v.blob.size })
      }
      const base = variants.filter((v) => v.format !== 'avif').sort((a, b) => b.width - a.width)[0]
      setBusy('Saving details…')
      const row = await insertMedia({
        id,
        storage_path: base.path,
        variants,
        width: enc.width,
        height: enc.height,
        alt_text: meta.alt_text.trim(),
        credit: meta.credit.trim(),
        caption: meta.caption.trim() || null,
        source_url: meta.source_url.trim() || null,
        focal_x: focal.x,
        focal_y: focal.y,
        tags: meta.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      })
      if (row.error) throw new Error(row.error)
      setNotes(enc.notes)
      setFile(null)
      setPreview(null)
      setMeta(EMPTY)
      if (inputRef.current) inputRef.current.value = ''
      onUploaded?.(row.data, enc.notes)
    } catch (e) {
      let msg = e?.message || String(e)
      if (uploaded.length) {
        const cleanup = await removeFiles(uploaded)
        msg += cleanup.error ? `\nAlso couldn't remove the partly uploaded files: ${uploaded.join(', ')}` : '\nThe partly uploaded files were removed.'
      }
      setError(msg)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="sa-uploader">
      <div
        className={`sa-drop${over ? ' sa-drop-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          choose(e.dataTransfer.files?.[0])
        }}
      >
        <p>{file ? file.name : 'Drop an image here, or'}</p>
        <label className="sa-btn sa-btn-default">
          {file ? 'Choose a different image' : 'Choose image'}
          <input ref={inputRef} type="file" accept="image/*" className="sa-sr" onChange={(e) => choose(e.target.files?.[0])} />
        </label>
      </div>

      {preview && (
        <>
          <img
            src={preview}
            alt=""
            hidden
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          <FocalPicker src={preview} x={focal.x} y={focal.y} onChange={(x, y) => setFocal({ x, y })} />
          {dims && (
            <p className="sa-help">
              Original {dims.w}×{dims.h}. Will upload widths {plannedWidths(dims.w).join(', ')} px
              {dims.w < 480 ? ' (narrower than 480, so kept at its own width)' : ''}. The original is not uploaded.
            </p>
          )}
          <div className="sa-grid2">
            <Field label="Alt text" required help="Describe what the image shows, for screen readers." wide>
              <input className="sa-input" value={meta.alt_text} onChange={set('alt_text')} aria-required="true" />
            </Field>
            <Field label="Credit" required help="e.g. Photo: Company annual report FY25" wide>
              <input className="sa-input" value={meta.credit} onChange={set('credit')} aria-required="true" />
            </Field>
            <Field label="Caption" wide>
              <input className="sa-input" value={meta.caption} onChange={set('caption')} />
            </Field>
            <Field label="Source URL">
              <input className="sa-input" type="url" inputMode="url" value={meta.source_url} onChange={set('source_url')} />
            </Field>
            <Field label="Tags" help="Comma separated">
              <input className="sa-input" value={meta.tags} onChange={set('tags')} />
            </Field>
          </div>
          {!ready && !busy && <p className="sa-help">Alt text and credit are required before uploading.</p>}
          <div className="sa-row">
            <Button variant="primary" onClick={upload} disabled={!ready}>
              {busy || 'Upload'}
            </Button>
          </div>
        </>
      )}
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      {notes.length > 0 && <Notice kind="info">{notes.join(' ')}</Notice>}
    </div>
  )
}
