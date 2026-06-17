import { useEffect, useRef, useState } from 'react'

// Inline help tooltip. Renders `children` followed by a small "?"
// indicator; tapping or hovering the indicator opens a small
// popup above it with `text` inside.
//
// Usage:
//   <Tooltip text="Stocks in uptrend above 30W MA.">
//     Stage 2
//   </Tooltip>
//
// The popup closes on click-outside and on Escape. Hover support is
// included for desktop pointer users, but the primary interaction
// is tap — the indicator itself is a focusable button so the
// pattern works without a mouse.
export default function Tooltip({ text, children }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocPointer(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointer)
    document.addEventListener('touchstart', onDocPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      document.removeEventListener('touchstart', onDocPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      {children}
      <button
        type="button"
        aria-label="What is this?"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: 'inline-block',
          width: 14, height: 14,
          borderRadius: '50%',
          background: '#1E2530',
          color: '#64748B',
          fontSize: 10,
          textAlign: 'center',
          lineHeight: '14px',
          marginLeft: 4,
          cursor: 'pointer',
          border: 'none',
          padding: 0,
          verticalAlign: 'middle',
          fontWeight: 700,
        }}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#141820',
            border: '1px solid #1E2530',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 12,
            color: '#CBD5E1',
            maxWidth: 200,
            // max-content lets short text shrink and long text fill
            // up to the 200 px cap — looks tighter than a hard width.
            width: 'max-content',
            minWidth: 140,
            lineHeight: 1.45,
            zIndex: 100,
            whiteSpace: 'normal',
            textAlign: 'left',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </span>
  )
}
