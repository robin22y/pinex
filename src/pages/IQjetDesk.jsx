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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context'
import { supabase } from '../lib/supabase'
import { IQJET_ADMIN_PROMPT } from '../constants/iqjetPrompts'

const ADMIN_EMAIL = 'robin22y@gmail.com'
const EDGE_FUNCTION_NAME = 'iqjet-brief'
const STOCK_INFO_FUNCTION_NAME = 'fetch-stock-info'

const WATCHLIST_STORAGE_KEY       = 'iqjet_desk_watchlist_v1'
const BRIEF_SELECTION_STORAGE_KEY = 'iqjet_desk_brief_selection_v1'
const MAX_WATCHLIST = 10

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
    </main>
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
  minRs, onMinRs, minVol, onMinVol, allocation,
}) {
  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>RADAR · Top Accumulation — Stage 2</p>
          <p style={muted}>Stocks showing cycle strength and volume confirmation.</p>
        </div>
      </div>

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
      fundamentals:   e.layer2?.fundamentals    || null,
      forensic_flags: e.layer2?.forensic_flags  || null,
      notes:          e.layer2?.notes           || null,
    })
  }
  return out
}

// ── Edge function call ───────────────────────────────────────────

async function callEdgeFunction(context, systemPrompt) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('Supabase URL / anon key not configured for this build.')
  }

  // The user's JWT proves identity to the function. The function
  // additionally re-checks the admin email, so a leaked token from
  // another user still cannot generate briefs.
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes?.session?.access_token
  if (!token) throw new Error('You are not signed in.')

  let res
  try {
    res = await fetch(`${url}/functions/v1/${EDGE_FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ context, systemPrompt }),
    })
  } catch {
    throw new Error('Could not reach iqjet-brief Edge Function.')
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = body?.error || JSON.stringify(body)
    } catch {}
    if (res.status === 401) throw new Error('Sign-in expired. Refresh the page.')
    if (res.status === 403) throw new Error('This account is not the admin.')
    if (res.status === 429) throw new Error('Gemini quota reached. Try again later.')
    throw new Error(detail)
  }
  const body = await res.json()
  const text = (body?.brief || '').trim()
  if (!text) throw new Error('Edge function returned no brief text.')
  return text
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
}) {
  const briefSet = useMemo(() => new Set(briefSelections), [briefSelections])
  const watchSet = useMemo(() => new Set(watchlist.map((w) => w.symbol)), [watchlist])

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <p style={eyebrow}>Stock Lookup · Research</p>
          <p style={muted}>
            Search NSE symbol or company name. Click a result to fetch
            fundamentals + bookkeeping-health flags via fetch-stock-info.
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

      {isOpen && <ExpandedStockCard row={row} capital={capital} enriched={enriched} />}
    </div>
  )
}

function ExpandedStockCard({ row, capital, enriched }) {
  const status = enriched?.status || 'idle'
  const layer1 = enriched?.layer1 || null
  const layer2 = enriched?.layer2 || null
  const fundamentals = layer2?.fundamentals || null
  const forensic     = layer2?.forensic_flags || null

  const sizing = computeSizing({
    close: row.close, ma30w: row.ma30w, substage: row.substage,
  }, capital)

  return (
    <div style={expandedBox}>
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

      <Layer2Card status={status} fundamentals={fundamentals} error={enriched?.error} />
      <ForensicCard status={status} forensic={forensic} />
    </div>
  )
}

function Layer1Card({ layer1 }) {
  const km = layer1.key_metrics || null
  const qf = layer1.quarterly  || []
  const ds = layer1.delivery   || null

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

function Layer2Card({ status, fundamentals, error }) {
  return (
    <SectionBlock title="Fundamentals · Yahoo Finance">
      {status === 'loading' && <p style={muted}>Fetching Yahoo data…</p>}
      {status === 'error' && (
        <p style={{ ...muted, color: '#e74c3c' }}>
          fetch-stock-info failed: {error || 'unknown'}
        </p>
      )}
      {status === 'ready' && !fundamentals && (
        <p style={muted}>No data returned.</p>
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

function Line({ label, value }) {
  return (
    <div style={kvLine}>
      <span style={kvLineLabel}>{label}</span>
      <span style={kvLineValue}>{value}</span>
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

// Fan-out Layer 1 (key_metrics, quarterly, delivery) + Layer 2
// (fetch-stock-info edge function) for one symbol. Writes phase
// updates to the enriched map as data arrives so the UI doesn't
// block on the slowest read.
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
      error:  '',
    },
  }))

  // Layer 1 — parallel Supabase reads.
  ;(async () => {
    let layer1 = { key_metrics: null, quarterly: [], delivery: null }
    try {
      const [kmRes, qfRes, dsRes] = await Promise.all([
        supabase.from('key_metrics').select('*').eq('symbol', sym).maybeSingle(),
        supabase.from('quarterly_financials_yf').select('*').eq('symbol', sym)
          .order('quarter_end', { ascending: false }).limit(4),
        cid
          ? supabase.from('delivery_signals').select('*').eq('company_id', cid)
              .order('date', { ascending: false }).limit(1).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      layer1 = {
        key_metrics: kmRes?.data || null,
        quarterly:   Array.isArray(qfRes?.data) ? qfRes.data : [],
        delivery:    dsRes?.data || null,
      }
    } catch (e) {
      // Layer 1 failure doesn't abort enrichment — Layer 2 may still succeed.
      // eslint-disable-next-line no-console
      console.warn('[IQjet Desk] Layer 1 enrich failed:', e)
    }
    setEnriched((prev) => ({
      ...prev,
      [sym]: { ...(prev[sym] || {}), layer1 },
    }))
  })()

  // Layer 2 — fetch-stock-info edge function (Yahoo + forensic).
  ;(async () => {
    try {
      const layer2 = await callStockInfoFunction(sym)
      setEnriched((prev) => ({
        ...prev,
        [sym]: {
          ...(prev[sym] || {}),
          layer2,
          status: 'ready',
          error: '',
        },
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
}

async function callStockInfoFunction(symbol) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Supabase not configured.')

  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes?.session?.access_token
  if (!token) throw new Error('You are not signed in.')

  const res = await fetch(`${url}/functions/v1/${STOCK_INFO_FUNCTION_NAME}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ symbol }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      msg = body?.error || msg
    } catch {}
    throw new Error(msg)
  }
  return res.json()
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
