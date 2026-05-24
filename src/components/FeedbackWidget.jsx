// FeedbackWidget — floating ✉ bottom-right.
//
// HOW IT WORKS
//   Mounted once at the app root (App.jsx /
//   RootLayout) so it appears on every page.
//   Auto-hides on the admin tree, on the
//   academy reader, on /login, and on the
//   public landing page when no user is
//   present — places where a feedback prompt
//   either competes with the page's own UI
//   or doesn't yet have anyone to write to.
//
//   Insert path: anonymous submissions are
//   refused at the UI level (user.id is the
//   primary key on the `feedback` row), so
//   sign-in is required. The submit handler
//   writes { user_id, rating, message?, page }
//   to a `feedback` table; admins read it back
//   in the AdminDashboard FeedbackSummary.
//
// SCHEMA HINT (run in Supabase if missing):
//   create table feedback (
//     id uuid default gen_random_uuid()
//        primary key,
//     user_id uuid references auth.users(id),
//     rating int2 not null check
//       (rating between 1 and 5),
//     message text,
//     page text,
//     created_at timestamptz default now()
//   );
//   alter table feedback enable row level
//     security;
//   create policy "own_or_admin_read"
//     on feedback for select
//     using (
//       auth.uid() = user_id OR
//       auth.jwt()->>'email' =
//         'robin22y@gmail.com'
//     );
//   create policy "insert_own" on feedback
//     for insert with check
//       (auth.uid() = user_id);

import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'

export default function FeedbackWidget() {
  const { user } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle')
  // 'idle' | 'submitting' | 'done'

  // Pages where the widget should NOT appear:
  //   /admin/*   — admins have their own
  //                feedback dashboard
  //   /learn/*   — academy reader is focused
  //                lesson UI
  //   /login     — no signed-in user yet
  //   /          — public landing (when no user)
  const hide =
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/learn') ||
    location.pathname === '/login' ||
    (location.pathname === '/' && !user)

  if (hide) return null

  const handleSubmit = async () => {
    if (!rating || !user) return
    setStatus('submitting')

    const { error } = await supabase
      .from('feedback')
      .insert({
        user_id: user.id,
        rating,
        message: message.trim() || null,
        page: location.pathname,
      })

    if (!error) {
      setStatus('done')
      // Auto-close 2s after success so the
      // widget returns to its idle state and
      // can be re-opened on the next page.
      setTimeout(() => {
        setOpen(false)
        setStatus('idle')
        setRating(0)
        setMessage('')
      }, 2000)
    } else {
      setStatus('idle')
    }
  }

  const EMOJIS = ['😞', '😕', '😐', '😊', '🤩']
  const LABELS = ['Poor', 'Fair', 'OK', 'Good', 'Excellent']

  return (
    <>
      {/* Floating button — sits above the
          mobile BottomNav (bottom 80 = 60
          nav + 20 gap). z-index 800 keeps
          it below the AcademyRequired bottom
          sheet (z-index 901) so the gate
          isn't competed with. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Send feedback"
          style={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            zIndex: 800,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'transform 0.2s',
          }}
        >
          💬
        </button>
      )}

      {/* Feedback panel */}
      {open && (
        <>
          {/* Backdrop — click-outside to close */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 801 }}
          />

          {/* Panel */}
          <div
            style={{
              position: 'fixed',
              bottom: 80,
              right: 16,
              zIndex: 802,
              width: 280,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              overflow: 'hidden',
              animation: 'pinex-feedback-slide-up 0.25s ease-out',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '14px 16px 10px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  How is PineX for you?
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 1,
                  }}
                >
                  Quick feedback helps us improve
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: 4,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {status === 'done' ? (
              /* Thank-you screen */
              <div
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 10 }}>🙏</div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: 4,
                  }}
                >
                  Thank you!
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                  }}
                >
                  Your feedback helps us build better.
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px' }}>
                {/* Emoji rating row.
                    Filter grayscale+opacity until
                    hover or selection — keeps the
                    UI quiet until the user
                    actually commits to a rating. */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onMouseEnter={() => setHovered(n)}
                      onMouseLeave={() => setHovered(0)}
                      onClick={() => setRating(n)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 28,
                        padding: '4px 2px',
                        transform:
                          (hovered || rating) >= n ? 'scale(1.2)' : 'scale(1)',
                        transition: 'transform 0.15s',
                        filter:
                          (hovered || rating) >= n
                            ? 'none'
                            : 'grayscale(1) opacity(0.4)',
                      }}
                    >
                      {EMOJIS[n - 1]}
                    </button>
                  ))}
                </div>

                {/* Rating label */}
                <div
                  style={{
                    textAlign: 'center',
                    fontSize: 11,
                    color: rating ? 'var(--accent)' : 'var(--text-hint)',
                    marginBottom: 12,
                    minHeight: 16,
                    fontWeight: rating ? 600 : 400,
                  }}
                >
                  {rating ? LABELS[rating - 1] : 'Tap to rate'}
                </div>

                {/* Optional message */}
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What can we improve? (optional)"
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    resize: 'none',
                    outline: 'none',
                    lineHeight: 1.5,
                    marginBottom: 10,
                  }}
                />

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={!rating || status === 'submitting'}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: 8,
                    border: 'none',
                    background: rating ? 'var(--accent)' : 'var(--border)',
                    color: rating ? '#000' : 'var(--text-hint)',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: rating ? 'pointer' : 'default',
                    transition: 'all 0.15s',
                  }}
                >
                  {status === 'submitting' ? 'Sending...' : 'Send feedback →'}
                </button>

                {/* Not logged in — submit is
                    disabled at the handler level
                    too (user is required for the
                    insert FK). */}
                {!user && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 10,
                      color: 'var(--text-hint)',
                      textAlign: 'center',
                    }}
                  >
                    Sign in to submit
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Slide-up keyframe scoped here so the
          file is self-contained — no extra CSS
          imports required. */}
      <style>{`
        @keyframes pinex-feedback-slide-up {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  )
}
