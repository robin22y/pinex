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

  useEffect(() => {
    loadFeedback()
  }, [])

  const loadFeedback = async () => {
    const { data } = await supabase
      .from('feedback')
      .select('rating, message, page, created_at, user_id')
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
                key={i}
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
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}
                >
                  {f.message}
                </div>
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
