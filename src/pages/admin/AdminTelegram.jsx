import { useState, useEffect, useCallback, useRef } from 'react'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'

const C = {
  bg: '#05070A', surface: '#0B0F18', surface2: '#111620',
  border: 'var(--border)', text: 'var(--text-primary)', muted: 'var(--text-muted)',
  faint: '#3D4F63', blue: '#38BDF8', blueBg: 'rgba(56,189,248,0.08)',
  blueBorder: 'rgba(56,189,248,0.18)', green: '#34D399', greenBg: 'rgba(52,211,153,0.1)',
  red: '#F87171', redBg: 'rgba(248,113,113,0.1)', amber: 'var(--warning)',
  purple: '#A78BFA', purpleBg: 'rgba(167,139,250,0.08)',
}

const TABS = [
  { id: 'spotlight', label: 'Stock Spotlight', icon: 'ti-star' },
  { id: 'sector', label: 'Sector Spotlight', icon: 'ti-chart-treemap' },
  { id: 'ai', label: 'AI Broadcast', icon: 'ti-sparkles' },
  { id: 'custom', label: 'Custom Message', icon: 'ti-pencil' },
]

const TARGETS = [
  { id: 'channel', label: 'Channel', icon: 'ti-broadcast', desc: 'Send to @pinexin channel' },
  { id: 'all',     label: 'All subscribers', icon: 'ti-users', desc: 'Send to all bot subscribers' },
  { id: 'test',    label: 'Test (me)',        icon: 'ti-test-pipe', desc: 'Send only to yourself' },
]

const TEMPLATES = [
  { label: 'Market alert', text: '🚨 Market Alert\n\nNifty showing unusual activity. Check pinex.in for details.\n\npinex.in' },
  { label: 'Sector update', text: '📈 Sector Update\n\nIT sector leading today\'s rally. Banking consolidating.\n\nFull breakdown: pinex.in' },
  { label: 'Breakout watch', text: '🔥 Breakout Watch\n\nSeveral Advancing-phase stocks approaching key resistance.\nHigh delivery + volume confirmation needed.\n\npinex.in' },
  // One-time launch announcement for the BYOK Research Assistant.
  // Manually sent by admin — not part of any automated pipeline.
  {
    label: '🔬 Research Assistant Launch',
    text:
      '🔬 New on PineX — Research Assistant\n\n' +
      'You can now connect your own free Gemini AI key to PineX.\n\n' +
      'Ask anything about any NSE stock:\n' +
      '📊 Valuation metrics\n' +
      '👥 Shareholding trends\n' +
      '📋 Quarterly results\n' +
      '🔄 Cycle position explained\n' +
      '🎯 Trading methodology framework\n\n' +
      'Your questions are completely private.\n' +
      'PineX never sees them.\n' +
      'Takes 2 minutes to set up.\n\n' +
      'Learn how: pinex.in/learn\n' +
      '(Module 9 — Research Assistant)\n\n' +
      'Then go to Settings → Research Assistant\n' +
      'to add your free key.\n\n' +
      'EOD data only · Not investment advice',
  },
  { label: 'Custom...', text: '' },
]

