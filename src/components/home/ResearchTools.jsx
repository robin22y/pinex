/**
 * ResearchTools — homepage Research Tools section.
 *
 * Two subtle, neutrally-framed entry points to the AI / context
 * tooling. Sits between WhatChangedToday and the SwingX surfaces.
 *
 * Spec-locked phrasing:
 *   - "Ask AI about any stock"      NOT "Get AI recommendations"
 *   - "Interpret today's market"    NOT "AI market analysis"
 *
 * AI interprets · PineX provides data · user draws the conclusion.
 *
 * The second row copies today's daily_market_context row as
 * formatted text to the clipboard. Silent fallback if the clipboard
 * API is unavailable — no modal, no alert.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { C } from '../../styles/tokens'
import { supabase } from '../../lib/supabase'

export default function ResearchTools() {
  const [copyState, setCopyState] = useState('idle')

  async function copyMarketContext() {
    setCopyState('busy')
    try {
      const { data, error } = await supabase
        .from('daily_market_context')
        .select('*')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        setCopyState('empty')
        setTimeout(() => setCopyState('idle'), 2000)
        return
      }
      const lines = [
        `Today's Indian market context (PineX, EOD)`,
        `Date: ${data.date}`,
        `Market phase: ${data.market_phase ?? '—'}`,
        `Above 30W MA: ${data.above_ma30w_pct ?? '—'}%`,
        `Stage 2 stocks: ${data.stage2_count ?? '—'}`,
        `Stage 3 stocks: ${data.stage3_count ?? '—'}`,
        `India VIX: ${data.india_vix ?? '—'} (${data.vix_level ?? '—'})`,
        `Nifty close: ${data.nifty_close ?? '—'}`,
        `Nifty 1d change: ${data.nifty_change_1d ?? '—'}%`,
        `Similar past sessions: ${data.similar_days_count ?? '—'}`,
      ]
      if (data.distribution_10d && typeof data.distribution_10d === 'object') {
        const d = data.distribution_10d
        lines.push(
          `Nifty 10-day forward distribution in similar conditions:`,
          `  +5% or more:  ${d.strong ?? 0}%`,
          `  +1% to +5%:   ${d.positive ?? 0}%`,
          `  Flat:         ${d.flat ?? 0}%`,
          `  Below -1%:    ${d.negative ?? 0}%`,
        )
      }
      lines.push(
        '',
        'Historical observations only. Past conditions do not guarantee future outcomes.',
      )
      const text = lines.join('\n')
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setCopyState('done')
      } else {
        // Fallback — write into a textarea, select, copy.
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy'); setCopyState('done') }
        catch { setCopyState('error') }
        finally { document.body.removeChild(ta) }
      }
      setTimeout(() => setCopyState('idle'), 2400)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('ResearchTools copy failed:', err)
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 2400)
    }
  }

  // Two plain lines. The card frame, the "RESEARCH TOOLS" heading, the
  // arrows and the per-row borders are gone — same links, same copy
  // behaviour, minimal styling.
  //
  // The transient copy states (Copied / Preparing / failed) still need
  // somewhere to surface, so the second line swaps its own label rather
  // than carrying a permanent subtitle. Silence on success would leave
  // the button looking inert.
  return (
    <div style={frame}>
      <Link to="/learn/research_assistant" style={line}>
        Ask AI about any stock — uses your own Gemini key
      </Link>

      <button
        type="button"
        onClick={copyMarketContext}
        disabled={copyState === 'busy'}
        style={{ ...line, ...lineButton, opacity: copyState === 'busy' ? 0.6 : 1 }}
      >
        {copyState === 'done'  ? "Interpret today's market — copied, paste into your AI" :
         copyState === 'busy'  ? "Interpret today's market — preparing…" :
         copyState === 'empty' ? "Interpret today's market — no context row yet" :
         copyState === 'error' ? "Interpret today's market — copy failed" :
         "Interpret today's market"}
      </button>
    </div>
  )
}

// ── Inline styles — flat, left-aligned, sepia-safe ─────────

const frame = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 5,
  marginTop: 0,
  marginBottom: 10,
}

// One text line. No card, no border, no arrow.
const line = {
  display: 'block',
  padding: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: C.accent,
  textDecoration: 'none',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
}

// A <button> does not inherit the page font the way an <a> does.
const lineButton = { font: 'inherit', fontSize: 13, fontFamily: 'inherit' }
