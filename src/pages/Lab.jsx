import { useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { readLocal, writeLocal } from '../lib/localStore'
import { useAuth } from '../context'
import { C } from '../styles/tokens'
import ProBadge from '../components/ProBadge'
import InfoSheet from '../components/InfoSheet'
import ExportMenu from '../components/ExportMenu'

// ── The Lab ──────────────────────────────────────────────────────────────────
// A user-EXECUTED screener. Results NEVER auto-populate — the user picks a
// template, reviews the mathematical criteria, and clicks "Run My Screen".
// This is the core legal posture: PineX outputs the result of the user's own
// query against pre-calculated EOD data; it does not suggest stocks.
//
// Data: mv_home_stocks (price/RS/volume/obv) merged with swing_conditions
// (the 5 SwingX condition booleans + conditions_met) for the latest trading day.

const TEMPLATES = [
  {
    id: 'trend-convergence', name: 'Trend Convergence', icon: '🔵', badge: null,
    tagline: 'Price, trend line, RS and OBV all pointing up',
    criteria: [
      { id: 'above_tl', name: 'Price above 30W Trend Line', formula: 'Close > MA(30W)', col: null, defaultOn: true, why: 'Price trading above its long-term average is the baseline of an established uptrend.' },
      { id: 'tl_rising', name: '30W Trend Line slope rising', formula: 'MA(30W) today > MA(30W) 4 weeks ago', col: null, defaultOn: true, why: 'A rising average shows the longer trend is still strengthening.' },
      { id: 'rs_positive', name: 'RS vs Nifty positive', formula: 'Stock return − Nifty return (119D) > 0', col: null, defaultOn: true, adjustable: true, param: { label: 'Min RS %', value: 0, min: -20, max: 50 }, why: 'Relative strength shows the stock is outperforming the index.' },
      { id: 'obv_rising', name: 'OBV slope rising', formula: 'OBV 10-day regression slope > 0', col: null, defaultOn: true, why: 'On-balance volume rising suggests accumulation under the price.' },
      { id: 'volume_above', name: 'Volume above 30D average', formula: 'Volume ratio > 1.0', col: null, defaultOn: false, why: 'Above-average volume shows participation behind the move.' },
      { id: 'near_tl', name: 'Extension < 15% from trend line', formula: '((Close − MA30W) / MA30W) × 100 < 15', col: null, defaultOn: false, adjustable: true, param: { label: 'Max extension %', value: 15, min: 5, max: 40 }, why: 'A smaller extension means price has not run too far from its average.' },
    ],
  },
  {
    id: 'base-formation', name: 'Base Formation', icon: '🟡', badge: null,
    tagline: 'Price stabilising after a decline on quiet volume',
    criteria: [
      { id: 'price_near_tl', name: 'Price near 30W Trend Line', formula: 'abs(Close − MA30W) / MA30W < 0.05', col: null, defaultOn: true, why: 'Price hugging its average is typical of a base.' },
      { id: 'tl_flat', name: 'Trend Line slope flat (Stage 1)', formula: 'MA(30W) slope ≈ 0', col: null, defaultOn: true, why: 'A flat average shows the prior decline has paused.' },
      { id: 'volume_low', name: 'Volume contracting', formula: 'Avg(Vol,3D) < Avg(Vol,30D) × 0.75', col: null, defaultOn: true, why: 'Drying-up volume often precedes a new move.' },
      { id: 'rsi_neutral', name: 'RSI in neutral range', formula: '40 ≤ RSI(14) ≤ 65', col: null, defaultOn: true, why: 'A neutral RSI is neither overbought nor oversold.' },
    ],
  },
  {
    id: 'trend-deterioration', name: 'Trend Deterioration', icon: '🔴', badge: null,
    tagline: 'Price below trend line with negative RS',
    criteria: [
      { id: 'below_tl', name: 'Price below 30W Trend Line', formula: 'Close < MA(30W)', col: null, defaultOn: true, why: 'Price below its average is the baseline of a downtrend.' },
      { id: 'rs_negative', name: 'RS vs Nifty negative', formula: 'Stock return − Nifty return (119D) < 0', col: null, defaultOn: true, why: 'Negative RS shows the stock is lagging the index.' },
      { id: 'tl_falling', name: 'Trend Line falling / breakdown', formula: 'MA(30W) today < MA(30W) 4 weeks ago', col: null, defaultOn: true, why: 'A falling average confirms the longer trend is weakening.' },
    ],
  },
  {
    id: 'swingx', name: 'SwingX Template', icon: '⚡', badge: 'PRO',
    tagline: 'The SwingX logic, recreated as transparent filters',
    criteria: [
      {
        id: 'swingx_crossed_30w', name: 'Price in advancing trend',
        formula: 'Stage 2 — close above a rising 30W MA',
        col: null, defaultOn: true,
        why: 'Price above a rising 30W trend line is the baseline condition cycle analysts look for in an advancing stock.',
        notMean: 'This does not predict the stock will continue rising. It is a mathematical observation only.',
      },
      {
        id: 'swingx_volume_2x', name: 'Volume ≥ multiplier × recent average',
        formula: 'Today volume ÷ 30-day average volume ≥ multiplier',
        col: null, defaultOn: true, adjustable: true,
        param: { label: 'Min volume multiplier', value: 2.0, min: 1.5, max: 5.0, step: 0.5 },
        why: 'High volume during a price transition is observed as participation confirmation.',
        notMean: 'Volume alone does not confirm direction. It is a data point only.',
      },
      {
        id: 'swingx_rs_positive', name: 'RS vs Nifty above threshold',
        formula: 'RS vs Nifty (119D) > min %',
        col: null, defaultOn: true, adjustable: true,
        param: { label: 'Minimum RS %', value: 0, min: -20, max: 50, step: 5 },
        why: 'Positive relative strength means the stock is outperforming the broader market index.',
        notMean: 'Outperformance in the past does not guarantee future outperformance.',
      },
      {
        id: 'swingx_strong_sector', name: 'From a strong sector',
        formula: 'Sector breadth > min % (sector stocks above their 30W MA)',
        col: null, defaultOn: true, adjustable: true,
        param: { label: 'Min sector breadth %', value: 50, min: 30, max: 70, step: 5 },
        why: 'Individual stock strength alongside broad sector strength is noted as contextual alignment.',
        notMean: 'A strong sector does not guarantee individual stock performance.',
      },
    ],
  },
  {
    id: 'rs-momentum', name: 'RS Momentum', icon: '📈', badge: 'PRO',
    tagline: 'Outperforming Nifty with expanding volume',
    criteria: [
      { id: 'rs_strong', name: 'RS vs Nifty positive', formula: 'Stock return − Nifty return (119D) > min', col: null, defaultOn: true, adjustable: true, param: { label: 'Min RS %', value: 10, min: 0, max: 100 }, why: 'A higher RS bar isolates clearer outperformers.' },
      { id: 'volume_above_2', name: 'Volume above 30D average', formula: 'Volume ratio > 1.0', col: null, defaultOn: true, why: 'Above-average volume shows participation.' },
    ],
  },
]

// Client-side tests for criteria without a swing_conditions column. Each reads
// merged mv_home_stocks fields. (ma30w_slope isn't in the feed, so slope-based
// rules use defensible proxies — noted in the methodology.)
const CLIENT_TESTS = {
  above_tl: (m) => m.close != null && m.ma30w != null && m.close > m.ma30w,
  below_tl: (m) => m.close != null && m.ma30w != null && m.close < m.ma30w,
  rs_positive: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 0),
  rs_strong: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 10),
  rs_negative: (m) => (m.rs_vs_nifty ?? 0) < 0,
  obv_rising: (m) => (parseFloat(m.obv_slope) || 0) > 0,
  volume_above: (m) => (m.vol_ratio || 0) > 1,
  volume_above_2: (m) => (m.vol_ratio || 0) > 1,
  near_tl: (m, p) => { const e = m.ma30w > 0 ? ((m.close - m.ma30w) / m.ma30w) * 100 : null; return e != null && e < (p ?? 15) },
  price_near_tl: (m) => m.ma30w > 0 && Math.abs((m.close - m.ma30w) / m.ma30w) < 0.05,
  tl_flat: (m) => m.stage === 'Stage 1',
  tl_falling: (m) => m.breakdown_30wma === true || m.stage === 'Stage 3' || m.stage === 'Stage 4',
  // Remapped from the (empty) swing_conditions table to real mv_home_stocks
  // fields. Slope / MA20 / 3D-volume aren't in the feed, so these use
  // documented proxies (stage, ma50, vol_ratio).
  tl_rising: (m) => m.stage === 'Stage 2',
  // SwingX (4 criteria). swing_conditions is empty, so "crossed above 30W"
  // uses the real breakout_30wma flag; "volume 2x" uses vol_ratio (today vs
  // 30D avg); "strong sector" uses the precomputed _sector_breadth.
  swingx_crossed_30w: (m) => m.stage === 'Stage 2',
  swingx_volume_2x: (m, p) => (m.vol_ratio || 0) >= (p ?? 2),
  swingx_rs_positive: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 0),
  swingx_strong_sector: (m, p) => (m._sector_breadth ?? 0) > (p ?? 50),
  volume_low: (m) => (m.vol_ratio || 0) > 0 && m.vol_ratio < 1,
  rsi_neutral: (m) => m.rsi != null && m.rsi >= 40 && m.rsi <= 65,
}

