import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'
import { C } from '../styles/tokens'

// ─────────────────────────────────────────────────────────────────────────────
// /rewards — points economy display
//
// READ-ONLY for now. The page displays everything the user can earn / redeem
// and surfaces their current state from user_points + points_transactions.
// Redemption buttons open a confirm modal, but on confirm just show
// "Redemption coming soon" — the actual deduction logic lives in a future
// session per the build spec.
//
// Sections (in render order):
//   1. Hero — total + lifetime + referral link with one-tap copy
//   2. How to Earn — tab switcher (Daily / Learning / Referrals / Achievements)
//   3. Redeem — five tiered Pro/streak-freeze cards
//   4. Your progress — progress bar to next milestone + streak
//   5. Leaderboard — top 10 this week + caller's rank
//   6. Rules — collapsible accordion
//
// All colours come from C tokens (src/styles/tokens.js). Layout uses Tailwind
// where convenient; styling stays inline to match the rest of the app.
// ─────────────────────────────────────────────────────────────────────────────


// ── Static config — earning + redemption catalogues ─────────────────────────

const EARN_DAILY = [
  { icon: '👀', title: 'Open app + check watchlist',  points: 2, cap: 'Once/day' },
  { icon: '💭', title: 'Answer daily question',        points: 5, cap: 'Once/day' },
  { icon: '🏷️', title: 'Classify a stock',             points: 3, cap: '5 per day' },
  { icon: '🔍', title: 'Run a screen',                 points: 2, cap: '3 per day' },
  { icon: '📖', title: 'Read methodology article',     points: 3, cap: '3 per day' },
]

const STREAK_MILESTONES = [
  { days: 3,   points: 15  },
  { days: 7,   points: 35  },
  { days: 14,  points: 75  },
  { days: 30,  points: 150 },
  { days: 100, points: 600 },
]

const EARN_LEARNING = [
  { icon: '🎓', title: 'Complete Module 1',         points: 50,  cap: 'One time' },
  { icon: '📚', title: 'Complete Modules 2–7',      points: 40,  cap: 'One time each' },
  { icon: '🏆', title: 'Complete Module 8',         points: 75,  cap: 'One time' },
  { icon: '🎖️', title: 'Pass certification',         points: 200, cap: 'One time' },
  { icon: '⭐', title: 'Featured daily answer',      points: 25,  cap: 'Daily' },
  { icon: '👍', title: '10 upvotes on answer',      points: 20,  cap: 'Per answer' },
]

const EARN_REFERRALS = [
  { icon: '🔗', title: 'Your link clicked',           points: 10,  cap: '5 per day' },
  { icon: '🎉', title: 'Friend registers',            points: 100, cap: 'Per referral' },
  { icon: '📘', title: 'Friend completes Module 1',   points: 200, cap: 'Per referral' },
  { icon: '🔥', title: 'Friend active 30 days',       points: 500, cap: 'Per referral' },
  { icon: '🏅', title: 'Friend gets certified',       points: 300, cap: 'Per referral' },
]

// Achievements grid (2×5). is_earned is computed at render time from the
// user's lifetime/streak/transaction state. The check criteria below are
// referenced inside the component — keep keys stable.
const ACHIEVEMENTS = [
  { key: 'first_steps',  icon: '👋', title: 'First Steps',     points: 10  },
  { key: 'week_streak',  icon: '🔥', title: 'Week Warrior',    points: 35  },
  { key: 'classifier',   icon: '🏷️', title: 'Classifier',      points: 50  },
  { key: 'student',      icon: '🎓', title: 'Student',         points: 100 },
  { key: 'graduate',     icon: '🏆', title: 'Graduate',        points: 200 },
  { key: 'evangelist',   icon: '📣', title: 'Evangelist',      points: 100 },
  { key: 'centurion',    icon: '💯', title: 'Centurion (100)', points: 50  },
  { key: 'thousander',   icon: '⭐', title: 'Thousand Club',   points: 100 },
  { key: 'lab_runner',   icon: '🧪', title: 'Lab Runner',      points: 50  },
  { key: 'streak_100',   icon: '👑', title: '100 Day Streak',  points: 600 },
]

