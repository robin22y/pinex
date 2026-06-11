import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context'
import { askGemini, getStoredGeminiKey } from '../../lib/researchAssistant'

import Icon from '../../components/ui/Icon'
const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'ta', label: 'Tamil' },
]

const LANG_NATIVE = {
  hi: 'Hindi (हिन्दी)',
  ml: 'Malayalam (മലയാളം)',
  ta: 'Tamil (தமிழ்)',
}

// ── AdminTranslateRow ────────────────────────────────────────────────
// One-tap "translate lesson content from English" button that uses the
// admin's own browser-stored Gemini key (BYOK — same key the Research
// Assistant uses). Translates BOTH the lesson body (content_en →
// content_<lang>) AND the optional chart caption (visual_caption_en →
// visual_caption_<lang>) into the currently-edited language.
//
// Why client-side BYOK rather than a Netlify proxy: the admin already
// has a Gemini key in localStorage for the Research Assistant, every
// admin trivially has one, and a proxy would require a new server-side
// env var + new function deploy without any user-facing benefit. Same
// privacy posture as the rest of the BYOK features — key never leaves
// the admin's browser.
//
// The translated text is written into local editor state (NOT directly
// to Supabase) so the admin can review and edit before clicking Save.
// Same one-undo-step flow the rest of the editor uses.
function AdminTranslateRow({ editLesson, lang, onTranslated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasKey = !!getStoredGeminiKey()
  const langLabel = LANG_NATIVE[lang] || lang

  async function translateOne(field) {
    const src = String(editLesson?.[field] || '').trim()
    if (!src) return null
    const prompt =
      `Translate the following finance-education content to ${langLabel} for an Indian retail-trader audience.\n\n` +
      `Rules:\n` +
      `- Translate naturally, not literally. Keep flow and tone.\n` +
      `- Keep these in English verbatim: PineX, NSE, BSE, Nifty, Sensex, all stock symbols (RELIANCE, TCS, etc.), numbers, percentages, ₹ amounts, technical terms (RSI, OHLC, MA, EPS, ROE, OBV, MACD).\n` +
      `- Preserve every paragraph break and bullet structure (→ markers, etc.).\n` +
      `- Do NOT add a preface, explanation, or commentary. Output ONLY the translated text.\n\n` +
      `Source:\n${src}`
    const { text } = await askGemini(
      prompt,
      { symbol: '', companyName: '', phase: '', sector: '', narrative: '' },
      {
        systemPromptOverride: 'You are a precise finance-education translator. Output ONLY the translation, with no commentary.',
        maxOutputTokens: 4000,
        temperature: 0.3,
        topP: 0.9,
      },
    )
    return String(text || '').trim()
  }

  async function run() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const bodyTr = await translateOne('content_en')
      const capTr  = await translateOne('visual_caption_en')
      onTranslated({
        ...editLesson,
        ...(bodyTr ? { [`content_${lang}`]: bodyTr } : {}),
        ...(capTr  ? { [`visual_caption_${lang}`]: capTr } : {}),
      })
    } catch (e) {
      setError(e?.message || 'Translation failed. Check your Gemini key in /account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 10,
        padding: '8px 10px',
        background: 'rgba(245,159,11,0.06)',
        border: '1px solid rgba(245,159,11,0.25)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 180 }}>
        Translate from English with Gemini → fills content + caption for review.
      </span>
      {hasKey ? (
        <button
          type="button"
          onClick={run}
          disabled={busy}
          style={{
            padding: '6px 12px',
            background: busy ? 'var(--bg-elevated)' : '#F59F0B',
            color: busy ? 'var(--text-muted)' : '#000',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {busy ? `Translating to ${LANGS.find((l) => l.code === lang)?.label}…` : `🌐 Translate to ${LANGS.find((l) => l.code === lang)?.label}`}
        </button>
      ) : (
        <span style={{ color: 'var(--text-hint)', fontSize: 11 }}>
          Add a Gemini key at /account to enable.
        </span>
      )}
      {error && (
        <span style={{ color: '#F87171', fontSize: 11, width: '100%' }}>{error}</span>
      )}
    </div>
  )
}

const BLANK_MODULE = {
  id: '',
  title_en: '', title_hi: '', title_ml: '', title_ta: '',
  subtitle_en: '', subtitle_hi: '', subtitle_ml: '', subtitle_ta: '',
  icon: '📘',
  duration: '10 min',
  sort_order: 10,
  is_published: false,
  is_pro: false,
  pass_mark: 4,
  total_questions: 5,
  points_on_complete: 0,
}

export default function AcademyAdmin() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [modules, setModules] = useState([])
  const [selected, setSelected] = useState(null)
  const [lessons, setLessons] = useState([])
  const [questions, setQuestions] = useState([])
  const [editLesson, setEditLesson] = useState(null)
  const [editQuestion, setEditQuestion] = useState(null)
  const [lang, setLang] = useState('en')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(null)
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  // Module form state — drives both the create modal and the edit modal.
  // mode: 'create' opens the form blank and INSERTs on save; 'edit'
  // pre-fills with an existing module's data and UPDATEs on save with
  // the id locked. Single form, two flows — no parallel UIs to maintain.
  const [moduleFormMode, setModuleFormMode] = useState(null) // 'create' | 'edit' | null
  const [moduleForm, setModuleForm] = useState(BLANK_MODULE)
  const [moduleFormError, setModuleFormError] = useState(null)

  useEffect(() => {
    const role = profile?.role
    if (profile && role !== 'admin' && role !== 'superadmin') {
      navigate('/')
      return
    }
    loadModules()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  useEffect(() => {
    if (selected) loadContent(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // ── Unsaved-edit guard ─────────────────────────────────────────
  // Block an accidental reload / tab close while the user is
  // pasting into a lesson body or editing a question. The native
  // beforeunload prompt is the strongest signal we can give
  // without intercepting in-app navigation. modern browsers show a
  // generic localised message regardless of returnValue text.
  useEffect(() => {
    const hasEdits = !!(editLesson || editQuestion || moduleFormMode)
    if (!hasEdits) return
    const onBefore = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [editLesson, editQuestion, moduleFormMode])

  const loadModules = async () => {
    const { data } = await supabase
      .from('academy_modules')
      .select('*')
      .order('sort_order')
    setModules(data || [])
    if (data?.length && !selected) {
      setSelected(data[0].id)
    }
  }

  // Track the module id whose content is currently loaded so a
  // re-fire of the [selected] effect can decide whether to nuke
  // edit state or preserve it. Without this, ANY re-trigger (focus
  // regain → AuthContext refresh, HMR after a save, StrictMode
  // double-invoke) silently wiped the user's mid-edit paste — the
  // "page just refreshes and goes to other modules" symptom in the
  // bug report.
  const loadedFor = useRef(null)

  const loadContent = async (moduleId) => {
    const [lRes, qRes] = await Promise.all([
      supabase
        .from('academy_lessons')
        .select('*')
        .eq('module_id', moduleId)
        .order('sort_order'),
      supabase
        .from('academy_questions')
        .select('*')
        .eq('module_id', moduleId)
        .order('sort_order'),
    ])
    const nextLessons = lRes.data || []
    const nextQuestions = qRes.data || []
    setLessons(nextLessons)
    setQuestions(nextQuestions)

    // EDIT-STATE PRESERVATION — only clear the in-flight edit when:
    //   (a) the user switched to a different module, OR
    //   (b) the edit target was deleted upstream (no row with that id
    //       in the freshly-fetched list).
    // Otherwise the user is mid-paste and the re-fetch is incidental
    // (focus regain, HMR, etc.) — leave their work alone.
    const sameModule = loadedFor.current === moduleId
    loadedFor.current = moduleId

    if (!sameModule) {
      setEditLesson(null)
      setEditQuestion(null)
      return
    }
    if (editLesson && !nextLessons.some((l) => l.id === editLesson.id)) {
      setEditLesson(null)
    }
    if (editQuestion && !nextQuestions.some((q) => q.id === editQuestion.id)) {
      setEditQuestion(null)
    }
  }

  const saveLesson = async () => {
    if (!editLesson) return
    setSaving(true)
    // BUG FIX — title was never in the update payload, so the
    // hardcoded "New lesson" set at INSERT time stuck forever
    // (visible at the top of /learn/<module>/<lesson> as the header).
    // Now writes it on every save. Empty title falls back to a
    // sensible "Lesson N" rather than blank-string-overwrite so a
    // half-edited row still reads cleanly.
    const titleClean = String(editLesson.title || '').trim()
    const titleToSave = titleClean || `Lesson ${editLesson.sort_order || ''}`.trim()
    const { error } = await supabase
      .from('academy_lessons')
      .update({
        title: titleToSave,
        [`content_${lang}`]: editLesson[`content_${lang}`],
        [`visual_caption_${lang}`]: editLesson[`visual_caption_${lang}`],
        visual_image_url: editLesson.visual_image_url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editLesson.id)

    setSaving(false)
    if (!error) {
      setSaved(editLesson.id)
      setTimeout(() => setSaved(null), 2000)
      loadContent(selected)
    }
  }

  const saveQuestion = async () => {
    if (!editQuestion) return
    setSaving(true)
    const updates = {}
    LANGS.forEach((l) => {
      updates[`question_${l.code}`] = editQuestion[`question_${l.code}`]
      updates[`explanation_${l.code}`] = editQuestion[`explanation_${l.code}`]
      ;[1, 2, 3, 4].forEach((n) => {
        updates[`option${n}_${l.code}`] = editQuestion[`option${n}_${l.code}`]
      })
    })
    updates.correct_option = editQuestion.correct_option

    const { error } = await supabase
      .from('academy_questions')
      .update(updates)
      .eq('id', editQuestion.id)

    setSaving(false)
    if (!error) {
      setSaved('q_' + editQuestion.id)
      setTimeout(() => setSaved(null), 2000)
      loadContent(selected)
    }
  }

  const uploadImage = async (file, lessonId) => {
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `lessons/${lessonId}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('academy')
      .upload(path, file, {
        upsert: true,
        contentType: file.type,
      })

    if (!upErr) {
      const {
        data: { publicUrl },
      } = supabase.storage.from('academy').getPublicUrl(path)

      const updated = {
        ...editLesson,
        visual_image_url: publicUrl,
        visual_type: 'image',
      }
      setEditLesson(updated)

      await supabase
        .from('academy_lessons')
        .update({
          visual_image_url: publicUrl,
          visual_type: 'image',
          updated_at: new Date().toISOString(),
        })
        .eq('id', lessonId)

      loadContent(selected)
    }
    setUploading(false)
  }

  // ── Module / lesson / question creation ────────────────────────────
  // The admin creates a module shell here (all 4 language slots up front).
  // Lessons + questions get added empty and filled via the existing edit
  // flow, which already handles per-language saves correctly.

  const saveModuleForm = async () => {
    setModuleFormError(null)
    const m = moduleForm
    const isCreate = moduleFormMode === 'create'

    // Validation. id is required only on create — edit locks the id
    // since it's the PK and changing it would orphan lessons/questions.
    if (isCreate) {
      if (!m.id?.trim()) {
        setModuleFormError('Module id is required (e.g. "options_basics").')
        return
      }
      if (!/^[a-z0-9_]+$/.test(m.id.trim())) {
        setModuleFormError(
          'Module id can only contain lowercase letters, digits and _.',
        )
        return
      }
    }
    if (!m.title_en?.trim()) {
      setModuleFormError('English title is required.')
      return
    }

    setSaving(true)
    // Strip the id from the UPDATE payload to make absolutely sure we
    // never accidentally rewrite the PK (which would orphan child rows).
    const { id, ...rest } = m
    const payload = {
      ...rest,
      sort_order: Number(m.sort_order) || 0,
      pass_mark: Number(m.pass_mark) || 0,
      total_questions: Number(m.total_questions) || 0,
      points_on_complete: Number(m.points_on_complete) || 0,
    }

    let error
    if (isCreate) {
      ;({ error } = await supabase
        .from('academy_modules')
        .insert({ ...payload, id: id.trim() }))
    } else {
      ;({ error } = await supabase
        .from('academy_modules')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id))
    }
    setSaving(false)
    if (error) {
      // Most likely: duplicate id (create), RLS denies INSERT/UPDATE,
      // or a column the admin tweaked is NOT NULL. Surface verbatim.
      setModuleFormError(error.message || 'Failed to save module.')
      return
    }
    setModuleFormMode(null)
    setModuleForm(BLANK_MODULE)
    await loadModules()
    if (isCreate) setSelected(id.trim())
  }

  const addLesson = async () => {
    if (!selected) return
    // Append at the end. Numbered placeholder rather than the stale
    // "New lesson" string so a forgotten title still reads as
    // "Lesson 3" / "Lesson 4" rather than every lesson sharing the
    // same generic header (the bug-report screenshot).
    const nextOrder = (lessons[lessons.length - 1]?.sort_order || 0) + 1
    const { error } = await supabase.from('academy_lessons').insert({
      module_id: selected,
      sort_order: nextOrder,
      title: `Lesson ${nextOrder}`,
      content_en: '',
      visual_type: 'none',
      is_published: true,
    })
    if (!error) await loadContent(selected)
  }

  const addQuestion = async () => {
    if (!selected) return
    const nextOrder = (questions[questions.length - 1]?.sort_order || 0) + 1
    const insert = {
      module_id: selected,
      sort_order: nextOrder,
      correct_option: 1,
      is_published: true,
    }
    // Seed every per-language column so the existing UPDATE flow can
    // write to them without hitting NOT NULL constraints on re-save.
    LANGS.forEach((l) => {
      insert[`question_${l.code}`] = ''
      insert[`explanation_${l.code}`] = ''
      ;[1, 2, 3, 4].forEach((n) => {
        insert[`option${n}_${l.code}`] = ''
      })
    })
    const { error } = await supabase.from('academy_questions').insert(insert)
    if (!error) await loadContent(selected)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 0 }}>
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => navigate('/admin')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <Icon name="arrow-left" style={{ fontSize: 18 }} />
          </button>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            Academy Editor
          </div>
        </div>

        {/* Language picker */}
        <div style={{ display: 'flex', gap: 4 }}>
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: lang === l.code ? 'var(--accent)' : 'transparent',
                color: lang === l.code ? '#000' : 'var(--text-muted)',
                fontSize: 11,
                fontWeight: lang === l.code ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          height: 'calc(100vh - 57px)',
          overflow: 'hidden',
        }}
      >
        {/* Sidebar — modules */}
        <div
          style={{
            width: 200,
            borderRight: '1px solid var(--border)',
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            flexShrink: 0,
          }}
        >
          {/* + New Module — opens the per-language creation modal. */}
          <button
            onClick={() => {
              setModuleFormError(null)
              // Suggest a sort_order one past the current max so the new
              // module lands at the bottom of the list by default.
              const nextOrder =
                (modules[modules.length - 1]?.sort_order || 0) + 1
              setModuleForm({ ...BLANK_MODULE, sort_order: nextOrder })
              setModuleFormMode('create')
            }}
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'var(--bg-elevated)',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              color: 'var(--accent)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="plus" style={{ fontSize: 14 }} />
            New module
          </button>

          {modules.length === 0 ? (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              No modules yet. Click <strong>+ New module</strong> above.
            </div>
          ) : (
            modules.map((mod) => (
              // Row container: clickable label fills most of the width,
              // a small ✎ button on the right opens the edit modal. Two
              // separate <button>s so a click on ✎ doesn't bubble into
              // the row-select handler.
              <div
                key={mod.id}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  background:
                    selected === mod.id ? 'var(--bg-elevated)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  borderLeft:
                    selected === mod.id
                      ? '3px solid var(--accent)'
                      : '3px solid transparent',
                }}
              >
                <button
                  onClick={() => setSelected(mod.id)}
                  style={{
                    flex: 1,
                    padding: '12px 4px 12px 14px',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: selected === mod.id ? 700 : 400,
                      color:
                        selected === mod.id
                          ? 'var(--text-primary)'
                          : 'var(--text-muted)',
                      marginBottom: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {mod.icon} {mod.title_en}
                  </div>
                  {/* Unpublished badge so admins can tell at a glance
                      which modules are still hidden from learners. */}
                  {!mod.is_published && (
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: 'var(--text-hint)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Draft
                    </div>
                  )}
                </button>
                <button
                  title="Edit module metadata"
                  onClick={(e) => {
                    e.stopPropagation()
                    setModuleFormError(null)
                    // Hydrate the form with the existing row. Coerce
                    // null/undefined per-language fields to '' so the
                    // controlled inputs stay controlled.
                    const hydrated = { ...BLANK_MODULE, ...mod }
                    LANGS.forEach((l) => {
                      hydrated[`title_${l.code}`] =
                        hydrated[`title_${l.code}`] || ''
                      hydrated[`subtitle_${l.code}`] =
                        hydrated[`subtitle_${l.code}`] || ''
                    })
                    setModuleForm(hydrated)
                    setModuleFormMode('edit')
                  }}
                  style={{
                    width: 32,
                    background: 'transparent',
                    border: 'none',
                    borderLeft: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <Icon name="pencil" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Lessons header + add button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Lessons
            </div>
            {selected && (
              <button
                onClick={addLesson}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--accent-border)',
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Add lesson
              </button>
            )}
          </div>

          {lessons.map((lesson) => (
            <div
              key={lesson.id}
              style={{
                background:
                  editLesson?.id === lesson.id
                    ? 'var(--bg-elevated)'
                    : 'var(--bg-surface)',
                border:
                  editLesson?.id === lesson.id
                    ? '1px solid var(--accent-border)'
                    : '1px solid var(--border)',
                borderRadius: 10,
                marginBottom: 10,
                overflow: 'hidden',
              }}
            >
              {/* Lesson header */}
              <div
                onClick={() =>
                  setEditLesson(editLesson?.id === lesson.id ? null : { ...lesson })
                }
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}
                >
                  {lesson.sort_order}. {lesson.title}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {lesson.visual_image_url && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '2px 6px',
                        borderRadius: 8,
                        background: 'var(--info-dim)',
                        color: 'var(--info)',
                      }}
                    >
                      IMG
                    </span>
                  )}
                  {lesson.visual_chart_type && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '2px 6px',
                        borderRadius: 8,
                        background: 'var(--accent-dim)',
                        color: 'var(--accent)',
                      }}
                    >
                      CHART
                    </span>
                  )}
                  <Icon
                    name={editLesson?.id === lesson.id ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    style={{ color: 'var(--text-hint)' }}
                  />
                </div>
              </div>

              {/* Edit panel */}
              {editLesson?.id === lesson.id && (
                <div
                  style={{
                    padding: '0 14px 14px',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  {/* Lesson title — shared across all languages
                      (academy_lessons.title is a single column, not
                      per-language). This was missing from the editor,
                      so admins couldn't change the "New lesson"
                      placeholder seeded at insert time and every
                      lesson rendered with the same header. */}
                  <div style={{ marginTop: 12, marginBottom: 10 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      Lesson title
                    </label>
                    <input
                      value={editLesson.title || ''}
                      onChange={(e) =>
                        setEditLesson((l) => ({ ...l, title: e.target.value }))
                      }
                      placeholder={`Lesson ${editLesson.sort_order}`}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: 14,
                        fontWeight: 600,
                        outline: 'none',
                      }}
                    />
                  </div>

                  {/* Translate-from-English row — only shown when the
                      editor is on a non-EN tab and the EN content has
                      something to translate. Uses the admin's own
                      browser-stored Gemini key (BYOK), so no server-
                      side proxy is required. Same askGemini path the
                      Research Assistant uses, with model routed to the
                      cheap flash-lite tier (translation tasks land
                      well within its quality bar). */}
                  {lang !== 'en' && (editLesson.content_en || '').trim() && (
                    <AdminTranslateRow
                      editLesson={editLesson}
                      lang={lang}
                      onTranslated={(nextLessonState) => setEditLesson(nextLessonState)}
                    />
                  )}

                  {/* Content textarea */}
                  <div style={{ marginTop: 12, marginBottom: 10 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      Content ({LANGS.find((l) => l.code === lang)?.label})
                    </label>
                    <textarea
                      value={editLesson[`content_${lang}`] || ''}
                      onChange={(e) =>
                        setEditLesson((l) => ({
                          ...l,
                          [`content_${lang}`]: e.target.value,
                        }))
                      }
                      rows={10}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        lineHeight: 1.6,
                        fontFamily: 'var(--font-mono)',
                        resize: 'vertical',
                        outline: 'none',
                      }}
                    />
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text-hint)',
                        marginTop: 4,
                      }}
                    >
                      Use → at start of line for key points
                    </div>
                  </div>

                  {/* Caption */}
                  <div style={{ marginBottom: 12 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      Chart caption ({LANGS.find((l) => l.code === lang)?.label})
                    </label>
                    <input
                      value={editLesson[`visual_caption_${lang}`] || ''}
                      onChange={(e) =>
                        setEditLesson((l) => ({
                          ...l,
                          [`visual_caption_${lang}`]: e.target.value,
                        }))
                      }
                      placeholder="Optional caption..."
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        outline: 'none',
                      }}
                    />
                  </div>

                  {/* Image upload */}
                  <div style={{ marginBottom: 12 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      Chart image upload
                    </label>

                    {editLesson.visual_image_url && (
                      <div style={{ marginBottom: 8 }}>
                        <img
                          src={editLesson.visual_image_url}
                          alt="current"
                          style={{
                            width: '100%',
                            maxHeight: 160,
                            objectFit: 'cover',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                          }}
                        />
                      </div>
                    )}

                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const f = e.target.files[0]
                        if (f) {
                          await uploadImage(f, lesson.id)
                        }
                      }}
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-muted)',
                        fontSize: 12,
                        cursor: uploading ? 'wait' : 'pointer',
                      }}
                    >
                      {uploading
                        ? 'Uploading...'
                        : editLesson.visual_image_url
                        ? '🔄 Replace image'
                        : '📷 Upload image'}
                    </button>
                  </div>

                  {/* Save */}
                  <button
                    onClick={saveLesson}
                    disabled={saving}
                    style={{
                      padding: '10px 20px',
                      borderRadius: 8,
                      border: 'none',
                      background: saved === lesson.id ? '#00C805' : 'var(--accent)',
                      color: '#000',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: saving ? 'wait' : 'pointer',
                    }}
                  >
                    {saving
                      ? 'Saving...'
                      : saved === lesson.id
                      ? '✓ Saved!'
                      : 'Save changes'}
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Questions header + add button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '20px 0 10px',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Quiz Questions
            </div>
            {selected && (
              <button
                onClick={addQuestion}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--accent-border)',
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Add question
              </button>
            )}
          </div>

          {questions.map((q, qi) => (
            <div
              key={q.id}
              style={{
                background:
                  editQuestion?.id === q.id
                    ? 'var(--bg-elevated)'
                    : 'var(--bg-surface)',
                border:
                  editQuestion?.id === q.id
                    ? '1px solid var(--accent-border)'
                    : '1px solid var(--border)',
                borderRadius: 10,
                marginBottom: 10,
                overflow: 'hidden',
              }}
            >
              <div
                onClick={() =>
                  setEditQuestion(editQuestion?.id === q.id ? null : { ...q })
                }
                style={{
                  padding: '12px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    flex: 1,
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      marginRight: 6,
                    }}
                  >
                    Q{qi + 1}.
                  </span>
                  {q[`question_${lang}`] || q.question_en}
                </div>
                <Icon
                  name={editQuestion?.id === q.id ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  style={{
                    color: 'var(--text-hint)',
                    flexShrink: 0,
                  }}
                />
              </div>

              {editQuestion?.id === q.id && (
                <div
                  style={{
                    padding: '0 14px 14px',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  {/* Question text */}
                  <div style={{ marginTop: 12 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      Question text ({LANGS.find((l) => l.code === lang)?.label})
                    </label>
                    <textarea
                      value={editQuestion[`question_${lang}`] || ''}
                      onChange={(e) =>
                        setEditQuestion((qq) => ({
                          ...qq,
                          [`question_${lang}`]: e.target.value,
                        }))
                      }
                      rows={3}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        resize: 'vertical',
                        outline: 'none',
                        marginBottom: 10,
                      }}
                    />
                  </div>

                  {/* Options */}
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} style={{ marginBottom: 8 }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          marginBottom: 3,
                        }}
                      >
                        <button
                          onClick={() =>
                            setEditQuestion((qq) => ({
                              ...qq,
                              correct_option: n,
                            }))
                          }
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            border: `2px solid ${
                              editQuestion.correct_option === n
                                ? '#00C805'
                                : 'var(--border)'
                            }`,
                            background:
                              editQuestion.correct_option === n
                                ? '#00C805'
                                : 'transparent',
                            cursor: 'pointer',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            color:
                              editQuestion.correct_option === n
                                ? '#000'
                                : 'var(--text-muted)',
                            fontWeight: 700,
                          }}
                          title="Mark as correct"
                        >
                          {['A', 'B', 'C', 'D'][n - 1]}
                        </button>
                        <input
                          value={editQuestion[`option${n}_${lang}`] || ''}
                          onChange={(e) =>
                            setEditQuestion((qq) => ({
                              ...qq,
                              [`option${n}_${lang}`]: e.target.value,
                            }))
                          }
                          placeholder={`Option ${n}`}
                          style={{
                            flex: 1,
                            padding: '7px 10px',
                            borderRadius: 6,
                            border:
                              editQuestion.correct_option === n
                                ? '1px solid rgba(0,200,5,0.4)'
                                : '1px solid var(--border)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* Explanation */}
                  <div style={{ marginTop: 8, marginBottom: 12 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        display: 'block',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      Explanation after answer
                    </label>
                    <textarea
                      value={editQuestion[`explanation_${lang}`] || ''}
                      onChange={(e) =>
                        setEditQuestion((qq) => ({
                          ...qq,
                          [`explanation_${lang}`]: e.target.value,
                        }))
                      }
                      rows={3}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        resize: 'vertical',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <button
                    onClick={saveQuestion}
                    disabled={saving}
                    style={{
                      padding: '10px 20px',
                      borderRadius: 8,
                      border: 'none',
                      background:
                        saved === 'q_' + q.id ? '#00C805' : 'var(--accent)',
                      color: '#000',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: saving ? 'wait' : 'pointer',
                    }}
                  >
                    {saving
                      ? 'Saving...'
                      : saved === 'q_' + q.id
                      ? '✓ Saved!'
                      : 'Save question'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Module form modal — create + edit ──────────────────────── */}
      {/* All four language slots are visible up front so the admin can */}
      {/* localize the title + subtitle in one pass. Edit mode locks    */}
      {/* the id field (it's the PK and child rows reference it).       */}
      {moduleFormMode && (
        <div
          onClick={() => setModuleFormMode(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '40px 16px',
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 720,
              background: 'var(--bg-surface)',
              borderRadius: 12,
              border: '1px solid var(--border)',
              padding: 20,
              maxHeight: 'calc(100vh - 80px)',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                }}
              >
                {moduleFormMode === 'create'
                  ? 'Create new module'
                  : `Edit module — ${moduleForm.id}`}
              </div>
              <button
                onClick={() => setModuleFormMode(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 18,
                }}
              >
                <Icon name="x" />
              </button>
            </div>

            {/* Core fields */}
            <Section title="Identifier">
              <Field
                label="Module id (slug, lowercase, no spaces)"
                hint={
                  moduleFormMode === 'edit'
                    ? 'Locked — the id is the primary key and is referenced by all lessons and quiz questions in this module.'
                    : 'e.g. options_basics — used as PRIMARY KEY'
                }
              >
                <input
                  value={moduleForm.id}
                  disabled={moduleFormMode === 'edit'}
                  onChange={(e) =>
                    setModuleForm((m) => ({ ...m, id: e.target.value }))
                  }
                  placeholder="options_basics"
                  style={{
                    ...inputStyle,
                    opacity: moduleFormMode === 'edit' ? 0.5 : 1,
                    cursor:
                      moduleFormMode === 'edit' ? 'not-allowed' : 'text',
                  }}
                />
              </Field>
              <Row>
                <Field label="Icon">
                  <input
                    value={moduleForm.icon}
                    onChange={(e) =>
                      setModuleForm((m) => ({ ...m, icon: e.target.value }))
                    }
                    placeholder="📘"
                    style={{ ...inputStyle, fontSize: 18 }}
                  />
                </Field>
                <Field label="Duration">
                  <input
                    value={moduleForm.duration}
                    onChange={(e) =>
                      setModuleForm((m) => ({
                        ...m,
                        duration: e.target.value,
                      }))
                    }
                    placeholder="10 min"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Sort order">
                  <input
                    type="number"
                    value={moduleForm.sort_order}
                    onChange={(e) =>
                      setModuleForm((m) => ({
                        ...m,
                        sort_order: e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
              </Row>
            </Section>

            {/* Per-language titles */}
            <Section title="Title — one per language">
              {LANGS.map((l) => (
                <Field key={l.code} label={`Title (${l.label})`}>
                  <input
                    value={moduleForm[`title_${l.code}`] || ''}
                    onChange={(e) =>
                      setModuleForm((m) => ({
                        ...m,
                        [`title_${l.code}`]: e.target.value,
                      }))
                    }
                    placeholder={
                      l.code === 'en' ? 'Your module title' : `${l.label} title`
                    }
                    style={inputStyle}
                  />
                </Field>
              ))}
            </Section>

            {/* Per-language subtitles */}
            <Section title="Subtitle — one per language (optional)">
              {LANGS.map((l) => (
                <Field key={l.code} label={`Subtitle (${l.label})`}>
                  <input
                    value={moduleForm[`subtitle_${l.code}`] || ''}
                    onChange={(e) =>
                      setModuleForm((m) => ({
                        ...m,
                        [`subtitle_${l.code}`]: e.target.value,
                      }))
                    }
                    placeholder={`Short tagline shown on the academy card`}
                    style={inputStyle}
                  />
                </Field>
              ))}
            </Section>

            {/* Quiz + publish flags */}
            <Section title="Quiz & access">
              <Row>
                <Field label="Pass mark">
                  <input
                    type="number"
                    value={moduleForm.pass_mark}
                    onChange={(e) =>
                      setModuleForm((m) => ({
                        ...m,
                        pass_mark: e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Total questions">
                  <input
                    type="number"
                    value={moduleForm.total_questions}
                    onChange={(e) =>
                      setModuleForm((m) => ({
                        ...m,
                        total_questions: e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Points on complete">
                  <input
                    type="number"
                    value={moduleForm.points_on_complete}
                    onChange={(e) =>
                      setModuleForm((m) => ({
                        ...m,
                        points_on_complete: e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Published">
                  <Toggle
                    checked={moduleForm.is_published}
                    onChange={(v) =>
                      setModuleForm((m) => ({ ...m, is_published: v }))
                    }
                    hint="Off = invisible to learners; flip on once content is filled in."
                  />
                </Field>
                <Field label="Pro-only">
                  <Toggle
                    checked={moduleForm.is_pro}
                    onChange={(v) =>
                      setModuleForm((m) => ({ ...m, is_pro: v }))
                    }
                    hint="Gated to paid plan when paid tier launches."
                  />
                </Field>
              </Row>
            </Section>

            {moduleFormError && (
              <div
                style={{
                  padding: 10,
                  marginBottom: 12,
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  fontSize: 12,
                }}
              >
                {moduleFormError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setModuleFormMode(null)}
                style={{
                  padding: '10px 18px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveModuleForm}
                disabled={saving}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#000',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >
                {saving
                  ? 'Saving…'
                  : moduleFormMode === 'create'
                  ? 'Create module'
                  : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Small layout helpers used only by the create-module modal ─────────
// Kept local to this file because the styling is one-off and inlined
// throughout the rest of the page already.

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 13,
  outline: 'none',
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 10, flex: 1 }}>
      <label
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          display: 'block',
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-hint)',
            marginTop: 3,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}

function Row({ children }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 0 }}>{children}</div>
  )
}

function Toggle({ checked, onChange, hint }) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: checked ? 'var(--accent)' : 'transparent',
          color: checked ? '#000' : 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {checked ? 'ON' : 'OFF'}
      </button>
      {hint && (
        <div style={{ fontSize: 10, color: 'var(--text-hint)', marginTop: 3 }}>
          {hint}
        </div>
      )}
    </div>
  )
}
