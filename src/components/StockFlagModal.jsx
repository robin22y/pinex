// StockFlagModal — bottom-sheet "Report a phase mismatch" modal.
// Inserts a row into stage_flags. Parent gates the trigger button
// behind the per-user-per-stock-per-day rate limit.

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { C } from '../styles/tokens'

const STAGE_OPTIONS = ['Basing', 'Advancing', 'Topping', 'Declining']

export default function StockFlagModal({ open, onClose, onSubmitted, symbol, companyId, userId, currentPhase }) {
  const [suggested, setSuggested] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setSuggested(''); setReason(''); setSubmitting(false); setDone(false); setError('') }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onEsc(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, onClose])

  async function handleSubmit() {
    if (!userId || !suggested) return
    setSubmitting(true); setError('')
    try {
      const { error: insertErr } = await supabase
        .from('stage_flags')
        .insert({
          symbol,
          company_id: companyId || null,
          user_id: userId,
          reported_stage: currentPhase || 'Unknown',
          suggested_stage: suggested,
          reason: reason.slice(0, 200) || null,
          status: 'pending',
        })
      if (insertErr) throw insertErr
      setDone(true)
      onSubmitted?.()
    } catch (e) {
      setError(e?.message || 'Could not submit. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="flag-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onClose?.()}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1099 }}
          />
          <motion.div
            key="flag-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Report phase mismatch"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0,
              zIndex: 1100, background: C.surface,
              borderTopLeftRadius: 18, borderTopRightRadius: 18,
              maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
              <div style={{ width: 44, height: 4, borderRadius: 2, background: C.border }} />
            </div>

            <div style={{ padding: '6px 18px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                Report a phase mismatch for {symbol}
              </span>
              <button
                type="button"
                onClick={() => onClose?.()}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: C.textMuted, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4 }}
              >
                ×
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 4px' }}>
              {done ? (
                <div style={{ padding: '20px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }} aria-hidden>✓</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 6 }}>Thank you</div>
                  <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.55 }}>
                    Our team will review this within 24 hours.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>
                    PineX shows: <span style={{ color: C.text, fontWeight: 700 }}>{currentPhase || 'Unknown'}</span>
                  </div>

                  <div style={{ fontSize: 12, color: C.text, marginBottom: 8 }}>
                    What do you think it should be?
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {STAGE_OPTIONS.map((opt) => {
                      const on = suggested === opt
                      return (
                        <label
                          key={opt}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', borderRadius: 8,
                            background: on ? 'rgba(245,159,11,0.08)' : 'transparent',
                            border: `1px solid ${on ? C.amber : C.border}`,
                            cursor: 'pointer',
                            fontSize: 13, color: C.text,
                          }}
                        >
                          <input
                            type="radio"
                            name="stage"
                            value={opt}
                            checked={on}
                            onChange={() => setSuggested(opt)}
                            style={{ margin: 0, accentColor: C.amber }}
                          />
                          {opt}
                        </label>
                      )
                    })}
                  </div>

                  <div style={{ fontSize: 12, color: C.text, marginBottom: 6 }}>
                    Why do you think so? <span style={{ color: C.textFaint }}>(optional)</span>
                  </div>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 200))}
                    placeholder="e.g. Chart shows it has been basing for months"
                    rows={3}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: C.surface2, border: `1px solid ${C.border}`,
                      borderRadius: 8, padding: '8px 10px',
                      fontSize: 12, color: C.text, resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ fontSize: 10, color: C.textFaint, textAlign: 'right', marginTop: 2 }}>
                    {reason.length}/200
                  </div>
                  {error && (
                    <div style={{ fontSize: 11, color: C.red, marginTop: 8 }}>{error}</div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '14px 18px', borderTop: `1px solid ${C.border}` }}>
              {done ? (
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  style={{
                    flex: 1, padding: '10px 14px',
                    background: C.amber, border: 'none', borderRadius: 10,
                    color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onClose?.()}
                    disabled={submitting}
                    style={{
                      flex: 1, padding: '10px 14px',
                      background: 'transparent', border: `1px solid ${C.border}`,
                      borderRadius: 10, color: C.text,
                      fontSize: 13, fontWeight: 600,
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      opacity: submitting ? 0.6 : 1,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || !suggested}
                    style={{
                      flex: 1.4, padding: '10px 14px',
                      background: !suggested ? C.surface2 : C.amber,
                      border: 'none', borderRadius: 10,
                      color: !suggested ? C.textFaint : '#000',
                      fontSize: 13, fontWeight: 700,
                      cursor: submitting || !suggested ? 'not-allowed' : 'pointer',
                      opacity: submitting ? 0.7 : 1,
                    }}
                  >
                    {submitting ? 'Submitting…' : 'Submit Report'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