const REDEMPTIONS = [
  {
    key: 'pro_month',  title: '1 Month Pro',     points: 1000,  value: 'Worth ₹299',
    badge: null,        cta: 'Redeem',           input: false,
  },
  {
    key: 'pro_disc',   title: '50% Off Pro',     points: 500,   value: 'Pay ₹150 instead of ₹299',
    badge: null,        cta: 'Redeem',           input: false,
  },
  {
    key: 'pro_year',   title: '1 Year Pro Free', points: 10000, value: 'Worth ₹3,588',
    badge: 'BEST VALUE', cta: 'Redeem',          input: false,
  },
  {
    key: 'gift',       title: 'Gift Pro to a Friend', points: 1000, value: 'Give 1 month Pro',
    badge: null,        cta: 'Send Gift',         input: 'email',
  },
  {
    key: 'freeze',     title: 'Streak Freeze',   points: 100,   value: 'Protect streak for 24 hrs',
    badge: 'Max 2 active', cta: 'Buy Freeze',    input: false,
  },
]

const TABS = [
  { key: 'daily',        label: 'Daily' },
  { key: 'learning',     label: 'Learning' },
  { key: 'referrals',    label: 'Referrals' },
  { key: 'achievements', label: 'Achievements' },
]


// ── Tiny re-usable bits ──────────────────────────────────────────────────────

function SectionHeading({ children }) {
  return (
    <p style={{
      fontSize: 11,
      fontWeight: 700,
      color: C.textMuted,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      margin: '0 0 12px',
    }}>
      {children}
    </p>
  )
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function PointsPill({ value, prefix = '+' }) {
  return (
    <span style={{
      fontSize: 14,
      fontWeight: 800,
      color: C.amber,
      fontFamily: 'Inter, system-ui, sans-serif',
      whiteSpace: 'nowrap',
    }}>
      {prefix}{value.toLocaleString('en-IN')} pts
    </span>
  )
}

function EarningCard({ item }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            color: C.text,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {item.title}
          </div>
          {item.cap && (
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
              {item.cap}
            </div>
          )}
        </div>
      </div>
      <PointsPill value={item.points} />
    </Card>
  )
}


// ── Section 1 — Hero (total + lifetime + referral link) ─────────────────────

