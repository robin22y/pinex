import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context'

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'ta', label: 'Tamil' },
]

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
    setLessons(lRes.data || [])
    setQuestions(qRes.data || [])
    setEditLesson(null)
    setEditQuestion(null)
  }

  const saveLesson = async () => {
    if (!editLesson) return
    setSaving(true)
    const { error } = await supabase
      .from('academy_lessons')
      .update({
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
            <i className="ti ti-arrow-left" style={{ fontSize: 18 }} />
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
          {modules.length === 0 ? (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              No modules yet. Add them in your DB.
            </div>
          ) : (
            modules.map((mod) => (
              <button
                key={mod.id}
                onClick={() => {
                  setSelected(mod.id)
                }}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  textAlign: 'left',
                  background: selected === mod.id ? 'var(--bg-elevated)' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  borderLeft:
                    selected === mod.id
                      ? '3px solid var(--accent)'
                      : '3px solid transparent',
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
                  }}
                >
                  {mod.icon} {mod.title_en}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Lessons */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 10,
            }}
          >
            Lessons
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
                  <i
                    className={
                      editLesson?.id === lesson.id
                        ? 'ti ti-chevron-up'
                        : 'ti ti-chevron-down'
                    }
                    style={{ fontSize: 14, color: 'var(--text-hint)' }}
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

          {/* Questions */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '20px 0 10px',
            }}
          >
            Quiz Questions
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
                <i
                  className={
                    editQuestion?.id === q.id
                      ? 'ti ti-chevron-up'
                      : 'ti ti-chevron-down'
                  }
                  style={{
                    fontSize: 14,
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
    </div>
  )
}
