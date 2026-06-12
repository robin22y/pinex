// TermTooltip — wraps any PineX-specific term in an underlined,
// tap-to-open tooltip with a 2-sentence explanation plus a link to
// the relevant Academy module.
//
// Usage:
//   <TermTooltip term="stage 2">Stage 2</TermTooltip>
//   <TermTooltip term="rs">RS</TermTooltip>
//
// `term` is the lookup key (case-insensitive). If the dictionary
// doesn't have an entry, the children are rendered plain so callers
// can wrap terms speculatively without breaking the UI.
//
// Tap to open. Outside-click closes. The link routes to /learn with
// the module id as a hash so the Academy page can scroll/highlight.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'

const TERMS = {
  'basing': {
    short: 'Stock moving sideways near its long-term trend line. Building energy before a potential move.',
    module: 'stage1_basing',
    moduleLabel: 'Learn about Basing →',
  },
  'advancing': {
    short: 'Stock above a rising long-term trend line with multiple criteria confirmed.',
    module: 'stage2_advancing',
    moduleLabel: 'Learn about Advancing →',
  },
  'topping': {
    short: 'Stock showing early signs of weakness after an advance. Criteria starting to fail.',
    module: 'stage3_topping',
    moduleLabel: 'Learn about Topping →',
  },
  'declining': {
    short: 'Stock below a falling trend line. Most cycle criteria failing.',
    module: 'stage4_declining',
    moduleLabel: 'Learn about Declining →',
  },
  'criteria': {
    short: 'Five conditions checked daily: trend direction, RS vs Nifty, OBV, price position, and volume pattern.',
    module: 'core_foundation',
    moduleLabel: 'Learn about Criteria →',
  },
  'swingx': {
    short: 'PineX filter showing stocks that meet all five cycle criteria today.',
    module: 'stage2_advancing',
    moduleLabel: 'Learn about SwingX →',
  },
  'breakout': {
    short: 'Stock that hit a new 52-week high — a potential start of a new advancing phase.',
    module: 'stage2_advancing',
    moduleLabel: 'Learn more →',
  },
  'breakouts': {
    short: 'Stocks that hit a new 52-week high — a potential start of a new advancing phase.',
    module: 'stage2_advancing',
    moduleLabel: 'Learn more →',
  },
  'stage 2': {
    short: 'The advancing phase — stock above rising trend with strong participation.',
    module: 'stage2_advancing',
    moduleLabel: 'Learn about Stage 2 →',
  },
  'rs': {
    short: 'Relative Strength vs Nifty. Positive RS means the stock is outperforming the index.',
    module: 'relative_strength_selection',
    moduleLabel: 'Learn about RS →',
  },
  'obv': {
    short: 'On-Balance Volume. Rising OBV means buying volume is exceeding selling volume.',
    module: 'volume_rules',
    moduleLabel: 'Learn about OBV →',
  },
  'delivery': {
    short: 'Delivery volume shows genuine buying vs speculative trading. High delivery = real interest.',
    module: 'volume_rules',
    moduleLabel: 'Learn about Delivery →',
  },
  '30w ma': {
    short: 'The 30-week moving average — the long-term trend line PineX uses as the cycle reference.',
    module: 'core_foundation',
    moduleLabel: 'Learn the methodology →',
  },
}

export default function TermTooltip({ term, children }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const def = TERMS[String(term || '').toLowerCase()]

  // Close on outside click — listens once when open. The capture
  // phase + a tiny delay would also work, but a simple click handler
  // bound when open is the lightest. Skips the inner click that
  // opened it because the click event has already finished bubbling
  // by the time the effect attaches.
  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onEsc)
    function onEsc(e) { if (e.key === 'Escape') setOpen(false) }
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  if (!def) return children

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <span
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title={def.short}
        style={{
          borderBottom: `1px dashed ${C.amber}`,
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        {children}
      </span>

      {open && (
        <div
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            zIndex: 50,
            background: C.surface2,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: '12px 14px',
            width: 240,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            marginBottom: 6,
          }}
        >
          <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, margin: 0, marginBottom: 8 }}>
            {def.short}
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate(`/learn#${def.module}`)
            }}
            style={{
              fontSize: 11,
              color: C.amber,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontWeight: 600,
            }}
          >
            {def.moduleLabel}
          </button>
        </div>
      )}
    </span>
  )
}
