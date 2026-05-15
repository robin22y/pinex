import { useState, useEffect } from 'react'

const C = {
  bg: '#05070A', surface: '#0B0F18', surface2: '#111620',
  border: '#1E2530', text: '#E2E8F0', muted: '#64748B',
  faint: '#3D4F63', blue: '#38BDF8', blueBg: 'rgba(56,189,248,0.08)',
  blueBorder: 'rgba(56,189,248,0.18)', green: '#34D399', greenBg: 'rgba(52,211,153,0.1)',
  red: '#F87171', redBg: 'rgba(248,113,113,0.1)', amber: '#FBBF24',
  purple: '#A78BFA', purpleBg: 'rgba(167,139,250,0.08)',
}

const TABS = [
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
  { label: 'Breakout watch', text: '🔥 Breakout Watch\n\nSeveral Stage 2 stocks approaching key resistance.\nHigh delivery + volume confirmation needed.\n\npinex.in' },
  { label: 'Custom...', text: '' },
]

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ── AI Broadcast Panel ─────────────────────────────────────────────────── */
function AIBroadcastPanel() {
  const [message, setMessage] = useState('')
  const [generatedAt, setGeneratedAt] = useState(null)
  const [status, setStatus] = useState(null)
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
      const res = await fetch('/.netlify/functions/admin-generate-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true }),
      })
      const data = await res.json()
      if (data.ok) {
        setMessage(data.message || '')
        setGeneratedAt(new Date().toISOString())
        setStatus('draft')
        setStockCount(data.stockCount ?? null)
      } else {
        setResult({ ok: false, error: data.error || 'Generation failed' })
      }
    } catch (err) {
      setResult({ ok: false, error: String(err) })
    } finally {
      setSending_gen(false)
    }
  }

  async function handleSend() {
    if (!message.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/.netlify/functions/admin-send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), target: 'channel' }),
      })
      const data = await res.json()
      setResult(data)
      if (data.ok) setStatus('sent')
    } catch (err) {
      setResult({ ok: false, error: String(err) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header + generate button */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 4px' }}>
              AI-generated weekly broadcast
            </p>
            <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
              Claude reads top multi-factor stocks + market breadth and writes the message.
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
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.purple}33`,
              background: C.purpleBg, color: C.purple,
              fontSize: 12, fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.7 : 1, flexShrink: 0,
              transition: 'all 0.12s',
            }}
          >
            <i className={`ti ${generating ? 'ti-loader-2' : 'ti-sparkles'}`} style={{ fontSize: 14 }} />
            {generating ? 'Generating…' : (message ? 'Regenerate' : 'Generate with Claude')}
          </button>
        </div>
      </div>

      {/* Editable message */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16 }}>
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
            background: C.surface2, border: `1px solid ${C.border}`,
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
            <div style={{ background: '#1A1E2A', borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.purple}` }}>
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

      <div style={{ padding: '12px 14px', borderRadius: 8, background: C.surface, border: `1px solid ${C.border}` }}>
        <p style={{ margin: 0, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
          <strong style={{ color: C.muted }}>Auto-schedule:</strong> GitHub Actions runs this every Sunday after the weekly data refresh.<br />
          <strong style={{ color: C.muted }}>Edit:</strong> The message above is fully editable before you send — fix names, add context, adjust tone.<br />
          <strong style={{ color: C.muted }}>Criteria:</strong> Stage 2 · above 30W MA · above 50DMA · delivery &gt;40% · positive 7d momentum.
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
      const res = await fetch('/.netlify/functions/admin-send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), target }),
      })
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setResult({ ok: false, error: String(err) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Target selector */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16 }}>
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
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16 }}>
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
                border: `1px solid ${C.border}`, background: 'transparent',
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
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16 }}>
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
            background: C.surface2, border: `1px solid ${C.border}`,
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
            <div style={{ background: '#1A1E2A', borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.blue}` }}>
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

      <div style={{ padding: '12px 14px', borderRadius: 8, background: C.surface, border: `1px solid ${C.border}` }}>
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

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function AdminTelegram() {
  const [tab, setTab] = useState('ai')

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
      <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 4, border: `1px solid ${C.border}` }}>
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
              outline: tab === t.id ? `1px solid ${C.border}` : 'none',
            }}
          >
            <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ai' ? <AIBroadcastPanel /> : <CustomMessagePanel />}
    </div>
  )
}
