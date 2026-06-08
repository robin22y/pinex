import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import {
  askGemini,
  getStoredGeminiKey,
  saveResearchNote,
} from '../lib/researchAssistant'
import { C } from '../styles/tokens'

// ── WatchlistSummary ────────────────────────────────────────────────────
// Mounted below the Watchlist heading on Dashboard. Renders a single
// "🔬 Summarise my watchlist" button when:
//   - the user has a Gemini key saved on this device, AND
//   - the watchlist has 2+ entries (a 1-stock list isn't really a "list")
//
// On click:
//   1. Pulls the current watchRows data the parent already has (phase,
//      sector, pctFromMa, daysSince).
//   2. Best-effort fetches criteria_score (swing_conditions.conditions_met)
//      and sector_breadth (nifty_sectors.above_ma30w_pct) — both batched
//      into single IN queries so we don't hit n+1.
//   3. Builds a context string, calls askGemini with the user's key. The
//      assistant returns 3-4 sentences summarising cycle positions,
//      sector concentration, and notable contrasts. No buy/sell advice.
//   4. Renders the response in an amber card with the same 💾 Save
//      affordance the StockDetail Research Assistant uses; saves go to
//      research_notes with symbol="_WATCHLIST" and category="watchlist_summary".
//
// PRIVACY: the askGemini round-trip is client-side to Google with the
// user's own key. PineX servers never see the prompt or the answer.
// The save path (if the user clicks 💾) goes through Supabase REST and
// is RLS-scoped to the user's own row.

const PROMPT_SYSTEM = `You are reviewing a trader's watchlist on PineX cycle analysis.

RULES — NEVER BREAK THESE:
1. Only describe the data given. Do NOT invent numbers or stocks.
2. Plain simple English. Flowing prose, NOT bullets or headings.
3. NEVER give buy/sell advice. NEVER give price targets or stop-loss prices.
4. Always end with exactly: "Not investment advice. Consult a SEBI registered adviser."

WORD BUDGET — CRITICAL:
Under 100 words total. Always finish with a complete sentence followed
by the disclaimer. Never end mid-sentence.

OPENING STYLE:
Never start with a preamble. Never repeat the data back row-by-row.
Start with the most useful observation immediately.`