async function netlifyFetch(path, options = {}) {
  const res = await fetch(path, options)
  const text = await res.text()
  if (!text) {
    if (res.status === 404) throw new Error('Function not found — run `netlify dev` locally (not `npm run dev`)')
    throw new Error(`Server returned ${res.status} with no body`)
  }
  try {
    return JSON.parse(text)
  } catch {
    if (res.status === 404) throw new Error('Function not found — run `netlify dev` locally (not `npm run dev`)')
    throw new Error(`Server returned ${res.status}: ${text.slice(0, 120)}`)
  }
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ── Stock Spotlight Panel ──────────────────────────────────────────────── */
function StockSpotlightPanel() {
  const [stocks, setStocks] = useState([])
  const [loadingStocks, setLoadingStocks] = useState(false)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [message, setMessage] = useState('')
  const [aiModel, setAiModel] = useState('claude')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const searchRef = useRef(null)

  const loadStocks = useCallback(async () => {
    if (!hasSupabaseEnv) return
    setLoadingStocks(true)
    try {
      // Fetch all companies in batches of 1000 to bypass PostgREST row cap
      let all = [], from = 0
      while (true) {
        const { data } = await supabase
          .from('companies')
          .select('id, symbol, name, sector, industry')
          .order('symbol', { ascending: true })
          .range(from, from + 999)
        if (!data?.length) break
        all = all.concat(data)
        if (data.length < 1000) break
        from += 1000
      }
      setStocks(all.map(c => ({ ...c, company_id: c.id })))
    } finally {
      setLoadingStocks(false)
    }
  }, [])

  useEffect(() => { loadStocks() }, [loadStocks])

  // Close results on outside click
  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchFocused(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function selectStock(s) {
    setSelected(s)
    setSearch('')
    setSearchFocused(false)
    setMessage('')
    setResult(null)
    setDetail(null)
    if (!hasSupabaseEnv) return
    const [{ data: pd }, { data: del }] = await Promise.all([
      supabase.from('price_data')
        .select('close, stage, weinstein_substage, rs_vs_nifty, ma30w, rsi, high_52w, low_52w')
        .eq('company_id', s.company_id)
        .eq('is_latest', true)
        .maybeSingle(),
      supabase.from('delivery_signals')
        .select('avg_delivery_7d, avg_delivery_30d, pct_from_30w, vol_ratio')
        .eq('company_id', s.company_id)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const price = pd || {}
    setDetail({
      delivery: del || null,
      close: price.close,
      stage: price.stage,
      weinstein_substage: price.weinstein_substage,
      rs_vs_nifty: price.rs_vs_nifty,
      ma30w: price.ma30w,
      rsi: price.rsi,
      pct_from_ma: price.close && price.ma30w ? ((price.close - price.ma30w) / price.ma30w * 100) : null,
    })
  }

  function autoFill(s, d) {
    if (!s) return
    const p = d || {}
    const sub = p.weinstein_substage ? ` · ${p.weinstein_substage}` : ''
    const name = s.name || s.symbol
    const sector = s.sector || ''
    const delivery = p.delivery
    const del = delivery?.avg_delivery_7d ?? delivery?.avg_delivery_30d
    const delLabel = delivery?.avg_delivery_7d != null ? '7D' : '30D'
    const pledge = delivery?.promoter_pledge_pct
    const lines = [
      `🔦 *${s.symbol}* — Stock Spotlight`,
      ``,
      `📌 ${name}${sector ? ` · ${sector}` : ''}`,
      `${p.stage || 'Stage 2'}${sub}`,
      ``,
      `📊 Key Metrics:`,
      p.close != null ? `• Price: ₹${Number(p.close).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : null,
      p.rs_vs_nifty != null ? `• RS vs Nifty (1Y): ${Number(p.rs_vs_nifty).toFixed(1)}%` : null,
      p.pct_from_ma != null ? `• % from 30W Trend Line: ${Number(p.pct_from_ma).toFixed(1)}%` : null,
      p.rsi != null ? `• RSI: ${Number(p.rsi).toFixed(0)}` : null,
      del != null ? `• Delivery (${delLabel}): ${Number(del).toFixed(1)}%` : null,
      pledge != null ? `• Promoter Pledge: ${Number(pledge).toFixed(1)}%` : null,
      ``,
      `[Add your analysis here]`,
      ``,
      `Data for educational purposes only. Not investment advice.`,
      `pinex.in/${s.symbol.toLowerCase()}`,
    ].filter(l => l !== null)
    setMessage(lines.join('\n'))
  }

  async function handleAIGenerate() {
    if (!selected) return
    setGenerating(true)
    setResult(null)
    try {
      const data = await netlifyFetch('/.netlify/functions/admin-generate-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selected.symbol, model: aiModel }),
      })
      if (data.ok) {
        setMessage(data.message || '')
      } else {
        setResult({ ok: false, error: data.error || 'Generation failed' })
      }
    } catch (err) {
      setResult({ ok: false, error: err.message || String(err) })
    } finally {
      setGenerating(false)
    }
  }

  async function handleSend() {
    if (!message.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      setResult(await netlifyFetch('/.netlify/functions/admin-send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), target: 'channel' }),
      }))
    } catch (err) {
      setResult({ ok: false, error: err.message || String(err) })
    } finally {
      setSending(false)
    }
  }

  const filtered = stocks.filter(s => {
    const q = search.trim().toLowerCase()
    if (!q) return false
    return s.symbol.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Stock search */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Search stock
          </p>
          {stocks.length > 0 && (
            <span style={{ fontSize: 11, color: C.faint }}>{stocks.length} stocks loaded</span>
          )}
        </div>

        <div ref={searchRef} style={{ position: 'relative' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: C.surface2, borderRadius: 10, padding: '9px 14px',
            border: `1px solid ${searchFocused ? C.blue : C.border}`, transition: 'border-color 0.15s',
          }}>
            <i className="ti ti-search" style={{ fontSize: 14, color: C.faint }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchFocused(true) }}
              onFocus={() => setSearchFocused(true)}
              placeholder={loadingStocks ? 'Loading stocks…' : 'Type symbol or company name…'}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.text, fontSize: 13 }}
            />
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSearchFocused(false) }}
                style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
            )}
          </div>

          {/* Results list */}
          {searchFocused && search.trim() && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
              background: C.surface, border: `1px solid ${C.blue}44`, borderRadius: 12,
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
            }}>
              {filtered.length === 0 ? (
                <p style={{ padding: '12px 16px', fontSize: 12, color: C.faint, margin: 0 }}>No matches.</p>
              ) : (
                filtered.slice(0, 60).map(s => (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => selectStock(s)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 14px', background: 'transparent',
                      border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{s.symbol}</span>
                      {s.name && <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{s.name}</span>}
                      {s.sector && <span style={{ fontSize: 10, color: C.faint, marginLeft: 6 }}>· {s.sector}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                      {s.high_conviction && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'rgba(52,211,153,0.12)', color: C.green, border: '1px solid rgba(52,211,153,0.25)' }}>⚡ SwingX</span>
                      )}
                      {s.stage && (
                        <span style={{ fontSize: 10, color: C.muted }}>{s.stage.replace('Stage ', 'S')}</span>
                      )}
                      {s.rs_vs_nifty != null && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: s.rs_vs_nifty > 0 ? C.green : C.red }}>
                          RS {Number(s.rs_vs_nifty).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Selected stock chip */}
        {selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: C.faint }}>Selected:</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>{selected.symbol}</span>
            {selected.name && <span style={{ fontSize: 12, color: C.muted }}>{selected.name}</span>}
            {detail?.stage && <span style={{ fontSize: 11, color: C.muted }}>{detail.stage}{detail.weinstein_substage ? ` · ${detail.weinstein_substage}` : ''}</span>}
            <button type="button" onClick={() => { setSelected(null); setDetail(null); setMessage(''); setResult(null) }}
              style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', fontSize: 11, padding: 0 }}>✕ Clear</button>
          </div>
        )}
      </div>

      {/* Selected stock detail + actions */}
      {selected && (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.blue}33`, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{selected.symbol}</p>
              {selected.name && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>{selected.name}{selected.sector ? ` · ${selected.sector}` : ''}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => autoFill(selected, detail)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${C.blue}44`, background: C.blueBg, color: C.blue,
                  fontSize: 12, fontWeight: 600,
                }}
              >
                <i className="ti ti-layout-list" style={{ fontSize: 13 }} />
                Auto-fill details
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 8, border: `1px solid ${C.purple}44`, overflow: 'hidden' }}>
                {['claude', 'gemini'].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAiModel(m)}
                    style={{
                      padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      background: aiModel === m ? `${C.purple}22` : 'transparent',
                      color: aiModel === m ? C.purple : C.muted,
                      border: 'none', borderRight: m === 'claude' ? `1px solid ${C.purple}33` : 'none',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}
                  >
                    {m === 'claude' ? 'Claude' : 'Gemini'}
                  </button>
                ))}
                <button
                  onClick={handleAIGenerate}
                  disabled={generating}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', cursor: generating ? 'not-allowed' : 'pointer',
                    background: C.purpleBg, color: C.purple,
                    border: 'none', borderLeft: `1px solid ${C.purple}33`,
                    fontSize: 12, fontWeight: 600, opacity: generating ? 0.7 : 1,
                  }}
                >
                  <i className={`ti ${generating ? 'ti-loader-2' : 'ti-sparkles'}`} style={{ fontSize: 13 }} />
                  {generating ? 'Generating…' : 'AI Write-up'}
                </button>
              </div>
            </div>
          </div>

          {/* Quick metrics strip */}
          {!detail ? (
            <p style={{ fontSize: 12, color: C.faint, margin: '0 0 12px' }}>Loading metrics…</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                { label: 'Price', val: detail.close != null ? `₹${Number(detail.close).toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : null },
                { label: 'Stage', val: detail.stage ? `${detail.stage}${detail.weinstein_substage ? ` · ${detail.weinstein_substage}` : ''}` : null },
                { label: 'RS vs Nifty', val: detail.rs_vs_nifty != null ? `${Number(detail.rs_vs_nifty).toFixed(1)}%` : null },
                { label: '% from MA', val: detail.pct_from_ma != null ? `${Number(detail.pct_from_ma).toFixed(1)}%` : null },
                { label: 'RSI', val: detail.rsi != null ? Number(detail.rsi).toFixed(0) : null },
                { label: 'Delivery', val: detail.delivery?.avg_delivery_7d != null ? `${Number(detail.delivery.avg_delivery_7d).toFixed(1)}% (7D)` : detail.delivery?.avg_delivery_30d != null ? `${Number(detail.delivery.avg_delivery_30d).toFixed(1)}% (30D)` : null },
              ].filter(m => m.val).map(m => (
                <div key={m.label} style={{ padding: '5px 10px', borderRadius: 8, background: C.surface2, border: '1px solid var(--border)' }}>
                  <p style={{ margin: 0, fontSize: 9, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 700, color: C.text }}>{m.val}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message composer */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Message — edit before sending
          </p>
          <span style={{ fontSize: 11, color: message.length > 3800 ? C.red : C.faint }}>{message.length} / 4096</span>
        </div>
        <textarea
          value={message}
          onChange={e => { setMessage(e.target.value); setResult(null) }}
          placeholder={selected ? "Click 'Auto-fill details' or 'AI Write-up' above, then edit here…" : "Select a stock first…"}
          rows={12}
          maxLength={4096}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: C.surface2, border: '1px solid var(--border)', borderRadius: 8,
            padding: '12px 14px', color: C.text, fontSize: 13, lineHeight: 1.6,
            resize: 'vertical', outline: 'none', fontFamily: 'inherit',
          }}
          onFocus={e => (e.target.style.borderColor = C.blue)}
          onBlur={e => (e.target.style.borderColor = C.border)}
        />
        {message.trim() && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontWeight: 700 }}>Preview</p>
            <div style={{ background: '#1A1E2A', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)', borderLeft: `3px solid ${C.green}` }}>
              <p style={{ margin: 0, fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{message}</p>
            </div>
          </div>
        )}
      </div>

      {/* Send */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 24px', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none',
            cursor: message.trim() && !sending ? 'pointer' : 'not-allowed',
            background: message.trim() && !sending ? 'linear-gradient(135deg, #34D399, #38BDF8)' : C.border,
            color: message.trim() && !sending ? '#000' : C.faint,
            opacity: sending ? 0.7 : 1, transition: 'all 0.15s',
          }}
        >
          <i className={`ti ${sending ? 'ti-loader-2' : 'ti-send'}`} style={{ fontSize: 16 }} />
          {sending ? 'Sending…' : 'Send to @pinexin channel'}
        </button>
        {result && (
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: result.ok ? C.greenBg : C.redBg,
            border: `1px solid ${result.ok ? C.green + '40' : C.red + '40'}`,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <i className={`ti ${result.ok ? 'ti-circle-check' : 'ti-alert-circle'}`}
              style={{ fontSize: 16, color: result.ok ? C.green : C.red, flexShrink: 0, marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 13, color: result.ok ? C.green : C.red, fontWeight: 600 }}>
              {result.ok
                ? `Sent to ${result.sent ?? 1} recipient${(result.sent ?? 1) !== 1 ? 's' : ''}${result.failed > 0 ? ` · ${result.failed} failed` : ''}`
                : result.error || 'Send failed'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── AI Broadcast Panel ─────────────────────────────────────────────────── */
function AIBroadcastPanel() {
  const [message, setMessage] = useState('')
  const [generatedAt, setGeneratedAt] = useState(null)
  const [status, setStatus] = useState(null)
  const [aiModel, setAiModel] = useState('claude')
  const [generating, setSending_gen] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [stockCount, setStockCount] = useState(null)

  useEffect(() => {
    // Load latest draft on mount
    fetch('/.netlify/functions/admin-generate-broadcast')
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.broadcast) {
          setMessage(data.broadcast.message || '')
          setGeneratedAt(data.broadcast.generated_at)
          setStatus(data.broadcast.status)
        }
      })
      .catch(() => {})
  }, [])

  async function handleGenerate() {
    setSending_gen(true)
    setResult(null)
    try {
      const data = await netlifyFetch('/.netlify/functions/admin-generate-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true, model: aiModel }),
      })
      if (data.ok) {
        setMessage(data.message || '')
        setGeneratedAt(new Date().toISOString())
        setStatus('draft')
        setStockCount(data.stockCount ?? null)
      } else {
        setResult({ ok: false, error: data.error || 'Generation failed' })
      }
    } catch (err) {
      setResult({ ok: false, error: err.message || String(err) })
    } finally {
      setSending_gen(false)
    }
  }

  async function handleSend() {
    if (!message.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      const data = await netlifyFetch('/.netlify/functions/admin-send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), target: 'channel' }),
      })
      setResult(data)
      if (data.ok) setStatus('sent')
    } catch (err) {
      setResult({ ok: false, error: err.message || String(err) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header + generate button */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 4px' }}>
              AI-generated weekly broadcast
            </p>
            <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
              AI reads top multi-factor stocks + market breadth and writes the message.
            </p>
            {generatedAt && (
              <p style={{ fontSize: 10, color: C.faint, margin: '6px 0 0' }}>
                Last generated: {fmtDate(generatedAt)}
                {status === 'sent' && (
                  <span style={{ marginLeft: 8, color: C.green, fontWeight: 600 }}>· Sent</span>
                )}
                {stockCount !== null && (
                  <span style={{ marginLeft: 8, color: C.muted }}>· {stockCount} stocks met criteria</span>
                )}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 8, border: `1px solid ${C.purple}33`, overflow: 'hidden', flexShrink: 0 }}>
            {['claude', 'gemini'].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setAiModel(m)}
                style={{
                  padding: '8px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  background: aiModel === m ? `${C.purple}22` : 'transparent',
                  color: aiModel === m ? C.purple : C.muted,
                  border: 'none', borderRight: m === 'claude' ? `1px solid ${C.purple}33` : 'none',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}
              >
                {m === 'claude' ? 'Claude' : 'Gemini'}
              </button>
            ))}
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', border: 'none', borderLeft: `1px solid ${C.purple}33`,
                background: C.purpleBg, color: C.purple,
                fontSize: 12, fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.7 : 1,
              }}
            >
              <i className={`ti ${generating ? 'ti-loader-2' : 'ti-sparkles'}`} style={{ fontSize: 14 }} />
              {generating ? 'Generating…' : (message ? 'Regenerate' : 'Generate')}
            </button>
          </div>
        </div>
      </div>

      {/* Editable message */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Message — edit before sending
          </p>
          <span style={{ fontSize: 11, color: message.length > 3800 ? C.red : C.faint }}>
            {message.length} / 4096
          </span>
        </div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Click 'Generate with Claude' to create the weekly broadcast, or type manually…"
          rows={12}
          maxLength={4096}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: C.surface2, border: '1px solid var(--border)',
            borderRadius: 8, padding: '12px 14px',
            color: C.text, fontSize: 13, lineHeight: 1.6,
            resize: 'vertical', outline: 'none', fontFamily: 'inherit',
          }}
          onFocus={e => (e.target.style.borderColor = C.blue)}
          onBlur={e => (e.target.style.borderColor = C.border)}
        />

        {message.trim() && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontWeight: 700 }}>
              Preview
            </p>
            <div style={{ background: '#1A1E2A', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)', borderLeft: `3px solid ${C.purple}` }}>
              <p style={{ margin: 0, fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {message}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Send button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 24px', borderRadius: 10, fontSize: 14, fontWeight: 700,
            border: 'none', cursor: message.trim() && !sending ? 'pointer' : 'not-allowed',
            background: message.trim() && !sending
              ? 'linear-gradient(135deg, #A78BFA, #38BDF8)'
              : C.border,
            color: message.trim() && !sending ? '#000' : C.faint,
            opacity: sending ? 0.7 : 1,
            transition: 'all 0.15s',
          }}
        >
          <i className={`ti ${sending ? 'ti-loader-2' : 'ti-send'}`} style={{ fontSize: 16 }} />
          {sending ? 'Sending…' : 'Send to @pinexin channel'}
        </button>

        {result && (
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: result.ok ? C.greenBg : C.redBg,
            border: `1px solid ${result.ok ? C.green + '40' : C.red + '40'}`,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <i className={`ti ${result.ok ? 'ti-circle-check' : 'ti-alert-circle'}`}
              style={{ fontSize: 16, color: result.ok ? C.green : C.red, flexShrink: 0, marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 13, color: result.ok ? C.green : C.red, fontWeight: 600 }}>
              {result.ok
                ? `Sent to ${result.sent} recipient${result.sent !== 1 ? 's' : ''}${result.failed > 0 ? ` · ${result.failed} failed` : ''}`
                : result.error || 'Send failed'}
            </p>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 8, background: C.surface, border: '1px solid var(--border)' }}>
        <p style={{ margin: 0, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
          <strong style={{ color: C.muted }}>Auto-schedule:</strong> GitHub Actions runs this every Sunday after the weekly data refresh.<br />
          <strong style={{ color: C.muted }}>Edit:</strong> The message above is fully editable before you send — fix names, add context, adjust tone.<br />
          <strong style={{ color: C.muted }}>Criteria:</strong> Stage 2 · above 30W Trend Line · above 50DMA · delivery &gt;40% · positive 7d momentum.
        </p>
      </div>
    </div>
  )
}

/* ── Custom Message Panel ────────────────────────────────────────────────── */
function CustomMessagePanel() {
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState('channel')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [charCount, setCharCount] = useState(0)

  function handleTemplate(tpl) {
    setMessage(tpl.text)
    setCharCount(tpl.text.length)
    setResult(null)
  }

  function handleChange(e) {
    setMessage(e.target.value)
    setCharCount(e.target.value.length)
    setResult(null)
  }

  async function handleSend() {
    if (!message.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      setResult(await netlifyFetch('/.netlify/functions/admin-send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), target }),
      }))
    } catch (err) {
      setResult({ ok: false, error: err.message || String(err) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Target selector */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
          Send to
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TARGETS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTarget(t.id); setResult(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${target === t.id ? C.blue : C.border}`,
                background: target === t.id ? C.blueBg : 'transparent',
                color: target === t.id ? C.blue : C.muted,
                fontSize: 13, fontWeight: target === t.id ? 600 : 400,
                transition: 'all 0.12s',
              }}
            >
              <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: C.faint }}>
          {TARGETS.find(t => t.id === target)?.desc}
        </p>
      </div>

      {/* Templates */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>
          Quick templates
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.label}
              onClick={() => handleTemplate(tpl)}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                border: '1px solid var(--border)', background: 'transparent',
                color: C.muted, cursor: 'pointer', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Message
          </p>
          <span style={{ fontSize: 11, color: charCount > 3800 ? C.red : C.faint }}>
            {charCount} / 4096
          </span>
        </div>
        <textarea
          value={message}
          onChange={handleChange}
          placeholder="Type your message here…"
          rows={10}
          maxLength={4096}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: C.surface2, border: '1px solid var(--border)',
            borderRadius: 8, padding: '12px 14px',
            color: C.text, fontSize: 13, lineHeight: 1.6,
            resize: 'vertical', outline: 'none', fontFamily: 'inherit',
          }}
          onFocus={e => (e.target.style.borderColor = C.blue)}
          onBlur={e => (e.target.style.borderColor = C.border)}
        />
        {message.trim() && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontWeight: 700 }}>Preview</p>
            <div style={{ background: '#1A1E2A', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)', borderLeft: `3px solid ${C.blue}` }}>
              <p style={{ margin: 0, fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{message}</p>
            </div>
          </div>
        )}
      </div>

      {/* Send */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 24px', borderRadius: 10, fontSize: 14, fontWeight: 700,
            border: 'none', cursor: message.trim() && !sending ? 'pointer' : 'not-allowed',
            background: message.trim() && !sending ? 'linear-gradient(135deg, #38BDF8, #818CF8)' : C.border,
            color: message.trim() && !sending ? '#000' : C.faint,
            opacity: sending ? 0.7 : 1,
            transition: 'all 0.15s',
          }}
        >
          <i className={`ti ${sending ? 'ti-loader-2' : 'ti-send'}`} style={{ fontSize: 16 }} />
          {sending ? 'Sending…' : `Send to ${TARGETS.find(t => t.id === target)?.label}`}
        </button>

        {result && (
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: result.ok ? C.greenBg : C.redBg,
            border: `1px solid ${result.ok ? C.green + '40' : C.red + '40'}`,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <i className={`ti ${result.ok ? 'ti-circle-check' : 'ti-alert-circle'}`}
              style={{ fontSize: 16, color: result.ok ? C.green : C.red, flexShrink: 0, marginTop: 1 }} />
            <div>
              {result.ok ? (
                <p style={{ margin: 0, fontSize: 13, color: C.green, fontWeight: 600 }}>
                  Sent to {result.sent} recipient{result.sent !== 1 ? 's' : ''}
                  {result.failed > 0 && ` · ${result.failed} failed`}
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: C.red, fontWeight: 600 }}>
                  {result.error || 'Send failed'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 8, background: C.surface, border: '1px solid var(--border)' }}>
        <p style={{ margin: 0, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
          <strong style={{ color: C.muted }}>Channel:</strong> Messages go to @pinexin — visible to all channel members.<br />
          <strong style={{ color: C.muted }}>All subscribers:</strong> Sends individually to users who ran /subscribe on the bot.<br />
          <strong style={{ color: C.muted }}>Test:</strong> Sends only to the channel (safe preview).<br />
          Telegram rate limit: ~30 messages/sec.
        </p>
      </div>
    </div>
  )
}

/* ── Sector Spotlight Panel ─────────────────────────────────────────────── */
function SectorSpotlightPanel() {
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [selected, setSelected] = useState(null)
  const [message, setMessage] = useState('')
  const [aiModel, setAiModel] = useState('claude')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (!hasSupabaseEnv) return
    setLoading(true)
    supabase.from('nifty_sectors').select('*').order('date', { ascending: false }).limit(64)
      .then(({ data }) => {
        if (!data?.length) return
        const latestDate = data[0].date
        setSectors(data.filter(s => s.date === latestDate).sort((a, b) => (b.change_1w ?? -999) - (a.change_1w ?? -999)))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchFocused(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectSector(s) {
    setSelected(s)
    setSearch('')
    setSearchFocused(false)
    setMessage('')
    setResult(null)
  }

  function fmt(val) {
    if (val == null) return '—'
    const n = Number(val)
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
  }

  function fmtColor(val) {
    if (val == null) return C.muted
    return Number(val) >= 0 ? C.green : C.red
  }

  function autoFill(s) {
    if (!s) return
    const name = s.display_name || s.index_name || ''
    const lines = [
      `📊 *${name}* — Sector Update`,
      ``,
      `🗓 Performance snapshot:`,
      `• 1 Day:  ${fmt(s.change_1d)}`,
      `• 1 Week: ${fmt(s.change_1w)}`,
      `• 1 Month: ${fmt(s.change_1m)}`,
      `• 3 Months: ${fmt(s.change_3m)}`,
      ``,
      `[Add your analysis here — key stocks, news, outlook]`,
      ``,
      `Data for educational purposes only. Not investment advice.`,
      `pinex.in`,
    ]
    setMessage(lines.join('\n'))
  }

  async function handleAIGenerate() {
    if (!selected) return
    setGenerating(true)
    setResult(null)
    try {
      const data = await netlifyFetch('/.netlify/functions/admin-generate-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector: selected.index_name || selected.display_name, model: aiModel }),
      })
      if (data.ok) setMessage(data.message || '')
      else setResult({ ok: false, error: data.error || 'Generation failed' })
    } catch (err) {
      setResult({ ok: false, error: err.message || String(err) })
    } finally {
      setGenerating(false)
    }
  }

  async function handleSend() {
    if (!message.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      setResult(await netlifyFetch('/.netlify/functions/admin-send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), target: 'channel' }),
      }))
    } catch (err) {
      setResult({ ok: false, error: err.message || String(err) })
    } finally {
      setSending(false)
    }
  }

  const filtered = sectors.filter(s => {
    const q = search.trim().toLowerCase()
    if (!q) return false
    const name = (s.display_name || s.index_name || '').toLowerCase()
    return name.includes(q)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Search */}
      <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Search sector / industry
          </p>
          {sectors.length > 0 && <span style={{ fontSize: 11, color: C.faint }}>{sectors.length} sectors loaded</span>}
        </div>

        <div ref={searchRef} style={{ position: 'relative' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, background: C.surface2,
            borderRadius: 10, padding: '9px 14px',
            border: `1px solid ${searchFocused ? C.blue : C.border}`, transition: 'border-color 0.15s',
          }}>
            <i className="ti ti-search" style={{ fontSize: 14, color: C.faint }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchFocused(true) }}
              onFocus={() => setSearchFocused(true)}
              placeholder={loading ? 'Loading sectors…' : 'Type sector name…'}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.text, fontSize: 13 }}
            />
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSearchFocused(false) }}
                style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
            )}
          </div>

          {searchFocused && search.trim() && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
              background: C.surface, border: `1px solid ${C.blue}44`, borderRadius: 12,
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
            }}>
              {filtered.length === 0 ? (
                <p style={{ padding: '12px 16px', fontSize: 12, color: C.faint, margin: 0 }}>No matches.</p>
              ) : filtered.map(s => (
                <button
                  key={s.index_name || s.display_name}
                  type="button"
                  onClick={() => selectSector(s)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', background: 'transparent',
                    border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.display_name || s.index_name}</span>
                  <div style={{ display: 'flex', gap: 12, flexShrink: 0, marginLeft: 8 }}>
                    {s.change_1w != null && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: fmtColor(s.change_1w) }}>1W {fmt(s.change_1w)}</span>
                    )}
                    {s.change_1m != null && (
                      <span style={{ fontSize: 11, color: fmtColor(s.change_1m) }}>1M {fmt(s.change_1m)}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: C.faint }}>Selected:</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>{selected.display_name || selected.index_name}</span>
              <button type="button" onClick={() => { setSelected(null); setMessage(''); setResult(null) }}
                style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', fontSize: 11, padding: 0 }}>✕ Clear</button>
            </div>
            {/* Metrics strip */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[['1D', selected.change_1d], ['1W', selected.change_1w], ['1M', selected.change_1m], ['3M', selected.change_3m]].map(([label, val]) => (
                val != null && (
                  <div key={label} style={{ background: C.surface2, border: '1px solid var(--border)', borderRadius: 8, padding: '5px 12px', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 10, color: C.faint }}>{label}</p>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: fmtColor(val) }}>{fmt(val)}</p>
                  </div>
                )
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions + composer */}
      {selected && (
        <div style={{ background: C.surface, borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => autoFill(selected)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${C.blue}44`, background: C.blueBg, color: C.blue,
                fontSize: 12, fontWeight: 600,
              }}
            >
              <i className="ti ti-layout-list" style={{ fontSize: 13 }} />
              Auto-fill details
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 8, border: `1px solid ${C.purple}44`, overflow: 'hidden' }}>
              {['claude', 'gemini'].map(m => (
                <button key={m} type="button" onClick={() => setAiModel(m)} style={{
                  padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  background: aiModel === m ? `${C.purple}22` : 'transparent',
                  color: aiModel === m ? C.purple : C.muted,
                  border: 'none', borderRight: m === 'claude' ? `1px solid ${C.purple}33` : 'none',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {m === 'claude' ? 'Claude' : 'Gemini'}
                </button>
              ))}
              <button onClick={handleAIGenerate} disabled={generating} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', cursor: generating ? 'not-allowed' : 'pointer',
                background: C.purpleBg, color: C.purple,
                border: 'none', borderLeft: `1px solid ${C.purple}33`,
                fontSize: 12, fontWeight: 600, opacity: generating ? 0.7 : 1,
              }}>
                <i className={`ti ${generating ? 'ti-loader-2' : 'ti-sparkles'}`} style={{ fontSize: 13 }} />
                {generating ? 'Generating…' : 'AI Write-up'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              Message — edit before sending
            </p>
            <span style={{ fontSize: 11, color: C.faint }}>{message.length} / 4096</span>
          </div>
          <textarea
            value={message}
            onChange={e => { setMessage(e.target.value); setResult(null) }}
            placeholder={selected ? "Click 'Auto-fill details' or 'AI Write-up' above, then edit here…" : 'Select a sector first…'}
            rows={12}
            maxLength={4096}
            style={{
              width: '100%', boxSizing: 'border-box', background: C.surface2,
              border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px',
              color: C.text, fontSize: 13, lineHeight: 1.6, resize: 'vertical',
              outline: 'none', fontFamily: 'inherit',
            }}
            onFocus={e => (e.target.style.borderColor = C.blue)}
            onBlur={e => (e.target.style.borderColor = C.border)}
          />
          {result?.ok === false && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: C.red }}>{result.error}</p>
          )}
        </div>
      )}

      {selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '13px 24px', borderRadius: 10, fontSize: 14, fontWeight: 700,
              border: 'none', cursor: message.trim() && !sending ? 'pointer' : 'not-allowed',
              background: message.trim() && !sending ? 'linear-gradient(135deg, #A78BFA, #38BDF8)' : C.border,
              color: message.trim() && !sending ? '#000' : C.faint,
              opacity: sending ? 0.7 : 1,
            }}
          >
            <i className={`ti ${sending ? 'ti-loader-2' : 'ti-send'}`} style={{ fontSize: 16 }} />
            {sending ? 'Sending…' : 'Send to @pinexin channel'}
          </button>
          {result?.ok && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: C.greenBg, border: `1px solid ${C.green}40`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="ti ti-circle-check" style={{ fontSize: 16, color: C.green }} />
              <p style={{ margin: 0, fontSize: 13, color: C.green, fontWeight: 600 }}>
                Sent to {result.sent ?? 1} recipient{(result.sent ?? 1) !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function AdminTelegram() {
  const [tab, setTab] = useState('spotlight')

  return (
    <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Telegram Broadcast
        </h1>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
          AI-generated weekly updates and custom messages to the PineX channel.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 4, border: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: tab === t.id ? C.surface2 : 'transparent',
              color: tab === t.id ? C.text : C.muted,
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              transition: 'all 0.12s',
              outline: tab === t.id ? '1px solid var(--border)' : 'none',
            }}
          >
            <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'spotlight' && <StockSpotlightPanel />}
      {tab === 'sector' && <SectorSpotlightPanel />}
      {tab === 'ai' && <AIBroadcastPanel />}
      {tab === 'custom' && <CustomMessagePanel />}
    </div>
  )
}
