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
import { C, FONTS } from '../../styles/tokens'
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

  return (
    <section style={frame}>
      <div style={sectionHeader}>RESEARCH TOOLS</div>

      <Link to="/learn/research_assistant" style={rowLink}>
        <div style={rowLeft}>
          <div style={rowTitle}>Ask AI about any stock</div>
          <div style={rowSub}>Uses your Gemini key — free. Bring Your Own Key.</div>
        </div>
        <span style={arrow}>→</span>
      </Link>

      <button type="button" onClick={copyMarketContext}
        disabled={copyState === 'busy'}
        style={{ ...rowButton, opacity: copyState === 'busy' ? 0.6 : 1 }}>
        <div style={rowLeft}>
          <div style={rowTitle}>Interpret today's market</div>
          <div style={rowSub}>
            {copyState === 'done'  ? 'Copied. Paste into your AI.' :
             copyState === 'busy'  ? 'Preparing…' :
             copyState === 'empty' ? 'No context row yet — try later.' :
             copyState === 'error' ? 'Copy failed. Try selecting manually.' :
             "Copy today's data to your AI."}
          </div>
        </div>
        <span style={arrow}>→</span>
      </button>
    </section>
  )
}

// ── Inline styles — flat, left-aligned, sepia-safe ─────────

const frame = {
  marginTop: 48,
  padding: '16px 16px',
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 4,
}

const sectionHeader = {
  fontFamily: FONTS.mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: C.textMuted,
  marginBottom: 12,
}

const rowBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 0',
  textDecoration: 'none',
  color: 'inherit',
  borderTop: `1px solid ${C.border}`,
  background: 'transparent',
  border: 'none',
  borderTopWidth: 1,
  borderTopStyle: 'solid',
  borderTopColor: C.border,
  width: '100%',
  textAlign: 'left',
  cursor: 'pointer',
}

const rowLink   = rowBase
const rowButton = rowBase

const rowLeft = { flex: 1, minWidth: 0 }

const rowTitle = {
  fontSize: 14,
  fontWeight: 600,
  color: C.text,
  lineHeight: 1.4,
}

const rowSub = {
  marginTop: 2,
  fontSize: 12,
  color: C.textMuted,
  lineHeight: 1.45,
}

const arrow = {
  fontSize: 14,
  color: C.textMuted,
  flexShrink: 0,
}
