// IQjetDesk — /iqjet-desk · admin-only morning brief generator.
//
// Hard-coded to robin22y@gmail.com. Any other authenticated user (or
// signed-out visitor) is silently redirected to /dashboard. No
// navigation link points here; the URL is the only entry.
//
// BYOK pattern: Gemini key lives in sessionStorage as 'gemini_api_key'.
// Deliberately scoped to the session (not localStorage) — closing the
// tab wipes the key. Distinct from the public Research Assistant
// flow which uses localStorage 'pinex_gemini_key'.
//
// System prompt: IQJET_ADMIN_PROMPT (full Desktop variant — HOLD /
// ADD / EXIT verdicts, no SEBI framing). Never imported from any
// public-facing component.

import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'
import { IQJET_ADMIN_PROMPT } from '../constants/iqjetPrompts'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const GEMINI_KEY_NAME = 'gemini_api_key'
const GEMINI_MODEL = 'gemini-2.5-flash'

export default function IQjetDesk() {
  const { user, loading } = useAuth()

  if (loading) {
    return <FullScreen><p style={muted}>Loading…</p></FullScreen>
  }

  const email = String(user?.email || '').trim().toLowerCase()
  if (email !== ADMIN_EMAIL) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <>
      <Helmet>
        <title>IQjet Desk</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <Desk />
    </>
  )
}