function HeroSection({ points, lifetime, referralCode }) {
  const [copied, setCopied] = useState(false)
  const referralUrl =
    referralCode ? `pinex.in/join/${referralCode}` : 'Loading…'

  async function copyLink() {
    if (!referralCode) return
    const fullUrl = `https://${referralUrl}`
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for browsers without clipboard API access
      const el = document.createElement('textarea')
      el.value = fullUrl
      document.body.appendChild(el)
      el.select()
      try { document.execCommand('copy') } catch (e) { /* ignore */ }
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{
      background: C.surface,
      padding: 24,
      borderRadius: 12,
      marginBottom: 24,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{
        fontSize: 48,
        fontWeight: 800,
        color: C.amber,
        lineHeight: 1.05,
        letterSpacing: '-0.02em',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        {Number(points || 0).toLocaleString('en-IN')} <span style={{ fontSize: 24, fontWeight: 600 }}>points</span>
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>
        Lifetime earned: {Number(lifetime || 0).toLocaleString('en-IN')}
      </div>

      {/* Referral link box */}
      <div style={{
        marginTop: 20,
        background: C.surface2,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '12px 14px',
      }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em' }}>
          YOUR REFERRAL LINK
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          <code style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            color: C.text,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {referralUrl}
          </code>
          <button
            type="button"
            onClick={copyLink}
            disabled={!referralCode}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: `1px solid ${copied ? C.green : C.amberBorder}`,
              background: copied ? C.greenBg : C.amberBg,
              color: copied ? C.green : C.amber,
              fontSize: 12,
              fontWeight: 700,
              cursor: referralCode ? 'pointer' : 'not-allowed',
              opacity: referralCode ? 1 : 0.6,
              whiteSpace: 'nowrap',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            {copied ? '✓ Copied!' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Section 2 — How to Earn ──────────────────────────────────────────────────

function HowToEarnSection({ achievementsEarned }) {
  const [tab, setTab] = useState('daily')

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading>How to earn</SectionHeading>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 4,
        borderBottom: `1px solid ${C.border}`,
        marginBottom: 14,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? C.amber : 'transparent'}`,
                color: active ? C.amber : C.textMuted,
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                fontFamily: 'Inter, system-ui, sans-serif',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab body */}
      {tab === 'daily' && (
        <>
          {EARN_DAILY.map((item, i) => <EarningCard key={i} item={item} />)}

          <div style={{ marginTop: 18 }}>
            <p style={{
              fontSize: 11,
              fontWeight: 700,
              color: C.textMuted,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              margin: '0 0 10px',
            }}>
              Streak milestones
            </p>
            <div style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: 4,
            }}>
              {STREAK_MILESTONES.map(m => (
                <div
                  key={m.days}
                  style={{
                    flexShrink: 0,
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: '10px 14px',
                    textAlign: 'center',
                    minWidth: 88,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{m.days} days</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.amber, marginTop: 4 }}>
                    +{m.points}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'learning' && (
        <>
          {EARN_LEARNING.map((item, i) => <EarningCard key={i} item={item} />)}
        </>
      )}

      {tab === 'referrals' && (
        <>
          {EARN_REFERRALS.map((item, i) => <EarningCard key={i} item={item} />)}
          <p style={{
            marginTop: 10,
            fontSize: 12,
            color: C.amber,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 600,
          }}>
            Up to 1,110 points per referral
          </p>
        </>
      )}

      {tab === 'achievements' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
        }}>
          {ACHIEVEMENTS.map(a => {
            const earned = achievementsEarned[a.key]
            return (
              <div
                key={a.key}
                style={{
                  background: C.surface,
                  border: `1px solid ${earned ? C.amberBorder : C.border}`,
                  borderRadius: 10,
                  padding: '14px 12px',
                  textAlign: 'center',
                  opacity: earned ? 1 : 0.55,
                }}
              >
                <div style={{ fontSize: 22, lineHeight: 1 }}>{a.icon}</div>
                <div style={{
                  fontSize: 12,
                  color: earned ? C.text : C.textMuted,
                  marginTop: 6,
                  fontWeight: 600,
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}>
                  {a.title}
                </div>
                <div style={{
                  fontSize: 12,
                  color: earned ? C.amber : C.textFaint,
                  marginTop: 4,
                  fontWeight: 700,
                }}>
                  {earned ? '✓ earned' : `+${a.points}`}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


// ── Section 3 — Redeem ──────────────────────────────────────────────────────

function RedeemModal({ open, item, onClose }) {
  if (!open || !item) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 360,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 22,
        }}
      >
        <div style={{
          fontSize: 16,
          fontWeight: 700,
          color: C.text,
          marginBottom: 6,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          Confirm redemption?
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 18 }}>
          {item.points.toLocaleString('en-IN')} points will be deducted for <strong style={{ color: C.text }}>{item.title}</strong>.
        </div>

        <div style={{
          background: C.amberBg,
          border: `1px solid ${C.amberBorder}`,
          borderRadius: 8,
          padding: '10px 12px',
          marginBottom: 18,
          fontSize: 12,
          color: C.amber,
          lineHeight: 1.5,
        }}>
          ⏳ Redemption coming soon. Your points are being tracked — once
          the redemption store is live, you'll be able to spend them here.
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '11px 0',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              borderRadius: 9,
              color: C.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function RedeemSection({ totalPoints }) {
  const [modal, setModal] = useState({ open: false, item: null })
  const [giftEmailFor, setGiftEmailFor] = useState(null)

  function tryRedeem(item) {
    setModal({ open: true, item })
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading>Redeem points</SectionHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {REDEMPTIONS.map(r => {
          const affordable = (totalPoints || 0) >= r.points
          const accent = r.badge === 'BEST VALUE' ? C.amber : C.amberBorder
          const isGiftInput = r.input === 'email' && giftEmailFor === r.key
          return (
            <div
              key={r.key}
              style={{
                position: 'relative',
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderLeft: `4px solid ${accent}`,
                borderRadius: 10,
                padding: '14px 16px',
              }}
            >
              {r.badge && (
                <div style={{
                  position: 'absolute',
                  top: 8,
                  right: 12,
                  fontSize: 10,
                  fontWeight: 800,
                  color: C.amber,
                  background: C.amberBg,
                  border: `1px solid ${C.amberBorder}`,
                  borderRadius: 6,
                  padding: '2px 8px',
                  letterSpacing: '0.06em',
                }}>
                  {r.badge}
                </div>
              )}
              <div style={{
                fontSize: 15,
                fontWeight: 700,
                color: C.text,
                fontFamily: 'Inter, system-ui, sans-serif',
              }}>
                {r.title}
              </div>
              <div style={{
                fontSize: 13,
                color: C.amber,
                marginTop: 4,
                fontWeight: 700,
              }}>
                {r.points.toLocaleString('en-IN')} points
              </div>
              <div style={{
                fontSize: 12,
                color: C.textMuted,
                marginTop: 4,
                fontFamily: 'Newsreader, ui-serif, Georgia, serif',
                lineHeight: 1.5,
              }}>
                {r.value}
              </div>

              {isGiftInput && (
                <input
                  type="email"
                  placeholder="Enter friend's email"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 10,
                    padding: '10px 12px',
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    color: C.text,
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              )}

              <button
                type="button"
                onClick={() => {
                  if (r.input === 'email' && giftEmailFor !== r.key) {
                    setGiftEmailFor(r.key)
                    return
                  }
                  tryRedeem(r)
                }}
                disabled={!affordable}
                style={{
                  marginTop: 12,
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: affordable ? C.amber : C.surface2,
                  color: affordable ? C.accentOn : C.textFaint,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: affordable ? 'pointer' : 'not-allowed',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                {affordable ? r.cta : `Need ${(r.points - (totalPoints || 0)).toLocaleString('en-IN')} more`}
              </button>
            </div>
          )
        })}
      </div>

      <RedeemModal
        open={modal.open}
        item={modal.item}
        onClose={() => setModal({ open: false, item: null })}
      />
    </div>
  )
}


// ── Section 4 — Your progress ───────────────────────────────────────────────

function ProgressSection({ pts }) {
  const goal = 1000
  const total = Number(pts?.total_points || 0)
  const lifetime = Number(pts?.lifetime_points || 0)
  const streak = Number(pts?.current_streak || 0)
  const best = Number(pts?.longest_streak || 0)
  const pctRaw = goal > 0 ? (total / goal) * 100 : 0
  const pct = Math.max(0, Math.min(100, pctRaw))

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      padding: 20,
      borderRadius: 12,
      marginBottom: 24,
    }}>
      <div style={{
        fontSize: 14,
        fontWeight: 700,
        color: C.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        marginBottom: 4,
      }}>
        Your progress
      </div>
      <div style={{
        fontSize: 13,
        color: C.textMuted,
        marginBottom: 12,
      }}>
        {Math.max(0, goal - total).toLocaleString('en-IN')} points to 1 Month Pro
      </div>

      <div style={{
        height: 8,
        background: C.border,
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: C.amber,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <div style={{
        fontSize: 12,
        color: C.textMuted,
        marginTop: 6,
        textAlign: 'right',
      }}>
        {total.toLocaleString('en-IN')} / {goal.toLocaleString('en-IN')} points
      </div>

      {/* Streak */}
      <div style={{
        marginTop: 20,
        paddingTop: 18,
        borderTop: `1px solid ${C.border}`,
      }}>
        <div style={{
          fontSize: 18,
          fontWeight: 700,
          color: streak > 0 ? C.amber : C.textMuted,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          {streak > 0
            ? <>🔥 {streak} day streak</>
            : <>Start your streak today</>}
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
          Personal best: {best.toLocaleString('en-IN')} days
        </div>
      </div>
    </div>
  )
}


// ── Section 5 — Leaderboard ─────────────────────────────────────────────────

function LeaderboardSection({ rows, myRank }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading>This week's top earners</SectionHeading>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows === null ? (
          <p style={{ fontSize: 12, color: C.textFaint, padding: '8px 4px' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 12, color: C.textFaint, padding: '8px 4px' }}>
            No earnings logged this week yet — be the first.
          </p>
        ) : rows.map((r, i) => (
          <div
            key={r.user_id || `row-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderLeft: r.is_me ? `3px solid ${C.amber}` : `1px solid ${C.border}`,
              borderRadius: 8,
              gap: 12,
            }}
          >
            <div style={{
              width: 24,
              fontSize: 13,
              fontWeight: 800,
              color: i < 3 ? C.amber : C.textMuted,
              flexShrink: 0,
            }}>
              {i + 1}
            </div>
            <div style={{
              flex: 1,
              fontSize: 13,
              color: r.is_me ? C.amber : C.text,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontWeight: r.is_me ? 700 : 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {r.display_name}{r.is_me ? '  (you)' : ''}
            </div>
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              color: C.amber,
              flexShrink: 0,
            }}>
              {Number(r.weekly_points || 0).toLocaleString('en-IN')} pts
            </div>
          </div>
        ))}
      </div>

      {myRank && (myRank.rank > 10 || !rows?.some(r => r.is_me)) && (
        <div style={{
          marginTop: 10,
          padding: '10px 12px',
          background: C.surface2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          fontSize: 12,
          color: C.textMuted,
        }}>
          Your rank this week: <strong style={{ color: C.amber }}>
            {myRank.rank}
            {ordinalSuffix(myRank.rank)}
          </strong>
          {' '}of {myRank.total_ranked}
        </div>
      )}
    </div>
  )
}

