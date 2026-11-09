/** Small UI primitives for the Studies admin. Styles: studies-admin.css (.sa-*). */
import { useEffect, useRef } from 'react'
import { STATUS_LABELS } from './config.js'

export function Button({ variant = 'default', size, className = '', ...props }) {
  return <button type="button" className={`sa-btn sa-btn-${variant}${size === 'sm' ? ' sa-btn-sm' : ''} ${className}`} {...props} />
}

export function ErrorBox({ error, onDismiss }) {
  if (!error) return null
  return (
    <div className="sa-alert sa-alert-error" role="alert">
      <div style={{ whiteSpace: 'pre-line', flex: 1 }}>{error}</div>
      {onDismiss && (
        <button type="button" className="sa-x" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

export function Notice({ children, kind = 'info', onDismiss }) {
  if (!children) return null
  return (
    <div className={`sa-alert sa-alert-${kind}`} role="status">
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss && (
        <button type="button" className="sa-x" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

/** Non-blocking content warning: [{ where, term, excerpt }]. */
export function ContentWarnings({ hits, onDismiss }) {
  if (!hits?.length) return null
  return (
    <div className="sa-alert sa-alert-warn" role="status">
      <div style={{ flex: 1 }}>
        <strong>Saved — but check the wording.</strong> These words read like investment advice:
        <ul className="sa-warn-list">
          {hits.map((h, i) => (
            <li key={i}>
              <b>“{h.term}”</b> in {h.where}: <span className="sa-muted">{h.excerpt}</span>
            </li>
          ))}
        </ul>
      </div>
      {onDismiss && (
        <button type="button" className="sa-x" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

export function StatusPill({ status }) {
  return <span className={`sa-pill sa-pill-${status}`}>{STATUS_LABELS[status] || status}</span>
}

export function Field({ label, required, help, error, children, wide }) {
  return (
    <label className={`sa-field${wide ? ' sa-field-wide' : ''}`}>
      <span className="sa-label">
        {label}
        {required && <span className="sa-req" aria-hidden="true"> *</span>}
      </span>
      {children}
      {help && <span className="sa-help">{help}</span>}
      {error && <span className="sa-field-error">{error}</span>}
    </label>
  )
}

/** Plain inputs: text, textarea, number, date, url, select, checkbox. */
export function PlainInput({ field, value, onChange, placeholder }) {
  const f = field
  const common = { 'aria-required': f.required || undefined, placeholder: placeholder ?? f.placeholder, className: 'sa-input' }
  switch (f.type) {
    case 'textarea':
      return <textarea {...common} rows={f.rows || 4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          step={f.step || 1}
          min={f.min}
          max={f.max}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      )
    case 'date':
      return <input {...common} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    case 'url':
      return <input {...common} type="url" inputMode="url" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'select':
      return (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          {!f.required && <option value="">—</option>}
          {f.required && value == null && <option value="">Choose…</option>}
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'checkbox':
      return <input type="checkbox" className="sa-check" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
    default:
      return (
        <input
          {...common}
          type="text"
          maxLength={f.maxLength}
          value={value ?? ''}
          onChange={(e) => onChange(f.upper ? e.target.value.toUpperCase() : e.target.value)}
        />
      )
  }
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const prev = document.activeElement
    ref.current?.focus()
    const onKey = (e) => e.key === 'Escape' && closeRef.current?.()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [])
  return (
    <div className="sa-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`sa-modal${wide ? ' sa-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="sa-modal-head">
          <h2>{title}</h2>
          <button type="button" className="sa-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sa-modal-body">{children}</div>
        {footer && <div className="sa-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Spinner({ label = 'Loading…' }) {
  return <p className="sa-muted sa-loading">{label}</p>
}