function Desk() {
  const [data, setData] = useState({ status: 'loading' })
  const [hasKey, setHasKey] = useState(() => Boolean(getKey()))
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [brief, setBrief] = useState('')
  const [briefAt, setBriefAt] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [divRes, miRes, swxRes, deskRes] = await Promise.all([
          supabase
            .from('divergence_signals')
            .select('*')
            .order('date', { ascending: false })
            .limit(1),
          supabase
            .from('market_internals')
            .select(
              'date,nifty_close,nifty_change_1d,above_ma30w_pct,' +
              'stage2_count,stage3_count,new_52w_highs,new_52w_lows,' +
              'advances,declines,india_vix,vix_level',
            )
            .order('date', { ascending: false })
            .limit(1),
          supabase
            .from('swingx_entries')
            .select(
              'id,symbol,sector,entry_date,entry_price,entry_substage,warning_level',
            )
            .eq('is_active', true)
            .order('entry_date', { ascending: false })
            .limit(100),
          // robins_desk is optional — if the table doesn't exist yet
          // the call rejects and we degrade to []. Wrapped so the
          // outer Promise.all never short-circuits the other reads.
          supabase
            .from('robins_desk')
            .select('*')
            .eq('is_active', true)
            .then((r) => r, () => ({ data: [], error: null })),
        ])

        if (cancelled) return

        const div = (divRes?.data && divRes.data[0]) || null
        const mi  = (miRes?.data && miRes.data[0])  || null
        const swingx = Array.isArray(swxRes?.data) ? swxRes.data : []
        const desk   = Array.isArray(deskRes?.data) ? deskRes.data : []

        setData({ status: 'ready', div, mi, swingx, desk })
      } catch (e) {
        if (!cancelled) {
          setData({ status: 'error', message: String(e?.message || e) })
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  function saveKey(e) {
    e?.preventDefault?.()
    const k = String(keyInput || '').trim()
    if (!k) return
    try { sessionStorage.setItem(GEMINI_KEY_NAME, k) } catch {}
    setKeyInput('')
    setHasKey(true)
  }

  function clearKey() {
    try { sessionStorage.removeItem(GEMINI_KEY_NAME) } catch {}
    setHasKey(false)
  }

  async function generate() {
    if (!hasKey || data.status !== 'ready' || busy) return
    setBusy(true)
    setError('')
    setBrief('')
    try {
      const context = buildContext(data)
      const text = await callGemini(
        buildUserMessage(context),
        IQJET_ADMIN_PROMPT,
      )
      setBrief(text || '')
      setBriefAt(new Date())
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function copyBrief() {
    if (!brief) return
    try { await navigator.clipboard.writeText(brief) } catch {}
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <p style={brand}>IQjet · Desk</p>
        <p style={tagline}>
          Admin-only morning brief. Pulls today's divergence row,
          market internals, active SwingX positions, and Robin's desk
          into one Gemini call.
        </p>
      </header>

      <Snapshot data={data} />

      <Positions data={data} />

      <section style={cardStyle}>
        <div style={cardHead}>
          <p style={eyebrow}>Brief</p>
          {briefAt && (
            <p style={muted}>
              Last generated: {briefAt.toLocaleString()}
            </p>
          )}
        </div>

        {!hasKey ? (
          <form onSubmit={saveKey} style={keyForm}>
            <p style={muted}>
              Paste your Gemini API key. Stored in sessionStorage —
              cleared when you close the tab.
            </p>
            <div style={keyRow}>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIza…"
                autoComplete="off"
                spellCheck={false}
                style={keyInputStyle}
              />
              <button type="submit" style={primaryBtn}>Save key</button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={generate}
              disabled={busy || data.status !== 'ready'}
              style={{
                ...primaryBtn,
                opacity: busy || data.status !== 'ready' ? 0.55 : 1,
                cursor:  busy || data.status !== 'ready' ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Generating…' : 'Generate brief'}
            </button>
            {brief && (
              <button type="button" onClick={copyBrief} style={ghostBtn}>
                {copied ? 'Copied ✓' : 'Copy brief'}
              </button>
            )}
            <button type="button" onClick={clearKey} style={linkBtn}>
              Forget key
            </button>
          </div>
        )}

        {error && (
          <p style={{ ...muted, color: '#e74c3c', marginTop: 12 }}>
            {error}
          </p>
        )}

        {brief && (
          <pre style={briefPre}>{brief}</pre>
        )}
      </section>
    </main>
  )
}

// ── Snapshot bar ─────────────────────────────────────────────────

function Snapshot({ data }) {
  if (data.status === 'loading') {
    return <section style={cardStyle}><p style={muted}>Loading market snapshot…</p></section>
  }
  if (data.status === 'error') {
    return (
      <section style={cardStyle}>
        <p style={{ ...muted, color: '#e74c3c' }}>
          Couldn't load market data: {data.message}
        </p>
      </section>
    )
  }
  const { div, mi } = data
  const verdict = String(div?.verdict || 'UNKNOWN').toUpperCase()
  const verdictColour = verdictColours(verdict)
  const change = mi?.nifty_change_1d
  const breadthPct = div?.breadth_pct ?? mi?.above_ma30w_pct
  const stage2 = div?.stage2_count ?? mi?.stage2_count
  const stage3 = div?.stage3_count ?? mi?.stage3_count

  const cells = [
    {
      label: 'Nifty',
      value: fmtNum(div?.nifty_close ?? mi?.nifty_close),
      sub:   change != null
        ? `${change >= 0 ? '+' : ''}${Number(change).toFixed(2)}%`
        : null,
      subColour: change == null
        ? '#888'
        : change >= 0 ? '#2ecc71' : '#e74c3c',
    },
    {
      label: 'Breadth · 30W MA',
      value: breadthPct != null ? `${Number(breadthPct).toFixed(0)}%` : '—',
    },
    {
      label: 'India VIX',
      value: mi?.india_vix != null ? Number(mi.india_vix).toFixed(2) : '—',
      sub:   mi?.vix_level ? titlecase(mi.vix_level) : null,
    },
    { label: 'Stage 2',  value: fmtInt(stage2) },
    { label: 'Stage 3',  value: fmtInt(stage3) },
  ]

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>Snapshot</p>
          {div?.date && <p style={muted}>as of {div.date}</p>}
        </div>
        <span
          style={{
            ...verdictBadge,
            background:  verdictColour.bg,
            color:       verdictColour.fg,
            borderColor: verdictColour.fg,
          }}
        >
          {verdict}
        </span>
      </div>
      <div style={snapGrid}>
        {cells.map((c, i) => (
          <div key={i} style={snapCell}>
            <p style={snapLabel}>{c.label}</p>
            <p style={snapValue}>{c.value}</p>
            {c.sub && (
              <p style={{ ...snapSub, color: c.subColour || '#aaa' }}>
                {c.sub}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Positions table ──────────────────────────────────────────────

function Positions({ data }) {
  if (data.status !== 'ready') return null
  const rows = data.swingx || []
  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <p style={eyebrow}>SwingX · Active positions ({rows.length})</p>
      </div>
      {rows.length === 0 ? (
        <p style={muted}>No active SwingX entries.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Symbol</th>
                <th style={th}>Sector</th>
                <th style={th}>Entry date</th>
                <th style={thRight}>Entry price</th>
                <th style={th}>Substage</th>
                <th style={th}>Warning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdSym}>{r.symbol}</td>
                  <td style={td}>{r.sector || '—'}</td>
                  <td style={td}>{r.entry_date || '—'}</td>
                  <td style={tdRight}>{fmtNum(r.entry_price)}</td>
                  <td style={td}>{r.entry_substage || '—'}</td>
                  <td style={td}>
                    {r.warning_level
                      ? <WarningBadge level={r.warning_level} />
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function WarningBadge({ level }) {
  const map = {
    1: { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' },
    2: { bg: 'rgba(230,126,34,0.18)', fg: '#e67e22' },
    3: { bg: 'rgba(231,76,60,0.20)',  fg: '#e74c3c' },
  }
  const c = map[level] || { bg: 'rgba(255,255,255,0.08)', fg: '#aaa' }
  return (
    <span
      style={{
        display:      'inline-block',
        padding:      '2px 8px',
        borderRadius: 999,
        fontSize:     11,
        fontWeight:   600,
        background:   c.bg,
        color:        c.fg,
        border:       `1px solid ${c.fg}`,
      }}
    >
      L{level}
    </span>
  )
}

// ── Helpers ──────────────────────────────────────────────────────

function getKey() {
  try { return (sessionStorage.getItem(GEMINI_KEY_NAME) || '').trim() }
  catch { return '' }
}

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

function verdictColours(v) {
  switch (v) {
    case 'STRONG':    return { bg: 'rgba(46,204,113,0.16)', fg: '#2ecc71' }
    case 'WATCH':     return { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' }
    case 'MIXED':     return { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' }
    case 'WEAK':      return { bg: 'rgba(230,126,34,0.16)', fg: '#e67e22' }
    case 'DANGEROUS': return { bg: 'rgba(231,76,60,0.18)',  fg: '#e74c3c' }
    default:          return { bg: 'rgba(255,255,255,0.08)', fg: '#aaa' }
  }
}

function buildContext({ div, mi, swingx, desk }) {
  const swingxCompact = (swingx || []).map((e) => ({
    symbol:         e.symbol,
    sector:         e.sector,
    entry_date:     e.entry_date,
    entry_price:    e.entry_price,
    entry_substage: e.entry_substage,
    warning_level:  e.warning_level,
  }))
  return {
    as_of: div?.date || mi?.date || null,
    nse: {
      above_30wma_pct:     mi?.above_ma30w_pct ?? null,
      ad_line_direction:   div?.ad_line_direction ?? null,
      stage2_count:        mi?.stage2_count ?? div?.stage2_count ?? null,
      stage3_count:        mi?.stage3_count ?? div?.stage3_count ?? null,
      india_vix:           mi?.india_vix ?? null,
      india_vix_level:     mi?.vix_level ?? null,
      nifty_close:         mi?.nifty_close ?? div?.nifty_close ?? null,
      nifty_change_1d:     mi?.nifty_change_1d ?? null,
      new_52w_highs:       mi?.new_52w_highs ?? null,
      new_52w_lows:        mi?.new_52w_lows ?? null,
      pillar1_verdict:     div?.verdict ?? null,
      pillar1_divergences: div?.divergences_detected ?? [],
      pillar1_notes:       div?.notes ?? null,
      mmi:               'unavailable',
      community_poll:    'unavailable',
      news_sentiment:    'unavailable',
    },
    us: {
      sp500_breadth:     'unavailable',
      sp500_close:       'unavailable',
      us_vix:            'unavailable',
      put_call_ratio:    'unavailable',
      cnn_fear_greed:    'unavailable',
      finbert_sentiment: 'unavailable',
      reddit_mentions:   'unavailable',
    },
    swingx_active: swingxCompact,
    robins_desk:   (desk && desk.length > 0) ? desk : 'unavailable',
  }
}

function buildUserMessage(context) {
  return (
    "Generate today's IQJET DAILY brief using the format defined in " +
    'your system prompt. Use the following data:\n\n' +
    '```json\n' +
    JSON.stringify(context, null, 2) +
    '\n```\n\n' +
    'Notes on missing data:\n' +
    "- Any field with value 'unavailable' has no live collector yet. " +
    'Briefly acknowledge the gap if it matters; do NOT make up values.\n' +
    '- The US market collectors are entirely pending — for the US row, ' +
    'say so plainly rather than fabricating a verdict.\n' +
    "- If robins_desk is 'unavailable', skip the ROBIN'S DESK section.\n"
  )
}

async function callGemini(userMessage, systemPrompt) {
  const key = getKey()
  if (!key) throw new Error('No Gemini key in this session.')
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}` +
    `:generateContent?key=${encodeURIComponent(key)}`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature:     0.2,
          maxOutputTokens: 4000,
          thinkingConfig:  { thinkingBudget: 0 },
        },
      }),
    })
  } catch {
    throw new Error('Could not reach Gemini. Check your internet.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg = body?.error?.message || `Gemini HTTP ${res.status}`
    if (res.status === 400 && /API key not valid/i.test(msg)) {
      throw new Error('Gemini key invalid. Paste a fresh key.')
    }
    if (res.status === 429) {
      throw new Error('Gemini quota reached. Try again later.')
    }
    throw new Error(msg)
  }
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts || []
  const text = parts.map((p) => p?.text || '').join('').trim()
  if (!text) throw new Error('Gemini returned empty text.')
  return text
}

function FullScreen({ children }) {
  return (
    <div style={{ ...pageStyle, justifyContent: 'center', alignItems: 'center' }}>
      {children}
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────

const pageStyle = {
  minHeight:    '100vh',
  width:        '100%',
  background:   '#0b0b14',
  color:        '#e6e6e6',
  padding:      '32px 20px 80px',
  display:      'flex',
  flexDirection:'column',
  alignItems:   'center',
  fontFamily:   'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

const headerStyle = {
  width:        '100%',
  maxWidth:     960,
  marginBottom: 18,
}

const brand = {
  margin:        0,
  fontSize:      26,
  fontWeight:    600,
  letterSpacing: '-0.02em',
}

const tagline = {
  margin:    '6px 0 0',
  fontSize:  13,
  color:     '#888',
  maxWidth:  640,
  lineHeight: 1.55,
}

const cardStyle = {
  width:        '100%',
  maxWidth:     960,
  background:   'rgba(255,255,255,0.04)',
  border:       '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding:      '18px 20px',
  marginTop:    14,
}

const cardHead = {
  display:        'flex',
  alignItems:     'flex-start',
  justifyContent: 'space-between',
  gap:            12,
  marginBottom:   12,
}

const eyebrow = {
  margin:        0,
  fontSize:      11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         '#888',
}

const verdictBadge = {
  padding:       '6px 12px',
  borderRadius:  999,
  border:        '1px solid',
  fontSize:      12,
  fontWeight:    600,
  letterSpacing: '0.04em',
}

const snapGrid = {
  display:    'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap:        10,
}

const snapCell = {
  background:   'rgba(0,0,0,0.18)',
  border:       '1px solid rgba(255,255,255,0.06)',
  borderRadius: 10,
  padding:      '10px 12px',
}

const snapLabel = {
  margin:        0,
  fontSize:      10,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color:         '#888',
}

const snapValue = { margin: '6px 0 0', fontSize: 17, fontWeight: 600 }
const snapSub   = { margin: '2px 0 0', fontSize: 12 }

const tableStyle = {
  width:          '100%',
  borderCollapse: 'collapse',
  fontSize:       13,
}

const th = {
  textAlign:     'left',
  padding:       '8px 10px',
  borderBottom:  '1px solid rgba(255,255,255,0.1)',
  fontSize:      11,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color:         '#888',
  fontWeight:    600,
}
const thRight = { ...th, textAlign: 'right' }

const td = {
  padding:      '8px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  color:        '#ddd',
}
const tdRight = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const tdSym = { ...td, fontWeight: 600, color: '#fff' }

const keyForm = { display: 'flex', flexDirection: 'column', gap: 10 }
const keyRow  = { display: 'flex', gap: 8, flexWrap: 'wrap' }

const keyInputStyle = {
  flex:         '1 1 260px',
  background:   '#0b0b14',
  border:       '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:        '#e6e6e6',
  fontSize:     13,
  padding:      '9px 12px',
  outline:      'none',
  fontFamily:   'inherit',
}

const primaryBtn = {
  appearance:   'none',
  border:       '1px solid rgba(255,255,255,0.2)',
  background:   'rgba(255,255,255,0.08)',
  color:        '#fff',
  padding:      '9px 16px',
  fontSize:     13,
  fontWeight:   600,
  borderRadius: 8,
  cursor:       'pointer',
}

const ghostBtn = {
  ...primaryBtn,
  background: 'transparent',
  fontWeight: 500,
}

const linkBtn = {
  appearance: 'none',
  background: 'transparent',
  border:     'none',
  color:      '#888',
  fontSize:   12,
  cursor:     'pointer',
  padding:    '4px 0',
  textDecoration: 'underline',
}

const briefPre = {
  marginTop:    14,
  padding:      '14px 16px',
  background:   'rgba(0,0,0,0.35)',
  border:       '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  fontFamily:   'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  fontSize:     13,
  lineHeight:   1.55,
  color:        '#e6e6e6',
  whiteSpace:   'pre-wrap',
  wordBreak:    'break-word',
  overflowX:    'auto',
}

const muted = {
  margin:   0,
  fontSize: 13,
  color:    '#888',
}