function ordinalSuffix(n) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}


// ── Section 6 — Rules accordion ─────────────────────────────────────────────

function RulesSection() {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ marginBottom: 40 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          color: C.text,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'Inter, system-ui, sans-serif',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span>How points work</span>
        <span style={{ color: C.textMuted, fontSize: 14 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{
          marginTop: 8,
          padding: '14px 16px',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          fontFamily: 'Newsreader, ui-serif, Georgia, serif',
          color: C.textMuted,
          fontSize: 14,
          lineHeight: 1.7,
        }}>
          <p style={{ margin: '0 0 12px' }}>
            Points are earned by using PineX — reading, learning, classifying
            stocks, and referring friends. They cannot be bought with money.
          </p>
          <p style={{ margin: '0 0 12px' }}>
            Points can be redeemed for Pro access or gifted to other PineX users.
            They have no cash value and cannot be exchanged for money.
          </p>
          <p style={{ margin: '0 0 12px' }}>
            Points do not expire as long as your account is active. Inactive
            accounts (12+ months) may see points reduce gradually.
          </p>
          <p style={{ margin: 0 }}>
            PineX reserves the right to adjust point values and redemption rates.
            Existing balances are always honoured.
          </p>
        </div>
      )}
    </div>
  )
}


// ── Top-level page ──────────────────────────────────────────────────────────

