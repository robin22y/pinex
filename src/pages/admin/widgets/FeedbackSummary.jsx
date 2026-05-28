import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// ── User Feedback summary ────────────────────────────────────────────────────
// Reads the `feedback` table (written by the
// FeedbackWidget on every page). Renders an
// average rating, 5-bar distribution, and an
// expandable list of recent messages.

const FeedbackSummary = () => {
  const [feedback, setFeedback] = useState([])
  const [stats, setStats] = useState(null)
  const [expanded, setExpanded] = useState(false)
  // Reply state — replyingTo holds the feedback row id whose
  // reply form is open. replyResult maps feedback id → 'sent' |
  // 'failed' for the inline confirmation line.
  const [replyingTo, setReplyingTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [replyResult, setReplyResult] = useState({})

  useEffect(() => {
    loadFeedback()
  }, [])

  const loadFeedback = async () => {
    // Pull reply fields + join profiles for the author's email /
    // name so the admin can see who left the feedback and whether
    // it's already been answered.
    const { data } = await supabase
      .from('feedback')
      .select(
        'id, rating, message, page, created_at, user_id, ' +
        'admin_reply, replied_at, profiles(email, full_name)'
      )
      .order('created_at', { ascending: false })
      .limit(50)

    setFeedback(data || [])

    if (data?.length) {
      // HOW IT'S DERIVED
      //   avg  = arithmetic mean of all
      //          ratings (1..5).
      //   dist = count of responses at each
      //          star level for the bar chart.
      //   total= total responses included
      //          (capped at last 50 by the
      //          select limit above).
      const avg = data.reduce((s, r) => s + r.rating, 0) / data.length
      const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      data.forEach((r) => {
        dist[r.rating]++
      })
      setStats({ avg, dist, total: data.length })
    }
  }

  const EMOJIS = ['', '😞', '😕', '😐', '😊', '🤩']

  // Send an admin reply to a feedback row: fire the email via the
  // admin-send-email Netlify function (feedback_reply type), then
  // persist the reply on the feedback row so the UI shows the
  // "✓ Replied" state and won't offer the form again.
  const sendReply = async (fb) => {
    if (!replyText.trim() || sendingReply) return
    setSendingReply(true)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch('/.netlify/functions/admin-send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          type: 'feedback_reply',
          userIds: [fb.user_id],
          replyText: replyText.trim(),
          originalMessage: fb.message,
          originalRating: fb.rating,
        }),
      })
      const result = await res.json()

      if (result.sent > 0 || result.success) {
        await supabase
          .from('feedback')
          .update({
            admin_reply: replyText.trim(),
            replied_at: new Date().toISOString(),
            replied_by: session?.user?.email || null,
          })
          .eq('id', fb.id)

        setReplyResult((prev) => ({ ...prev, [fb.id]: 'sent' }))
        setReplyingTo(null)
        setReplyText('')
        loadFeedback()
      } else {
        setReplyResult((prev) => ({ ...prev, [fb.id]: 'failed' }))
      }
    } catch {
      setReplyResult((prev) => ({ ...prev, [fb.id]: 'failed' }))
    }
    setSendingReply(false)
  }

  if (!stats) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
          padding: '0 16px',
        }}
      >
        User Feedback
      </div>

      {/* Average score + distribution */}
      <div
        style={{
          margin: '0 16px 12px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: 'var(--accent)',
              lineHeight: 1,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {stats.avg.toFixed(1)}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              marginTop: 3,
            }}
          >
            avg rating
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-hint)' }}>
            {stats.total} responses
          </div>
        </div>

        <div style={{ flex: 1 }}>
          {[5, 4, 3, 2, 1].map((n) => {
            const count = stats.dist[n] || 0
            const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
            return (
              <div
                key={n}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 3,
                }}
              >
                <span style={{ fontSize: 12, width: 20, flexShrink: 0 }}>
                  {EMOJIS[n]}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    background: 'var(--border)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background:
                        n >= 4
                          ? 'var(--accent)'
                          : n === 3
                          ? 'var(--warning)'
                          : 'var(--negative)',
                      borderRadius: 3,
                      transition: 'width 0.5s',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    width: 20,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {count}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Expandable recent messages */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: 'calc(100% - 32px)',
          margin: '0 16px',
          padding: '10px 14px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--text-muted)',
          fontSize: 12,
        }}
      >
        <span>Recent feedback with messages</span>
        <i
          className={expanded ? 'ti ti-chevron-up' : 'ti ti-chevron-down'}
          style={{ fontSize: 14 }}
        />
      </button>

      {expanded && (
        <div style={{ margin: '8px 16px 0' }}>
          {feedback
            .filter((f) => f.message)
            .slice(0, 10)
            .map((f, i) => (
              <div
                key={f.id || i}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{EMOJIS[f.rating]}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                    {f.page} ·{' '}
                    {new Date(f.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </div>

                {/* Author identity */}
                {f.profiles?.email && (
                  <div style={{ fontSize: 10, color: 'var(--text-hint)', marginBottom: 4 }}>
                    {f.profiles.full_name || f.profiles.email}
                  </div>
                )}

                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}
                >
                  {f.message}
                </div>

                {/* Already-replied indicator */}
                {f.admin_reply && (
                  <div style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'rgba(0,200,5,0.06)',
                    border: '1px solid rgba(0,200,5,0.15)',
                  }}>
                    <div style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: '#00C805',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      marginBottom: 3,
                    }}>
                      ✓ Replied
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {f.admin_reply}
                    </div>
                  </div>
                )}

                {/* Reply button + form (only when not yet replied
                    and we have a user_id to email). */}
                {!f.admin_reply && f.user_id && (
                  <div style={{ marginTop: 8 }}>
                    {replyingTo === f.id ? (
                      <div>
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write a reply to this user…"
                          rows={3}
                          autoFocus
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '8px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-elevated)',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            resize: 'none',
                            outline: 'none',
                            lineHeight: 1.5,
                            marginBottom: 6,
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => sendReply(f)}
                            disabled={!replyText.trim() || sendingReply}
                            style={{
                              padding: '5px 14px',
                              borderRadius: 6,
                              border: 'none',
                              background: replyText.trim() ? 'var(--accent)' : 'var(--border)',
                              color: replyText.trim() ? '#000' : '#475569',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: replyText.trim() ? 'pointer' : 'default',
                            }}
                          >
                            {sendingReply ? 'Sending…' : 'Send reply →'}
                          </button>
                          <button
                            onClick={() => { setReplyingTo(null); setReplyText('') }}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: 'var(--text-muted)',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {replyResult[f.id] && (
                          <div style={{
                            marginTop: 6,
                            fontSize: 11,
                            color: replyResult[f.id] === 'sent' ? '#00C805' : '#FF3B30',
                          }}>
                            {replyResult[f.id] === 'sent'
                              ? '✓ Reply sent successfully'
                              : '✗ Failed to send reply'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => { setReplyingTo(f.id); setReplyText('') }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 5,
                          border: '1px solid var(--border)',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        ↩ Reply
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

          {feedback.filter((f) => f.message).length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '16px',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              No messages yet
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default FeedbackSummary
