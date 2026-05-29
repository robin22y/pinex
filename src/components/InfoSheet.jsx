import { useState } from 'react'
import { C } from '../styles/tokens'

// ── InfoSheet ───────────────────────────────────────────────────────────────
// Reusable ℹ️ disclosure. On tap it opens a bottom sheet (works on mobile and
// desktop) with a backdrop; closes on backdrop tap or the × button. Used for
// the "data only / not advice" explanations throughout the app.
//
// Props: trigger (node), title (string), children (content).
export default function InfoSheet({ trigger, title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <span
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        style={{ display: 'inline-flex', cursor: 'pointer' }}
      >
        {trigger}
      </span>
      {open && (
        <div
          onClick={(e) => { e.stopPropagation(); setOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 520, maxHeight: '80vh', overflowY: 'auto',
              background: C.surface, border: `1px solid ${C.border}`,
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              padding: '18px 18px calc(20px + env(safe-area-inset-bottom))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{title}</h3>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.65 }}>{children}</div>
          </div>
        </div>
      )}
    </>
  )
}
