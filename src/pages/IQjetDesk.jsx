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

// SwingX substages we hunt for stage-2 accumulation. Same set as
// the RADAR query filter — kept in one constant so the dropdown
// labels in the table match the data.
const RADAR_SUBSTAGES = ['2A', '2A+', '2B', '2B+']

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

  // RADAR state — filters + fetched rows
  const [minRs,       setMinRs]       = useState(1.0)
  const [minVol,      setMinVol]      = useState(1.5)
  const [sectorFilter, setSectorFilter] = useState('ALL')
  const [radar, setRadar] = useState({ status: 'loading', rows: [] })

  // Brief generation
  const [busy, setBusy]      = useState(false)
  const [brief, setBrief]    = useState('')
  const [briefAt, setBriefAt] = useState(null)
  const [error, setError]    = useState('')
  const [copied, setCopied]  = useState(false)

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

  // ── RADAR load — refetches when min thresholds change ──────────
  //
  // The query the user asked for referenced swing_conditions.stage /
  // .substage / .rs_score / .volume_ratio — none of which exist on
  // that table. Those columns all live on price_data instead, so the
  // real query joins price_data → companies. See the schema audit in
  // scripts/sql/add_price_data_*.sql.
  useEffect(() => {
    let cancelled = false
    setRadar({ status: 'loading', rows: [] })
    ;(async () => {
      try {
        // Two-query join — Supabase's embedded select would also
        // work (price_data has a FK to companies.id), but a plain
        // .in() against the resolved company_ids is more obviously
        // correct and survives FK name drift.
        const { data: priceRows, error: priceErr } = await supabase
          .from('price_data')
          .select(
            'company_id,close,ma30w,stage,weinstein_substage,rs_vs_nifty,vol_ratio',
          )
          .eq('is_latest', true)
          .eq('stage', 'Stage 2')
          .in('weinstein_substage', RADAR_SUBSTAGES)
          .gt('rs_vs_nifty', Number(minRs))
          .gt('vol_ratio',   Number(minVol))
          .order('rs_vs_nifty', { ascending: false })
          .order('vol_ratio',   { ascending: false })
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
  }, [minRs, minVol])

  // Sectors offered in the dropdown — derived from the current RADAR
  // result so we never show a sector that has no qualifying rows.
  const sectorOptions = useMemo(() => {
    const set = new Set()
    for (const r of radar.rows) if (r.sector) set.add(r.sector)
    return ['ALL', ...[...set].sort()]
  }, [radar.rows])

  // Filtered + sized rows the table renders. Sizing depends on capital
  // settings so the recompute is cheap memoisation, not another fetch.
  const sizedRows = useMemo(() => {
    const filtered = sectorFilter === 'ALL'
      ? radar.rows
      : radar.rows.filter((r) => r.sector === sectorFilter)
    return filtered.map((r) => ({
      ...r,
      sizing: computeSizing(r, capital),
      exit_observation: EXIT_OBSERVATIONS[r.substage] || 'Watch substage carefully',
    }))
  }, [radar.rows, sectorFilter, capital])

  // Portfolio allocation across the visible rows.
  const allocation = useMemo(() => summarise(sizedRows, capital), [sizedRows, capital])

  // Brief generator — POSTs to the edge function (no Gemini key in browser).
  const generate = useCallback(async () => {
    if (data.status !== 'ready' || busy) return
    setBusy(true)
    setError('')
    setBrief('')
    try {
      const context = buildContext({ data, capital, radarRows: sizedRows })
      const text = await callEdgeFunction(context, IQJET_ADMIN_PROMPT)
      setBrief(text || '')
      setBriefAt(new Date())
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }, [data, capital, sizedRows, busy])

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

function buildContext({ data, capital, radarRows }) {
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
  }
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
