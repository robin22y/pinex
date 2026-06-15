// IQjetDesk — /iqjet-desk · admin-only morning brief generator.
//
// Hard-coded to robin22y@gmail.com. Any other authenticated user (or
// signed-out visitor) is silently redirected to /dashboard. No
// navigation link points here; the URL is the only entry.
//
// Brief flow:
//   The page never holds a Gemini API key. It POSTs the assembled
//   context to the Supabase Edge Function `iqjet-brief`, which reads
//   GEMINI_API_KEY from server-side secrets and returns the brief text.
//   The user's Supabase JWT authenticates the call; the function
//   re-checks the admin email server-side. BYOK is gone.
//
// System prompt: IQJET_ADMIN_PROMPT (full Desktop variant — HOLD /
// ADD / EXIT verdicts, no SEBI framing). Never imported from any
// public-facing component.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'
import { IQJET_ADMIN_PROMPT, IQJET_PUBLIC_TELEGRAM_PROMPT } from '../constants/iqjetPrompts'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const EDGE_FUNCTION_NAME = 'iqjet-brief'
const STOCK_INFO_FUNCTION_NAME = 'fetch-stock-info'
const TELEGRAM_FUNCTION_NAME   = 'iqjet-telegram-send'
const TELEGRAM_BROADCAST_FUNCTION_NAME = 'iqjet-telegram'

const TELEGRAM_RECIPIENTS_STORAGE_KEY = 'iqjet_telegram_recipients'

const WATCHLIST_STORAGE_KEY       = 'iqjet_desk_watchlist_v1'
const BRIEF_SELECTION_STORAGE_KEY = 'iqjet_desk_brief_selection_v1'
const MAX_WATCHLIST = 10

// Functions base URL. By default we hit Supabase's hosted Edge Function
// runtime at ${VITE_SUPABASE_URL}/functions/v1. For local iteration on
// the edge functions without redeploying, set VITE_FUNCTIONS_BASE_URL
// to e.g. http://localhost:54321/functions/v1 and run
//   supabase functions serve --no-verify-jwt
// The JWT verify skip is needed locally because the user JWT is still
// signed by the remote Supabase project, but the local function server
// expects its own dev secret. The function's own admin-email check
// still enforces access.
function functionsBaseUrl() {
  const override = import.meta.env.VITE_FUNCTIONS_BASE_URL
  if (override) return String(override).replace(/\/+$/, '')
  const url = import.meta.env.VITE_SUPABASE_URL
  if (!url) return null
  return `${String(url).replace(/\/+$/, '')}/functions/v1`
}

// Stop-loss percentage below the 30W MA, keyed by substage. The early
// substages (fresh entry) get more room — late ones (topping risk)
// keep a tight leash. 2A- / 2B- carry the same room as their
// no-sign counterparts since RADAR doesn't actively surface them, but
// the table happily renders one if the data shifts.
const STOP_PCT_BY_SUBSTAGE = {
  '2A-': 0.030,
  '2A':  0.020,
  '2A+': 0.015,
  '2B-': 0.025,
  '2B':  0.025,
  '2B+': 0.020,
}

// Exit observation per substage — the wording the brief should use
// when describing the trail. Raw / no SEBI hedging because this page
// is admin-only.
const EXIT_OBSERVATIONS = {
  '2A-': 'Exit if price closes below 30W MA',
  '2A':  'Exit if 30W MA starts flattening',
  '2A+': 'Trail stop — exit on substage drop to 2A-',
  '2B-': 'Exit if price closes below 30W MA',
  '2B':  'Exit — topping signals increasing',
  '2B+': 'Exit — topping signals increasing',
}

const CAPITAL_STORAGE_KEY = 'iqjet_desk_capital_v1'

const DEFAULT_CAPITAL = {
  availableCapital:  500000,   // ₹5,00,000 — sensible starting point
  riskPerTradePct:   1.0,      // 1% — the spec default
  maxPositions:      10,       // 10 — the spec default
}

// ── Component shell ──────────────────────────────────────────────

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

// ── Top-level Desk container ─────────────────────────────────────

