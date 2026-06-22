// MarketPulse — Section 1 of /iqjet.
//
// Reads the latest row of `divergence_signals` (populated by
// scripts/iqjet/calc_divergences.py in the daily pipeline) plus the
// matching `market_internals` row for context numbers the divergence
// table doesn't denormalise (Nifty 1d change, advancing/declining
// counts, 52w highs/lows).
//
// "Copy today's observation" produces structured text the user can
// paste into any AI (Gemini, Claude, GPT, ...) to get a verdict in
// their own words. Per Robin's brief: IQjet web side is the data
// surface; the language layer is whatever AI the user prefers to
// pipe it through.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const VERDICT_COLOURS = {
  STRONG:    { bg: 'rgba(46, 204, 113, 0.16)', fg: '#2ecc71' },
  WATCH:     { bg: 'rgba(241, 196, 15, 0.16)', fg: '#f1c40f' },
  MIXED:     { bg: 'rgba(241, 196, 15, 0.16)', fg: '#f1c40f' },
  WEAK:      { bg: 'rgba(230, 126, 34, 0.16)', fg: '#e67e22' },
  DANGEROUS: { bg: 'rgba(231, 76, 60, 0.18)',  fg: '#e74c3c' },
}

export default function MarketPulse() {
  const [state, setState] = useState({ status: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: divRows, error: divErr } = await supabase
          .from('divergence_signals')
          .select('*')
          .order('date', { ascending: false })
          .limit(1)
        if (divErr) throw divErr
        const div = (divRows && divRows[0]) || null
        if (!div) {
          if (!cancelled) setState({ status: 'empty' })
          return
        }
        const { data: miRows, error: miErr } = await supabase
          .from('market_internals')
          .select(
            'date,nifty_close,nifty_change_1d,above_ma30w_pct,' +
            'stage2_count,stage3_count,new_52w_highs,new_52w_lows,' +
            'advances,declines,india_vix,vix_level',
          )
          .eq('date', div.date)
          .limit(1)
        if (miErr) throw miErr
        const mi = (miRows && miRows[0]) || null
        if (!cancelled) setState({ status: 'ready', div, mi })
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: String(e?.message || e) })
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state.status === 'loading') {
    return <SectionFrame><p style={muted}>Loading today’s market pulse…</p></SectionFrame>
  }
  if (state.status === 'error') {
    return (
      <SectionFrame>
        <p style={{ ...muted, color: 'var(--negative, #e57373)' }}>
          Couldn’t load market pulse: {state.message}
        </p>
      </SectionFrame>
    )
  }
  if (state.status === 'empty') {
    return (
      <SectionFrame>
        <p style={muted}>
          No divergence_signals row yet — the daily pipeline hasn’t
          run since the table was created, or today’s computation is
          still in flight. Check back in a bit.
        </p>
      </SectionFrame>
    )
  }

  const { div, mi } = state
  const verdict = String(div.verdict || 'UNKNOWN').toUpperCase()
  const verdictColour = VERDICT_COLOURS[verdict] || VERDICT_COLOURS.MIXED
  const divList = Array.isArray(div.divergences_detected)
    ? div.divergences_detected
    : []

  return (
    <SectionFrame>
      <div style={headerRow}>
        <div>
          <p style={eyebrow}>Section 1 · Market Pulse</p>
          <p style={dateLine}>as of {div.date}</p>
        </div>
        <span
          style={{
            ...verdictBadge,
            background: verdictColour.bg,
            color:      verdictColour.fg,
            borderColor: verdictColour.fg,
          }}
        >
          {verdict}
        </span>
      </div>

      <KeyStats div={div} mi={mi} />

      <div style={{ marginTop: 18 }}>
        <p style={subhead}>
          Divergences fired today: <b>{divList.length}</b>
        </p>
        {divList.length === 0 ? (
          <p style={muted}>
            No divergences — internals match the index.
          </p>
        ) : (
          <ul style={ulStyle}>
            {divList.map((d, i) => (
              <li key={d.key || i} style={liStyle}>
                {d.label || d.key || String(d)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {div.notes && (
        <p style={{ ...muted, marginTop: 14, fontStyle: 'italic' }}>
          {div.notes}
        </p>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={() => {
            const text = buildClipboardText(div, mi)
            try { navigator.clipboard.writeText(text) } catch {}
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          }}
          style={copyButton}
        >
          {copied ? 'Copied ✓' : 'Copy today’s observation'}
        </button>
        <span style={{ ...muted, alignSelf: 'center', fontSize: 12 }}>
          Paste into any AI for an interpretation in your own words.
        </span>
      </div>
    </SectionFrame>
  )
}

// ── Sub-components ────────────────────────────────────────────────

function KeyStats({ div, mi }) {
  const cards = [
    {
      label: 'Nifty',
      primary: fmtNum(div.nifty_close ?? mi?.nifty_close),
      sub: mi?.nifty_change_1d != null
        ? `${mi.nifty_change_1d >= 0 ? '+' : ''}${Number(mi.nifty_change_1d).toFixed(2)}%`
        : null,
      subColour: mi?.nifty_change_1d >= 0 ? 'var(--positive, #2ecc71)' : 'var(--negative, #e74c3c)',
    },
    {
      label: '% above 30W MA',
      primary: div.breadth_pct != null ? `${Number(div.breadth_pct).toFixed(0)}%` : '—',
      sub: null,
    },
    {
      label: 'A/D line direction',
      primary: titlecase(div.ad_line_direction || 'unknown'),
      sub: null,
    },
    {
      label: 'Stage 2 / Stage 3',
      primary: `${fmtInt(div.stage2_count)} / ${fmtInt(div.stage3_count)}`,
      sub: null,
    },
    {
      label: 'New 52W H / L',
      primary: mi
        ? `${fmtInt(mi.new_52w_highs)} / ${fmtInt(mi.new_52w_lows)}`
        : '—',
      sub: null,
    },
    {
      label: 'India VIX',
      primary: mi?.india_vix != null ? Number(mi.india_vix).toFixed(2) : '—',
      sub: mi?.vix_level ? titlecase(mi.vix_level) : null,
    },
  ]
  return (
    <div style={statsGrid}>
      {cards.map((c, i) => (
        <div key={i} style={statCard}>
          <p style={statLabel}>{c.label}</p>
          <p style={statPrimary}>{c.primary}</p>
          {c.sub && (
            <p style={{ ...statSub, color: c.subColour || 'var(--text-secondary, #888)' }}>
              {c.sub}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function SectionFrame({ children }) {
  return (
    <section style={sectionStyle}>
      {children}
    </section>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function fmtNum(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtInt(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function titlecase(s) {
  const t = String(s || '')
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '—'
}

function buildClipboardText(div, mi) {
  const lines = []
  lines.push(`IQjet Market Pulse — ${div.date}`)
  lines.push(`Verdict: ${div.verdict}`)
  lines.push('')
  if (div.nifty_close != null) {
    const chg = mi?.nifty_change_1d
    lines.push(
      `Nifty: ${fmtNum(div.nifty_close)}` +
      (chg != null ? ` (${chg >= 0 ? '+' : ''}${Number(chg).toFixed(2)}%)` : ''),
    )
  }
  if (div.breadth_pct != null) {
    lines.push(`Stocks above 30W MA: ${Number(div.breadth_pct).toFixed(0)}%`)
  }
  lines.push(`A/D line direction: ${titlecase(div.ad_line_direction)}`)
  if (div.stage2_count != null || div.stage3_count != null) {
    lines.push(
      `Stage 2 / Stage 3 count: ${fmtInt(div.stage2_count)} / ${fmtInt(div.stage3_count)}`,
    )
  }
  if (mi) {
    lines.push(
      `New 52W highs / lows: ${fmtInt(mi.new_52w_highs)} / ${fmtInt(mi.new_52w_lows)}`,
    )
    if (mi.india_vix != null) {
      lines.push(`India VIX: ${Number(mi.india_vix).toFixed(2)} (${mi.vix_level || '—'})`)
    }
  }
  lines.push('')
  const divs = Array.isArray(div.divergences_detected) ? div.divergences_detected : []
  lines.push(`Divergences fired: ${divs.length}`)
  for (const d of divs) {
    const label = (d && (d.label || d.key)) || String(d)
    if (label) lines.push(`  - ${label}`)
  }
  if (div.notes) {
    lines.push('')
    lines.push(div.notes)
  }
  lines.push('')
  lines.push('Paste this into your AI for an interpretation.')
  lines.push('Source: pinex.in/iqjet')
  return lines.join('\n')
}

// ── Styles ────────────────────────────────────────────────────────

const sectionStyle = {
  background:   'var(--surface, rgba(255,255,255,0.04))',
  border:       '1px solid var(--border, rgba(255,255,255,0.08))',
  borderRadius: '12px',
  padding:      '20px 22px',
}

const headerRow = {
  display:        'flex',
  alignItems:     'flex-start',
  justifyContent: 'space-between',
  gap:            '12px',
  marginBottom:   '16px',
}

const eyebrow = {
  margin:        0,
  fontSize:      '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         'var(--text-muted, #888)',
}

const dateLine = {
  margin:    '4px 0 0',
  fontSize:  '14px',
  color:     'var(--text-secondary, #aaa)',
}

const verdictBadge = {
  padding:      '6px 12px',
  borderRadius: '999px',
  border:       '1px solid',
  fontSize:     '13px',
  fontWeight:   600,
  letterSpacing:'0.04em',
}

const statsGrid = {
  display:    'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap:        '12px',
}

const statCard = {
  background:   'var(--surface-2, rgba(0,0,0,0.18))',
  border:       '1px solid var(--border, rgba(255,255,255,0.06))',
  borderRadius: '10px',
  padding:      '12px 14px',
}

const statLabel = {
  margin:        0,
  fontSize:      '11px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color:         'var(--text-muted, #888)',
}

const statPrimary = {
  margin:     '6px 0 0',
  fontSize:   '18px',
  fontWeight: 600,
}

const statSub = {
  margin:   '2px 0 0',
  fontSize: '13px',
}

const subhead = {
  margin:   '0 0 6px',
  fontSize: '14px',
}

const ulStyle = {
  margin: 0,
  paddingLeft: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}

const liStyle = {
  fontSize: '14px',
  lineHeight: 1.5,
}

const muted = {
  margin:  0,
  fontSize: '14px',
  color:   'var(--text-secondary, #888)',
}

const copyButton = {
  appearance:   'none',
  border:       '1px solid var(--border, rgba(255,255,255,0.15))',
  background:   'rgba(255,255,255,0.06)',
  color:        'inherit',
  padding:      '8px 14px',
  fontSize:     '13px',
  borderRadius: '8px',
  cursor:       'pointer',
}