// Strip Gemini's markdown leftovers — same logic as ResearchAssistant.
function stripMarkdown(text) {
  if (!text) return text
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function WatchlistSummary({ watchRows, userId }) {
  const hasKey = Boolean(getStoredGeminiKey())
  const visible = hasKey && Array.isArray(watchRows) && watchRows.length >= 2

  const [loading, setLoading]     = useState(false)
  const [response, setResponse]   = useState('')
  const [error, setError]         = useState('')
  // Save-to-notes flash; mirrors ResearchAssistant's pattern.
  const [saved, setSaved]         = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [saving, setSaving]       = useState(false)

  if (!visible) return null

  async function handleClick() {
    setLoading(true)
    setError('')
    setResponse('')
    setSaved(false)
    setJustSaved(false)

    try {
      const symbols = watchRows
        .map((r) => String(r.symbol || '').toUpperCase().trim())
        .filter(Boolean)
      const sectorsList = Array.from(
        new Set(watchRows.map((r) => String(r.sector || '').trim()).filter(Boolean)),
      )

      // Batched best-effort enrichment. Failures are non-fatal; the prompt
      // just omits the missing column rather than blocking the call.
      const criteriaMap = {}
      try {
        if (symbols.length) {
          const { data } = await supabase
            .from('swing_conditions')
            .select('symbol,conditions_met,trading_date')
            .in('symbol', symbols)
            .order('trading_date', { ascending: false })
            .limit(symbols.length * 4)
          for (const r of data || []) {
            const sym = String(r.symbol || '').toUpperCase()
            // Keep only the most recent (first occurrence after DESC sort).
            if (sym && !(sym in criteriaMap) && r.conditions_met != null) {
              criteriaMap[sym] = r.conditions_met
            }
          }
        }
      } catch { /* table absent — leave map empty */ }

      const breadthMap = {}
      try {
        if (sectorsList.length) {
          const { data } = await supabase
            .from('nifty_sectors')
            .select('name,above_ma30w_pct,date')
            .in('name', sectorsList)
            .order('date', { ascending: false })
            .limit(sectorsList.length * 4)
          for (const r of data || []) {
            const nm = String(r.name || '').trim()
            if (nm && !(nm in breadthMap) && r.above_ma30w_pct != null) {
              breadthMap[nm] = Number(r.above_ma30w_pct).toFixed(0)
            }
          }
        }
      } catch { /* table absent — leave map empty */ }

      const lines = watchRows.map((r) => {
        const sym = String(r.symbol || '').toUpperCase()
        const phase = r.stage || 'unclassified'
        const sect = r.sector || 'unknown sector'
        const score = criteriaMap[sym]
        const breadth = breadthMap[r.sector]
        const parts = [`${sym}: ${phase}`]
        if (score != null) parts.push(`${score}/5 criteria`)
        parts.push(`${sect}${breadth != null ? ` (${breadth}% breadth)` : ''}`)
        return parts.join(', ')
      }).join('\n')

      const prompt = `WATCHLIST DATA:
${lines}

Write 3-4 sentences summarising:
Which stocks are in the strongest cycle positions right now.
Which sectors are well represented.
Any notable contrasts in the list.
Plain English. Under 100 words.
Never give buy/sell advice.`

      const { text, finishReason } = await askGemini(
        prompt,
        { symbol: '_WATCHLIST', companyName: 'Watchlist Summary' },
        {
          systemPromptOverride: PROMPT_SYSTEM,
          maxOutputTokens: 800,
          temperature: 0.6,
          topP: 0.9,
        },
      )
      let cleaned = stripMarkdown(text)
      if (finishReason === 'MAX_TOKENS') {
        cleaned += '...\n\n(Response was long — ask again for more detail.)'
      }
      setResponse(cleaned)
      setLoading(false)
    } catch (e) {
      setError('Could not get a summary. Check your key at aistudio.google.com')
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!userId || !response || saved) return
    setSaving(true)
    const result = await saveResearchNote({
      userId,
      symbol: '_WATCHLIST',
      companyName: 'Watchlist Summary',
      category: 'watchlist_summary',
      responseText: response,
    })
    setSaving(false)
    if (result.ok) {
      setSaved(true)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    }
  }

  return (
    <div style={{ margin: '8px 0 14px' }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: '9px 16px',
          background: 'transparent',
          color: C.amber,
          border: `1px solid ${C.amber}`,
          borderRadius: 8,
          fontSize: 13, fontWeight: 700,
          cursor: loading ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}
      >
        <span>🔬</span>
        {loading ? 'Summarising…' : 'Summarise my watchlist'}
      </button>

      <AnimatePresence>
        {(response || error) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              marginTop: 12,
              padding: 16,
              background: C.surface,
              borderLeft: `3px solid ${error ? C.red : C.amber}`,
              borderRadius: '0 12px 12px 12px',
            }}
          >
            {error && (
              <div style={{
                color: C.red, fontSize: 13, lineHeight: 1.55,
              }}>
                {error}
              </div>
            )}
            {response && (
              <>
                <div style={{
                  color: C.text,
                  fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                  fontSize: '0.95rem',
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {response}
                </div>

                {/* Save affordance — same UX as ResearchAssistant: small
                    subtle button, flashes "✅ Saved" for 2 seconds, then
                    disappears (savedKey state prevents duplicate inserts). */}
                {userId && (saved && !justSaved ? null : (
                  <div style={{ marginTop: 10 }}>
                    {justSaved ? (
                      <span style={{ fontSize: 11, color: C.green }}>
                        ✅ Saved to your research notes
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          color: C.textMuted,
                          fontSize: 11,
                          cursor: saving ? 'wait' : 'pointer',
                          textDecoration: 'underline',
                          textUnderlineOffset: 2,
                        }}
                      >
                        {saving ? 'Saving…' : '💾 Save this insight'}
                      </button>
                    )}
                  </div>
                ))}

                {/* Footer — mirrors ResearchAssistant. */}
                <div style={{
                  marginTop: 12, paddingTop: 10,
                  borderTop: `1px solid ${C.border}`,
                  fontSize: 10, color: C.textMuted, textAlign: 'center',
                  lineHeight: 1.55, fontStyle: 'italic',
                }}>
                  Powered by your Gemini key · Not PineX analysis · Not investment advice
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