export default function Rewards() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const [points, setPoints]               = useState(null)
  const [referralCode, setReferralCode]   = useState(null)
  const [transactions, setTransactions]   = useState([])
  const [leaderboard, setLeaderboard]     = useState(null)
  const [myRank, setMyRank]               = useState(null)
  const [loading, setLoading]             = useState(true)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    setLoading(true)

    const pointsP = supabase
      .from('user_points')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    const profileP = supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', user.id)
      .maybeSingle()

    const txP = supabase
      .from('points_transactions')
      .select('id, points, action_type, notes, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    // Leaderboard RPCs degrade gracefully — if the SQL migration hasn't
    // been run yet, RPC errors with 42883 and we render the empty state.
    const lbP = supabase.rpc('rewards_weekly_leaderboard')
    const rankP = supabase.rpc('rewards_user_weekly_rank')

    Promise.all([pointsP, profileP, txP, lbP, rankP]).then(([p, pr, tx, lb, rk]) => {
      if (cancelled) return
      setPoints(p?.data || null)
      setReferralCode(pr?.data?.referral_code || null)
      setTransactions(tx?.data || [])
      setLeaderboard(Array.isArray(lb?.data) ? lb.data : [])
      const rankData = Array.isArray(rk?.data) ? rk.data[0] : null
      setMyRank(rankData || null)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [user?.id])

  // Derive which achievements the user has earned from lifetime totals and
  // transaction history. Pure-display — never gates anything. Conservative
  // by design: if we can't be sure, render as not-earned.
  const achievementsEarned = useMemo(() => {
    const totalLife = Number(points?.lifetime_points || 0)
    const longest = Number(points?.longest_streak || 0)
    const txTypes = new Set(
      (transactions || []).map(t => String(t.action_type || '')),
    )
    return {
      first_steps:  totalLife >= 10,
      week_streak:  longest >= 7,
      classifier:   txTypes.has('classification') || totalLife >= 50,
      student:      txTypes.has('module_complete') || totalLife >= 100,
      graduate:     txTypes.has('certification') || totalLife >= 200,
      evangelist:   txTypes.has('referral') || totalLife >= 100,
      centurion:    totalLife >= 100,
      thousander:   totalLife >= 1000,
      lab_runner:   txTypes.has('lab_run') || totalLife >= 50,
      streak_100:   longest >= 100,
    }
  }, [points, transactions])

  if (authLoading) {
    return <PageShell><Skeleton /></PageShell>
  }

  if (!user) {
    // ProtectedRoute should have caught this — defensive fallback.
    return (
      <PageShell>
        <p style={{ color: C.textMuted, padding: '24px 4px' }}>
          Please sign in to view your rewards.
        </p>
        <Link to="/login" style={{ color: C.amber }}>Sign in →</Link>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <Helmet>
        <title>Rewards — PineX</title>
        <meta name="description" content="Your PineX points balance, earning catalogue, redemptions, and weekly leaderboard." />
      </Helmet>

      {loading ? (
        <Skeleton />
      ) : (
        <>
          <HeroSection
            points={points?.total_points}
            lifetime={points?.lifetime_points}
            referralCode={referralCode}
          />
          <HowToEarnSection achievementsEarned={achievementsEarned} />
          <RedeemSection totalPoints={points?.total_points} />
          <ProgressSection pts={points} />
          <LeaderboardSection rows={leaderboard} myRank={myRank} />
          <RulesSection />
        </>
      )}
    </PageShell>
  )
}


// ── Page chrome ─────────────────────────────────────────────────────────────

function PageShell({ children }) {
  const navigate = useNavigate()
  return (
    <div style={{
      minHeight: '100vh',
      background: C.base,
      color: C.text,
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Sticky header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: C.base,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: 52,
        gap: 10,
      }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            color: C.textMuted,
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="Go back"
        >
          <i className="ti ti-arrow-left" style={{ fontSize: 20 }} />
        </button>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.text }}>
          Rewards
        </span>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px 60px' }}>
        {children}
      </div>
    </div>
  )
}

function Skeleton() {
  // Single dim block instead of multiple shimmery shapes — keeps the
  // page weight small. The real content renders within ~300ms of mount
  // in normal conditions; the skeleton is mostly a hold for slow networks.
  return (
    <div style={{ padding: '40px 0' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            height: i === 0 ? 160 : 96,
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            marginBottom: 16,
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  )
}
