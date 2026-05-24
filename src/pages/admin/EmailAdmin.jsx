// EmailAdmin — admin tool for editing transactional email templates.
//
// HOW IT WORKS
//   Templates live in the Supabase
//   `email_templates` table (id, subject,
//   html_body, …). This page lets an admin
//   browse the three known templates,
//   preview their rendered HTML in a
//   sandboxed iframe, edit the subject /
//   body, save back to the DB, and fire a
//   test send through the
//   admin-send-email Netlify function.
//
//   The Netlify function reads templates
//   from the same DB row at send time and
//   substitutes {{name}}, {{email}},
//   {{score}}, {{date}}, {{certificate_url}},
//   {{app_url}} — see the bottom-of-page
//   variable reference card.
//
//   RLS on email_templates restricts writes
//   to robin22y@gmail.com (see the seed SQL
//   in the task spec).

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context'

// The three transactional emails the system
// sends today. Adding a new template is two
// steps: add it here AND insert the row in
// the email_templates table.
const TEMPLATES = [
  {
    id: 'congratulations',
    name: 'Academy Completion',
    icon: '🎓',
    description:
      'Sent when user passes all required modules',
    color: 'var(--accent)',
  },
  {
    id: 'reengagement',
    name: 'Re-engagement',
    icon: '👋',
    description:
      'Sent to users absent 10+ days',
    color: 'var(--warning)',
  },
  {
    id: 'invite',
    name: 'Invite Email',
    icon: '✉️',
    description:
      'Sent when admin approves waitlist',
    color: 'var(--info)',
  },
]

