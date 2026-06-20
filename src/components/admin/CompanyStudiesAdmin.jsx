/**
 * CompanyStudiesAdmin — admin CRUD for company_studies.
 *
 * Mounted as a tab inside IQjet Desk. The page-level email gate
 * around IQjet Desk + the table's RLS policy ("admin full access"
 * via auth.email() = 'robin22y@gmail.com') together mean only
 * Robin can read this surface AND only Robin can persist writes.
 *
 * Three sections:
 *   1. Published studies — table + edit / delete / preview row actions
 *   2. Create / edit study — form with EN / ML / HI / TA tabs and a
 *      "Generate with Gemini" button per non-EN tab that calls the
 *      project's existing BYOK Gemini helper.
 *   3. Delete confirmation — inline modal, "this cannot be undone"
 *
 * Wiring notes
 *   - Gemini key comes from the existing /account BYOK input
 *     (getStoredGeminiKey).
 *   - Companies table is queried to fetch the display name when the
 *     symbol input changes — same lookup pattern other admin
 *     surfaces use.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { askGemini, getStoredGeminiKey } from '../../lib/researchAssistant'

const LANGS = [
  { key: 'en', label: 'EN', display: 'English' },
  { key: 'ml', label: 'ML', display: 'Malayalam (മലയാളം)' },
  { key: 'hi', label: 'HI', display: 'Hindi (हिन्दी)' },
  { key: 'ta', label: 'TA', display: 'Tamil (தமிழ்)' },
]

const NON_EN_LANG_NAMES = {
  ml: 'Malayalam',
  hi: 'Hindi',
  ta: 'Tamil',
}

const SECTIONS = [
  { key: 'what_they_do',        label: 'What they do' },
  { key: 'how_they_make_money', label: 'How they make money' },
  { key: 'who_built_it',        label: 'Who built it' },
  { key: 'similar_companies',   label: 'Similar companies' },
  { key: 'what_to_watch',       label: 'What to watch' },
]

// Empty draft used to seed the form for "new study". Every column we
// might touch is initialised so React doesn't switch between
// controlled / uncontrolled inputs on edit.
function emptyDraft() {
  const draft = {
    symbol: '',
    youtube_url: '',
    podcast_duration_seconds: '',
    is_published: false,
    // EN
    what_they_do: '',
    how_they_make_money: '',
    who_built_it: '',
    similar_companies: '',
    what_to_watch: '',
    // Per-language title + 5 sections
  }
  for (const lang of ['ml', 'hi', 'ta']) {
    draft[`title_${lang}`] = ''
    for (const s of SECTIONS) {
      draft[`${s.key}_${lang}`] = ''
    }
  }
  return draft
}

export default function CompanyStudiesAdmin() {
  const [list, setList] = useState([])
  const [listStatus, setListStatus] = useState('loading')
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyDraft())
  const [activeLang, setActiveLang] = useState('en')
  const [companyMeta, setCompanyMeta] = useState(null)
  const [savedMsg, setSavedMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(null)  // lang key being translated
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, symbol }

  // Load the studies table — drafts + published. The 'admin full
  // access' policy returns everything for Robin.
  async function refreshList() {
    setListStatus('loading')
    try {
      const { data, error } = await supabase
        .from('company_studies')
        .select('id, symbol, is_published, published_at, updated_at')
        .order('updated_at', { ascending: false })
      if (error) throw error
      setList(data || [])
      setListStatus('ready')
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[CompanyStudiesAdmin] list load failed:', e)
      setListStatus('error')
    }
  }
  useEffect(() => { refreshList() }, [])

  // Auto-fill company name when symbol changes (best-effort, silent).
  useEffect(() => {
    const sym = String(draft.symbol || '').trim().toUpperCase()
    if (!sym || sym.length < 2) { setCompanyMeta(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('companies')
          .select('id, symbol, name, sector')
          .eq('symbol', sym)
          .maybeSingle()
        if (!cancelled) setCompanyMeta(data || null)
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [draft.symbol])

  function setField(name, value) {
    setDraft((d) => ({ ...d, [name]: value }))
  }

  function newStudy() {
    setEditingId(null)
    setDraft(emptyDraft())
    setActiveLang('en')
    setSavedMsg('')
  }

  async function loadForEdit(id) {
    setSavedMsg('')
    try {
      const { data, error } = await supabase
        .from('company_studies')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) return
      // Merge incoming row into the empty-draft shape so nullable
      // columns don't switch the textareas to uncontrolled state.
      const filled = emptyDraft()
      for (const k of Object.keys(filled)) {
        if (data[k] != null) filled[k] = data[k]
      }
      setDraft(filled)
      setEditingId(id)
      setActiveLang('en')
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[CompanyStudiesAdmin] loadForEdit failed:', e)
    }
  }

  async function save(publishOverride) {
    setSaving(true)
    setSavedMsg('')
    try {
      const isPub = publishOverride === undefined ? !!draft.is_published : !!publishOverride
      const payload = {
        symbol: String(draft.symbol || '').trim().toUpperCase(),
        youtube_url: draft.youtube_url || null,
        podcast_duration_seconds: draft.podcast_duration_seconds
          ? Number(draft.podcast_duration_seconds) : null,
        is_published: isPub,
        published_at: isPub
          ? (editingId ? undefined : new Date().toISOString())
          : null,
        updated_at: new Date().toISOString(),
      }
      // EN content columns
      for (const s of SECTIONS) payload[s.key] = draft[s.key] || null
      // Multilingual columns
      for (const lang of ['ml', 'hi', 'ta']) {
        payload[`title_${lang}`] = draft[`title_${lang}`] || null
        for (const s of SECTIONS) {
          payload[`${s.key}_${lang}`] = draft[`${s.key}_${lang}`] || null
        }
      }
      if (!payload.symbol) {
        setSavedMsg('Symbol is required.')
        return
      }
      // Strip published_at when undefined so PostgREST doesn't try to
      // overwrite it on edit.
      if (payload.published_at === undefined) delete payload.published_at

      let resp
      if (editingId) {
        resp = await supabase
          .from('company_studies')
          .update(payload)
          .eq('id', editingId)
          .select('id')
          .maybeSingle()
      } else {
        resp = await supabase
          .from('company_studies')
          .insert(payload)
          .select('id')
          .maybeSingle()
      }
      if (resp.error) throw resp.error
      setSavedMsg(isPub ? '✓ Published' : '✓ Saved')
      if (!editingId && resp.data?.id) setEditingId(resp.data.id)
      refreshList()
    } catch (e) {
      const msg = String(e?.message || e)
      if (/relation .*company_studies.* does not exist/i.test(msg)) {
        setSavedMsg('Apply scripts/sql/create_company_studies.sql first.')
      } else {
        setSavedMsg('Save failed: ' + msg.slice(0, 160))
      }
    } finally {
      setSaving(false)
      setTimeout(() => setSavedMsg(''), 5000)
    }
  }

  // Per-language Gemini translation. EN content goes in, translated
  // text comes back, all 6 fields for that language are filled.
  async function generateTranslation(lang) {
    if (lang === 'en') return
    if (!NON_EN_LANG_NAMES[lang]) return
    const geminiKey = getStoredGeminiKey()
    if (!geminiKey) {
      setSavedMsg('Set Gemini key in /account first.')
      setTimeout(() => setSavedMsg(''), 4000)
      return
    }
    setTranslating(lang)
    setSavedMsg('')
    try {
      const langName = NON_EN_LANG_NAMES[lang]
      const targetTitleLabel = `[${langName} title for this company study]`
      // Build a structured prompt the model can answer in one round-
      // trip. We label the EN blocks, ask for the translated blocks
      // in the same order, separated by clear delimiters so we can
      // parse the response without regex acrobatics.
      const blocks = []
      blocks.push(`### TITLE\n${draft.symbol} — ${companyMeta?.name || draft.symbol}`)
      for (const s of SECTIONS) {
        const text = (draft[s.key] || '').trim()
        if (!text) continue
        blocks.push(`### ${s.key.toUpperCase()}\n${text}`)
      }
      if (blocks.length < 2) {
        setSavedMsg('Add EN content first.')
        setTimeout(() => setSavedMsg(''), 4000)
        return
      }
      const prompt = (
        `Translate this company study content to ${langName}.\n\n` +
        `Keep it simple and conversational. This is for retail investors who may not be finance experts.\n\n` +
        `Preserve all company names, stock symbols, and numbers as-is. Only translate the explanatory text.\n\n` +
        `Return the translation in the SAME block structure shown below, with the same "### LABEL" markers. ` +
        `For the TITLE block, return a short ${langName} title (4-8 words) describing what the company does. ` +
        `No preamble, no explanation.\n\n` +
        `Content to translate:\n\n` +
        blocks.join('\n\n')
      )
      const { text } = await askGemini(prompt, null, { systemHint: null })
      if (!text) throw new Error('Empty response')

      // Parse out each block. Tolerant — if a block is missing we
      // just leave that field alone.
      const parsed = parseTranslationBlocks(text)
      setDraft((d) => {
        const next = { ...d }
        if (parsed.TITLE) next[`title_${lang}`] = parsed.TITLE
        for (const s of SECTIONS) {
          const k = s.key.toUpperCase()
          if (parsed[k]) next[`${s.key}_${lang}`] = parsed[k]
        }
        return next
      })
      setSavedMsg(`✓ ${langName} translation generated`)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[CompanyStudiesAdmin] translation failed:', e)
      setSavedMsg('Translation failed: ' + (e?.message || e).slice(0, 160))
    } finally {
      setTranslating(null)
      setTimeout(() => setSavedMsg(''), 5000)
    }
  }

  async function confirmDelete(id) {
    setDeleteTarget(null)
    try {
      const { error } = await supabase.from('company_studies').delete().eq('id', id)
      if (error) throw error
      setSavedMsg('✓ Deleted')
      if (editingId === id) newStudy()
      refreshList()
    } catch (e) {
      setSavedMsg('Delete failed: ' + (e?.message || e))
    } finally {
      setTimeout(() => setSavedMsg(''), 4000)
    }
  }

  return (
    <div style={wrap}>
      <h2 style={h2}>Company Studies</h2>
      {savedMsg && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 4,
          background: savedMsg.startsWith('✓') ? 'rgba(34, 197, 94, 0.10)' : 'rgba(239, 68, 68, 0.10)',
          border: `1px solid ${savedMsg.startsWith('✓') ? '#22c55e' : '#ef4444'}`,
          color: savedMsg.startsWith('✓') ? '#86efac' : '#fca5a5',
          fontSize: 13,
        }}>
          {savedMsg}
        </div>
      )}

      {/* ── Published list ──────────────────────────────────────── */}
      <section style={card}>
        <div style={sectionHeader}>
          <h3 style={h3}>All Studies</h3>
          <button type="button" onClick={newStudy} style={primaryBtn}>+ New Study</button>
        </div>
        {listStatus === 'loading' && <p style={muted}>Loading…</p>}
        {listStatus === 'error' && <p style={muted}>Could not load.</p>}
        {listStatus === 'ready' && list.length === 0 && (
          <p style={muted}>No studies yet. Create one below.</p>
        )}
        {listStatus === 'ready' && list.length > 0 && (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>SYMBOL</th>
                <th style={th}>STATUS</th>
                <th style={th}>PUBLISHED</th>
                <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.symbol}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                      fontSize: 11, fontWeight: 700,
                      background: r.is_published ? 'rgba(34, 197, 94, 0.10)' : 'rgba(148, 163, 184, 0.10)',
                      color:      r.is_published ? '#86efac' : '#94A3B8',
                      border:     `1px solid ${r.is_published ? 'rgba(34, 197, 94, 0.30)' : 'rgba(148, 163, 184, 0.20)'}`,
                    }}>
                      {r.is_published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td style={td}>{r.published_at ? new Date(r.published_at).toLocaleDateString() : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" onClick={() => loadForEdit(r.id)} style={miniBtn}>Edit</button>
                    {r.is_published && (
                      <Link to={`/learn/company/${r.symbol}`} target="_blank" rel="noreferrer noopener" style={miniLink}>
                        Preview
                      </Link>
                    )}
                    <button type="button" onClick={() => setDeleteTarget({ id: r.id, symbol: r.symbol })} style={{ ...miniBtn, color: '#fca5a5' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Create / Edit form ──────────────────────────────────── */}
      <section style={{ ...card, marginTop: 18 }}>
        <div style={sectionHeader}>
          <h3 style={h3}>{editingId ? 'Edit study' : 'Create study'}</h3>
          <div style={{ fontSize: 12, color: '#94A3B8' }}>
            {companyMeta?.name ? `Detected: ${companyMeta.name} · ${companyMeta.sector || ''}` : (
              draft.symbol ? `Symbol "${draft.symbol}" not found in companies table` : ''
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={fieldLabel}>Symbol</label>
            <input
              type="text"
              value={draft.symbol}
              onChange={(e) => setField('symbol', e.target.value.toUpperCase())}
              style={inputStyle}
              placeholder="TEJASNET"
            />
          </div>
          <div>
            <label style={fieldLabel}>YouTube URL</label>
            <input
              type="url"
              value={draft.youtube_url}
              onChange={(e) => setField('youtube_url', e.target.value)}
              style={inputStyle}
              placeholder="https://youtu.be/…"
            />
          </div>
          <div>
            <label style={fieldLabel}>Podcast duration (sec)</label>
            <input
              type="number"
              min={0}
              value={draft.podcast_duration_seconds}
              onChange={(e) => setField('podcast_duration_seconds', e.target.value)}
              style={inputStyle}
              placeholder="1320"
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#CBD5E1' }}>
            <input
              type="checkbox"
              checked={!!draft.is_published}
              onChange={(e) => setField('is_published', e.target.checked)}
            />
            Published (visible to public at /learn/company/SYMBOL)
          </label>
        </div>

        {/* Language tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {LANGS.map((L) => (
            <button
              key={L.key}
              type="button"
              onClick={() => setActiveLang(L.key)}
              style={{
                padding: '6px 12px',
                fontSize: 12, fontWeight: 700,
                borderRadius: 4, cursor: 'pointer',
                background: activeLang === L.key ? '#FBBF24' : 'transparent',
                color:      activeLang === L.key ? '#0B0E11' : '#CBD5E1',
                border:     `1px solid ${activeLang === L.key ? '#FBBF24' : '#1E2530'}`,
              }}
              title={L.display}
            >
              {L.label}
            </button>
          ))}
          {activeLang !== 'en' && (
            <button
              type="button"
              onClick={() => generateTranslation(activeLang)}
              disabled={translating === activeLang}
              style={{
                marginLeft: 'auto',
                padding: '6px 12px',
                fontSize: 12, fontWeight: 600,
                borderRadius: 4, cursor: translating ? 'wait' : 'pointer',
                background: 'rgba(99, 102, 241, 0.10)',
                color: '#a5b4fc',
                border: '1px solid rgba(99, 102, 241, 0.30)',
              }}
            >
              {translating === activeLang ? 'Translating…' : `✨ Generate ${NON_EN_LANG_NAMES[activeLang]} with Gemini`}
            </button>
          )}
        </div>

        {/* Title (non-EN only) */}
        {activeLang !== 'en' && (
          <div style={{ marginBottom: 12 }}>
            <label style={fieldLabel}>Title ({activeLang.toUpperCase()})</label>
            <input
              type="text"
              value={draft[`title_${activeLang}`] || ''}
              onChange={(e) => setField(`title_${activeLang}`, e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        {/* Section textareas — EN columns when activeLang=en, otherwise the _xx variant. */}
        {SECTIONS.map((S) => {
          const fieldKey = activeLang === 'en' ? S.key : `${S.key}_${activeLang}`
          return (
            <div key={S.key} style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>{S.label}</label>
              <textarea
                rows={5}
                value={draft[fieldKey] || ''}
                onChange={(e) => setField(fieldKey, e.target.value)}
                style={textareaStyle}
                placeholder={activeLang === 'en'
                  ? `${S.label}…`
                  : `${S.label} (${activeLang.toUpperCase()})`}
              />
            </div>
          )
        })}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => save(false)} disabled={saving} style={secondaryBtn}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={() => save(true)} disabled={saving} style={primaryBtn}>
            {saving ? 'Publishing…' : 'Publish'}
          </button>
          <button type="button" onClick={newStudy} style={ghostBtn}>Cancel</button>
        </div>
      </section>

      {/* ── Delete confirmation modal ───────────────────────────── */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setDeleteTarget(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(11, 14, 17, 0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 380, width: '100%',
              background: '#0F1217', border: '1px solid #1E2530',
              borderRadius: 8, padding: '20px 22px', color: '#E2E8F0',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              Delete {deleteTarget.symbol} study?
            </h3>
            <p style={{ margin: '8px 0 16px', fontSize: 13, color: '#CBD5E1' }}>
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setDeleteTarget(null)} style={ghostBtn}>Cancel</button>
              <button type="button" onClick={() => confirmDelete(deleteTarget.id)} style={{
                padding: '8px 14px', border: 'none', background: '#ef4444', color: '#fff',
                fontSize: 13, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────

function parseTranslationBlocks(text) {
  // Parse blocks of "### LABEL\n<content>" emitted by Gemini. Tolerant
  // to leading/trailing whitespace and to the model occasionally
  // wrapping content in ``` fences (strip them).
  const out = {}
  const cleaned = String(text || '').replace(/```[a-z]*\n?/gi, '').replace(/```\n?/g, '')
  const parts = cleaned.split(/^###\s+/m).filter(Boolean)
  for (const part of parts) {
    const idx = part.indexOf('\n')
    const label = idx >= 0 ? part.slice(0, idx).trim().toUpperCase() : part.trim().toUpperCase()
    const body  = idx >= 0 ? part.slice(idx + 1).trim() : ''
    if (label && body) out[label] = body
  }
  return out
}

// ── Styles ──────────────────────────────────────────────────────

const wrap = { padding: 20, color: '#E2E8F0' }
const h2 = { margin: '0 0 16px', fontSize: 18, fontWeight: 700 }
const h3 = { margin: 0, fontSize: 14, fontWeight: 700 }
const card = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid #1E2530',
  borderRadius: 8,
  padding: 18,
}
const sectionHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 12, flexWrap: 'wrap', gap: 8,
}
const muted = { fontSize: 12, color: '#94A3B8' }
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const th = {
  textAlign: 'left', padding: '8px 10px',
  fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: '#64748B', borderBottom: '1px solid #1E2530', fontWeight: 700,
}
const td = { padding: '10px', borderBottom: '1px solid #1E2530', color: '#CBD5E1' }
const fieldLabel = {
  display: 'block', marginBottom: 4,
  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: '#94A3B8', fontWeight: 600,
}
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px',
  background: '#16191F', border: '1px solid #2A323D',
  borderRadius: 4, color: '#E2E8F0', fontSize: 13, outline: 'none',
}
const textareaStyle = { ...inputStyle, fontFamily: 'inherit', lineHeight: 1.55 }
const primaryBtn = {
  padding: '8px 14px', background: '#FBBF24', color: '#0B0E11',
  border: 'none', borderRadius: 4,
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
const secondaryBtn = {
  padding: '8px 14px', background: 'transparent', color: '#FBBF24',
  border: '1px solid #FBBF24', borderRadius: 4,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const ghostBtn = {
  padding: '8px 14px', background: 'transparent', color: '#CBD5E1',
  border: '1px solid #1E2530', borderRadius: 4,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const miniBtn = {
  marginLeft: 6,
  padding: '4px 8px', background: 'transparent', color: '#CBD5E1',
  border: '1px solid #1E2530', borderRadius: 3,
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
}
const miniLink = {
  marginLeft: 6,
  display: 'inline-block',
  padding: '4px 8px', color: '#CBD5E1',
  border: '1px solid #1E2530', borderRadius: 3,
  fontSize: 11, fontWeight: 600, textDecoration: 'none',
}
