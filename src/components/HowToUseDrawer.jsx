// HowToUseDrawer — bottom-sheet slide-up walkthrough of the 7
// canonical PineX steps. Used in two flows:
//   1. First-login auto-open on Home (gated by pinex_guide_seen)
//   2. Re-openable any time from Account → "How to use PineX"
//
// Why a drawer and not a /guide route: keeps the user anchored to
// whatever screen they were on, dismisses with swipe-down or × so
// they don't have to navigate back. URL doesn't change.
//
// Editing content: every step lives in the STEPS array below. To
// change copy / order / count just edit that array.

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { C } from '../styles/tokens'
import Icon from './ui/Icon'

// Icons are Flaticon-style class suffixes — Icon strips the `fi-rr-` prefix
// and renders the matching lucide SVG.
// Catalog: https://www.flaticon.com/uicons/interface-icons/regular
const STEPS = [
  {
    iconClass: 'fi-rr-search',
    title: 'Search any stock',
    body: 'Type any company name or ticker in the search bar. Try RELIANCE, HONASA, or INFY. Tap a result to open that stock’s cycle analysis.',
  },
  {
    iconClass: 'fi-rr-chart-line-up',
    title: 'Read the cycle position',
    body: 'Every stock shows a phase — Basing, Advancing, Topping, or Declining — with a criteria score like 4/5. Higher score means the pattern is clearer.',
  },
  {
    iconClass: 'fi-rr-document',
    title: 'Read the plain English description',
    body: 'Below the phase badge is a daily description with no jargon. It explains what the data shows — sector context, trend strength, and what changed recently.',
  },
  {
    iconClass: 'fi-rr-bookmark',
    title: 'Add stocks to your watchlist',
    body: 'Tap the bookmark icon on any stock page to save it. Your watchlist appears on the home page every morning and alerts you when something changes overnight.',
  },
  {
    iconClass: 'fi-rr-folder',
    title: 'Explore sectors',
    body: 'Tap Sectors in the bottom bar. You will see all NSE sectors grouped into Strong, Mixed, and Weak participation. Tap any sector to see the stocks inside it.',
  },
  {
    iconClass: 'fi-rr-flask',
    title: 'Run a screen in The Lab',
    body: 'Tap the flask icon in the bottom bar. Filter 2,125 NSE stocks by phase, criteria score, and sector. Start with the SwingX template — it shows stocks meeting all five cycle criteria today.',
  },
  {
    iconClass: 'fi-rr-graduation-cap',
    title: 'Complete the Academy',
    body: 'Tap Learn in the bottom bar. Eight modules explain cycle analysis in Malayalam, English, Hindi, and Tamil. Finish all modules and pass the exam to earn your certificate and unlock full access.',
  },
]

export default function HowToUseDrawer({ open, onClose }) {
  const [step, setStep] = useState(0)

  // Reset to step 0 each time the drawer opens — feels natural and
  // saves the caller from threading a key prop just to remount.
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // Esc to dismiss matches the rest of the codebase's modal/drawer
  // affordance (TermTooltip, BYOK banner, …).
  useEffect(() => {
    if (!open) return
    function onEsc(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, onClose])

  const isFirst = step === 0
  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — tap to dismiss. fixed inset-0, dim. */}
          <motion.div
            key="how-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onClose?.()}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
              zIndex: 999,
            }}
          />

          {/* Sheet — slides up from the bottom on a spring. Swipe
              down >120 px or velocity-down dismisses. Max height
              90 vh, scrollable if step body is longer than viewport. */}
          <motion.div
            key="how-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="How to use PineX"
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) onClose?.()
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1000,
              background: C.surface,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.35)',
              touchAction: 'none',
            }}
          >
            {/* Drag handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
              <div style={{ width: 44, height: 4, borderRadius: 2, background: C.border }} />
            </div>

            {/* Header — title + close + step counter */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 18px 12px',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>How to use PineX</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>
                  Step {step + 1} of {STEPS.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onClose?.()}
                aria-label="Close"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: C.textMuted,
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>

            {/* Step progress dots — at-a-glance navigation */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                justifyContent: 'center',
                padding: '12px 18px 4px',
              }}
            >
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-label={`Go to step ${i + 1}`}
                  style={{
                    width: i === step ? 22 : 8,
                    height: 8,
                    borderRadius: 4,
                    background: i === step ? C.amber : C.border,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'width 0.2s, background 0.2s',
                    padding: 0,
                  }}
                />
              ))}
            </div>

            {/* Body — animated cross-fade between steps */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 4px' }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.18 }}
                >
                  <div style={{ marginBottom: 10, lineHeight: 1, color: C.accent }} aria-hidden>
                    <Icon name={current.iconClass} size={38} style={{ color: 'currentColor', display: 'inline-flex' }} />
                  </div>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>
                    {current.title}
                  </h3>
                  <p style={{ margin: '10px 0 0', fontSize: 14, color: C.textMuted, lineHeight: 1.65 }}>
                    {current.body}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer — Prev / Next or Got it */}
            <div
              style={{
                display: 'flex',
                gap: 10,
                padding: '14px 18px',
                borderTop: `1px solid ${C.border}`,
              }}
            >
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={isFirst}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: 'transparent',
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  color: isFirst ? C.textFaint : C.text,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isFirst ? 'not-allowed' : 'pointer',
                  opacity: isFirst ? 0.6 : 1,
                }}
              >
                ← Back
              </button>
              {isLast ? (
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  style={{
                    flex: 1.4,
                    padding: '10px 14px',
                    background: C.amber,
                    border: 'none',
                    borderRadius: 10,
                    color: '#000',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Got it ✓
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                  style={{
                    flex: 1.4,
                    padding: '10px 14px',
                    background: C.amber,
                    border: 'none',
                    borderRadius: 10,
                    color: '#000',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Next →
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