export default function EmailAdmin() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  // Selected template id — drives every panel
  // on the page (subject editor, HTML editor,
  // preview iframe, test-send target).
  const [selected, setSelected] = useState('congratulations')

  // Local cache keyed by template id. Edits
  // happen in this map; only `Save template`
  // pushes to Supabase. Lets the admin tab
  // between templates without losing in-flight
  // changes.
  const [templates, setTemplates] = useState({})

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [testEmail, setTestEmail] = useState(user?.email || '')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)

  // 'preview' = sandboxed iframe with rendered HTML
  // 'html'    = raw textarea + toolbar
  const [preview, setPreview] = useState('preview')

  useEffect(() => {
    // Gate the page to admin/superadmin —
    // AdminRoute already does this for the
    // /admin/* tree, but we double-check
    // here so a route-config mistake can't
    // silently expose this page.
    if (
      profile &&
      profile.role !== 'admin' &&
      profile.role !== 'superadmin'
    ) {
      navigate('/')
      return
    }
    loadTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const loadTemplates = async () => {
    const { data } = await supabase
      .from('email_templates')
      .select('*')

    const map = {}
    ;(data || []).forEach((t) => {
      map[t.id] = t
    })
    setTemplates(map)
  }

  // Defaults are an empty shell so the editor
  // still renders even when the row doesn't
  // exist yet — admin can author, then Save
  // will upsert and the row appears.
  const currentTemplate = templates[selected] || {
    id: selected,
    subject: '',
    html_body: '',
  }

  const handleSave = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('email_templates')
      .upsert({
        id: selected,
        name: TEMPLATES.find((t) => t.id === selected)?.name,
        subject: currentTemplate.subject,
        html_body: currentTemplate.html_body,
        updated_at: new Date().toISOString(),
        updated_by: user?.email,
      })

    setSaving(false)
    if (!error) {
      setSaved(true)
      // Auto-clear the "Saved" pill after 2 s
      // so subsequent saves still flash green.
      setTimeout(() => setSaved(false), 2000)
      loadTemplates()
    }
  }

  // Generic field setter — both `subject`
  // and `html_body` come through here. Keeps
  // the keyed map fresh without losing other
  // templates' in-flight edits.
  const handleChange = (field, value) => {
    setTemplates((t) => ({
      ...t,
      [selected]: {
        ...t[selected],
        id: selected,
        [field]: value,
      },
    }))
  }

  // Fires the admin-send-email Netlify
  // function with `testEmail` and the
  // currently selected template id. The
  // function looks up the template by id
  // in the DB (NOT from the editor's local
  // state) — so always Save first if you
  // want the test send to reflect your edits.
  const sendTestEmail = async () => {
    if (!testEmail) return
    setSending(true)
    setSendResult(null)

    const { data: { session } } = await supabase.auth.getSession()

    try {
      const res = await fetch('/.netlify/functions/admin-send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          type: selected,
          testEmail,
          userIds: [user.id],
        }),
      })
      const result = await res.json()
      setSendResult(result)
    } catch (err) {
      setSendResult({ error: err.message })
    }
    setSending(false)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        paddingBottom: 80,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
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
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            Email Templates
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Edit and preview all system emails
          </div>
        </div>
      </div>

      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: 16,
        }}
      >
        {/* Template selector — pills row */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setSelected(t.id)
                setSendResult(null)
              }}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                border: `1px solid ${
                  selected === t.id ? t.color : 'var(--border)'
                }`,
                background:
                  selected === t.id ? t.color + '20' : 'transparent',
                color: selected === t.id ? t.color : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: selected === t.id ? 700 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{t.icon}</span>
              {t.name}
            </button>
          ))}
        </div>

        {/* Subject editor */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Email Subject</span>
          </div>
          <div style={{ padding: '10px 14px' }}>
            <input
              value={currentTemplate.subject || ''}
              onChange={(e) => handleChange('subject', e.target.value)}
              placeholder="Email subject line..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-input, var(--bg-elevated))',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* HTML editor + preview */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          {/* Tab bar — Preview / HTML toggle + Save */}
          <div
            style={{
              padding: '0 14px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: 0 }}>
              {['preview', 'html'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPreview(tab)}
                  style={{
                    padding: '10px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom:
                      preview === tab
                        ? '2px solid var(--accent)'
                        : '2px solid transparent',
                    color:
                      preview === tab
                        ? 'var(--text-primary)'
                        : 'var(--text-muted)',
                    fontSize: 12,
                    fontWeight: preview === tab ? 700 : 400,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    marginBottom: -1,
                  }}
                >
                  {tab === 'preview' ? '👁 Preview' : '< > HTML'}
                </button>
              ))}
            </div>

            {/* Save action */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: saved ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: saved ? '#000' : 'var(--text-primary)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save template'}
              </button>
            </div>
          </div>

          {/* Preview pane — sandboxed iframe so any
              dodgy <script> in the template can't
              execute against this admin origin. */}
          {preview === 'preview' ? (
            <div
              style={{
                padding: 16,
                background: '#f8f9fa',
                minHeight: 400,
              }}
            >
              {currentTemplate.html_body ? (
                <iframe
                  srcDoc={currentTemplate.html_body}
                  style={{
                    width: '100%',
                    height: 500,
                    border: 'none',
                    borderRadius: 8,
                  }}
                  title="Email preview"
                  sandbox="allow-same-origin"
                />
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 60,
                    color: '#94A3B8',
                    fontSize: 13,
                  }}
                >
                  Switch to HTML tab to write the template
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Toolbar — quick-insert snippets.
                  Click appends to the current
                  html_body string; this keeps the
                  editor simple (no rich editor lib)
                  while still being usable. */}
              <div
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                {[
                  { label: 'Name', insert: '{{name}}', tip: "User's name" },
                  { label: 'Email', insert: '{{email}}', tip: "User's email" },
                  { label: 'Score', insert: '{{score}}', tip: 'Academy score %' },
                  { label: 'Date', insert: '{{date}}', tip: 'Completion date' },
                  {
                    label: 'CTA Button',
                    insert:
                      '<a href="https://pinex.in" style="display:inline-block;background:#00C805;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Go to PineX →</a>',
                    tip: 'Green CTA button',
                  },
                  {
                    label: 'Divider',
                    insert:
                      '<hr style="border:none;border-top:1px solid #1E2530;margin:20px 0;"/>',
                    tip: 'Horizontal line',
                  },
                ].map((v) => (
                  <button
                    key={v.label}
                    title={v.tip}
                    onClick={() => {
                      const curr = currentTemplate.html_body || ''
                      handleChange('html_body', curr + v.insert)
                    }}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-muted)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    + {v.label}
                  </button>
                ))}
              </div>

              {/* Raw HTML textarea */}
              <textarea
                value={currentTemplate.html_body || ''}
                onChange={(e) => handleChange('html_body', e.target.value)}
                placeholder={`Write HTML email template here...

Use {{name}}, {{email}}, {{score}}, {{date}} as variables.

Example:
<p>Hi {{name}},</p>
<p>Congratulations on completing PineX Academy!</p>`}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '14px',
                  border: 'none',
                  background: '#0B0E11',
                  color: '#E2E8F0',
                  fontSize: 12,
                  lineHeight: 1.7,
                  fontFamily: 'monospace',
                  minHeight: 400,
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>
          )}
        </div>

        {/* Test send — fires the Netlify function
            with `testEmail` as the recipient. The
            function still reads the DB row, so
            unsaved edits will NOT appear in the
            test message. Save first. */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 12,
            }}
          >
            Send test email
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="test@email.com"
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-input, var(--bg-elevated))',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={sendTestEmail}
              disabled={sending || !testEmail}
              style={{
                padding: '9px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: '#000',
                fontSize: 13,
                fontWeight: 700,
                cursor: sending ? 'wait' : 'pointer',
                opacity: sending ? 0.7 : 1,
                flexShrink: 0,
              }}
            >
              {sending ? 'Sending...' : 'Send test →'}
            </button>
          </div>

          {sendResult && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: sendResult.error
                  ? 'var(--negative-dim)'
                  : 'var(--accent-dim)',
                border: `1px solid ${
                  sendResult.error
                    ? 'var(--negative-dim)'
                    : 'var(--accent-border)'
                }`,
                fontSize: 12,
                color: sendResult.error ? 'var(--negative)' : 'var(--accent)',
              }}
            >
              {sendResult.error
                ? `Error: ${sendResult.error}`
                : `✓ Test email sent to ${testEmail}`}
            </div>
          )}
        </div>

        {/* Variables reference — these are the
            tokens the Netlify function substitutes
            at send time. Keep this list in sync
            with admin-send-email.js / replaceVars(). */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 16,
          }}
        >
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
            Available variables
          </div>
          {[
            ['{{name}}', "User's full name"],
            ['{{email}}', "User's email address"],
            ['{{score}}', 'Academy completion score %'],
            ['{{date}}', 'Date of action'],
            ['{{certificate_url}}', 'Link to certificate page'],
            ['{{app_url}}', 'https://pinex.in'],
          ].map(([v, desc]) => (
            <div
              key={v}
              style={{
                display: 'flex',
                gap: 12,
                marginBottom: 8,
                alignItems: 'center',
              }}
            >
              <code
                style={{
                  background: 'var(--bg-elevated)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  color: 'var(--accent)',
                  fontFamily: 'monospace',
                  flexShrink: 0,
                }}
              >
                {v}
              </code>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