function Desk() {
  // Core data (snapshot, positions, robins desk)
  const [data, setData] = useState({ status: 'loading' })

  // Capital settings — persisted to sessionStorage so a tab-refresh
  // keeps the working numbers around but a fresh browser session
  // starts clean. (Same scoping as the prior BYOK key.)
  const [capital, setCapital] = useState(() => loadCapital())
  useEffect(() => { saveCapital(capital) }, [capital])

  // RADAR state — filters + fetched rows.
  //
  // minRs / minVol are CLIENT-SIDE filters applied to the fetched
  // rows. The server query is intentionally loose right now — only
  // stage='Stage 2' + rs > 0 — because production substages are
  // exclusively '2A-' / '2B-' and avg vol_ratio in Stage 2 is ~0.95,
  // so any tighter server filter returns nothing today. Default 0
  // so the UI scaffolding doesn't accidentally hide the result the
  // moment the page loads; tighten via the filter bar to taste.
  const [minRs,       setMinRs]       = useState(0)
  const [minVol,      setMinVol]      = useState(0)
  const [sectorFilter, setSectorFilter] = useState('ALL')
  const [radar, setRadar] = useState({ status: 'loading', rows: [] })

  // Brief generation
  const [busy, setBusy]      = useState(false)
  const [brief, setBrief]    = useState('')
  const [briefAt, setBriefAt] = useState(null)
  const [error, setError]    = useState('')
  const [copied, setCopied]  = useState(false)

  // Stock lookup state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState({ status: 'idle', results: [], error: '' })
  const [openSymbol,  setOpenSymbol]  = useState(null)
  // Per-symbol enrichment cache. Each entry:
  //   { status: 'loading' | 'ready' | 'error',
  //     layer1: { ... }, layer2: { ... }, error: string,
  //     companyId, sector, name }
  const [enriched, setEnriched] = useState({})

  // Research watchlist + brief selections — both persist in
  // sessionStorage so a tab-refresh keeps them, but a fresh
  // session starts clean (same scope as the capital bar).
  const [watchlist,       setWatchlist]       = useState(() => loadWatchlist())
  const [briefSelections, setBriefSelections] = useState(() => loadBriefSelections())
  useEffect(() => { saveWatchlist(watchlist) }, [watchlist])
  useEffect(() => { saveBriefSelections(briefSelections) }, [briefSelections])

  // ── Core data load (one-shot) ──────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [divRes, miRes, miHistRes, swxRes, deskRes] = await Promise.all([
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
            .from('market_internals')
            .select('date,stage2_count')
            .order('date', { ascending: false })
            .limit(10),
          supabase
            .from('swingx_entries')
            .select(
              'id,symbol,sector,entry_date,entry_price,entry_substage,warning_level',
            )
            .eq('is_active', true)
            .order('entry_date', { ascending: false })
            .limit(100),
          supabase
            .from('robins_desk')
            .select('*')
            .eq('is_active', true)
            .then((r) => r, () => ({ data: [], error: null })),
        ])
        if (cancelled) return

        const div = (divRes?.data && divRes.data[0]) || null
        const mi  = (miRes?.data && miRes.data[0])  || null
        const miHist = Array.isArray(miHistRes?.data) ? miHistRes.data : []
        const swingx = Array.isArray(swxRes?.data) ? swxRes.data : []
        const desk   = Array.isArray(deskRes?.data) ? deskRes.data : []

        // Current substages for the SwingX trend column.
        let currentSubstages = {}
        const symbols = swingx.map((r) => r.symbol).filter(Boolean)
        if (symbols.length > 0) {
          try {
            const { data: sub } = await supabase
              .from('mv_home_stocks')
              .select('symbol,weinstein_substage')
              .in('symbol', symbols)
            if (Array.isArray(sub)) {
              for (const row of sub) {
                if (row?.symbol) {
                  currentSubstages[row.symbol] = row.weinstein_substage || null
                }
              }
            }
          } catch {
            currentSubstages = {}
          }
        }
        if (cancelled) return

        const prevStage2 = pickWeekAgoStage2(miHist)
        setData({
          status: 'ready',
          div, mi, swingx, desk,
          prevStage2, currentSubstages,
        })
      } catch (e) {
        if (!cancelled) {
          setData({ status: 'error', message: String(e?.message || e) })
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── RADAR load (one-shot) ──────────────────────────────────────
  //
  // The query the user originally asked for referenced
  // swing_conditions.{stage,substage,rs_score,volume_ratio} — none
  // of those columns exist there. They all live on price_data, so
  // the real query joins price_data → companies. See the schema
  // probe results documented in the project history.
  //
  // Filters intentionally LOOSE today:
  //   stage = 'Stage 2'
  //   rs_vs_nifty > 0
  // Substage IN (...) and vol_ratio > 1.5 were removed because the
  // live classifier only emits '2A-' / '2B-' and avg Stage 2
  // vol_ratio is ~0.95 — tight filters returned zero rows.
  // minRs / minVol are applied CLIENT-SIDE in the sizedRows memo
  // below, so tightening the UI sliders works without a refetch.
  useEffect(() => {
    let cancelled = false
    setRadar({ status: 'loading', rows: [] })
    ;(async () => {
      try {
        const { data: priceRows, error: priceErr } = await supabase
          .from('price_data')
          .select(
            'company_id,close,ma30w,stage,weinstein_substage,rs_vs_nifty,vol_ratio',
          )
          .eq('is_latest', true)
          .eq('stage', 'Stage 2')
          .gt('rs_vs_nifty', 0)
          .order('rs_vs_nifty', { ascending: false })
          .limit(20)
        if (priceErr) throw priceErr
        const prices = Array.isArray(priceRows) ? priceRows : []
        if (cancelled) return

        if (prices.length === 0) {
          setRadar({ status: 'ready', rows: [] })
          return
        }

        const cids = [...new Set(prices.map((r) => r.company_id).filter(Boolean))]
        const { data: cos } = await supabase
          .from('companies')
          .select('id,symbol,name,sector')
          .in('id', cids)
        if (cancelled) return

        const byId = Object.fromEntries((cos || []).map((c) => [c.id, c]))
        const rows = prices.map((p) => {
          const c = byId[p.company_id] || {}
          return {
            company_id:       p.company_id,
            symbol:           c.symbol || '—',
            name:             c.name   || '',
            sector:           c.sector || '',
            substage:         p.weinstein_substage,
            rs_vs_nifty:      p.rs_vs_nifty,
            vol_ratio:        p.vol_ratio,
            close:            p.close,
            ma30w:            p.ma30w,
          }
        })
        setRadar({ status: 'ready', rows })
      } catch (e) {
        if (!cancelled) {
          setRadar({ status: 'error', message: String(e?.message || e), rows: [] })
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Sectors offered in the dropdown — derived from the current RADAR
  // result so we never show a sector that has no qualifying rows.
  const sectorOptions = useMemo(() => {
    const set = new Set()
    for (const r of radar.rows) if (r.sector) set.add(r.sector)
    return ['ALL', ...[...set].sort()]
  }, [radar.rows])

  // Filtered + sized rows the table renders. Sector, minRs, and
  // minVol all apply client-side now (the server query is the loose
  // top-20 by RS). Sizing depends on capital settings so the recompute
  // is cheap memoisation, not another fetch.
  const sizedRows = useMemo(() => {
    const filtered = radar.rows.filter((r) => {
      if (sectorFilter !== 'ALL' && r.sector !== sectorFilter) return false
      if (minRs > 0 && (r.rs_vs_nifty == null || r.rs_vs_nifty < minRs)) return false
      if (minVol > 0 && (r.vol_ratio == null || r.vol_ratio < minVol)) return false
      return true
    })
    return filtered.map((r) => ({
      ...r,
      sizing: computeSizing(r, capital),
      exit_observation: EXIT_OBSERVATIONS[r.substage] || 'Watch substage carefully',
    }))
  }, [radar.rows, sectorFilter, minRs, minVol, capital])

  // Portfolio allocation across the visible rows.
  const allocation = useMemo(() => summarise(sizedRows, capital), [sizedRows, capital])

  // Brief generator — POSTs to the edge function (no Gemini key in browser).
  const generate = useCallback(async () => {
    if (data.status !== 'ready' || busy) return
    setBusy(true)
    setError('')
    setBrief('')
    try {
      const context = buildContext({
        data,
        capital,
        radarRows: sizedRows,
        researchSelections: briefSelections,
        enriched,
      })
      const text = await callEdgeFunction(context, IQJET_ADMIN_PROMPT)
      setBrief(text || '')
      setBriefAt(new Date())
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }, [data, capital, sizedRows, briefSelections, enriched, busy])

  // ── Stock lookup handlers ────────────────────────────────────────
  const onSearch = useCallback(async (e) => {
    e?.preventDefault?.()
    const q = String(searchQuery || '').trim()
    if (q.length < 2) {
      setSearchState({ status: 'idle', results: [], error: '' })
      return
    }
    setSearchState({ status: 'loading', results: [], error: '' })
    try {
      const results = await searchStocks(q)
      setSearchState({ status: 'ready', results, error: '' })
    } catch (err) {
      setSearchState({ status: 'error', results: [], error: String(err?.message || err) })
    }
  }, [searchQuery])

  const onToggleOpen = useCallback((row) => {
    const sym = row.symbol
    setOpenSymbol((prev) => (prev === sym ? null : sym))
    if (!enriched[sym] || enriched[sym].status === 'error') {
      enrichStock(row, setEnriched)
    }
  }, [enriched])

  const onAddWatchlist = useCallback((row) => {
    setWatchlist((prev) => {
      if (prev.find((p) => p.symbol === row.symbol)) return prev
      const next = [
        { symbol: row.symbol, name: row.name, sector: row.sector, company_id: row.company_id },
        ...prev,
      ]
      return next.slice(0, MAX_WATCHLIST)
    })
  }, [])

  const onRemoveWatchlist = useCallback((sym) => {
    setWatchlist((prev) => prev.filter((p) => p.symbol !== sym))
  }, [])

  const onToggleBrief = useCallback((row) => {
    const sym = row.symbol
    setBriefSelections((prev) => {
      const set = new Set(prev)
      if (set.has(sym)) set.delete(sym)
      else set.add(sym)
      return [...set]
    })
    if (!enriched[sym]) {
      enrichStock(row, setEnriched)
    }
  }, [enriched])

  const onRunForensic = useCallback((sym) => {
    enrichForensic(sym, setEnriched)
  }, [])

  // After a fresh earnings analysis lands, re-query the past-analyses
  // chip row so the new entry shows up immediately.
  const onTranscriptAnalysed = useCallback(async (sym) => {
    try {
      const { data } = await supabase
        .from('earnings_intelligence')
        .select('id,call_date,tone,confidence_score,verdict,summary,key_phrases,red_flags,hedging_count,evasion_count,guidance_specific,transcript_length')
        .eq('symbol', sym)
        .order('call_date', { ascending: false })
      setEnriched((prev) => ({
        ...prev,
        [sym]: { ...(prev[sym] || {}), pastAnalyses: Array.isArray(data) ? data : [] },
      }))
    } catch { /* RLS-blocked or table missing — silent */ }
  }, [])

  const copyBrief = useCallback(async () => {
    if (!brief) return
    try { await navigator.clipboard.writeText(brief) } catch {}
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }, [brief])

  const sections = useMemo(() => (brief ? parseBriefSections(brief) : []), [brief])

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <p style={brand}>IQjet · Desk</p>
        <p style={tagline}>
          Admin-only morning brief. Pulls today's divergence row,
          market internals, active SwingX positions, Robin's desk,
          and a Stage 2 accumulation radar into one Gemini call —
          served via the iqjet-brief Edge Function (no key in browser).
        </p>
      </header>

      <CapitalBar capital={capital} onChange={setCapital} />

      <Snapshot data={data} />

      <Positions data={data} />

      <StockLookup
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSearch={onSearch}
        searchState={searchState}
        watchlist={watchlist}
        briefSelections={briefSelections}
        enriched={enriched}
        openSymbol={openSymbol}
        capital={capital}
        onToggleOpen={onToggleOpen}
        onAddWatchlist={onAddWatchlist}
        onRemoveWatchlist={onRemoveWatchlist}
        onToggleBrief={onToggleBrief}
        onRunForensic={onRunForensic}
        onTranscriptAnalysed={onTranscriptAnalysed}
      />

      <Radar
        radar={radar}
        rows={sizedRows}
        capital={capital}
        sectorOptions={sectorOptions}
        sectorFilter={sectorFilter}
        onSectorFilter={setSectorFilter}
        minRs={minRs}
        onMinRs={setMinRs}
        minVol={minVol}
        onMinVol={setMinVol}
        allocation={allocation}
        snapshotDate={data.status === 'ready' ? (data.div?.date || null) : null}
      />

      <section style={cardStyle}>
        <div style={cardHead}>
          <p style={eyebrow}>Brief</p>
          {briefAt && (
            <p style={muted}>Last generated: {briefAt.toLocaleString()}</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={generate}
            disabled={busy || data.status !== 'ready'}
            style={{
              ...generateBtn,
              opacity: busy || data.status !== 'ready' ? 0.75 : 1,
              cursor:  busy || data.status !== 'ready' ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'IQjet is thinking…' : 'Generate Morning Brief'}
          </button>
          <span style={muted}>
            Calls Supabase Edge Function · GEMINI_API_KEY held server-side.
          </span>
        </div>

        {error && (
          <p style={{ ...muted, color: '#e74c3c', marginTop: 12 }}>{error}</p>
        )}

        {brief && (
          <BriefCard sections={sections} onCopy={copyBrief} copied={copied} />
        )}
      </section>

      <BroadcastPanel brief={brief} sections={sections} data={data} />

      <PublicBroadcastPanel data={data} />
    </main>
  )
}

// ── Broadcast panel ─────────────────────────────────────────────

function BroadcastPanel({ brief, sections, data }) {
  // Recipients live as an array of numeric chat_id strings persisted
  // to sessionStorage. The Add input accepts a single id or a pasted
  // comma/space-separated batch so people can drop a list at once.
  const [recipients,  setRecipients]  = useState(() => loadRecipients())
  const [draftInput,  setDraftInput]  = useState('')
  const [addError,    setAddError]    = useState('')
  const [message, setMessage] = useState('')
  // Auto-prefill the message from the brief whenever a fresh brief
  // generates AND the box hasn't been touched yet. Robin can still
  // edit before sending.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (touched) return
    if (!brief) { setMessage(''); return }
    setMessage(briefToTelegramMessage(brief, sections, data))
  }, [brief, sections, data, touched])

  useEffect(() => { saveRecipients(recipients) }, [recipients])

  const userIds   = recipients
  const validCount = userIds.length

  function addRecipients() {
    const tokens = parseUserIds(draftInput)
    if (tokens.length === 0) {
      setAddError('Enter a numeric Telegram user ID.')
      return
    }
    const accepted = []
    const rejected = []
    for (const t of tokens) {
      if (!/^-?\d+$/.test(t))      rejected.push(t)
      else if (recipients.includes(t)) { /* silent dedupe */ }
      else                          accepted.push(t)
    }
    if (accepted.length > 0) {
      setRecipients((prev) => [...prev, ...accepted])
    }
    setDraftInput('')
    if (rejected.length > 0) {
      setAddError(
        `Skipped ${rejected.length} non-numeric value${rejected.length === 1 ? '' : 's'}: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? '…' : ''}. Telegram chat_id must be a number.`,
      )
    } else if (accepted.length === 0) {
      setAddError('Already on the list.')
    } else {
      setAddError('')
    }
  }

  function removeRecipient(id) {
    setRecipients((prev) => prev.filter((u) => u !== id))
  }

  function onDraftKey(e) {
    // Enter or comma in the input → Add. Shift+Enter still inserts a
    // newline so paste-with-newlines works through Ctrl+V naturally.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      addRecipients()
    }
  }

  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState('')
  const [statuses, setStatuses] = useState([])

  // Past broadcasts — last 5 rows from the audit table.
  const [past, setPast] = useState([])
  const refreshPast = useCallback(async () => {
    try {
      const { data: rows } = await supabase
        .from('iqjet_broadcasts')
        .select('id,sent_at,recipient_count,message_preview,delivery_status')
        .order('sent_at', { ascending: false })
        .limit(5)
      setPast(Array.isArray(rows) ? rows : [])
    } catch { /* RLS-blocked / table missing — silent */ }
  }, [])
  useEffect(() => { refreshPast() }, [refreshPast])

  async function onSend() {
    if (sending || userIds.length === 0 || !message.trim()) return
    setSending(true)
    setError('')
    setStatuses([])
    try {
      const res = await postToFunction(TELEGRAM_BROADCAST_FUNCTION_NAME, {
        user_ids: userIds,
        message,
        parse_mode: 'Markdown',
      })
      setStatuses(Array.isArray(res?.statuses) ? res.statuses : [])
      refreshPast()
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setSending(false)
    }
  }

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>Broadcast · Send to Selected Users</p>
          <p style={muted}>
            Direct messages to individual Telegram user IDs.
            Not the public channel.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <p style={{ ...muted, marginBottom: 6 }}>
          Recipients · {validCount} on list
        </p>

        <div style={recipientAddRow}>
          <input
            type="text"
            inputMode="numeric"
            value={draftInput}
            onChange={(e) => { setDraftInput(e.target.value); setAddError('') }}
            onKeyDown={onDraftKey}
            placeholder="Enter Telegram user ID (e.g. 123456789) and press Add"
            autoComplete="off"
            spellCheck={false}
            style={recipientAddInput}
          />
          <button
            type="button"
            onClick={addRecipients}
            disabled={!draftInput.trim()}
            style={{
              ...primaryBtn,
              opacity: draftInput.trim() ? 1 : 0.5,
              cursor:  draftInput.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            + Add
          </button>
        </div>
        <p style={{ ...muted, fontSize: 11, margin: '4px 0 0' }}>
          Tip: paste multiple comma- or space-separated IDs in one go;
          press Enter to add. The bot can only DM users who've sent
          /start to it at least once.
        </p>
        {addError && (
          <p style={{ ...muted, color: '#e67e22', marginTop: 6, fontSize: 12 }}>
            {addError}
          </p>
        )}

        {recipients.length > 0 && (
          <div style={recipientChips}>
            {recipients.map((id) => (
              <span key={id} style={recipientChip}>
                <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>{id}</span>
                <button
                  type="button"
                  aria-label={`Remove ${id}`}
                  onClick={() => removeRecipient(id)}
                  style={recipientChipClose}
                >×</button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setRecipients([])}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                color: '#888',
                fontSize: 11,
                cursor: 'pointer',
                padding: '2px 6px',
                textDecoration: 'underline',
              }}
            >
              clear all
            </button>
          </div>
        )}
      </div>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <p style={{ ...muted, marginBottom: 6 }}>
          Message · {message.length} chars
          {brief && !touched && <span style={{ color: '#2ecc71', marginLeft: 8 }}>· auto-filled from brief</span>}
        </p>
        <textarea
          value={message}
          onChange={(e) => { setMessage(e.target.value); setTouched(true) }}
          rows={10}
          placeholder="Type the message — supports Telegram Markdown (*bold*, _italic_)."
          spellCheck={false}
          style={broadcastTextarea}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onSend}
          disabled={sending || validCount === 0 || !message.trim()}
          style={{
            ...generateBtn,
            padding:  '10px 18px',
            fontSize: 13,
            opacity:  sending || validCount === 0 || !message.trim() ? 0.6 : 1,
            cursor:   sending || validCount === 0 || !message.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {sending ? 'Sending…' : `Send to ${validCount} user${validCount === 1 ? '' : 's'}`}
        </button>
        {brief && touched && (
          <button
            type="button"
            onClick={() => { setMessage(briefToTelegramMessage(brief, sections, data)); setTouched(false) }}
            style={ghostBtn}
          >
            Reset from brief
          </button>
        )}
      </div>

      {error && (
        <p style={{ ...muted, color: '#e74c3c', marginTop: 12 }}>{error}</p>
      )}

      {statuses.length > 0 && (
        <div style={broadcastStatusBox}>
          <p style={sectionBlockTitle}>Delivery status</p>
          {statuses.map((s) => (
            <p
              key={s.user_id}
              style={{
                ...muted,
                color: s.ok ? '#2ecc71' : '#e74c3c',
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                fontSize: 12,
                margin: '3px 0',
              }}
            >
              {s.ok ? '✓' : '✗'} {s.user_id}
              {' — '}
              {s.ok ? 'delivered' : `failed (${s.error || 'unknown'})`}
            </p>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={sectionBlockTitle}>Recent broadcasts</p>
          {past.map((p) => {
            const ds = Array.isArray(p.delivery_status) ? p.delivery_status : []
            const ok = ds.filter((d) => d?.ok).length
            const summary = ok === p.recipient_count
              ? '✓ all delivered'
              : `${ok} of ${p.recipient_count} delivered`
            return (
              <p key={p.id} style={{ ...muted, margin: '3px 0' }}>
                {fmtBroadcastDate(p.sent_at)} · {p.recipient_count} recipient{p.recipient_count === 1 ? '' : 's'} · {summary}
              </p>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Capital bar ──────────────────────────────────────────────────

function CapitalBar({ capital, onChange }) {
  function update(field, raw) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    onChange({ ...capital, [field]: n })
  }
  return (
    <section style={{ ...cardStyle, marginTop: 0 }}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>Capital · Risk · Allocation</p>
          <p style={muted}>Drives the RADAR sizing math. Saved in this tab.</p>
        </div>
      </div>
      <div style={capitalGrid}>
        <CapitalInput
          label="Available capital (₹)"
          value={capital.availableCapital}
          step={10000}
          min={0}
          onChange={(v) => update('availableCapital', v)}
        />
        <CapitalInput
          label="Risk per trade (%)"
          value={capital.riskPerTradePct}
          step={0.1}
          min={0.1}
          max={5}
          onChange={(v) => update('riskPerTradePct', v)}
        />
        <CapitalInput
          label="Max positions"
          value={capital.maxPositions}
          step={1}
          min={1}
          max={50}
          onChange={(v) => update('maxPositions', v)}
        />
      </div>
    </section>
  )
}

function CapitalInput({ label, value, step, min, max, onChange }) {
  return (
    <label style={capitalCell}>
      <span style={capitalLabel}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        style={capitalInputStyle}
      />
    </label>
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
  const { div, mi, prevStage2 } = data
  const rawVerdict = div?.verdict ? String(div.verdict).toUpperCase().trim() : ''
  const verdictText = rawVerdict || 'AWAITING DATA'
  const verdictStyle = rawVerdict ? verdictColours(rawVerdict) : VERDICT_AWAITING
  const change = mi?.nifty_change_1d
  const breadthPct = div?.breadth_pct ?? mi?.above_ma30w_pct
  const stage2 = mi?.stage2_count ?? div?.stage2_count
  const stage3 = mi?.stage3_count ?? div?.stage3_count
  const stage2Trend = trendArrow(stage2, prevStage2)
  const adArrow = adLineArrow(div?.ad_line_direction)

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
      label: 'A/D line',
      value: adArrow.glyph,
      sub:   adArrow.label,
      subColour: adArrow.colour,
    },
    {
      label: '52W H / L',
      value: (mi?.new_52w_highs != null || mi?.new_52w_lows != null)
        ? `${fmtInt(mi?.new_52w_highs)}H / ${fmtInt(mi?.new_52w_lows)}L`
        : '—',
    },
    {
      label: 'India VIX',
      value: mi?.india_vix != null ? Number(mi.india_vix).toFixed(2) : '—',
      sub:   mi?.vix_level ? titlecase(mi.vix_level) : null,
    },
    {
      label: 'Stage 2',
      value: fmtInt(stage2),
      sub:   stage2Trend ? `${stage2Trend.arrow} vs last week` : null,
      subColour: stage2Trend?.colour,
    },
    { label: 'Stage 3',  value: fmtInt(stage3) },
  ]

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>Snapshot</p>
          {div?.date && <p style={muted}>as of {div.date}</p>}
        </div>
        <span style={{
          ...verdictBadge,
          background:  verdictStyle.bg,
          color:       verdictStyle.fg,
          borderColor: verdictStyle.fg,
        }}>
          {verdictText}
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

// ── Positions table (unchanged from prior version) ──────────────

function Positions({ data }) {
  if (data.status !== 'ready') return null
  const rows = data.swingx || []
  const current = data.currentSubstages || {}
  const today = new Date()
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
                <th style={thRight}>Days held</th>
                <th style={thRight}>Entry price</th>
                <th style={th}>Substage</th>
                <th style={th}>Trend</th>
                <th style={th}>Warning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const daysHeld = daysSince(r.entry_date, today)
                const cur = current[r.symbol] || null
                const trend = substageTrend(r.entry_substage, cur)
                return (
                  <tr key={r.id}>
                    <td style={tdSym}>{r.symbol}</td>
                    <td style={td}>{r.sector || '—'}</td>
                    <td style={td}>{r.entry_date || '—'}</td>
                    <td style={tdRight}>{daysHeld != null ? `${daysHeld}d` : '—'}</td>
                    <td style={tdRight}>{fmtNum(r.entry_price)}</td>
                    <td style={td}>
                      {r.entry_substage || '—'}
                      {cur && cur !== r.entry_substage && (
                        <span style={subStageNow}> → {cur}</span>
                      )}
                    </td>
                    <td style={td}><TrendBadge trend={trend} /></td>
                    <td style={td}><WarningCell value={r.warning_level} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── RADAR section ────────────────────────────────────────────────

function Radar({
  radar, rows, capital, sectorOptions, sectorFilter, onSectorFilter,
  minRs, onMinRs, minVol, onMinVol, allocation, snapshotDate,
}) {
  const [exporting,   setExporting]   = useState(false)
  const [tgSending,   setTgSending]   = useState(false)
  const [tgMessage,   setTgMessage]   = useState('')
  const [tgError,     setTgError]     = useState('')

  const canAct = radar.status === 'ready' && rows.length > 0

  async function handleExport() {
    if (!canAct || exporting) return
    setExporting(true)
    try {
      await exportRadarToExcel(rows, capital, snapshotDate)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[IQjet Desk] Excel export failed:', e)
    } finally {
      setExporting(false)
    }
  }

  async function handleTelegram() {
    if (!canAct || tgSending) return
    setTgSending(true)
    setTgMessage('')
    setTgError('')
    try {
      const text = formatRadarForTelegram(rows, capital, snapshotDate)
      await postToFunction(TELEGRAM_FUNCTION_NAME, {
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
      setTgMessage('Posted ✓')
      window.setTimeout(() => setTgMessage(''), 2500)
    } catch (e) {
      setTgError(String(e?.message || e))
    } finally {
      setTgSending(false)
    }
  }

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>RADAR · Top Accumulation — Stage 2</p>
          <p style={muted}>Stocks showing cycle strength and volume confirmation.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleExport}
            disabled={!canAct || exporting}
            style={{
              ...ghostBtn,
              opacity: !canAct || exporting ? 0.5 : 1,
              cursor:  !canAct || exporting ? 'not-allowed' : 'pointer',
            }}
            title="Download today's RADAR as an .xlsx workbook"
          >
            {exporting ? 'Exporting…' : '📥 Export to Excel'}
          </button>
          <button
            type="button"
            onClick={handleTelegram}
            disabled={!canAct || tgSending}
            style={{
              ...ghostBtn,
              opacity: !canAct || tgSending ? 0.5 : 1,
              cursor:  !canAct || tgSending ? 'not-allowed' : 'pointer',
            }}
            title="Post top 10 RADAR rows to the IQjet Telegram channel"
          >
            {tgSending ? 'Sending…' : tgMessage ? tgMessage : '📱 Send to Telegram'}
          </button>
        </div>
      </div>
      {tgError && (
        <p style={{ ...muted, color: '#e74c3c', marginBottom: 8 }}>{tgError}</p>
      )}

      <RadarFilters
        sectorOptions={sectorOptions}
        sectorFilter={sectorFilter}
        onSectorFilter={onSectorFilter}
        minRs={minRs}
        onMinRs={onMinRs}
        minVol={minVol}
        onMinVol={onMinVol}
      />

      {radar.status === 'loading' && (
        <p style={{ ...muted, marginTop: 12 }}>Loading RADAR…</p>
      )}
      {radar.status === 'error' && (
        <p style={{ ...muted, color: '#e74c3c', marginTop: 12 }}>
          Couldn't load RADAR: {radar.message}
        </p>
      )}
      {radar.status === 'ready' && rows.length === 0 && (
        <p style={muted}>No stocks match the current filters.</p>
      )}

      {radar.status === 'ready' && rows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={radarTable}>
              <thead>
                <tr>
                  <th style={th}>Symbol</th>
                  <th style={th}>Name</th>
                  <th style={th}>Sector</th>
                  <th style={th}>Cycle Position</th>
                  <th style={thRight}>Relative Strength</th>
                  <th style={thRight}>Accumulation</th>
                  <th style={th}>Entry Zone</th>
                  <th style={thRight}>Stop Loss</th>
                  <th style={thRight}>Risk / Share</th>
                  <th style={thRight}>Units</th>
                  <th style={thRight}>Capital Req</th>
                  <th style={th}>Exit Observation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isTopFive = i < 5
                  const overCap = r.sizing.overCap
                  const rowStyle = {
                    background: overCap
                      ? 'rgba(231,76,60,0.12)'
                      : isTopFive
                        ? 'rgba(46,204,113,0.08)'
                        : 'transparent',
                    borderLeft: overCap
                      ? '3px solid #e74c3c'
                      : isTopFive
                        ? '3px solid #2ecc71'
                        : '3px solid transparent',
                  }
                  return (
                    <tr key={r.company_id || r.symbol} style={rowStyle}>
                      <td style={tdSym}>{r.symbol}</td>
                      <td style={td}>{r.name || '—'}</td>
                      <td style={td}>{r.sector || '—'}</td>
                      <td style={td}>{r.substage || '—'}</td>
                      <td style={tdRight}>{fmtNum(r.rs_vs_nifty)}</td>
                      <td style={tdRight}>
                        {r.vol_ratio != null ? `${Number(r.vol_ratio).toFixed(2)}×` : '—'}
                      </td>
                      <td style={td}>{fmtEntryZone(r.close, r.ma30w)}</td>
                      <td style={tdRight}>{fmtRupee(r.sizing.stopPrice)}</td>
                      <td style={tdRight}>{fmtRupee(r.sizing.riskPerShare)}</td>
                      <td style={tdRight}>
                        {r.sizing.units > 0 ? `${r.sizing.units}` : '0'}
                      </td>
                      <td style={tdRight}>{fmtRupee(r.sizing.capitalRequired)}</td>
                      <td style={td}>{r.exit_observation}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <AllocationFooter allocation={allocation} capital={capital} />
        </>
      )}
    </section>
  )
}

function RadarFilters({
  sectorOptions, sectorFilter, onSectorFilter,
  minRs, onMinRs, minVol, onMinVol,
}) {
  return (
    <div style={filterBar}>
      <label style={filterCell}>
        <span style={filterLabel}>Sector</span>
        <select
          value={sectorFilter}
          onChange={(e) => onSectorFilter(e.target.value)}
          style={filterInputStyle}
        >
          {sectorOptions.map((s) => (
            <option key={s} value={s}>{s === 'ALL' ? 'All sectors' : s}</option>
          ))}
        </select>
      </label>
      <label style={filterCell}>
        <span style={filterLabel}>Min RS score</span>
        <input
          type="number"
          step={0.1}
          value={minRs}
          onChange={(e) => onMinRs(Number(e.target.value))}
          style={filterInputStyle}
        />
      </label>
      <label style={filterCell}>
        <span style={filterLabel}>Min Accumulation (vol ratio)</span>
        <input
          type="number"
          step={0.1}
          value={minVol}
          onChange={(e) => onMinVol(Number(e.target.value))}
          style={filterInputStyle}
        />
      </label>
    </div>
  )
}

function AllocationFooter({ allocation, capital }) {
  const pct = capital.availableCapital > 0
    ? (allocation.totalCapitalRequired / capital.availableCapital) * 100
    : 0
  return (
    <div style={allocationFooter}>
      <p style={{ ...eyebrow, margin: '0 0 6px' }}>
        If you take all {allocation.count} positions:
      </p>
      <div style={allocGrid}>
        <Alloc label="Total capital required" value={fmtRupee(allocation.totalCapitalRequired)} />
        <Alloc label="% of available capital" value={`${pct.toFixed(1)}%`}
               colour={pct > 100 ? '#e74c3c' : pct > 80 ? '#f1c40f' : '#2ecc71'} />
        <Alloc label="Within per-position cap"
               value={`${allocation.withinCap} of ${allocation.count}`}
               colour={allocation.withinCap === allocation.count ? '#2ecc71' : '#aaa'} />
        <Alloc label="Exceeding per-position cap"
               value={`${allocation.overCap} of ${allocation.count}`}
               colour={allocation.overCap > 0 ? '#e74c3c' : '#aaa'} />
      </div>
    </div>
  )
}

function Alloc({ label, value, colour }) {
  return (
    <div style={allocCell}>
      <p style={snapLabel}>{label}</p>
      <p style={{ ...snapValue, color: colour || '#fff' }}>{value}</p>
    </div>
  )
}

// ── Brief card (unchanged) ───────────────────────────────────────

function BriefCard({ sections, onCopy, copied }) {
  return (
    <div style={briefCard}>
      <div style={briefHead}>
        <p style={eyebrow}>Morning brief</p>
        <button type="button" onClick={onCopy} style={ghostBtn}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <div style={briefBody}>
        {sections.length === 0
          ? <p style={muted}>Brief generated — content empty.</p>
          : sections.map((s, i) => <BriefSection key={i} section={s} />)}
      </div>
    </div>
  )
}

function BriefSection({ section }) {
  const { title, inline, body } = section
  if (!title && !body) return null
  return (
    <div style={briefSection}>
      {title && (
        <p style={briefSectionTitle}>
          {title}
          {inline && <span style={briefSectionInline}> — {inline}</span>}
        </p>
      )}
      {body && <p style={briefSectionBody}>{body}</p>}
    </div>
  )
}

// ── Inline cell renderers ────────────────────────────────────────

function WarningCell({ value }) {
  const raw = value == null ? '' : String(value).trim()
  if (!raw || raw.toLowerCase() === 'none') {
    return <span style={{ color: '#666' }}>—</span>
  }
  const clean = raw.replace(/^L(?=[^A-Za-z]|$)/, '').trim() || raw
  const colour = warningColour(clean)
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: colour.bg, color: colour.fg, border: `1px solid ${colour.fg}`,
    }}>
      {clean}
    </span>
  )
}

function TrendBadge({ trend }) {
  if (!trend) return <span style={{ color: '#666' }}>—</span>
  const map = {
    improving: { arrow: '↑', label: 'improving', fg: '#2ecc71', bg: 'rgba(46,204,113,0.14)' },
    holding:   { arrow: '→', label: 'holding',   fg: '#aaa',    bg: 'rgba(255,255,255,0.08)' },
    weakening: { arrow: '↓', label: 'weakening', fg: '#e67e22', bg: 'rgba(230,126,34,0.14)' },
  }
  const c = map[trend] || map.holding
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.fg, border: `1px solid ${c.fg}`,
    }}>
      <span>{c.arrow}</span><span>{c.label}</span>
    </span>
  )
}

// ── Sizing math ──────────────────────────────────────────────────

function computeSizing(row, capital) {
  const currentPrice = Number(row.close)
  const ma30w = Number(row.ma30w)
  const stopPct = STOP_PCT_BY_SUBSTAGE[row.substage] ?? 0.025
  if (!Number.isFinite(currentPrice) || !Number.isFinite(ma30w) || ma30w <= 0) {
    return {
      stopPrice: NaN, riskPerShare: NaN, units: 0,
      capitalRequired: 0, overCap: false,
    }
  }
  const stopPrice = ma30w * (1 - stopPct)
  const riskPerShare = currentPrice - stopPrice
  if (riskPerShare <= 0) {
    return { stopPrice, riskPerShare, units: 0, capitalRequired: 0, overCap: false }
  }
  const riskCapital = Number(capital.availableCapital) * (Number(capital.riskPerTradePct) / 100)
  const units = Math.max(0, Math.floor(riskCapital / riskPerShare))
  const capitalRequired = units * currentPrice
  const maxPositions = Math.max(1, Number(capital.maxPositions) || 1)
  const maxPerPosition = Number(capital.availableCapital) / maxPositions
  const overCap = capitalRequired > maxPerPosition
  return { stopPrice, riskPerShare, units, capitalRequired, overCap }
}

function summarise(rows, capital) {
  let total = 0
  let withinCap = 0
  let overCap = 0
  for (const r of rows) {
    total += r.sizing.capitalRequired || 0
    if (r.sizing.overCap) overCap++
    else if (r.sizing.units > 0) withinCap++
  }
  return {
    count: rows.length,
    totalCapitalRequired: total,
    withinCap,
    overCap,
  }
}

// ── Gemini context builder ───────────────────────────────────────

function buildContext({ data, capital, radarRows, researchSelections, enriched }) {
  const { div, mi, swingx, desk, currentSubstages, prevStage2 } = data

  const swingxCompact = (swingx || []).map((e) => {
    const raw = e.warning_level == null ? '' : String(e.warning_level).trim()
    const cleanedWarning = (!raw || raw.toLowerCase() === 'none') ? null : raw
    return {
      symbol:           e.symbol,
      sector:           e.sector,
      entry_date:       e.entry_date,
      entry_price:      e.entry_price,
      entry_substage:   e.entry_substage,
      current_substage: currentSubstages?.[e.symbol] ?? null,
      substage_trend:   substageTrend(e.entry_substage, currentSubstages?.[e.symbol]),
      days_held:        daysSince(e.entry_date, new Date()),
      warning_level:    cleanedWarning,
    }
  })

  const radarTop10 = (radarRows || []).slice(0, 10).map((r) => ({
    symbol:            r.symbol,
    name:              r.name,
    sector:            r.sector,
    substage:          r.substage,
    rs_vs_nifty:       r.rs_vs_nifty,
    vol_ratio:         r.vol_ratio,
    close:             r.close,
    ma30w:             r.ma30w,
  }))

  const radarWithSizing = (radarRows || []).slice(0, 10).map((r) => ({
    symbol:           r.symbol,
    substage:         r.substage,
    current_price:    r.close,
    ma30w:            r.ma30w,
    stop_price:       roundOr(r.sizing.stopPrice, 2),
    risk_per_share:   roundOr(r.sizing.riskPerShare, 2),
    units_to_buy:     r.sizing.units,
    capital_required: roundOr(r.sizing.capitalRequired, 0),
    exit_observation: r.exit_observation,
    over_per_position_cap: !!r.sizing.overCap,
  }))

  return {
    as_of: div?.date || mi?.date || null,
    nse: {
      above_30wma_pct:        mi?.above_ma30w_pct ?? null,
      ad_line_direction:      div?.ad_line_direction ?? null,
      stage2_count:           mi?.stage2_count ?? div?.stage2_count ?? null,
      stage2_count_week_ago:  prevStage2 ?? null,
      stage3_count:           mi?.stage3_count ?? div?.stage3_count ?? null,
      india_vix:              mi?.india_vix ?? null,
      india_vix_level:        mi?.vix_level ?? null,
      nifty_close:            mi?.nifty_close ?? div?.nifty_close ?? null,
      nifty_change_1d:        mi?.nifty_change_1d ?? null,
      new_52w_highs:          mi?.new_52w_highs ?? null,
      new_52w_lows:           mi?.new_52w_lows ?? null,
      pillar1_verdict:        div?.verdict ?? null,
      pillar1_divergences:    div?.divergences_detected ?? [],
      pillar1_notes:          div?.notes ?? null,
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

    // Capital + RADAR — drives the brief's sizing language.
    capital_available:     Number(capital.availableCapital) || 0,
    risk_per_trade_pct:    Number(capital.riskPerTradePct)  || 0,
    max_positions:         Number(capital.maxPositions)     || 0,
    radar_top10:           radarTop10,
    radar_with_sizing:     radarWithSizing,

    // Stocks the admin marked "Add to Brief" in the lookup panel.
    // Each entry carries Layer 1 (Supabase) + Layer 2 (Yahoo via
    // fetch-stock-info edge function) + the forensic flag set so the
    // model can speak to specific names alongside the market context.
    research_stocks:       buildResearchStocksPayload(researchSelections, enriched),
  }
}

function buildResearchStocksPayload(selections, enriched) {
  if (!Array.isArray(selections) || selections.length === 0) return []
  const out = []
  for (const sym of selections) {
    const e = enriched?.[sym]
    if (!e) {
      out.push({ symbol: sym, status: 'not fetched' })
      continue
    }
    if (e.status !== 'ready') {
      out.push({ symbol: sym, status: e.status, error: e.error || null })
      continue
    }
    out.push({
      symbol: sym,
      name:   e.name   || null,
      sector: e.sector || null,
      layer1: e.layer1 || null,
      fundamentals:       e.layer2?.fundamentals       || null,
      shareholding:       e.layer2?.shareholding       || null,
      shareholding_flags: e.layer2?.shareholding_flags || null,
      // Forensic only populated when Robin clicked Run Forensic Audit.
      // Left null otherwise so the model knows it wasn't requested.
      forensic_flags:     e.forensic                   || null,
      notes:              e.layer2?.notes              || null,
      // Most recent past earnings analysis if any.
      latest_earnings_analysis: (e.pastAnalyses && e.pastAnalyses[0]) || null,
    })
  }
  return out
}

// ── Edge function call ───────────────────────────────────────────

async function callEdgeFunction(context, systemPrompt) {
  const body = await postToFunction(EDGE_FUNCTION_NAME, {
    mode: 'morning_brief', context, systemPrompt,
  })
  const text = (body?.brief || '').trim()
  if (!text) throw new Error('Edge function returned no brief text.')
  return text
}

// Shared POST helper for both edge functions. Centralises auth +
// URL resolution + error mapping so each caller stays small.
async function postToFunction(name, body) {
  const base = functionsBaseUrl()
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!base || !anon) {
    throw new Error('Supabase URL / anon key not configured for this build.')
  }
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes?.session?.access_token
  if (!token) throw new Error('You are not signed in.')

  let res
  try {
    res = await fetch(`${base}/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(`Could not reach ${name} Edge Function.`)
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.error || JSON.stringify(j)
    } catch {}
    if (res.status === 401) throw new Error('Sign-in expired. Refresh the page.')
    if (res.status === 403) throw new Error('This account is not the admin.')
    if (res.status === 429) throw new Error('Gemini quota reached. Try again later.')
    throw new Error(detail)
  }
  return res.json()
}

// ── Helpers ──────────────────────────────────────────────────────

function loadCapital() {
  try {
    const raw = sessionStorage.getItem(CAPITAL_STORAGE_KEY)
    if (!raw) return DEFAULT_CAPITAL
    const parsed = JSON.parse(raw)
    return {
      availableCapital: Number(parsed.availableCapital) || DEFAULT_CAPITAL.availableCapital,
      riskPerTradePct:  Number(parsed.riskPerTradePct)  || DEFAULT_CAPITAL.riskPerTradePct,
      maxPositions:     Number(parsed.maxPositions)     || DEFAULT_CAPITAL.maxPositions,
    }
  } catch { return DEFAULT_CAPITAL }
}

function saveCapital(c) {
  try { sessionStorage.setItem(CAPITAL_STORAGE_KEY, JSON.stringify(c)) } catch {}
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

function fmtRupee(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const rounded = Math.round(n)
  return `₹${rounded.toLocaleString('en-IN')}`
}

function fmtEntryZone(close, ma30w) {
  const c = Number(close)
  const m = Number(ma30w)
  if (!Number.isFinite(c)) return '—'
  if (!Number.isFinite(m) || m <= 0) return fmtRupee(c)
  // "₹1,290 — ₹1,180" → current price down to 30W MA (the pullback
  // zone). If close is below ma30w, the zone reads ma30w → close.
  const hi = Math.max(c, m)
  const lo = Math.min(c, m)
  return `${fmtRupee(hi)} — ${fmtRupee(lo)}`
}

function roundOr(v, places) {
  if (v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const f = Math.pow(10, places)
  return Math.round(n * f) / f
}

function titlecase(s) {
  const t = String(s || '')
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : ''
}

function verdictColours(v) {
  switch (v) {
    case 'STRONG':    return { bg: 'rgba(46,204,113,0.16)', fg: '#2ecc71' }
    case 'WATCH':     return { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' }
    case 'MIXED':     return { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' }
    case 'WEAK':      return { bg: 'rgba(230,126,34,0.16)', fg: '#e67e22' }
    case 'DANGEROUS': return { bg: 'rgba(231,76,60,0.18)',  fg: '#e74c3c' }
    default:          return VERDICT_AWAITING
  }
}
const VERDICT_AWAITING = { bg: 'rgba(255,255,255,0.06)', fg: '#888' }

function warningColour(label) {
  const l = String(label || '').toLowerCase()
  if (l.includes('grace')) return { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' }
  if (l.includes('warn'))  return { bg: 'rgba(230,126,34,0.18)', fg: '#e67e22' }
  if (l.includes('exit'))  return { bg: 'rgba(231,76,60,0.20)',  fg: '#e74c3c' }
  return { bg: 'rgba(255,255,255,0.08)', fg: '#aaa' }
}

function adLineArrow(v) {
  const s = String(v || '').toLowerCase()
  if (s.includes('up') || s.includes('rising') || s.includes('positive')) {
    return { glyph: '↑', label: 'Rising',  colour: '#2ecc71' }
  }
  if (s.includes('down') || s.includes('falling') || s.includes('negative')) {
    return { glyph: '↓', label: 'Falling', colour: '#e74c3c' }
  }
  if (s.includes('flat') || s.includes('side') || s.includes('neutral')) {
    return { glyph: '→', label: 'Flat',    colour: '#aaa' }
  }
  return { glyph: '—', label: 'Unknown', colour: '#666' }
}

function trendArrow(current, previous) {
  const a = Number(current)
  const b = Number(previous)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (a === b) return { arrow: '→', colour: '#aaa' }
  if (a > b)   return { arrow: '↑', colour: '#2ecc71' }
  return         { arrow: '↓', colour: '#e67e22' }
}

function pickWeekAgoStage2(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const latest = rows[0]
  if (!latest?.date) return null
  const latestMs = new Date(latest.date).valueOf()
  if (!Number.isFinite(latestMs)) return null
  const target = latestMs - 7 * 24 * 3600 * 1000
  let best = null
  let bestDist = Infinity
  for (const row of rows) {
    if (!row?.date) continue
    const d = new Date(row.date).valueOf()
    if (!Number.isFinite(d) || d === latestMs) continue
    const dist = Math.abs(d - target)
    if (dist < bestDist) { best = row; bestDist = dist }
  }
  return best?.stage2_count ?? null
}

function daysSince(dateStr, today) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (!Number.isFinite(d.valueOf())) return null
  const ms = today.valueOf() - d.valueOf()
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)))
}

function substageOrdinal(s) {
  if (!s) return null
  const m = String(s).trim().match(/^([1-4])([A-Z])([+\-]?)$/i)
  if (!m) return null
  const stage = Number(m[1])
  const letter = m[2].toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  const sign = m[3] === '+' ? 1 : m[3] === '-' ? -1 : 0
  return stage * 100 + letter * 10 + sign
}

function substageTrend(entry, current) {
  if (!entry || !current) return null
  if (entry === current) return 'holding'
  const a = substageOrdinal(entry)
  const b = substageOrdinal(current)
  if (a == null || b == null) return null
  if (b === a) return 'holding'
  if (b > a) {
    if (b >= 300 && a < 300) return 'weakening'
    return 'improving'
  }
  return 'weakening'
}

function parseBriefSections(text) {
  const HEADERS = [
    'IQJET DAILY',
    'NSE MARKET',
    'US MARKET',
    'NSE SENTIMENT',
    'US SENTIMENT',
    'SWINGX WATCH',
    "ROBIN'S DESK",
    "TODAY'S EDGE",
  ]
  const normalised = String(text || '').replace(/[’]/g, "'")
  const lines = normalised.split(/\r?\n/)
  const matchHeader = (line) => {
    const trimmed = line.trim().replace(/^[#*\s]+/, '')
    for (const h of HEADERS) {
      const re = new RegExp(
        '^' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          + '(?:\\s*[—:\\-]\\s*(.*))?$',
        'i',
      )
      const m = trimmed.match(re)
      if (m) return { title: h, inline: (m[1] || '').trim() }
    }
    return null
  }
  const sections = []
  let current = { title: null, inline: '', body: [] }
  for (const line of lines) {
    const head = matchHeader(line)
    if (head) {
      if (current.title || current.body.length) sections.push(current)
      current = { title: head.title, inline: head.inline, body: [] }
    } else {
      current.body.push(line)
    }
  }
  if (current.title || current.body.length) sections.push(current)
  return sections.map((s) => ({ ...s, body: s.body.join('\n').trim() }))
}

// ── Stock lookup section ─────────────────────────────────────────

function StockLookup({
  searchQuery, onSearchQueryChange, onSearch, searchState,
  watchlist, briefSelections, enriched, openSymbol, capital,
  onToggleOpen, onAddWatchlist, onRemoveWatchlist, onToggleBrief,
  onRunForensic, onTranscriptAnalysed,
}) {
  const briefSet = useMemo(() => new Set(briefSelections), [briefSelections])
  const watchSet = useMemo(() => new Set(watchlist.map((w) => w.symbol)), [watchlist])

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>Stock Lookup · Research</p>
          <p style={muted}>
            Search NSE symbol or company name. Click a result to load
            fundamentals + shareholding. Forensic audit and earnings
            transcript analysis are on-demand inside the card.
          </p>
        </div>
      </div>

      {watchlist.length > 0 && (
        <WatchlistChips watchlist={watchlist} onRemove={onRemoveWatchlist} />
      )}

      <form onSubmit={onSearch} style={searchForm}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Type symbol or company name…"
          autoComplete="off"
          spellCheck={false}
          style={searchInputStyle}
        />
        <button type="submit" style={primaryBtn}>Search</button>
      </form>

      {searchState.status === 'loading' && (
        <p style={{ ...muted, marginTop: 10 }}>Searching…</p>
      )}
      {searchState.status === 'error' && (
        <p style={{ ...muted, color: '#e74c3c', marginTop: 10 }}>
          {searchState.error}
        </p>
      )}
      {searchState.status === 'ready' && searchState.results.length === 0 && (
        <p style={muted}>No matches.</p>
      )}

      {searchState.results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {searchState.results.map((row) => (
            <StockResultCard
              key={row.symbol}
              row={row}
              capital={capital}
              isOpen={openSymbol === row.symbol}
              enriched={enriched[row.symbol]}
              inBrief={briefSet.has(row.symbol)}
              inWatchlist={watchSet.has(row.symbol)}
              watchlistFull={watchlist.length >= MAX_WATCHLIST}
              onToggleOpen={() => onToggleOpen(row)}
              onAddWatchlist={() => onAddWatchlist(row)}
              onToggleBrief={() => onToggleBrief(row)}
              onRunForensic={onRunForensic}
              onTranscriptAnalysed={onTranscriptAnalysed}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function WatchlistChips({ watchlist, onRemove }) {
  return (
    <div style={watchlistBar}>
      <span style={{ ...eyebrow, marginRight: 4 }}>
        Research watchlist ({watchlist.length}/{MAX_WATCHLIST})
      </span>
      {watchlist.map((w) => (
        <span key={w.symbol} style={chip}>
          <span style={{ fontWeight: 600 }}>{w.symbol}</span>
          <button
            type="button"
            aria-label={`Remove ${w.symbol}`}
            onClick={() => onRemove(w.symbol)}
            style={chipClose}
          >×</button>
        </span>
      ))}
    </div>
  )
}

function StockResultCard({
  row, capital, isOpen, enriched, inBrief, inWatchlist, watchlistFull,
  onToggleOpen, onAddWatchlist, onToggleBrief,
  onRunForensic, onTranscriptAnalysed,
}) {
  const sizing = computeSizing({
    close: row.close, ma30w: row.ma30w, substage: row.substage,
  }, capital)
  const exitObs = EXIT_OBSERVATIONS[row.substage] || 'Watch substage carefully'
  const aboveMA = row.close != null && row.ma30w != null && Number(row.close) >= Number(row.ma30w)

  return (
    <div style={resultCard}>
      <div style={resultHead}>
        <div style={{ minWidth: 0 }}>
          <p style={resultSymbol}>{row.symbol}</p>
          <p style={resultName}>{row.name || '—'}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={resultPrice}>{fmtRupee(row.close)}</p>
          <p style={muted}>{row.sector || '—'}</p>
        </div>
      </div>

      <div style={resultMetaRow}>
        <Meta label="Stage"     value={row.stage  || '—'} />
        <Meta label="Substage"  value={row.substage || '—'} />
        <Meta label="RS vs N50" value={fmtNum(row.rs_vs_nifty)} />
        <Meta label="Vol ratio" value={row.vol_ratio != null ? `${Number(row.vol_ratio).toFixed(2)}×` : '—'} />
        <Meta label="30W MA"    value={fmtRupee(row.ma30w)} />
        <Meta label="vs 30W MA" value={aboveMA ? 'Above' : 'Below'}
              valueColour={aboveMA ? '#2ecc71' : '#e67e22'} />
      </div>

      <div style={resultMetaRow}>
        <Meta label="Entry zone" value={fmtEntryZone(row.close, row.ma30w)} />
        <Meta label="Stop loss"  value={fmtRupee(sizing.stopPrice)} />
        <Meta label="Risk/share" value={fmtRupee(sizing.riskPerShare)} />
        <Meta label="Units"      value={sizing.units > 0 ? String(sizing.units) : '0'} />
        <Meta label="Capital"    value={fmtRupee(sizing.capitalRequired)} />
      </div>

      <p style={{ ...muted, marginTop: 8 }}>{exitObs}</p>

      <div style={resultActions}>
        <button type="button" onClick={onToggleOpen} style={ghostBtn}>
          {isOpen ? 'Close detail' : 'Open detail'}
        </button>
        <button
          type="button"
          onClick={onAddWatchlist}
          disabled={inWatchlist || (watchlistFull && !inWatchlist)}
          style={{
            ...ghostBtn,
            opacity: inWatchlist || (watchlistFull && !inWatchlist) ? 0.5 : 1,
          }}
        >
          {inWatchlist ? 'In watchlist ✓' : watchlistFull ? 'Watchlist full' : 'Add to watchlist'}
        </button>
        <button
          type="button"
          onClick={onToggleBrief}
          style={{
            ...ghostBtn,
            borderColor: inBrief ? '#2ecc71' : 'rgba(255,255,255,0.18)',
            color:       inBrief ? '#2ecc71' : '#e6e6e6',
          }}
        >
          {inBrief ? 'In brief ✓' : 'Add to brief'}
        </button>
      </div>

      {isOpen && (
        <ExpandedStockCard
          row={row}
          capital={capital}
          enriched={enriched}
          onRunForensic={onRunForensic}
          onTranscriptAnalysed={onTranscriptAnalysed}
        />
      )}
    </div>
  )
}

function ExpandedStockCard({ row, capital, enriched, onRunForensic, onTranscriptAnalysed }) {
  const status         = enriched?.status || 'idle'
  const layer1         = enriched?.layer1 || null
  const layer2         = enriched?.layer2 || null
  const fundamentals   = layer2?.fundamentals    || null
  const sharehold      = layer2?.shareholding    || null
  const shareholdFlags = layer2?.shareholding_flags || null
  const forensicStatus = enriched?.forensicStatus || 'idle'
  const forensic       = enriched?.forensic       || null
  const pastAnalyses   = enriched?.pastAnalyses   || []

  const sizing = computeSizing({
    close: row.close, ma30w: row.ma30w, substage: row.substage,
  }, capital)

  // Ref + state for the PDF export. The full card body sits inside
  // this div; html2canvas captures it, jsPDF lays it across A4 pages.
  // Anything with data-pdf-hide is temporarily hidden during the
  // capture so the shared PDF doesn't show form controls + tip text.
  const pdfRef = useRef(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  async function onDownloadPdf() {
    if (pdfBusy || !pdfRef.current) return
    setPdfBusy(true)
    try {
      await exportStockCardToPdf(pdfRef.current, row)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[IQjet Desk] PDF export failed:', e)
      alert('PDF export failed: ' + String(e?.message || e))
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div style={expandedBox} ref={pdfRef}>
      <div
        data-pdf-hide="true"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          onClick={onDownloadPdf}
          disabled={pdfBusy}
          style={{
            ...ghostBtn,
            opacity: pdfBusy ? 0.6 : 1,
            cursor:  pdfBusy ? 'wait' : 'pointer',
          }}
        >
          {pdfBusy ? 'Building PDF…' : '📄 Download PDF'}
        </button>
      </div>
      <SectionBlock title="Cycle Position">
        <Line label="Stage / Substage" value={`${row.stage || '—'} · ${row.substage || '—'}`} />
        <Line label="RS vs Nifty" value={fmtNum(row.rs_vs_nifty)} />
        <Line label="Vol ratio"   value={row.vol_ratio != null ? `${Number(row.vol_ratio).toFixed(2)}×` : '—'} />
        <Line label="Entry substage exit observation" value={EXIT_OBSERVATIONS[row.substage] || 'Watch substage carefully'} />
      </SectionBlock>

      <SectionBlock title="Price · 52W">
        <Line label="Close"  value={fmtRupee(row.close)} />
        <Line label="30W MA" value={fmtRupee(row.ma30w)} />
        <Line label="52W high" value={fmtRupee(row.high_52w)} />
        <Line label="52W low"  value={fmtRupee(row.low_52w)} />
        <Line label="Entry zone" value={fmtEntryZone(row.close, row.ma30w)} />
      </SectionBlock>

      {layer1 && <Layer1Card layer1={layer1} />}

      <SectionBlock title="Risk Sizing">
        <Line label="Stop loss"       value={fmtRupee(sizing.stopPrice)} />
        <Line label="Risk per share"  value={fmtRupee(sizing.riskPerShare)} />
        <Line label="Units to buy"    value={sizing.units > 0 ? `${sizing.units}` : '0'} />
        <Line label="Capital required" value={fmtRupee(sizing.capitalRequired)} />
        <Line label="Risk capital"    value={fmtRupee(Number(capital.availableCapital) * (Number(capital.riskPerTradePct) / 100))} />
      </SectionBlock>

      <Layer2Card
        status={status}
        fundamentals={fundamentals}
        error={enriched?.error}
        notes={layer2?.notes}
        layer2Source={layer2?.source || (layer2?.notes?.some((n) => /IndianAPI fundamentals ok/i.test(n)) ? 'IndianAPI' : null)}
      />

      {/* Shareholding — loads automatically, no trigger button. */}
      <ShareholdingCard
        status={status}
        layer1Shareholding={layer1?.shareholding || []}
        layer2Shareholding={sharehold}
        flags={shareholdFlags}
      />

      {/* Forensic — gated behind explicit button click. */}
      <ForensicSection
        symbol={row.symbol}
        forensicStatus={forensicStatus}
        forensic={forensic}
        error={enriched?.forensicError}
        onRunForensic={onRunForensic}
      />

      {/* Earnings transcript upload + analysis. */}
      <EarningsPanel
        symbol={row.symbol}
        companyId={row.company_id}
        pastAnalyses={pastAnalyses}
        onAnalysed={onTranscriptAnalysed}
      />
    </div>
  )
}

// ── Shareholding (always-visible) ────────────────────────────────

function ShareholdingCard({ status, layer1Shareholding, layer2Shareholding, flags }) {
  // Layer 1 — last 6 quarters from the Supabase `shareholding` table
  // (populated by Robin's daily IndianAPI pipeline). Layer 2 — Yahoo +
  // IndianAPI augmentation served via fetch-stock-info edge function.
  // History is sorted chronologically by the caller; index 0 is the
  // most recent quarter.
  const history = Array.isArray(layer1Shareholding) ? layer1Shareholding : []
  const latest  = history[0] || null
  const prev    = history[1] || null
  const promoterPct    = latest?.promoter_pct    ?? layer2Shareholding?.promoterPct
  const fiiPct         = latest?.fii_pct
  const diiPct         = latest?.dii_pct
  const publicPct      = latest?.public_pct      ?? layer2Shareholding?.publicPct
  const institutionPct = (fiiPct != null || diiPct != null)
    ? (Number(fiiPct || 0) + Number(diiPct || 0))
    : layer2Shareholding?.institutionPct
  const pledgePct      = latest?.promoter_pledge_pct
  const asOf           = latest?.quarter || layer2Shareholding?.asOf || null

  // Quarter-over-quarter deltas surfaced inline next to the latest row.
  const promoterDelta  = (prev && latest && latest.promoter_pct != null && prev.promoter_pct != null)
    ? latest.promoter_pct - prev.promoter_pct : null
  const fiiDelta       = (prev && latest && latest.fii_pct != null && prev.fii_pct != null)
    ? latest.fii_pct - prev.fii_pct : null
  const diiDelta       = (prev && latest && latest.dii_pct != null && prev.dii_pct != null)
    ? latest.dii_pct - prev.dii_pct : null

  const topInst        = layer2Shareholding?.topInstitutions || []
  const insiderTx      = layer2Shareholding?.insiderTransactions || []

  const hasAnyData = promoterPct != null || institutionPct != null
    || topInst.length > 0 || insiderTx.length > 0 || history.length > 0

  return (
    <SectionBlock title="Shareholding Pattern">
      {status === 'loading' && <p style={muted}>Loading shareholding…</p>}
      {status === 'error' && (
        <p style={{ ...muted, color: '#e74c3c' }}>
          fetch-stock-info failed; falling back to Supabase layer only.
        </p>
      )}
      {!hasAnyData && status === 'ready' && (
        <p style={muted}>
          Shareholding data unavailable for this symbol.
        </p>
      )}
      {hasAnyData && (
        <>
          {asOf && <p style={muted}>As of: {asOf}</p>}
          <div style={{ height: 6 }} />
          <Line label="Promoter"
                value={
                  <>
                    {fmtPct(promoterPct)}
                    <PctDelta value={promoterDelta} />
                  </>
                }
                accessory={<FlagChip flag={flags?.promoter_flag} />} />
          {fiiPct != null && (
            <Line label="FII" value={<>{fmtPct(fiiPct)}<PctDelta value={fiiDelta} /></>} />
          )}
          {diiPct != null && (
            <Line label="DII" value={<>{fmtPct(diiPct)}<PctDelta value={diiDelta} /></>} />
          )}
          {institutionPct != null && (
            <Line label="Total institutions" value={fmtPct(institutionPct)} />
          )}
          <Line label="Public" value={fmtPct(publicPct)} />
          {pledgePct != null && (
            <Line label="Promoter pledge" value={fmtPct(pledgePct)} />
          )}

          {history.length > 1 && (
            <>
              <p style={{ ...sectionBlockTitle, marginTop: 12, color: '#aaa', fontSize: 11 }}>
                Last {history.length} quarters
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={miniTable}>
                  <thead>
                    <tr>
                      <th style={th}>Quarter</th>
                      <th style={thRight}>Promoter</th>
                      <th style={thRight}>FII</th>
                      <th style={thRight}>DII</th>
                      <th style={thRight}>Public</th>
                      <th style={thRight}>Pledge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={`${h.quarter}-${i}`}>
                        <td style={td}>{h.quarter || '—'}</td>
                        <td style={tdRight}>{fmtPct(h.promoter_pct)}</td>
                        <td style={tdRight}>{fmtPct(h.fii_pct)}</td>
                        <td style={tdRight}>{fmtPct(h.dii_pct)}</td>
                        <td style={tdRight}>{fmtPct(h.public_pct)}</td>
                        <td style={tdRight}>{h.promoter_pledge_pct != null ? fmtPct(h.promoter_pledge_pct) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {topInst.length > 0 && (
            <>
              <p style={{ ...sectionBlockTitle, marginTop: 12, color: '#aaa', fontSize: 11 }}>
                Top institutional holders
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={miniTable}>
                  <thead>
                    <tr>
                      <th style={th}>Holder</th>
                      <th style={thRight}>%</th>
                      <th style={thRight}>Value</th>
                      <th style={th}>Report date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topInst.slice(0, 5).map((h, i) => (
                      <tr key={i}>
                        <td style={td}>{h.name}</td>
                        <td style={tdRight}>{h.pctHeld != null ? `${(h.pctHeld * 100).toFixed(2)}%` : '—'}</td>
                        <td style={tdRight}>{fmtIndianMaybeCr(h.value)}</td>
                        <td style={td}>{h.reportDate || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {insiderTx.length > 0 && (
            <>
              <p style={{ ...sectionBlockTitle, marginTop: 12, color: '#aaa', fontSize: 11 }}>
                Insider activity (recent)
              </p>
              {insiderTx.slice(0, 5).map((t, i) => {
                const isSell = /sale|sold|dispos/i.test(t.transactionText)
                const colour = isSell ? '#e67e22' : '#2ecc71'
                return (
                  <div key={i} style={{ ...kvLine, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14, color: colour }}>
                      {isSell ? '🔴' : '🟢'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ ...kvLineValue, margin: 0 }}>
                        {t.filerName} · {t.transactionText}
                      </p>
                      <p style={{ ...muted, margin: '2px 0 0', fontSize: 11 }}>
                        {t.startDate || '—'} · {fmtIndianMaybeCr(t.value)} · {t.shares != null ? `${t.shares.toLocaleString('en-IN')} sh` : '—'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {flags && (
            <>
              <p style={{ ...sectionBlockTitle, marginTop: 12, color: '#aaa', fontSize: 11 }}>
                Shareholding flags
              </p>
              <ForensicLine flag={flags.promoter_flag}    label="Promoter Holding"      detail={flags.promoter_detail   || '—'} />
              <ForensicLine flag={flags.insider_flag}     label="Insider Activity"      detail={flags.insider_detail    || '—'} />
              <ForensicLine flag={flags.institution_flag} label="Institutional Trend"   detail={'Quarter-over-quarter trend not in Yahoo data.'} />
              <p style={{ ...muted, marginTop: 8, fontStyle: 'italic' }}>{flags.summary}</p>
            </>
          )}
        </>
      )}
    </SectionBlock>
  )
}

function FlagChip({ flag }) {
  if (!flag || flag === 'UNKNOWN') return null
  const c = FORENSIC_COLOURS[flag] || FORENSIC_COLOURS.UNKNOWN
  return (
    <span style={{ fontSize: 14, marginLeft: 6 }}>{c.glyph}</span>
  )
}

// Inline % delta vs prior quarter — green when increasing, orange
// when decreasing. Hidden when the prior-quarter value is missing.
function PctDelta({ value }) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.01) return null
  const colour = value > 0 ? '#2ecc71' : '#e67e22'
  const sign = value > 0 ? '+' : ''
  return (
    <span style={{ marginLeft: 6, fontSize: 11, color: colour, fontWeight: 600 }}>
      ({sign}{value.toFixed(2)})
    </span>
  )
}

// ── Forensic (on-demand) ─────────────────────────────────────────

function ForensicSection({ symbol, forensicStatus, forensic, error, onRunForensic }) {
  if (forensicStatus === 'idle') {
    return (
      <div style={sectionBlock}>
        <p style={sectionBlockTitle}>Forensic · Bookkeeping Health</p>
        <p style={muted}>
          Not fetched. Run when you want the bookkeeping audit —
          consumes one Yahoo + (optionally) one IndianAPI call.
        </p>
        <button
          type="button"
          onClick={() => onRunForensic(symbol)}
          style={{ ...ghostBtn, marginTop: 8 }}
        >
          🔍 Run Forensic Audit
        </button>
      </div>
    )
  }
  if (forensicStatus === 'loading') {
    return (
      <div style={sectionBlock}>
        <p style={sectionBlockTitle}>Forensic · Bookkeeping Health</p>
        <p style={muted}>Running forensic audit…</p>
      </div>
    )
  }
  if (forensicStatus === 'error') {
    return (
      <div style={sectionBlock}>
        <p style={sectionBlockTitle}>Forensic · Bookkeeping Health</p>
        <p style={{ ...muted, color: '#e74c3c' }}>Forensic fetch failed: {error || 'unknown'}</p>
        <button
          type="button"
          onClick={() => onRunForensic(symbol)}
          style={{ ...ghostBtn, marginTop: 8 }}
        >
          🔄 Retry
        </button>
      </div>
    )
  }
  // ready
  return (
    <div style={sectionBlock}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={sectionBlockTitle}>Forensic · Bookkeeping Health</p>
        <span style={{ ...muted, color: '#2ecc71', fontSize: 12 }}>✓ Audit complete</span>
      </div>
      {forensic ? (
        <>
          <ForensicLine flag={forensic.cash_vs_profit} label="Cash Flow vs Profit"
            detail={forensic.cash_ratio != null
              ? `OCF / Net Income = ${forensic.cash_ratio.toFixed(2)}× ${forensic.cash_ratio >= 1 ? '— profit backed by cash' : '— check accounting'}`
              : 'Insufficient data'} />
          <ForensicLine flag={forensic.receivables_flag} label="Receivables vs Revenue"
            detail={forensic.receivables_ratio != null
              ? `${(forensic.receivables_ratio * 100).toFixed(1)}% of revenue`
              : 'Insufficient data'} />
          <ForensicLine flag={forensic.debt_flag} label="Debt Repayment"
            detail={forensic.debt_years != null
              ? `${forensic.debt_years.toFixed(1)} years to repay at current free cash flow`
              : 'Debt with no positive free cash flow'} />
          <ForensicLine flag={forensic.inventory_flag} label="Inventory Health"
            detail={forensic.inventory_ratio != null
              ? `${(forensic.inventory_ratio * 100).toFixed(1)}% of revenue`
              : 'Insufficient data'} />
          <ForensicLine flag={forensic.goodwill_flag} label="Goodwill vs Assets"
            detail={forensic.goodwill_ratio != null
              ? `${(forensic.goodwill_ratio * 100).toFixed(1)}% of total assets`
              : 'Insufficient data'} />
          <ForensicLine flag={forensic.pledge_flag} label="Promoter Pledge"
            detail={forensic.promoter_pledge_pct != null
              ? `${Number(forensic.promoter_pledge_pct).toFixed(1)}% of shares pledged`
              : 'Set INDIAN_API_KEY on fetch-stock-info to enable'} />
          <p style={{ ...muted, marginTop: 10, fontStyle: 'italic' }}>{forensic.summary}</p>
          <p style={muted}>Note: {forensic.contingent_liabilities_note}</p>
        </>
      ) : (
        <p style={muted}>No forensic data returned.</p>
      )}
    </div>
  )
}

// ── Earnings panel ───────────────────────────────────────────────

function EarningsPanel({ symbol, companyId, pastAnalyses, onAnalysed }) {
  const [file, setFile]           = useState(null)
  // `text` is the analysed body — populated either by file extraction
  // or by hitting "Use pasted text" on the paste box.
  const [text, setText]           = useState('')
  const [extractErr, setExtractErr] = useState('')
  const [extracting, setExtracting] = useState(false)
  // Separate state for the paste textarea so it can hold a long draft
  // independently of `text` (which represents the locked-in transcript
  // sent to Gemini).
  const [paste, setPaste]         = useState('')
  const [callDate, setCallDate]   = useState('')
  const [analysing, setAnalysing] = useState(false)
  const [analysis, setAnalysis]   = useState(null)
  const [analysisErr, setAnalysisErr] = useState('')

  async function onFileChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setText('')
    setAnalysis(null)
    setAnalysisErr('')
    setExtractErr('')
    setExtracting(true)
    try {
      if (/\.(txt|md|csv)$/i.test(f.name) || f.type.startsWith('text/')) {
        const buf = await f.text()
        setText(buf)
      } else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        const t = await extractPdfText(f)
        setText(t)
      } else {
        setExtractErr(
          'Unsupported file type. Upload .txt or .pdf — or paste the ' +
          'transcript text directly in the box below.',
        )
      }
    } catch (err) {
      setExtractErr(
        'PDF extraction failed: ' + String(err?.message || err) +
        '. As a fallback, paste the transcript text in the box below.',
      )
    } finally {
      setExtracting(false)
    }
    // Reset the input so picking the same file again still fires change.
    e.target.value = ''
  }

  function onUsePastedText() {
    const t = (paste || '').trim()
    if (t.length < 200) {
      setExtractErr('Pasted text is too short. Need at least 200 characters of transcript.')
      return
    }
    setFile(null)
    setText(t)
    setAnalysis(null)
    setAnalysisErr('')
    setExtractErr('')
  }

  function onClearTranscript() {
    setText('')
    setFile(null)
    setExtractErr('')
  }

  async function onAnalyse() {
    if (!text || !callDate || analysing) return
    setAnalysing(true)
    setAnalysisErr('')
    try {
      const result = await callEarningsAnalysis({
        transcript:   text,
        symbol,
        callDate,
        systemPrompt: IQJET_ADMIN_PROMPT,
      })
      if (!result) throw new Error('Empty analysis from Gemini.')
      setAnalysis(result)
      // Persist + bubble up so the parent can refresh past-analyses chip row.
      try {
        await saveEarningsAnalysis({
          companyId, symbol, callDate,
          transcriptLength: text.length,
          analysis: result,
        })
        if (typeof onAnalysed === 'function') onAnalysed(symbol)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[IQjet Desk] Save earnings_intelligence failed:', e)
      }
    } catch (e) {
      setAnalysisErr(String(e?.message || e))
    } finally {
      setAnalysing(false)
    }
  }

  function loadPast(p) {
    setAnalysis({
      tone:              p.tone,
      confidence_score:  p.confidence_score,
      hedging_count:     p.hedging_count,
      evasion_count:     p.evasion_count,
      guidance_specific: p.guidance_specific,
      verdict:           p.verdict,
      key_phrases:       p.key_phrases || [],
      summary:           p.summary,
      red_flags:         p.red_flags   || [],
    })
    setCallDate(String(p.call_date || ''))
  }

  return (
    <div style={sectionBlock}>
      <p style={sectionBlockTitle}>Earnings Intelligence</p>

      {pastAnalyses.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <span style={{ ...muted, alignSelf: 'center' }}>Past analyses:</span>
          {pastAnalyses.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPast(p)}
              style={chip}
            >
              {p.call_date}
            </button>
          ))}
        </div>
      )}

      {!text && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={ghostBtnAsLabel}>
              📄 Upload .txt or .pdf
              <input
                type="file"
                accept=".txt,.pdf,.md,.csv,application/pdf,text/*"
                onChange={onFileChange}
                style={{ display: 'none' }}
              />
            </label>
            <span style={{ ...muted, fontSize: 11 }}>or</span>
            <span style={{ ...muted, fontSize: 11 }}>
              paste the transcript text directly below
            </span>
          </div>

          {extracting && <p style={{ ...muted, marginTop: 6 }}>Extracting text…</p>}
          {extractErr && <p style={{ ...muted, color: '#e74c3c', marginTop: 6 }}>{extractErr}</p>}

          <label style={{ display: 'block', marginTop: 10 }}>
            <p style={{ ...muted, marginBottom: 6, fontSize: 11 }}>
              Paste transcript · {paste.length.toLocaleString()} chars
            </p>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={8}
              placeholder="Paste the full earnings-call transcript here — Q&A included."
              spellCheck={false}
              style={broadcastTextarea}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onUsePastedText}
              disabled={paste.trim().length < 200}
              style={{
                ...generateBtn,
                padding: '8px 14px',
                fontSize: 12,
                opacity: paste.trim().length < 200 ? 0.5 : 1,
                cursor:  paste.trim().length < 200 ? 'not-allowed' : 'pointer',
              }}
            >
              Use pasted text →
            </button>
            {paste && (
              <button type="button" onClick={() => setPaste('')} style={ghostBtn}>
                Clear paste
              </button>
            )}
          </div>
        </>
      )}

      {text && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <p style={{ ...muted, margin: 0 }}>
              {file ? file.name : 'Pasted text'} · {text.length.toLocaleString()} characters
            </p>
            <button type="button" onClick={onClearTranscript} style={ghostBtn}>
              Use a different transcript
            </button>
          </div>
          <pre style={transcriptPreview}>{text.slice(0, 200)}{text.length > 200 ? '…' : ''}</pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Call date:
              <input
                type="date"
                value={callDate}
                onChange={(e) => setCallDate(e.target.value)}
                style={dateInputStyle}
              />
            </label>
            <button
              type="button"
              onClick={onAnalyse}
              disabled={!text || !callDate || analysing}
              style={{
                ...generateBtn,
                padding: '10px 16px',
                fontSize: 13,
                opacity: !text || !callDate || analysing ? 0.6 : 1,
                cursor:  !text || !callDate || analysing ? 'not-allowed' : 'pointer',
              }}
            >
              {analysing ? 'Analysing…' : 'Analyse with Gemini'}
            </button>
          </div>
        </>
      )}

      {analysisErr && (
        <p style={{ ...muted, color: '#e74c3c', marginTop: 10 }}>{analysisErr}</p>
      )}
      {analysis && (
        <EarningsResultCard symbol={symbol} callDate={callDate} analysis={analysis} />
      )}
    </div>
  )
}

function EarningsResultCard({ symbol, callDate, analysis }) {
  const tone = String(analysis.tone || '').toUpperCase()
  const toneColour =
    tone === 'CONFIDENT' ? '#2ecc71' :
    tone === 'CAUTIOUS'  ? '#e67e22' : '#aaa'
  const verdict = String(analysis.verdict || '').toUpperCase()
  const verdictColour =
    verdict.includes('BUY')    ? '#2ecc71' :
    verdict.includes('REDUCE') ? '#e67e22' :
    verdict.includes('EXIT')   ? '#e74c3c' : '#aaa'
  return (
    <div style={earningsResult}>
      <p style={earningsResultTitle}>
        {symbol}{callDate ? ` · ${callDate}` : ''}
      </p>
      <div style={earningsResultGrid}>
        <Line label="Management tone" value={<span style={{ color: toneColour, fontWeight: 700 }}>{tone || '—'}</span>} />
        <Line label="Confidence score" value={`${analysis.confidence_score ?? '—'}/10`} />
        <Line label="Hedging language" value={`${analysis.hedging_count ?? '—'} instances`} />
        <Line label="Q&A evasions" value={`${analysis.evasion_count ?? '—'} instances`} />
        <Line label="Forward guidance" value={analysis.guidance_specific ? 'Specific ✓' : 'Vague / withdrawn'} />
        <Line label="Verdict" value={<span style={{ color: verdictColour, fontWeight: 700 }}>{verdict || '—'}</span>} />
      </div>
      {Array.isArray(analysis.key_phrases) && analysis.key_phrases.length > 0 && (
        <>
          <p style={{ ...sectionBlockTitle, marginTop: 10, color: '#aaa', fontSize: 11 }}>
            Key phrases flagged
          </p>
          {analysis.key_phrases.map((p, i) => (
            <p key={i} style={{ ...muted, color: '#e6e6e6', margin: '2px 0', fontStyle: 'italic' }}>“{p}”</p>
          ))}
        </>
      )}
      {Array.isArray(analysis.red_flags) && analysis.red_flags.length > 0 && (
        <>
          <p style={{ ...sectionBlockTitle, marginTop: 10, color: '#e74c3c', fontSize: 11 }}>
            Red flags
          </p>
          {analysis.red_flags.map((p, i) => (
            <p key={i} style={{ ...muted, color: '#e6e6e6', margin: '2px 0' }}>• {p}</p>
          ))}
        </>
      )}
      {analysis.summary && (
        <p style={{ ...muted, color: '#e6e6e6', marginTop: 10 }}>
          <b style={{ color: '#888' }}>Summary: </b>{analysis.summary}
        </p>
      )}
    </div>
  )
}

function Layer1Card({ layer1 }) {
  const km = layer1.key_metrics || null
  const qf = layer1.quarterly  || []
  const ds = layer1.delivery   || null

  // Extended cashflow + balance-sheet columns are populated by the
  // nightly Python pipeline (scripts/iqjet/fetch_stock_fundamentals_extended.py).
  // Render the section only when at least one field is present —
  // companies that weren't covered by the run stay clean.
  const hasExtended = km && (
    km.operating_cashflow != null ||
    km.free_cashflow      != null ||
    km.total_debt         != null ||
    km.total_cash         != null ||
    km.total_assets       != null ||
    km.net_receivables    != null ||
    km.inventory          != null ||
    km.goodwill           != null
  )

  return (
    <>
      <SectionBlock title="Valuation · Supabase">
        {km ? (
          <>
            <Line label="Market cap" value={km.market_cap != null ? `₹${fmtIndianMaybeCr(km.market_cap)}` : '—'} />
            <Line label="P/E (TTM)"  value={fmtNum2(km.pe_ratio)} />
            <Line label="P/B"        value={fmtNum2(km.pb_ratio)} />
            <Line label="Div yield"  value={km.dividend_yield != null ? `${Number(km.dividend_yield).toFixed(2)}%` : '—'} />
            <Line label="EPS (TTM)"  value={fmtNum2(km.eps_ttm)} />
            <Line label="Book value" value={fmtNum2(km.book_value)} />
            <Line label="D/E"        value={fmtNum2(km.de_ratio)} />
            <Line label="ROE"        value={km.roe  != null ? `${Number(km.roe).toFixed(2)}%`  : '—'} />
            <Line label="ROCE"       value={km.roce != null ? `${Number(km.roce).toFixed(2)}%` : '—'} />
          </>
        ) : <p style={muted}>No key_metrics row.</p>}
      </SectionBlock>

      {hasExtended && (
        <SectionBlock title="Cashflow & Balance Sheet · Supabase">
          <Line label="Operating cash flow" value={fmtIndianMaybeCr(km.operating_cashflow)} />
          <Line label="Free cash flow"      value={fmtIndianMaybeCr(km.free_cashflow)} />
          <Line label="Total debt"          value={fmtIndianMaybeCr(km.total_debt)} />
          <Line label="Total cash"          value={fmtIndianMaybeCr(km.total_cash)} />
          <Line label="Total assets"        value={fmtIndianMaybeCr(km.total_assets)} />
          <Line label="Net receivables"     value={fmtIndianMaybeCr(km.net_receivables)} />
          <Line label="Inventory"           value={fmtIndianMaybeCr(km.inventory)} />
          <Line label="Goodwill"            value={fmtIndianMaybeCr(km.goodwill)} />
          {km.extended_updated_at && (
            <p style={{ ...muted, marginTop: 8, fontSize: 11 }}>
              Updated {new Date(km.extended_updated_at).toLocaleString()}
            </p>
          )}
        </SectionBlock>
      )}

      <SectionBlock title="Quarterly · last 4 quarters">
        {qf.length === 0 ? (
          <p style={muted}>No quarterly_financials_yf rows.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={miniTable}>
              <thead>
                <tr>
                  <th style={th}>Quarter</th>
                  <th style={thRight}>Revenue</th>
                  <th style={thRight}>Op. income</th>
                  <th style={thRight}>Net income</th>
                  <th style={thRight}>Op. margin</th>
                </tr>
              </thead>
              <tbody>
                {qf.map((q, i) => {
                  const om = (q.revenue && q.operating_income != null)
                    ? (Number(q.operating_income) / Number(q.revenue)) * 100
                    : null
                  return (
                    <tr key={q.quarter_end || i}>
                      <td style={td}>{q.quarter_end || '—'}</td>
                      <td style={tdRight}>{fmtIndianMaybeCr(q.revenue)}</td>
                      <td style={tdRight}>{fmtIndianMaybeCr(q.operating_income)}</td>
                      <td style={tdRight}>{fmtIndianMaybeCr(q.net_income)}</td>
                      <td style={tdRight}>{om != null ? `${om.toFixed(1)}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionBlock>

      {ds && (
        <SectionBlock title="Delivery · institutional interest">
          <Line label="Delivery % today"     value={ds.delivery_pct_today != null ? `${Number(ds.delivery_pct_today).toFixed(1)}%` : '—'} />
          <Line label="Avg delivery 30d"     value={ds.avg_delivery_30d   != null ? `${Number(ds.avg_delivery_30d).toFixed(1)}%`   : '—'} />
          <Line label="Delivery signal 30d"  value={ds.delivery_signal_30d || '—'} />
          <Line label="Accumulation"         value={ds.is_accumulation ? 'Yes' : 'No'} />
          <Line label="Distribution"         value={ds.is_distribution ? 'Yes' : 'No'} />
          <Line label="High conviction"      value={ds.high_conviction  ? 'Yes' : 'No'} />
          <Line label="% from 30W MA"        value={ds.pct_from_30w     != null ? `${Number(ds.pct_from_30w).toFixed(2)}%` : '—'} />
        </SectionBlock>
      )}
    </>
  )
}

function Layer2Card({ status, fundamentals, error, notes, layer2Source }) {
  // Detect the "all nulls" Yahoo result so we can explain WHY the
  // grid is full of dashes. This happens when Yahoo's quoteSummary
  // returned an error (auth/cookie/cmd) or zero matches — the edge
  // function ships back the skeleton object with every field null
  // PLUS a notes[] array describing what failed.
  const hasAny = fundamentals && Object.entries(fundamentals).some(
    ([k, v]) => v != null && k !== 'longName' && k !== 'sector' && k !== 'industry' && k !== 'promoterPledgePct',
  )
  return (
    <SectionBlock title={`Fundamentals${layer2Source ? ` · ${layer2Source}` : ' · Yahoo Finance'}`}>
      {status === 'loading' && <p style={muted}>Fetching fundamentals…</p>}
      {status === 'error' && (
        <p style={{ ...muted, color: '#e74c3c' }}>
          fetch-stock-info failed: {error || 'unknown'}
        </p>
      )}
      {status === 'ready' && !fundamentals && (
        <p style={muted}>No data returned.</p>
      )}
      {status === 'ready' && fundamentals && !hasAny && Array.isArray(notes) && notes.length > 0 && (
        <div style={{
          padding: '10px 12px',
          background: 'rgba(231,76,60,0.08)',
          border: '1px solid rgba(231,76,60,0.25)',
          borderRadius: 8,
          marginBottom: 10,
        }}>
          <p style={{ ...muted, color: '#e74c3c', margin: 0, fontWeight: 600 }}>
            No fundamentals returned. Reasons reported by the edge function:
          </p>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {notes.map((n, i) => (
              <li key={i} style={{ ...muted, color: '#e6e6e6', fontSize: 12 }}>{n}</li>
            ))}
          </ul>
          <p style={{ ...muted, marginTop: 8, fontSize: 11 }}>
            Common cause: Yahoo's quoteSummary endpoint blocks
            unauthenticated requests since 2024. Set INDIAN_API_KEY on
            fetch-stock-info to use Robin's IndianAPI subscription instead.
          </p>
        </div>
      )}
      {status === 'ready' && fundamentals && (
        <>
          <Line label="Yahoo long name"    value={fundamentals.longName || '—'} />
          <Line label="Industry"           value={fundamentals.industry || '—'} />
          <Line label="Current price"      value={fmtRupee(fundamentals.currentPrice)} />
          <Line label="52W high · Yahoo"   value={fmtRupee(fundamentals.fiftyTwoWeekHigh)} />
          <Line label="52W low · Yahoo"    value={fmtRupee(fundamentals.fiftyTwoWeekLow)} />
          <Line label="Market cap"         value={fmtIndianMaybeCr(fundamentals.marketCap)} />
          <Line label="Trailing P/E"       value={fmtNum2(fundamentals.trailingPE)} />
          <Line label="Forward P/E"        value={fmtNum2(fundamentals.forwardPE)} />
          <Line label="Price / Book"       value={fmtNum2(fundamentals.priceToBook)} />
          <Line label="Dividend yield"     value={fundamentals.dividendYield != null ? `${(fundamentals.dividendYield * 100).toFixed(2)}%` : '—'} />
          <Line label="Revenue growth YoY" value={fmtPctFraction(fundamentals.revenueGrowth)} />
          <Line label="Earnings growth"    value={fmtPctFraction(fundamentals.earningsGrowth)} />
          <Line label="Operating margin"   value={fmtPctFraction(fundamentals.operatingMargins)} />
          <Line label="Profit margin"      value={fmtPctFraction(fundamentals.profitMargins)} />
          <Line label="Debt / Equity"      value={fmtNum2(fundamentals.debtToEquity)} />
          <Line label="ROE"                value={fmtPctFraction(fundamentals.returnOnEquity)} />
          <Line label="ROA"                value={fmtPctFraction(fundamentals.returnOnAssets)} />
          <Line label="Free cash flow"     value={fmtIndianMaybeCr(fundamentals.freeCashflow)} />
          <Line label="Operating cash flow" value={fmtIndianMaybeCr(fundamentals.operatingCashflow)} />
          <Line label="Total debt"         value={fmtIndianMaybeCr(fundamentals.totalDebt)} />
        </>
      )}
    </SectionBlock>
  )
}

function ForensicCard({ status, forensic }) {
  return (
    <SectionBlock title="Forensic · Bookkeeping Health">
      {status === 'loading' && <p style={muted}>Computing forensic flags…</p>}
      {status === 'error' && (
        <p style={muted}>Cannot compute — Yahoo fetch failed.</p>
      )}
      {status === 'ready' && !forensic && (
        <p style={muted}>No forensic data.</p>
      )}
      {status === 'ready' && forensic && (
        <>
          <ForensicLine
            flag={forensic.cash_vs_profit}
            label="Cash Flow vs Profit"
            detail={forensic.cash_ratio != null
              ? `OCF / Net Income = ${forensic.cash_ratio.toFixed(2)}× ${forensic.cash_ratio >= 1 ? '— profit backed by cash' : '— check accounting'}`
              : 'Insufficient data'}
          />
          <ForensicLine
            flag={forensic.receivables_flag}
            label="Receivables vs Revenue"
            detail={forensic.receivables_ratio != null
              ? `${(forensic.receivables_ratio * 100).toFixed(1)}% of revenue`
              : 'Insufficient data'}
          />
          <ForensicLine
            flag={forensic.debt_flag}
            label="Debt Repayment"
            detail={forensic.debt_years != null
              ? `${forensic.debt_years.toFixed(1)} years to repay at current free cash flow`
              : 'Debt with no positive free cash flow'}
          />
          <ForensicLine
            flag={forensic.inventory_flag}
            label="Inventory Health"
            detail={forensic.inventory_ratio != null
              ? `${(forensic.inventory_ratio * 100).toFixed(1)}% of revenue`
              : 'Insufficient data'}
          />
          <ForensicLine
            flag={forensic.goodwill_flag}
            label="Goodwill vs Assets"
            detail={forensic.goodwill_ratio != null
              ? `${(forensic.goodwill_ratio * 100).toFixed(1)}% of total assets`
              : 'Insufficient data'}
          />
          <ForensicLine
            flag={forensic.pledge_flag}
            label="Promoter Pledge"
            detail={forensic.promoter_pledge_pct != null
              ? `${Number(forensic.promoter_pledge_pct).toFixed(1)}% of shares pledged`
              : 'Set INDIAN_API_KEY on fetch-stock-info to enable'}
          />
          <p style={{ ...muted, marginTop: 10, fontStyle: 'italic' }}>
            {forensic.summary}
          </p>
          <p style={muted}>
            Note: {forensic.contingent_liabilities_note}
          </p>
        </>
      )}
    </SectionBlock>
  )
}

function ForensicLine({ flag, label, detail }) {
  const c = FORENSIC_COLOURS[flag] || FORENSIC_COLOURS.UNKNOWN
  return (
    <div style={forensicLine}>
      <span style={{ fontSize: 14 }}>{c.glyph}</span>
      <div style={{ minWidth: 0 }}>
        <p style={{ ...forensicLineLabel, color: c.fg }}>{label}</p>
        <p style={forensicLineDetail}>{detail}</p>
      </div>
    </div>
  )
}

const FORENSIC_COLOURS = {
  GREEN:   { glyph: '🟢', fg: '#2ecc71' },
  YELLOW:  { glyph: '🟡', fg: '#f1c40f' },
  RED:     { glyph: '🔴', fg: '#e74c3c' },
  SEVERE:  { glyph: '🚨', fg: '#e74c3c' },
  UNKNOWN: { glyph: '⚪', fg: '#888'   },
}

function SectionBlock({ title, children }) {
  return (
    <div style={sectionBlock}>
      <p style={sectionBlockTitle}>{title}</p>
      {children}
    </div>
  )
}

function Line({ label, value, accessory }) {
  return (
    <div style={kvLine}>
      <span style={kvLineLabel}>{label}</span>
      <span style={kvLineValue}>
        {value}
        {accessory}
      </span>
    </div>
  )
}

function Meta({ label, value, valueColour }) {
  return (
    <div style={metaCell}>
      <p style={metaLabel}>{label}</p>
      <p style={{ ...metaValue, color: valueColour || '#e6e6e6' }}>{value}</p>
    </div>
  )
}

// ── Stock lookup data helpers ────────────────────────────────────

async function searchStocks(q) {
  const escaped = String(q || '').replace(/[%_]/g, (m) => `\\${m}`)
  // companies.symbol / companies.name search — Supabase .or() with
  // .ilike() for case-insensitive substring match. limit 10.
  const { data: cos, error } = await supabase
    .from('companies')
    .select('id,symbol,name,sector')
    .or(`symbol.ilike.%${escaped}%,name.ilike.%${escaped}%`)
    .limit(10)
  if (error) throw error
  if (!cos || cos.length === 0) return []

  const cids = cos.map((c) => c.id)
  const { data: prices } = await supabase
    .from('price_data')
    .select(
      'company_id,close,ma30w,stage,weinstein_substage,rs_vs_nifty,vol_ratio,high_52w,low_52w',
    )
    .in('company_id', cids)
    .eq('is_latest', true)

  const byId = Object.fromEntries((prices || []).map((p) => [p.company_id, p]))
  return cos.map((c) => {
    const p = byId[c.id] || {}
    return {
      company_id: c.id,
      symbol:     c.symbol,
      name:       c.name,
      sector:     c.sector,
      close:      p.close ?? null,
      ma30w:      p.ma30w ?? null,
      stage:      p.stage ?? null,
      substage:   p.weinstein_substage ?? null,
      rs_vs_nifty: p.rs_vs_nifty ?? null,
      vol_ratio:  p.vol_ratio   ?? null,
      high_52w:   p.high_52w    ?? null,
      low_52w:    p.low_52w     ?? null,
    }
  })
}

// Fan-out Layer 1 (Supabase tables) + Layer 2 baseline (fetch-stock-info
// WITHOUT forensic) for one symbol. Forensic fetch is on-demand only —
// see enrichForensic() below. Shareholding is baseline (loaded with the
// card).
function enrichStock(row, setEnriched) {
  const sym = row.symbol
  const cid = row.company_id
  setEnriched((prev) => ({
    ...prev,
    [sym]: {
      ...(prev[sym] || {}),
      status: 'loading',
      sector: row.sector,
      name:   row.name,
      companyId: cid,
      layer1: prev[sym]?.layer1 || null,
      layer2: prev[sym]?.layer2 || null,
      forensicStatus: prev[sym]?.forensicStatus || 'idle',
      forensic:       prev[sym]?.forensic       || null,
      forensicError:  prev[sym]?.forensicError  || '',
      error:  '',
    },
  }))

  // Layer 1 — parallel Supabase reads (key_metrics, quarterly,
  // delivery, AND shareholding history).
  ;(async () => {
    let layer1 = { key_metrics: null, quarterly: [], delivery: null, shareholding: [] }
    try {
      const [kmRes, qfRes, dsRes, shRes] = await Promise.all([
        supabase.from('key_metrics').select('*').eq('symbol', sym).maybeSingle(),
        supabase.from('quarterly_financials_yf').select('*').eq('symbol', sym)
          .order('quarter_end', { ascending: false }).limit(4),
        cid
          ? supabase.from('delivery_signals').select('*').eq('company_id', cid)
              .order('date', { ascending: false }).limit(1).maybeSingle()
          : Promise.resolve({ data: null }),
        cid
          // Pull the last 16 rows so chronological client-side sort has
          // enough headroom to surface a true rolling 6-quarter window.
          // SQL .order('quarter') sorts "Sep 2025" alphabetically and
          // mangles the order; we sort properly in code below.
          ? supabase.from('shareholding')
              .select('quarter,promoter_pct,promoter_pledge_pct,fii_pct,dii_pct,public_pct,named_investors,data_source')
              .eq('company_id', cid).limit(16)
          : Promise.resolve({ data: [] }),
      ])
      // Parse "Sep 2025" / "Mar 2026" strings to a comparable
      // timestamp so the most recent quarter sits at index 0. Falls
      // through to 0 for any row whose label doesn't match — they
      // sort to the bottom rather than crashing the page.
      const sortedShareholding = (Array.isArray(shRes?.data) ? shRes.data : [])
        .slice()
        .sort((a, b) => quarterToMs(b.quarter) - quarterToMs(a.quarter))
        .slice(0, 6)

      layer1 = {
        key_metrics:  kmRes?.data || null,
        quarterly:    Array.isArray(qfRes?.data) ? qfRes.data : [],
        delivery:     dsRes?.data || null,
        shareholding: sortedShareholding,
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[IQjet Desk] Layer 1 enrich failed:', e)
    }
    setEnriched((prev) => ({
      ...prev,
      [sym]: { ...(prev[sym] || {}), layer1 },
    }))
  })()

  // Layer 2 baseline — fetch-stock-info WITHOUT forensic. Returns
  // light Yahoo fundamentals + shareholding (auto per spec).
  ;(async () => {
    try {
      const layer2 = await callStockInfoFunction(sym, {
        forensic: false, shareholding: true,
      })
      setEnriched((prev) => ({
        ...prev,
        [sym]: { ...(prev[sym] || {}), layer2, status: 'ready', error: '' },
      }))
    } catch (e) {
      setEnriched((prev) => ({
        ...prev,
        [sym]: {
          ...(prev[sym] || {}),
          status: 'error',
          error:  String(e?.message || e),
        },
      }))
    }
  })()

  // Past earnings analyses — populate Past Analyses chip row.
  ;(async () => {
    try {
      const { data } = await supabase
        .from('earnings_intelligence')
        .select('id,call_date,tone,confidence_score,verdict,summary,key_phrases,red_flags,hedging_count,evasion_count,guidance_specific,transcript_length')
        .eq('symbol', sym)
        .order('call_date', { ascending: false })
      setEnriched((prev) => ({
        ...prev,
        [sym]: { ...(prev[sym] || {}), pastAnalyses: Array.isArray(data) ? data : [] },
      }))
    } catch {
      /* table-missing or RLS-blocked — leave undefined */
    }
  })()
}

// On-demand forensic fetch — triggered by the "Run Forensic Audit"
// button in ExpandedStockCard. Calls fetch-stock-info with forensic
// flag set. Existing fundamentals stay; forensic_flags merge in.
function enrichForensic(symbol, setEnriched) {
  setEnriched((prev) => ({
    ...prev,
    [symbol]: {
      ...(prev[symbol] || {}),
      forensicStatus: 'loading',
      forensicError:  '',
    },
  }))
  ;(async () => {
    try {
      const payload = await callStockInfoFunction(symbol, {
        forensic: true, shareholding: false,
      })
      setEnriched((prev) => {
        const cur = prev[symbol] || {}
        return {
          ...prev,
          [symbol]: {
            ...cur,
            // Merge fundamentals + flags into existing layer2 so the
            // baseline card still sees them.
            layer2: {
              ...(cur.layer2 || {}),
              fundamentals:   payload.fundamentals   ?? cur.layer2?.fundamentals,
              forensic_flags: payload.forensic_flags ?? null,
              notes:          payload.notes          ?? cur.layer2?.notes,
            },
            forensic:       payload.forensic_flags || null,
            forensicStatus: 'ready',
            forensicError:  '',
          },
        }
      })
    } catch (e) {
      setEnriched((prev) => ({
        ...prev,
        [symbol]: {
          ...(prev[symbol] || {}),
          forensicStatus: 'error',
          forensicError:  String(e?.message || e),
        },
      }))
    }
  })()
}

async function callStockInfoFunction(symbol, opts = {}) {
  return postToFunction(STOCK_INFO_FUNCTION_NAME, {
    symbol,
    // forensic defaults FALSE — only set when Robin explicitly clicks
    // "Run Forensic Audit". shareholding defaults TRUE per spec
    // (the section loads automatically).
    forensic:     opts.forensic === true,
    shareholding: opts.shareholding !== false,
  })
}

async function callEarningsAnalysis({ transcript, symbol, callDate, systemPrompt }) {
  const body = await postToFunction(EDGE_FUNCTION_NAME, {
    mode: 'earnings_analysis',
    transcript, symbol, call_date: callDate, systemPrompt,
  })
  return body?.analysis || null
}

function loadWatchlist() {
  try {
    const raw = sessionStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_WATCHLIST) : []
  } catch { return [] }
}

function saveWatchlist(w) {
  try { sessionStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(w)) } catch {}
}

function loadBriefSelections() {
  try {
    const raw = sessionStorage.getItem(BRIEF_SELECTION_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveBriefSelections(b) {
  try { sessionStorage.setItem(BRIEF_SELECTION_STORAGE_KEY, JSON.stringify(b)) } catch {}
}

// Indian-rupee formatting that auto-picks Cr / L when amount is
// large enough. Below ₹1 L falls through to plain rupees. Used for
// market cap, FCF, revenue, etc. where the raw number is huge.
function fmtIndianMaybeCr(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`
  if (abs >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function fmtNum2(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

// Yahoo growth / margin fields ship as fractions (0.123 = 12.3%).
function fmtPctFraction(v) {
  if (v == null) return '—'
  const n = Number(v) * 100
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

// Plain percentage formatter — the value is already in percentage
// points (e.g. 52.3 means 52.3%). Used for shareholding splits.
// Convert a "Mon YYYY" quarter label to a comparable millisecond
// timestamp. "Sep 2025" → 2025-09-01 ms. Unparseable strings fall
// through to 0 so they sort to the bottom instead of throwing.
function quarterToMs(q) {
  if (!q) return 0
  const m = String(q).trim().match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i)
  if (!m) {
    // Fall back to anything Date can chew on (e.g. "2025-09-30").
    const t = new Date(q).valueOf()
    return Number.isFinite(t) ? t : 0
  }
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  const idx = months.indexOf(m[1].toLowerCase())
  return new Date(Number(m[2]), idx, 1).valueOf()
}

function fmtPct(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

// Excel export — SheetJS workbook with RADAR + Meta sheets. The
// xlsx module is heavy (~700 kB minified); lazy-imported here so it
// only loads when the admin actually clicks "Export to Excel".
async function exportRadarToExcel(rows, capital, snapshotDate) {
  const XLSX = await import('xlsx')

  const data = rows.map((r, i) => ({
    'Rank':              i + 1,
    'Symbol':            r.symbol,
    'Name':              r.name,
    'Sector':            r.sector,
    'Substage':          r.substage,
    'RS vs Nifty':       r.rs_vs_nifty,
    'Vol Ratio':         r.vol_ratio,
    'Close (₹)':         r.close,
    'MA 30W (₹)':        r.ma30w,
    'Stop Loss (₹)':     r.sizing.stopPrice,
    'Risk / Share (₹)':  r.sizing.riskPerShare,
    'Units':             r.sizing.units,
    'Capital Req (₹)':   r.sizing.capitalRequired,
    'Over Per-Pos Cap':  r.sizing.overCap ? 'YES' : 'no',
    'Exit Observation':  r.exit_observation,
  }))

  const sheet = XLSX.utils.json_to_sheet(data)
  // Auto-width approximation — pick column widths from the longest
  // value in each column, capped at 30 chars.
  const headers = Object.keys(data[0] || {})
  sheet['!cols'] = headers.map((h) => {
    const max = Math.max(
      String(h).length,
      ...data.map((row) => String(row[h] ?? '').length),
    )
    return { wch: Math.min(30, max + 2) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'RADAR')

  const meta = [
    { Field: 'Snapshot date',     Value: snapshotDate || '(latest)' },
    { Field: 'Generated at',      Value: new Date().toISOString() },
    { Field: 'Rows',              Value: rows.length },
    { Field: 'Capital available', Value: Number(capital.availableCapital) || 0 },
    { Field: 'Risk per trade %',  Value: Number(capital.riskPerTradePct)  || 0 },
    { Field: 'Max positions',     Value: Number(capital.maxPositions)     || 0 },
    { Field: 'Source',            Value: 'price_data + companies via /iqjet-desk' },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Meta')

  const dateTag = (snapshotDate || new Date().toISOString().slice(0, 10))
    .replace(/[^0-9-]/g, '')
  XLSX.writeFile(wb, `iqjet-radar-${dateTag}.xlsx`)
}

// ── Public broadcast panel ──────────────────────────────────────
//
// Distinct from BroadcastPanel above:
//   - BroadcastPanel sends *private* DMs (HOLD/ADD/EXIT verdicts) to
//     a list of user_ids via the iqjet-telegram function.
//   - PublicBroadcastPanel posts a *SEBI-safe observation* to the
//     t.me/pinexin channel via iqjet-telegram-send. No verdicts, no
//     recommendations — pure data + an open question.
//
// Auto-generation goes through iqjet-brief in morning_brief mode but
// carries a different system prompt (IQJET_PUBLIC_TELEGRAM_PROMPT)
// and a context describing today's market snapshot + the language.
// The model returns three variants (FACTUAL / NARRATIVE / CRYPTIC)
// in a strict JSON shape so the UI can render radio buttons without
// parsing free-form prose.

const PUBLIC_LANGUAGES = [
  { code: 'EN', label: 'English' },
  { code: 'ML', label: 'മലയാളം' },
  { code: 'HI', label: 'हिंदी' },
  { code: 'TA', label: 'தமிழ்' },
]
const PUBLIC_VARIANTS = ['FACTUAL', 'NARRATIVE', 'CRYPTIC']

function PublicBroadcastPanel({ data }) {
  const [language,  setLanguage]  = useState('EN')
  const [variants,  setVariants]  = useState({ FACTUAL: '', NARRATIVE: '', CRYPTIC: '' })
  const [picked,    setPicked]    = useState('FACTUAL')
  // The picked variant's text the admin is actively editing. When
  // they switch variants we restore each one's edited copy if any.
  const [edited,    setEdited]    = useState({ FACTUAL: '', NARRATIVE: '', CRYPTIC: '' })
  const [touched,   setTouched]   = useState({ FACTUAL: false, NARRATIVE: false, CRYPTIC: false })

  const [generating, setGenerating] = useState(false)
  const [genError,   setGenError]   = useState('')
  const [posting,    setPosting]    = useState(false)
  const [postError,  setPostError]  = useState('')
  const [postOk,     setPostOk]     = useState('')

  const message = touched[picked] ? edited[picked] : variants[picked]
  const canPost = !posting && message && message.trim().length > 0

  async function onGenerate() {
    if (generating) return
    setGenerating(true)
    setGenError('')
    setPostError(''); setPostOk('')
    try {
      const snapshot = buildPublicSnapshot(data)
      const userMessage =
        `Language: ${language}\n` +
        `Date: ${snapshot.date}\n\n` +
        'Market snapshot (today):\n```json\n' +
        JSON.stringify(snapshot, null, 2) +
        '\n```\n\n' +
        'Produce all three variants now. Output strict JSON only.'

      // Reuse the existing morning_brief mode — the system prompt is
      // what shapes the output. The frontend parses JSON itself.
      const body = await postToFunction(EDGE_FUNCTION_NAME, {
        mode: 'morning_brief',
        systemPrompt: IQJET_PUBLIC_TELEGRAM_PROMPT,
        context: { snapshot, language, user_message: userMessage },
      })
      const raw = String(body?.brief || '').trim()
      if (!raw) throw new Error('Empty response from Gemini.')
      const parsed = parseVariantJson(raw)
      if (!parsed) {
        throw new Error('Could not parse 3-variant JSON from Gemini.')
      }
      setVariants(parsed)
      setEdited(parsed)
      setTouched({ FACTUAL: false, NARRATIVE: false, CRYPTIC: false })
      if (!parsed[picked]) {
        // The picked variant came back empty for some reason — fall
        // back to the first non-empty one so the admin sees something.
        const fallback = PUBLIC_VARIANTS.find((v) => parsed[v])
        if (fallback) setPicked(fallback)
      }
    } catch (e) {
      setGenError(String(e?.message || e))
    } finally {
      setGenerating(false)
    }
  }

  async function onPost() {
    if (!canPost) return
    setPosting(true)
    setPostError('')
    setPostOk('')
    try {
      await postToFunction(TELEGRAM_FUNCTION_NAME, {
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      })
      // Audit log row in iqjet_broadcasts.
      try {
        const preview = message.length > 200 ? message.slice(0, 200) + '…' : message
        const { data: { user } } = await supabase.auth.getUser()
        await supabase.from('iqjet_broadcasts').insert({
          recipient_count: 1,
          message_preview: preview,
          user_ids:        [],
          delivery_status: [{ channel: 'tg.me/pinexin', ok: true }],
          sent_by:         user?.email || 'robin22y@gmail.com',
          channel_type:    'public',
        })
      } catch {
        // Audit log is best-effort — don't surface a logging failure
        // as a "post failed" to the admin.
      }
      setPostOk('Posted to t.me/pinexin ✓')
      window.setTimeout(() => setPostOk(''), 3000)
    } catch (e) {
      setPostError(String(e?.message || e))
    } finally {
      setPosting(false)
    }
  }

  function onEdit(text) {
    setEdited((p) => ({ ...p, [picked]: text }))
    setTouched((p) => ({ ...p, [picked]: true }))
  }

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>Public Broadcast</p>
          <p style={muted}>
            SEBI-safe observation post to the t.me/pinexin channel. No
            recommendations, no verdicts — data + an open question.
          </p>
        </div>
      </div>

      <div style={publicToolbar}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PUBLIC_LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              style={{
                ...langPill,
                background:  language === l.code ? 'rgba(46,204,113,0.16)' : 'transparent',
                borderColor: language === l.code ? '#2ecc71' : 'rgba(255,255,255,0.18)',
                color:       language === l.code ? '#2ecc71' : '#aaa',
              }}
            >
              {l.code} · {l.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || data.status !== 'ready'}
          style={{
            ...primaryBtn,
            opacity: generating || data.status !== 'ready' ? 0.6 : 1,
            cursor:  generating || data.status !== 'ready' ? 'not-allowed' : 'pointer',
          }}
        >
          {generating ? 'Generating…' : 'Auto-generate from brief'}
        </button>
      </div>

      {genError && (
        <p style={{ ...muted, color: '#e74c3c', marginTop: 8 }}>{genError}</p>
      )}

      {(variants.FACTUAL || variants.NARRATIVE || variants.CRYPTIC) && (
        <div style={publicVariantRow}>
          {PUBLIC_VARIANTS.map((v) => {
            const has = Boolean(variants[v])
            const isPicked = picked === v
            const isEdited = touched[v]
            return (
              <label
                key={v}
                style={{
                  ...variantPill,
                  borderColor: isPicked ? '#2ecc71' : 'rgba(255,255,255,0.15)',
                  opacity:     has ? 1 : 0.45,
                  cursor:      has ? 'pointer' : 'not-allowed',
                }}
              >
                <input
                  type="radio"
                  name="public-variant"
                  value={v}
                  checked={isPicked}
                  disabled={!has}
                  onChange={() => has && setPicked(v)}
                  style={{ marginRight: 8 }}
                />
                {v}
                {isEdited && <span style={{ color: '#2ecc71', marginLeft: 6 }}>· edited</span>}
              </label>
            )
          })}
        </div>
      )}

      <label style={{ display: 'block', marginTop: 12 }}>
        <p style={{ ...muted, marginBottom: 6 }}>
          Message · {message ? message.length : 0} chars · supports Telegram Markdown
        </p>
        <textarea
          value={message}
          onChange={(e) => onEdit(e.target.value)}
          rows={14}
          placeholder='Click "Auto-generate from brief" — or type a SEBI-safe observation post by hand.'
          spellCheck={false}
          style={broadcastTextarea}
        />
      </label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <button
          type="button"
          onClick={onPost}
          disabled={!canPost}
          style={{
            ...generateBtn,
            padding:  '10px 18px',
            fontSize: 13,
            opacity:  canPost ? 1 : 0.6,
            cursor:   canPost ? 'pointer' : 'not-allowed',
          }}
        >
          {posting ? 'Posting…' : 'Post to t.me/pinexin'}
        </button>
        {touched[picked] && variants[picked] && (
          <button
            type="button"
            onClick={() => setTouched((p) => ({ ...p, [picked]: false }))}
            style={ghostBtn}
          >
            Reset to generated
          </button>
        )}
        {postOk && (
          <span style={{ ...muted, color: '#2ecc71' }}>{postOk}</span>
        )}
      </div>

      {postError && (
        <p style={{ ...muted, color: '#e74c3c', marginTop: 12 }}>{postError}</p>
      )}
    </section>
  )
}

// Build a compact, public-safe snapshot of today's data. Keeps the
// payload small (cheaper Gemini call) AND keeps it observation-only —
// no SwingX names, no positions, no admin desk fields.
function buildPublicSnapshot(data) {
  const div = data?.div || {}
  const mi  = data?.mi  || {}
  return {
    date:                div.date || mi.date || new Date().toISOString().slice(0, 10),
    nifty_close:         mi.nifty_close ?? div.nifty_close ?? null,
    nifty_change_1d_pct: mi.nifty_change_1d ?? null,
    above_30wma_pct:     div.breadth_pct ?? mi.above_ma30w_pct ?? null,
    stage2_count:        mi.stage2_count ?? div.stage2_count ?? null,
    stage3_count:        mi.stage3_count ?? div.stage3_count ?? null,
    new_52w_highs:       mi.new_52w_highs ?? null,
    new_52w_lows:        mi.new_52w_lows  ?? null,
    india_vix:           mi.india_vix ?? null,
    india_vix_level:     mi.vix_level ?? null,
    ad_line_direction:   div.ad_line_direction ?? null,
    divergences_today:   Array.isArray(div.divergences_detected)
      ? div.divergences_detected.length
      : null,
  }
}

// Defensive JSON parser for Gemini's three-variant response.
// Accepts:
//   - bare JSON object
//   - ```json ... ``` fences
//   - mixed prose with embedded JSON braces
// Returns { FACTUAL, NARRATIVE, CRYPTIC } or null.
function parseVariantJson(raw) {
  const tryParse = (s) => {
    try { return JSON.parse(s) } catch { return null }
  }
  let obj = tryParse(raw)
  if (!obj) {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    obj = tryParse(stripped)
  }
  if (!obj) {
    // Extract first {...} block.
    const open = raw.indexOf('{')
    const close = raw.lastIndexOf('}')
    if (open >= 0 && close > open) {
      obj = tryParse(raw.slice(open, close + 1))
    }
  }
  if (!obj || typeof obj !== 'object') return null
  return {
    FACTUAL:   String(obj.factual   || obj.FACTUAL   || '').trim(),
    NARRATIVE: String(obj.narrative || obj.NARRATIVE || '').trim(),
    CRYPTIC:   String(obj.cryptic   || obj.CRYPTIC   || '').trim(),
  }
}

// ── Broadcast helpers ────────────────────────────────────────────

// Recipients persist as a JSON array of numeric chat_id strings.
// Older sessions had a free-form textarea string stored — when we
// detect that, parse it with parseUserIds and keep the numeric ones
// so the upgrade is invisible.
function loadRecipients() {
  try {
    const raw = sessionStorage.getItem(TELEGRAM_RECIPIENTS_STORAGE_KEY)
    if (!raw) return []
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw)
      return Array.isArray(arr)
        ? arr.filter((x) => /^-?\d+$/.test(String(x))).map(String)
        : []
    }
    return parseUserIds(raw).filter((u) => /^-?\d+$/.test(u))
  } catch { return [] }
}
function saveRecipients(list) {
  try {
    sessionStorage.setItem(TELEGRAM_RECIPIENTS_STORAGE_KEY, JSON.stringify(list))
  } catch {}
}

// Split the textarea by lines + commas, trim, dedupe. The caller does
// the numeric-format check; this returns raw tokens so the UI can
// flag invalid entries by counting valids separately.
function parseUserIds(text) {
  if (!text) return []
  const seen = new Set()
  const out = []
  for (const part of String(text).split(/[\s,;]+/)) {
    const t = part.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

// Build the broadcast pre-fill from the generated brief. Falls back
// to a compact snapshot summary when no SWINGX / TODAY'S EDGE
// sections came back. Robin can still edit before sending.
function briefToTelegramMessage(brief, sections, data) {
  if (!brief) return ''
  const date = data?.div?.date || data?.mi?.date || new Date().toISOString().slice(0, 10)
  const nse  = sections.find((s) => s.title === 'NSE MARKET')
  const swx  = sections.find((s) => s.title === 'SWINGX WATCH')
  const edge = sections.find((s) => s.title === "TODAY'S EDGE")

  const verdict   = (nse?.inline || data?.div?.verdict || '').toString().toUpperCase() || '—'
  const breadth   = data?.div?.breadth_pct ?? data?.mi?.above_ma30w_pct
  const vix       = data?.mi?.india_vix
  const vixLevel  = data?.mi?.vix_level
  const stage2    = data?.mi?.stage2_count ?? data?.div?.stage2_count
  const stage3    = data?.mi?.stage3_count ?? data?.div?.stage3_count

  const lines = []
  lines.push('*IQjet · Market Intelligence*')
  lines.push(`_${date}_`)
  lines.push('')
  lines.push(`*NSE MARKET:* ${verdict}`)
  if (breadth != null || vix != null) {
    const parts = []
    if (breadth != null) parts.push(`*Breadth:* ${Number(breadth).toFixed(0)}%`)
    if (vix     != null) parts.push(`*VIX:* ${Number(vix).toFixed(2)}${vixLevel ? ` (${vixLevel})` : ''}`)
    lines.push(parts.join(' · '))
  }
  if (stage2 != null || stage3 != null) {
    const parts = []
    if (stage2 != null) parts.push(`*Stage 2:* ${stage2}`)
    if (stage3 != null) parts.push(`*Stage 3:* ${stage3}`)
    lines.push(parts.join(' · '))
  }
  if (swx?.body) {
    lines.push('')
    lines.push('*SWINGX WATCH*')
    lines.push(swx.body)
  }
  if (edge?.body) {
    lines.push('')
    lines.push("*TODAY'S EDGE*")
    lines.push(edge.body)
  }
  lines.push('')
  lines.push('_IQjet — Private Intelligence Service_')
  lines.push('_Not financial advice_')
  return lines.join('\n')
}

function fmtBroadcastDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.valueOf())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// HTML-escape user-supplied text before splicing into a Telegram
// HTML-parse-mode message. We only need <, >, & — Telegram allows
// <b>/<i>/<a> tags so we don't strip those, but ANY raw user value
// must be escaped to avoid breaking the HTML.
function escapeHtmlForTelegram(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Build the Telegram message body. Caps at top-10 rows so the
// message stays well under Telegram's 4096-char ceiling and reads
// like a focused observation post, not a wall of text.
function formatRadarForTelegram(rows, capital, snapshotDate) {
  const date = snapshotDate || new Date().toISOString().slice(0, 10)
  const top = rows.slice(0, 10)
  const lines = [
    `🎯 <b>IQjet RADAR — ${escapeHtmlForTelegram(date)}</b>`,
    `<i>Top ${top.length} Stage 2 by RS vs Nifty · observation only</i>`,
    '',
  ]
  for (let i = 0; i < top.length; i++) {
    const r = top[i]
    const close = Number.isFinite(Number(r.close)) ? Math.round(Number(r.close)) : null
    const stop  = Number.isFinite(Number(r.sizing.stopPrice)) ? Math.round(Number(r.sizing.stopPrice)) : null
    const cap   = Number.isFinite(Number(r.sizing.capitalRequired)) ? Math.round(Number(r.sizing.capitalRequired)) : null
    lines.push(
      `${i + 1}. <b>${escapeHtmlForTelegram(r.symbol)}</b> ` +
      `(${escapeHtmlForTelegram(r.sector || '—')}) — ` +
      escapeHtmlForTelegram(r.substage || '—'),
    )
    lines.push(
      `   RS ${Number(r.rs_vs_nifty).toFixed(0)} · Vol ${Number(r.vol_ratio).toFixed(2)}×` +
      (close != null ? ` · ₹${close.toLocaleString('en-IN')}` : ''),
    )
    if (r.sizing.units > 0 && stop != null && cap != null) {
      lines.push(
        `   Stop ₹${stop.toLocaleString('en-IN')} · ${r.sizing.units} units · ₹${cap.toLocaleString('en-IN')} cap` +
        (r.sizing.overCap ? ' ⚠️' : ''),
      )
    }
    lines.push('')
  }
  lines.push(
    `<i>Capital ₹${Math.round(Number(capital.availableCapital) || 0).toLocaleString('en-IN')} · ` +
    `${Number(capital.riskPerTradePct) || 0}%/trade · max ${Number(capital.maxPositions) || 0} positions</i>`,
  )
  lines.push('')
  lines.push('<i>Not investment advice.</i>')
  return lines.join('\n')
}

// PDF text extraction via pdfjs-dist (lazy-loaded — only fetched when
// the user actually uploads a PDF, so the main bundle stays slim).
// Export the expanded stock card as a multi-page A4 PDF. Uses
// html2canvas to capture the rendered DOM (preserving all the live
// data the admin has loaded — Layer 1 + Layer 2 + shareholding +
// forensic + earnings) then jsPDF to slice the resulting image
// across pages. Both libs are lazy-imported so the main bundle
// stays slim — html2canvas is ~210 KB and jsPDF is ~360 KB.
//
// Controls marked with data-pdf-hide="true" (the Download PDF
// button itself, the "Run Forensic Audit" button, the upload form,
// etc.) are temporarily set to visibility:hidden during the capture
// so the shared PDF reads as a clean data sheet, not a screenshot
// of the admin tool.
async function exportStockCardToPdf(node, row) {
  if (!node) throw new Error('No card to capture.')
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  // Hide interactive controls and forms during capture. visibility
  // hidden keeps the layout intact (no geometry shift) but stops
  // buttons / inputs / forms from rendering in the PDF. We hide:
  //   - anything tagged with data-pdf-hide="true" (the toolbar)
  //   - every <button>, <input>, <textarea> inside the card
  // That strips out "Run Forensic Audit", "Upload .txt or .pdf",
  // "Analyse with Gemini", call-date pickers, past-analysis chips —
  // pure data sheet, no admin tooling chrome.
  const hidden = Array.from(node.querySelectorAll(
    '[data-pdf-hide="true"], button, input, textarea',
  ))
  const saved = []
  hidden.forEach((el) => {
    saved.push([el, el.style.visibility])
    el.style.visibility = 'hidden'
  })

  let canvas
  try {
    canvas = await html2canvas(node, {
      // Match the page background so the captured image doesn't have
      // ugly white margins where the card overflows its parent.
      backgroundColor: '#0b0b14',
      // 2× scale for retina-grade text quality without blowing up
      // file size too much (JPEG@0.9 stays roughly 200-400 KB).
      scale:           2,
      useCORS:         true,
      logging:         false,
      // Width/height inferred from node; height grows with content
      // so we still slice across PDF pages below.
    })
  } finally {
    // Always restore the controls — even if html2canvas threw,
    // we don't want to leave the page in a half-hidden state.
    saved.forEach(([el, vis]) => { el.style.visibility = vis })
  }

  // ── PDF assembly — slice the tall image across A4 pages ────────
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  // Project the canvas onto full page width; height scales to keep
  // the aspect ratio. We then walk `position` downward by pageH and
  // render the same image with a negative y-offset on each page —
  // that's the canonical multi-page trick with jsPDF.addImage.
  const imgRatio = canvas.height / canvas.width
  const imgW = pageW
  const imgH = pageW * imgRatio
  const imgData = canvas.toDataURL('image/jpeg', 0.9)

  let heightLeft = imgH
  let position = 0
  pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST')
  heightLeft -= pageH
  while (heightLeft > 0) {
    position -= pageH
    pdf.addPage()
    pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST')
    heightLeft -= pageH
  }

  const symbol = String(row?.symbol || 'stock').replace(/[^A-Z0-9-]/gi, '')
  const date = new Date().toISOString().slice(0, 10)
  pdf.save(`iqjet-stock-${symbol}-${date}.pdf`)
}

// PDF text extraction. Lazy-loads pdfjs-dist; points the worker at
// the matching-version CDN so we don't have to fight Vite's worker
// bundling rules. v5 dropped `.min.mjs` so we pick the right name
// based on what the loaded module exposes — `version` is on
// pdfjsLib itself.
//
// If anything in the PDF pipeline throws (encrypted file, scanned
// image-only PDF, network blocked the CDN), the caller surfaces a
// friendly "PDF extraction failed — paste text instead" message and
// the paste path stays available.
async function extractPdfText(file) {
  const pdfjsLib = await import('pdfjs-dist')
  const ver = pdfjsLib.version
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // v5 uses .mjs; v4 uses .min.mjs. Try v5 first since that's the
    // installed major; fall back if a future patch swaps names.
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.mjs`
  }
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    // Disable streaming so we don't need range requests for local files.
    disableStream: true,
    disableAutoFetch: true,
  })
  const doc = await loadingTask.promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    pages.push(tc.items.map((it) => it.str).join(' '))
  }
  const out = pages.join('\n\n').trim()
  if (!out) {
    throw new Error(
      'PDF has no embedded text — probably a scanned image. ' +
      'Paste the transcript text instead.',
    )
  }
  return out
}

// Persist a freshly computed earnings analysis. Idempotent — same
// (symbol, call_date) overwrites the prior row (unique index in the
// migration).
async function saveEarningsAnalysis({ companyId, symbol, callDate, transcriptLength, analysis }) {
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('earnings_intelligence').upsert({
    company_id:        companyId,
    symbol,
    call_date:         callDate,
    transcript_length: transcriptLength,
    tone:              analysis.tone,
    confidence_score:  analysis.confidence_score,
    hedging_count:     analysis.hedging_count,
    evasion_count:     analysis.evasion_count,
    guidance_specific: analysis.guidance_specific,
    verdict:           analysis.verdict,
    key_phrases:       analysis.key_phrases || [],
    red_flags:         analysis.red_flags   || [],
    summary:           analysis.summary,
    created_by_email:  user?.email || null,
  }, { onConflict: 'symbol,call_date' })
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

const headerStyle = { width: '100%', maxWidth: 1080, marginBottom: 18 }
const brand = { margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }
const tagline = { margin: '6px 0 0', fontSize: 13, color: '#888', maxWidth: 720, lineHeight: 1.55 }

const cardStyle = {
  width:        '100%',
  maxWidth:     1080,
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

const radarTable = {
  ...tableStyle,
  minWidth: 1100,
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
  whiteSpace:    'nowrap',
}
const thRight = { ...th, textAlign: 'right' }

const td = {
  padding:      '8px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  color:        '#ddd',
}
const tdRight = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const tdSym = { ...td, fontWeight: 600, color: '#fff' }

const subStageNow = { color: '#888', fontSize: 12 }

// Capital bar
const capitalGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
}
const capitalCell = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: 'rgba(0,0,0,0.18)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 10,
  padding: '10px 12px',
}
const capitalLabel = {
  fontSize: 10,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#888',
}
const capitalInputStyle = {
  background: '#0b0b14',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color: '#e6e6e6',
  fontSize: 16,
  fontWeight: 600,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
}

// RADAR filters
const filterBar = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 10,
  marginBottom: 6,
}
const filterCell = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  background: 'rgba(0,0,0,0.18)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 8,
  padding: '8px 10px',
}
const filterLabel = capitalLabel
const filterInputStyle = {
  background: '#0b0b14',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  color: '#e6e6e6',
  fontSize: 13,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'inherit',
}

// Allocation footer
const allocationFooter = {
  marginTop: 14,
  padding: '14px 16px',
  background: 'rgba(0,0,0,0.22)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 10,
}
const allocGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
}
const allocCell = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 8,
  padding: '10px 12px',
}

// Brief
const primaryBtn = {
  appearance:   'none',
  border:       '1px solid rgba(255,255,255,0.2)',
  background:   'rgba(255,255,255,0.08)',
  color:        '#fff',
  padding:      '10px 16px',
  fontSize:     13,
  fontWeight:   600,
  borderRadius: 8,
  cursor:       'pointer',
}

const generateBtn = {
  appearance:    'none',
  border:        '1px solid #1d8348',
  background:    'linear-gradient(180deg, #2ecc71 0%, #239d56 100%)',
  color:         '#0b1410',
  padding:       '12px 22px',
  fontSize:      14,
  fontWeight:    700,
  borderRadius:  10,
  cursor:        'pointer',
  letterSpacing: '0.02em',
  boxShadow:     '0 1px 0 rgba(255,255,255,0.18) inset, 0 4px 16px rgba(46,204,113,0.20)',
}

const ghostBtn = {
  appearance:   'none',
  border:       '1px solid rgba(255,255,255,0.18)',
  background:   'transparent',
  color:        '#e6e6e6',
  padding:      '6px 12px',
  fontSize:     12,
  fontWeight:   500,
  borderRadius: 8,
  cursor:       'pointer',
}

const briefCard = {
  marginTop:    16,
  border:       '1px solid rgba(46,204,113,0.25)',
  borderRadius: 12,
  background:   'rgba(46,204,113,0.04)',
  overflow:     'hidden',
}

const briefHead = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '12px 16px',
  borderBottom:   '1px solid rgba(255,255,255,0.06)',
  background:     'rgba(0,0,0,0.18)',
}

const briefBody = {
  padding:       '4px 16px 8px',
  display:       'flex',
  flexDirection: 'column',
}

const briefSection = {
  padding:      '12px 0',
  borderBottom: '1px dashed rgba(255,255,255,0.08)',
}

const briefSectionTitle = {
  margin:        0,
  fontSize:      12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         '#2ecc71',
  fontWeight:    700,
}

const briefSectionInline = {
  color:         '#e6e6e6',
  fontWeight:    600,
  letterSpacing: 0,
}

const briefSectionBody = {
  margin:     '6px 0 0',
  fontSize:   14,
  lineHeight: 1.6,
  color:      '#e6e6e6',
  whiteSpace: 'pre-wrap',
  wordBreak:  'break-word',
}

const muted = {
  margin:   0,
  fontSize: 13,
  color:    '#888',
}

// ── Stock lookup styles ──────────────────────────────────────────

const searchForm = {
  display: 'flex',
  gap: 8,
  marginTop: 10,
  flexWrap: 'wrap',
}

const searchInputStyle = {
  flex:         '1 1 280px',
  background:   '#0b0b14',
  border:       '1px solid rgba(255,255,255,0.18)',
  borderRadius: 8,
  color:        '#e6e6e6',
  fontSize:     14,
  padding:      '10px 14px',
  outline:      'none',
  fontFamily:   'inherit',
}

const watchlistBar = {
  display:      'flex',
  flexWrap:     'wrap',
  gap:          6,
  alignItems:   'center',
  marginBottom: 12,
  padding:      '8px 10px',
  background:   'rgba(0,0,0,0.18)',
  border:       '1px solid rgba(255,255,255,0.06)',
  borderRadius: 8,
}

const chip = {
  display:      'inline-flex',
  alignItems:   'center',
  gap:          6,
  padding:      '4px 4px 4px 10px',
  borderRadius: 999,
  background:   'rgba(255,255,255,0.06)',
  border:       '1px solid rgba(255,255,255,0.1)',
  fontSize:     12,
  color:        '#e6e6e6',
}

const chipClose = {
  appearance:    'none',
  border:        'none',
  background:    'transparent',
  color:         '#aaa',
  cursor:        'pointer',
  fontSize:      14,
  lineHeight:    1,
  padding:       '2px 6px',
  borderRadius:  999,
}

const resultCard = {
  background:   'rgba(0,0,0,0.18)',
  border:       '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  padding:      '14px 16px',
}

const resultHead = {
  display:        'flex',
  alignItems:     'flex-start',
  justifyContent: 'space-between',
  gap:            12,
  marginBottom:   10,
}

const resultSymbol = {
  margin:     0,
  fontSize:   18,
  fontWeight: 700,
  color:      '#fff',
  letterSpacing: '-0.01em',
}

const resultName = {
  margin:   '2px 0 0',
  fontSize: 13,
  color:    '#aaa',
}

const resultPrice = {
  margin:     0,
  fontSize:   17,
  fontWeight: 600,
  color:      '#fff',
  fontVariantNumeric: 'tabular-nums',
}

const resultMetaRow = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 6,
  marginTop: 6,
}

const metaCell = {
  background:   'rgba(255,255,255,0.03)',
  border:       '1px solid rgba(255,255,255,0.05)',
  borderRadius: 6,
  padding:      '6px 8px',
}

const metaLabel = {
  margin:        0,
  fontSize:      10,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color:         '#888',
}

const metaValue = {
  margin:     '2px 0 0',
  fontSize:   13,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
}

const resultActions = {
  display:    'flex',
  gap:        8,
  marginTop:  12,
  flexWrap:   'wrap',
}

const expandedBox = {
  marginTop:    14,
  padding:      '14px 14px 4px',
  background:   'rgba(46,204,113,0.04)',
  border:       '1px solid rgba(46,204,113,0.2)',
  borderRadius: 10,
}

const sectionBlock = {
  paddingTop:   12,
  paddingBottom: 10,
  borderTop:    '1px dashed rgba(255,255,255,0.08)',
}

const sectionBlockTitle = {
  margin:        '0 0 8px',
  fontSize:      11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         '#2ecc71',
  fontWeight:    700,
}

const kvLine = {
  display:        'flex',
  justifyContent: 'space-between',
  gap:            12,
  padding:        '3px 0',
  fontSize:       13,
}

const kvLineLabel = { color: '#888' }
const kvLineValue = { color: '#e6e6e6', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }

const miniTable = {
  width:          '100%',
  borderCollapse: 'collapse',
  fontSize:       12,
}

const forensicLine = {
  display:    'flex',
  gap:        10,
  alignItems: 'flex-start',
  padding:    '6px 0',
}

const forensicLineLabel = {
  margin:        0,
  fontSize:      12,
  letterSpacing: '0.04em',
  fontWeight:    700,
  textTransform: 'uppercase',
}

const forensicLineDetail = {
  margin:   '2px 0 0',
  fontSize: 12,
  color:    '#bbb',
}

// Earnings panel styles
const ghostBtnAsLabel = {
  display:      'inline-block',
  appearance:   'none',
  border:       '1px solid rgba(255,255,255,0.18)',
  background:   'transparent',
  color:        '#e6e6e6',
  padding:      '8px 14px',
  fontSize:     13,
  fontWeight:   500,
  borderRadius: 8,
  cursor:       'pointer',
  marginTop:    4,
}

const transcriptPreview = {
  marginTop:    6,
  padding:      '10px 12px',
  background:   'rgba(0,0,0,0.25)',
  border:       '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6,
  fontFamily:   'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize:     12,
  lineHeight:   1.5,
  color:        '#ccc',
  whiteSpace:   'pre-wrap',
  wordBreak:    'break-word',
  maxHeight:    120,
  overflow:     'auto',
}

const dateInputStyle = {
  background:   '#0b0b14',
  border:       '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  color:        '#e6e6e6',
  fontSize:     12,
  padding:      '5px 8px',
  fontFamily:   'inherit',
}

const earningsResult = {
  marginTop:    12,
  padding:      '12px 14px',
  background:   'rgba(46,204,113,0.04)',
  border:       '1px solid rgba(46,204,113,0.2)',
  borderRadius: 8,
}

const earningsResultTitle = {
  margin:        '0 0 8px',
  fontSize:      14,
  fontWeight:    700,
  color:         '#2ecc71',
  letterSpacing: '0.04em',
}

const earningsResultGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 6,
}

// Broadcast — Add row + chips
const recipientAddRow = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
}

const recipientAddInput = {
  flex:         '1 1 260px',
  background:   '#0b0b14',
  border:       '1px solid rgba(255,255,255,0.18)',
  borderRadius: 8,
  color:        '#e6e6e6',
  fontSize:     13,
  padding:      '10px 12px',
  outline:      'none',
  fontFamily:   'inherit',
}

const recipientChips = {
  display:    'flex',
  gap:        6,
  flexWrap:   'wrap',
  alignItems: 'center',
  marginTop:  10,
  padding:    '8px 10px',
  background: 'rgba(0,0,0,0.18)',
  border:     '1px solid rgba(255,255,255,0.06)',
  borderRadius: 8,
}

const recipientChip = {
  display:      'inline-flex',
  alignItems:   'center',
  gap:          6,
  padding:      '4px 4px 4px 10px',
  borderRadius: 999,
  background:   'rgba(46,204,113,0.10)',
  border:       '1px solid rgba(46,204,113,0.30)',
  fontSize:     12,
  color:        '#e6e6e6',
}

const recipientChipClose = {
  appearance:    'none',
  border:        'none',
  background:    'transparent',
  color:         '#aaa',
  cursor:        'pointer',
  fontSize:      14,
  lineHeight:    1,
  padding:       '2px 6px',
  borderRadius:  999,
}

// Broadcast panel
const broadcastTextarea = {
  width:      '100%',
  background: '#0b0b14',
  border:     '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:      '#e6e6e6',
  fontSize:   13,
  padding:    '10px 12px',
  outline:    'none',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  lineHeight: 1.5,
  resize:     'vertical',
  boxSizing:  'border-box',
}

const broadcastStatusBox = {
  marginTop:    14,
  padding:      '12px 14px',
  background:   'rgba(0,0,0,0.25)',
  border:       '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
}

// Public broadcast styles
const publicToolbar = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  gap:            12,
  flexWrap:       'wrap',
  marginTop:      4,
}

const langPill = {
  appearance:    'none',
  border:        '1px solid rgba(255,255,255,0.18)',
  background:    'transparent',
  color:         '#aaa',
  padding:       '6px 10px',
  fontSize:      12,
  fontWeight:    600,
  borderRadius:  999,
  cursor:        'pointer',
  letterSpacing: '0.02em',
}

const publicVariantRow = {
  display:    'flex',
  gap:        8,
  flexWrap:   'wrap',
  marginTop:  12,
}

const variantPill = {
  display:       'inline-flex',
  alignItems:    'center',
  border:        '1px solid rgba(255,255,255,0.15)',
  background:    'rgba(0,0,0,0.18)',
  color:         '#e6e6e6',
  padding:       '8px 12px',
  fontSize:      12,
  fontWeight:    600,
  borderRadius:  10,
  letterSpacing: '0.05em',
}