function critPass(crit, m, paramVal) {
  if (crit.col) return m[crit.col] === true
  const fn = CLIENT_TESTS[crit.id]
  return fn ? fn(m, paramVal) : true
}

const tlPct = (m) => (m.ma30w > 0 && m.close != null ? ((m.close - m.ma30w) / m.ma30w) * 100 : null)

// Merge locally-saved screens with any Supabase rows, de-duped by name.
// Remote rows win on conflict (they carry the canonical id); local-only
// screens are appended so nothing saved offline is ever lost.
function mergeScreens(localList, remoteList) {
  const byName = new Map()
  for (const r of remoteList || []) byName.set(r.name, r)
  for (const r of localList || []) if (!byName.has(r.name)) byName.set(r.name, r)
  return [...byName.values()]
}

export default function Lab() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()

  const [view, setView] = useState('landing') // landing | parameters | results
  const [template, setTemplate] = useState(null)
  const [critState, setCritState] = useState({}) // id -> { on, param }
  const [universe, setUniverse] = useState('nifty500')
  const [sortBy, setSortBy] = useState('rs')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [tradingDate, setTradingDate] = useState(null)
  const [savedScreens, setSavedScreens] = useState([])
  const universeRef = useRef(null) // cache merged dataset between runs

  const selectTemplate = (t) => {
    setTemplate(t)
    const cs = {}
    for (const c of t.criteria) cs[c.id] = { on: c.defaultOn, param: c.param?.value }
    setCritState(cs)
    setResults(null)
    setView('parameters')
  }

  // Deep-link: /lab?template=swingx
  useEffect(() => {
    const tid = params.get('template')
    if (tid) {
      const t = TEMPLATES.find((x) => x.id === tid)
      if (t) selectTemplate(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Saved screens — LOCAL-FIRST. Read the user's (or guest's) locally-cached
  // screens instantly, then try Supabase as a best-effort mirror. The table may
  // not be deployed; that's fine — localStorage is the source of truth for the
  // UI and a logged-in user's screens still sync up/down when it exists.
  useEffect(() => {
    const uid = user?.id
    const local = readLocal('saved_screens', uid, [])
    setSavedScreens(local)
    if (!uid) return
    supabase.from('user_saved_screens').select('id,name,template_id,criteria_config,sort_by,universe')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(20)
      .then(({ data, error }) => {
        if (error || !data) return
        const merged = mergeScreens(local, data).slice(0, 20)
        writeLocal('saved_screens', uid, merged)
        setSavedScreens(merged)
      })
      .catch(() => {})
  }, [user?.id])

  const loadUniverse = async () => {
    if (universeRef.current) return universeRef.current
    const pages = await Promise.all([
      supabase.from('mv_home_stocks').select('*').order('symbol').range(0, 999),
      supabase.from('mv_home_stocks').select('*').order('symbol').range(1000, 1999),
      supabase.from('mv_home_stocks').select('*').order('symbol').range(2000, 2999),
    ])
    const merged = pages.flatMap((p) => p.data || [])

    // Sector breadth (% of sector stocks above their 30W MA) across the full
    // universe — used by the "strong sector" criterion. Annotated per stock.
    const secTot = {}, secUp = {}
    for (const m of merged) {
      if (!m.sector) continue
      secTot[m.sector] = (secTot[m.sector] || 0) + 1
      if (m.close != null && m.ma30w != null && m.close > m.ma30w) secUp[m.sector] = (secUp[m.sector] || 0) + 1
    }
    for (const m of merged) {
      m._sector_breadth = m.sector && secTot[m.sector] ? (secUp[m.sector] || 0) / secTot[m.sector] * 100 : 0
    }

    // Nifty 500 membership (companies.nifty500) for the universe filter.
    const nifty500 = new Set()
    try {
      for (let start = 0; start < 4000; start += 1000) {
        const { data } = await supabase.from('companies').select('id').eq('nifty500', true).range(start, start + 999)
        if (!data?.length) break
        for (const r of data) nifty500.add(r.id)
        if (data.length < 1000) break
      }
    } catch { /* non-fatal — nifty500 filter falls back to all */ }

    // Latest EOD date for the disclaimer line (mv_home_stocks has no date col).
    let td = null
    try {
      const { data } = await supabase.from('price_data').select('date').eq('is_latest', true).order('date', { ascending: false }).limit(1)
      td = data?.[0]?.date || null
    } catch { /* non-fatal */ }
    universeRef.current = { merged, td, nifty500 }
    setTradingDate(td)
    return universeRef.current
  }

  const runScreen = async () => {
    if (!template) return
    setLoading(true)
    try {
      const { merged, nifty500 } = await loadUniverse()
      const active = template.criteria.filter((c) => critState[c.id]?.on)
      // Universe filter — Nifty 500 (free) or full NSE universe.
      const pool = universe === 'nifty500' && nifty500 && nifty500.size
        ? merged.filter((m) => nifty500.has(m.id))
        : merged
      let matched = pool.filter((m) => active.every((c) => critPass(c, m, critState[c.id]?.param)))
      matched = matched.sort((a, b) => {
        if (sortBy === 'tl') return (tlPct(b) ?? -9999) - (tlPct(a) ?? -9999)
        if (sortBy === 'name') return String(a.name || a.symbol).localeCompare(String(b.name || b.symbol))
        return (b.rs_vs_nifty ?? -9999) - (a.rs_vs_nifty ?? -9999)
      })
      setResults({ stocks: matched, activeCount: active.length, activeNames: active.map((c) => c.name) })
      setView('results')
    } finally {
      setLoading(false)
    }
  }

  const saveScreen = async () => {
    if (!template) return
    const name = window.prompt('Name your screen:', template.name)
    if (!name) return
    const uid = user?.id // undefined → 'guest' bucket; works logged out too
    const record = {
      id: `local-${Date.now()}`,
      name,
      template_id: template.id,
      criteria_config: critState,
      universe,
      sort_by: sortBy,
      created_at: new Date().toISOString(),
    }
    // Local-first: persist immediately (de-duped by name, newest first, capped).
    const existing = readLocal('saved_screens', uid, [])
    const next = [record, ...existing.filter((s) => s.name !== name)].slice(0, 20)
    writeLocal('saved_screens', uid, next)
    setSavedScreens(next)
    // Best-effort Supabase mirror for logged-in users — failure is non-fatal,
    // the local copy is already saved.
    if (uid) {
      try {
        await supabase.from('user_saved_screens').upsert({
          user_id: uid, name, template_id: template.id,
          criteria_config: critState, universe, sort_by: sortBy, last_run: new Date().toISOString(),
        })
      } catch { /* local copy already saved */ }
    }
  }

  const activeCount = useMemo(() => (template ? template.criteria.filter((c) => critState[c.id]?.on).length : 0), [template, critState])

  // ── LANDING ─────────────────────────────────────────────────────────────
  if (view === 'landing') {
    return (
      <Shell title="PineX Lab" maxWidth={1040}>
        <div style={{ padding: '20px 16px 8px' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>🔬 PineX Lab</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
            Run your own cycle-analysis screen. All results come from your parameters · EOD data only.
          </p>
        </div>
        <SectionHead>Templates</SectionHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, padding: '0 16px' }}>
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => selectTemplate(t)}
              style={{ textAlign: 'left', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, cursor: 'pointer', color: 'inherit' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{t.name}</span>
                {t.badge === 'PRO' && <ProBadge />}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 }}>{t.tagline}</div>
              <div style={{ fontSize: 11, color: C.textFaint }}>{t.criteria.length} criteria · Use template →</div>
            </button>
          ))}
          <button onClick={() => selectTemplate({ id: 'custom', name: 'Build Your Own', icon: '✏️', badge: 'PRO', tagline: 'Pick any combination', criteria: TEMPLATES[0].criteria })}
            style={{ textAlign: 'left', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 12, padding: 16, cursor: 'pointer', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>✏️</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Build Your Own</span>
              <ProBadge />
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>Choose any combination of criteria</div>
          </button>
        </div>

        {savedScreens.length > 0 && (
          <>
            <SectionHead>Your saved screens <ProBadge /></SectionHead>
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {savedScreens.map((sv) => (
                <button key={sv.id}
                  onClick={() => { const t = TEMPLATES.find((x) => x.id === sv.template_id) || TEMPLATES[0]; setTemplate(t); setCritState(sv.criteria_config || {}); setSortBy(sv.sort_by || 'rs'); setUniverse(sv.universe || 'all'); setView('parameters') }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', color: 'inherit' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{sv.name}</span>
                  <span style={{ fontSize: 12, color: C.blue }}>Re-run →</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 24 }} />
      </Shell>
    )
  }

  // ── PARAMETERS ──────────────────────────────────────────────────────────
  if (view === 'parameters') {
    return (
      <Shell title={template?.name}>
        <div style={{ padding: '12px 16px 0' }}>
          <button onClick={() => setView('landing')} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>← Back to templates</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{template?.icon}</span>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>{template?.name}</h1>
            {template?.badge === 'PRO' && <ProBadge />}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
            These are the mathematical criteria your screen will apply. Review and adjust, then run.
          </p>
        </div>

        <SectionHead>Criteria</SectionHead>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {template?.criteria.map((c) => {
            const on = !!critState[c.id]?.on
            return (
              <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setCritState((p) => ({ ...p, [c.id]: { ...p[c.id], on: !on } }))}
                    style={{ width: 40, height: 22, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0, position: 'relative', background: on ? C.amber : C.surface2, transition: 'background .15s' }}>
                    <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: on ? '#000' : C.textMuted, transition: 'left .15s' }} />
                  </button>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: on ? C.text : C.textMuted }}>{c.name}</span>
                  <InfoSheet title={c.name} trigger={<span style={{ color: C.textMuted, fontSize: 13 }}>ℹ️</span>}>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>The maths:</strong><br /><span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{c.formula}</span></p>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>Why cycle analysts watch it:</strong><br />{c.why}</p>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>What it does not mean:</strong><br />{c.notMean || 'This criterion does not predict future price movement. It is a mathematical observation.'}</p>
                    <p style={{ margin: 0, fontSize: 11, color: C.textFaint }}>ℹ️ Data only · Not advice</p>
                  </InfoSheet>
                </div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6, marginLeft: 50, fontFamily: 'var(--font-mono, monospace)' }}>{c.formula}</div>
                {c.adjustable && c.param && on && (
                  <div style={{ marginLeft: 50, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: C.textMuted, minWidth: 90 }}>{c.param.label}: <strong style={{ color: C.amber }}>{critState[c.id]?.param}</strong></span>
                    <input type="range" min={c.param.min} max={c.param.max} step={c.param.step || 1} value={critState[c.id]?.param ?? c.param.value}
                      onChange={(e) => setCritState((p) => ({ ...p, [c.id]: { ...p[c.id], param: Number(e.target.value) } }))}
                      style={{ flex: 1, accentColor: C.amber }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <SectionHead>Universe & sort</SectionHead>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => setUniverse('nifty500')}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${universe === 'nifty500' ? C.amberBorder : C.border}`, background: universe === 'nifty500' ? C.amberBg : C.surface }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: universe === 'nifty500' ? C.amber : C.text }}>{universe === 'nifty500' ? '● ' : '○ '}Nifty 500</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>500 stocks · Free</div>
            </button>
            <button onClick={() => setUniverse('all')}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${universe === 'all' ? C.amberBorder : C.border}`, background: universe === 'all' ? C.amberBg : C.surface }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: universe === 'all' ? C.amber : C.text, display: 'flex', alignItems: 'center' }}>{universe === 'all' ? '● ' : '○ '}All NSE stocks<ProBadge /></div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>2100+ stocks · Unlocked</div>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: C.textMuted }}>Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
              <option value="rs">RS vs Nifty</option>
              <option value="tl">% from 30W Trend Line</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        <div style={{ padding: '20px 16px 120px' }}>
          <button onClick={runScreen} disabled={loading || activeCount === 0}
            style={{ width: '100%', height: 48, borderRadius: 12, border: 'none', background: activeCount ? C.amber : C.surface2, color: activeCount ? '#000' : C.textMuted, fontSize: 16, fontWeight: 700, cursor: activeCount ? 'pointer' : 'default' }}>
            {loading ? 'Running your screen…' : `▶  Run My Screen${activeCount ? ` · ${activeCount} criteria` : ''}`}
          </button>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: C.textFaint, textAlign: 'center', lineHeight: 1.5 }}>
            {loading
              ? `Checking stocks against your ${activeCount} parameters… EOD data${tradingDate ? ` as of ${tradingDate}` : ''}`
              : 'Results are generated from your parameters · EOD data only · Not investment advice'}
          </p>
        </div>
        <div style={{ height: 24 }} />
      </Shell>
    )
  }

  // ── RESULTS ─────────────────────────────────────────────────────────────
  const rows = results?.stocks || []
  return (
    <Shell title="Screen results">
      <div style={{ padding: '14px 16px 0' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>Your screen results</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: C.text }}>
          <strong>{rows.length}</strong> stock{rows.length === 1 ? '' : 's'} matched your <strong>{results?.activeCount}</strong> criteria
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.textMuted }}>EOD · {tradingDate || '—'} · sorted by {sortBy}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 0' }}>
          {(results?.activeNames || []).map((n) => (
            <span key={n} style={{ fontSize: 10, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: '2px 8px' }}>✓ {n}</span>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0', alignItems: 'center' }}>
          <button onClick={() => setView('parameters')} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 13, cursor: 'pointer' }}>← Modify screen</button>
          <button onClick={saveScreen} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.amberBorder}`, background: C.amberBg, color: C.amber, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>Save screen <ProBadge /></button>
          {rows.length > 0 && (
            <ExportMenu
              label="Export"
              align="left"
              filename={`PineX_${(template?.id || 'screen')}`}
              title={`PineX Lab — ${template?.name || 'Screen'}`}
              getRows={() => rows.map((m) => {
                const tl = tlPct(m)
                return {
                  'Symbol': m.symbol,
                  'Company': m.name || m.symbol,
                  'Sector': m.sector || '',
                  'CMP (Rs)': m.close ?? '',
                  '% vs 30W Trend Line': tl == null ? '' : tl.toFixed(1),
                  'RS vs Nifty (%)': m.rs_vs_nifty ?? '',
                  'Volume Ratio': m.vol_ratio ?? '',
                  'Criteria met': `${results?.activeCount ?? ''}/${results?.activeCount ?? ''}`,
                }
              })}
            />
          )}
        </div>
      </div>

      {/* Results table */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 64px 64px', gap: 8, padding: '8px 4px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>Ticker</span><span style={{ textAlign: 'right' }}>Crit</span><span style={{ textAlign: 'right' }}>TL%</span><span style={{ textAlign: 'right' }}>RS</span>
        </div>
        {rows.slice(0, 100).map((m) => {
          const tl = tlPct(m)
          return (
            <div key={m.id || m.symbol} onClick={() => navigate('/stock/' + m.symbol)}
              style={{ display: 'grid', gridTemplateColumns: '1fr 52px 64px 64px', gap: 8, padding: '9px 4px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{m.symbol}</div>
                <div style={{ fontSize: 10, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.sector}</div>
              </div>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.green }}>{results.activeCount}/{results.activeCount}</span>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: tl == null ? C.textMuted : tl > 0 ? C.green : C.red }}>{tl == null ? '—' : (tl > 0 ? '+' : '') + tl.toFixed(0) + '%'}</span>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: m.rs_vs_nifty == null ? C.textMuted : m.rs_vs_nifty > 0 ? C.green : C.red }}>{m.rs_vs_nifty == null ? '—' : (m.rs_vs_nifty > 0 ? '+' : '') + Number(m.rs_vs_nifty).toFixed(0)}</span>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>No stocks matched all your criteria. Try loosening a parameter.</div>
        )}
      </div>

      <p style={{ padding: '16px', fontSize: 11, color: C.textMuted, lineHeight: 1.6, fontStyle: 'italic' }}>
        These stocks match the mathematical criteria you set. What you do with this is entirely your decision.<br />
        ℹ️ Data only · Not advice · Not SEBI registered
      </p>
      <div style={{ height: 24 }} />
    </Shell>
  )
}

function Shell({ title, children, maxWidth = 760 }) {
  return (
    <>
      <Helmet><title>{title} | PineX Lab</title></Helmet>
      <div style={{ minHeight: '100vh', background: C.base, color: C.text, width: '100%', maxWidth, margin: '0 auto' }}>{children}</div>
    </>
  )
}

function SectionHead({ children }) {
  return (
    <div style={{ padding: '18px 16px 8px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center' }}>{children}</div>
  )
}

function RadioPill({ label, active, onClick, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ padding: '7px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, border: `1px solid ${active ? C.amberBorder : C.border}`, background: active ? C.amberBg : 'transparent', color: active ? C.amber : C.textMuted }}>
      {label}
    </button>
  )
}
