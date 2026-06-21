import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'
import { C } from '../styles/tokens'

import Icon from '../components/ui/Icon'
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


// ── Catalogue metadata — local-only display details ─────────────────────────
// points_config provides points + daily_cap + display_name + is_active. The
// icon, the cap-text formatting (numeric daily_cap → "5 per day") and the
// section grouping are display concerns that stay client-side. ACTION_LISTS
// declares which action_types appear in which tab — and in what order.

const ACTION_META = {
  // Daily
  daily_login:           { icon: '👀' },
  daily_question:        { icon: '💭' },
  classify_stock:        { icon: '🏷️' },
  run_screen:            { icon: '🔍' },
  read_methodology:      { icon: '📖' },
  discovery_tap:         { icon: '🔭' },
  validation_earned:     { icon: '📈' },
  // Learning
  module_complete_1:     { icon: '🎓' },
  module_complete_2_7:   { icon: '📚' },
  module_complete_8:     { icon: '🏆' },
  certification:         { icon: '🎖️' },
  featured_answer:       { icon: '⭐' },
  ten_upvotes:           { icon: '👍' },
  // Referral
  referral_click:        { icon: '🔗' },
  referral_register:     { icon: '🎉' },
  referral_module1:      { icon: '📘' },
  referral_30day:        { icon: '🔥' },
  referral_certified:    { icon: '🏅' },
  // Streak milestones
  streak_3_days:         { icon: '🔥' },
  streak_7_days:         { icon: '🔥' },
  streak_14_days:        { icon: '🔥' },
  streak_30_days:        { icon: '🔥' },
  streak_100_days:       { icon: '👑' },
  // Achievements (Rewards.jsx historical local keys are bridged via
  // ACHIEVEMENT_LIST below — don't rename without updating both.)
  achievement_first_steps:  { icon: '👋' },
  achievement_week_warrior: { icon: '🔥' },
  achievement_classifier:   { icon: '🏷️' },
  achievement_student:      { icon: '🎓' },
  achievement_graduate:     { icon: '🏆' },
  achievement_evangelist:   { icon: '📣' },
  achievement_centurion:    { icon: '💯' },
  achievement_thousander:   { icon: '⭐' },
  achievement_lab_runner:   { icon: '🧪' },
  achievement_streak_100:   { icon: '👑' },
}

// Order of cards in each tab. Anything in points_config that isn't here
// just doesn't appear in the Rewards page (admin can add new actions to
// these arrays in code or via a future points_config.display_order col).
const ACTION_LISTS = {
  daily:     ['daily_login', 'daily_question', 'classify_stock', 'run_screen', 'read_methodology', 'discovery_tap', 'validation_earned'],
  learning:  ['module_complete_1', 'module_complete_2_7', 'module_complete_8', 'certification', 'featured_answer', 'ten_upvotes'],
  referrals: ['referral_click', 'referral_register', 'referral_module1', 'referral_30day', 'referral_certified'],
  streaks:   ['streak_3_days', 'streak_7_days', 'streak_14_days', 'streak_30_days', 'streak_100_days'],
}

const TRIAL_DAYS = 14
const PAID_PRO_DAYS = 30

function formatDateLabel(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return String(iso)
  }
}

function getActiveProWindow(profile) {
  if (!profile) return null
  const now = Date.now()
  const plan = String(profile.plan || '').toLowerCase()

  if (plan === 'pro_trial' && profile.trial_expires_at) {
    const endMs = new Date(profile.trial_expires_at).valueOf()
    if (!Number.isFinite(endMs) || endMs <= now) return null
    const startIso = profile.created_at || new Date(endMs - TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    return {
      label: 'Trial Pro active',
      start: startIso,
      end: profile.trial_expires_at,
    }
  }

  if (plan === 'pro') {
    if (profile.pro_expires_at) {
      const endMs = new Date(profile.pro_expires_at).valueOf()
      if (!Number.isFinite(endMs) || endMs <= now) return null
      const startIso = profile.plan_activated_at || new Date(endMs - PAID_PRO_DAYS * 24 * 60 * 60 * 1000).toISOString()
      return {
        label: 'Pro active',
        start: startIso,
        end: profile.pro_expires_at,
      }
    }
    return {
      label: 'Pro active',
      start: profile.plan_activated_at || null,
      end: null,
    }
  }

  return null
}

function emitWalletUpdated(totalPoints) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('pinex:wallet-updated', {
      detail: { totalPoints: Number(totalPoints) || 0 },
    }))
  } catch { /* no-op */ }
}

// Achievement display order + local-key → action_type bridge. The local
// keys (first_steps, week_streak, classifier, …) are referenced by the
// achievementsEarned memo below — don't rename them.
const ACHIEVEMENT_LIST = [
  { localKey: 'first_steps', action_type: 'achievement_first_steps',  titleFallback: 'First Steps',     pointsFallback: 10  },
  { localKey: 'week_streak', action_type: 'achievement_week_warrior', titleFallback: 'Week Warrior',    pointsFallback: 35  },
  { localKey: 'classifier',  action_type: 'achievement_classifier',   titleFallback: 'Classifier',      pointsFallback: 50  },
  { localKey: 'student',     action_type: 'achievement_student',      titleFallback: 'Student',         pointsFallback: 100 },
  { localKey: 'graduate',    action_type: 'achievement_graduate',     titleFallback: 'Graduate',        pointsFallback: 200 },
  { localKey: 'evangelist',  action_type: 'achievement_evangelist',   titleFallback: 'Evangelist',      pointsFallback: 100 },
  { localKey: 'centurion',   action_type: 'achievement_centurion',    titleFallback: 'Centurion (100)', pointsFallback: 50  },
  { localKey: 'thousander',  action_type: 'achievement_thousander',   titleFallback: 'Thousand Club',   pointsFallback: 100 },
  { localKey: 'lab_runner',  action_type: 'achievement_lab_runner',   titleFallback: 'Lab Runner',      pointsFallback: 50  },
  { localKey: 'streak_100',  action_type: 'achievement_streak_100',   titleFallback: '100 Day Streak',  pointsFallback: 600 },
]

// Redemption display order + redemption_key bridge.
//
// Pricing is unpublished while PineX is in beta, so any explicit rupee
// amount has been stripped from `valueFallback`. The Pro tier name and
// the cards themselves stay visible — only the ₹ figures are gone.
// The 50%-Off card is hidden entirely because the whole offer ("half
// price") only makes sense once a base price exists. Restore the rupee
// strings + the 50%-Off card when paid pricing launches.
const REDEMPTION_LIST = [
  // Cheapest first so the price ladder reads top-to-bottom. Per-day
  // cost is intentionally HIGHEST on the 1-Day tier — that's the
  // "try before committing" SKU; weekly/monthly reward longer spend.
  //   1 Day   = 100 pts/day
  //   1 Week  = ~36 pts/day
  //   1 Month = ~33 pts/day
  { redemption_key: 'pro_1_day',     localKey: 'pro_day',    cta: 'Redeem',     input: false,   titleFallback: '1 Day Pro',             pointsFallback: 100,   valueFallback: '24 hours of Pro access',                      badgeFallback: 'TRY IT'        },
  // 1 Week Pro launches at 250 — flagged as EARLY ACCESS so the
  // planned move to a 300-point standard price reads as "the intro
  // discount ended", not "you raised the price on me". Once 300 is
  // the published price, drop the badge AND the price floor (never
  // run a future promo BELOW 300 — preserves pricing trust).
  { redemption_key: 'pro_1_week',    localKey: 'pro_week',   cta: 'Redeem',     input: false,   titleFallback: '1 Week Pro',            pointsFallback: 250,   valueFallback: '7 days of Pro access · Early-access price',  badgeFallback: 'EARLY ACCESS'  },
  { redemption_key: 'pro_1_month',   localKey: 'pro_month',  cta: 'Redeem',     input: false,   titleFallback: '1 Month Pro',           pointsFallback: 1000,  valueFallback: '30 days of Pro access',                       badgeFallback: 'BEST VALUE'    },
  // Gift + Streak Freeze are hidden until they're actually wired.
  // Showing "Coming soon" buttons next to the live Pro redemption
  // makes the whole catalogue feel half-baked. Add them back when
  // each one has a working backend RPC + RLS-safe deduction path.
]

// Days granted per Pro-redemption SKU. Keyed by localKey (the field
// REDEMPTION_LIST.localKey + RedeemSection's `r.key`). Used both for
// the days-to-add math in the modal AND for the validity preview
// shown before the user confirms. PAID_PRO_DAYS is still the 30-day
// default referenced elsewhere (e.g. ProActiveBanner). Keep both in
// sync if you change one.
const PRO_REDEMPTION_DAYS = {
  pro_day:   1,
  pro_week:  7,
  pro_month: 30,
}
function isProRedemptionKey(key) {
  return Object.prototype.hasOwnProperty.call(PRO_REDEMPTION_DAYS, String(key || ''))
}

const TABS = [
  { key: 'daily',        label: 'Daily' },
  { key: 'learning',     label: 'Learning' },
  { key: 'referrals',    label: 'Referrals' },
  { key: 'achievements', label: 'Achievements' },
]


// ── Cap formatting ──────────────────────────────────────────────────────────
// Convert {action_type, daily_cap} into the small grey caption under each
// earning card title. The DB stores daily_cap as an integer (or NULL =
// no cap). Caps that aren't per-day (e.g. "Per referral", "One time")
// are encoded by action_type rather than by an extra DB column.
function fmtCap(action_type, daily_cap) {
  if (action_type?.startsWith('module_complete')) return 'One time'
  if (action_type === 'certification')            return 'One time'
  if (action_type === 'featured_answer')          return 'Daily'
  if (action_type === 'ten_upvotes')              return 'Per answer'
  if (action_type === 'referral_click')           return daily_cap ? `${daily_cap} per day` : null
  if (action_type?.startsWith('referral_'))       return 'Per referral'
  if (action_type?.startsWith('achievement_'))    return null
  if (action_type?.startsWith('streak_'))         return null
  if (daily_cap === 1)                            return 'Once/day'
  if (daily_cap && daily_cap > 0)                 return `${daily_cap} per day`
  return null
}


// ── Offer application ───────────────────────────────────────────────────────
// Given a base point value and the list of currently-active offers, return
// { base, final, offer | null } where the picked offer is the one that
// produces the highest final value. Mirrors src/lib/pointsAwarder.js —
// keep the algorithm in sync if you change one of them.
function applyOffer(actionType, basePoints, activeOffers) {
  if (!Array.isArray(activeOffers) || activeOffers.length === 0) {
    return { base: basePoints, final: basePoints, offer: null }
  }
  let bestFinal = basePoints
  let bestOffer = null
  for (const o of activeOffers) {
    // null action_type = applies to every action
    if (o.action_type && o.action_type !== actionType) continue
    const m = Number(o.multiplier) || 1
    const b = Number(o.bonus_points) || 0
    const candidate = Math.round(basePoints * m + b)
    if (candidate > bestFinal) {
      bestFinal = candidate
      bestOffer = o
    }
  }
  return { base: basePoints, final: bestFinal, offer: bestOffer }
}


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
  // item: { icon, title, points, cap, finalPoints?, offer? }
  // When an active offer applies, item.finalPoints differs from item.points
  // — we render the base value as strikethrough + the multiplied value in
  // amber + a tiny 🎉 next to it. Without an offer, falls back to the
  // single-value PointsPill.
  const hasOffer =
    item.offer && Number(item.finalPoints) !== Number(item.points)

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

      {hasOffer ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{
            fontSize: 11,
            color: C.textFaint,
            textDecoration: 'line-through',
            fontFamily: 'Inter, system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}>
            +{Number(item.points).toLocaleString('en-IN')} pts
          </span>
          <span style={{
            fontSize: 14,
            fontWeight: 800,
            color: C.amber,
            fontFamily: 'Inter, system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}>
            +{Number(item.finalPoints).toLocaleString('en-IN')} pts 🎉
          </span>
        </div>
      ) : (
        <PointsPill value={item.points} />
      )}
    </Card>
  )
}


// ── Section 1 — Hero (total + lifetime + referral link) ─────────────────────

function HeroSection({ points, lifetime, referralCode, profile, redemptionNotice }) {
  const [copied, setCopied] = useState(false)
  const referralUrl =
    referralCode ? `pinex.in/join/${referralCode}` : 'Loading…'
  const proWindow = getActiveProWindow(profile) || (redemptionNotice
    ? { start: redemptionNotice.proStartedAt, end: redemptionNotice.proExpiresAt, label: 'Pro active' }
    : null)

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
      {(redemptionNotice || proWindow) && (
        <div style={{
          marginBottom: 16,
          padding: '10px 12px',
          borderRadius: 10,
          border: `1px solid ${C.amberBorder}`,
          background: C.amberBg,
          color: C.text,
          lineHeight: 1.55,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 4 }}>
            {redemptionNotice ? 'Pro unlocked' : proWindow?.label}
          </div>
          {proWindow?.start && proWindow?.end ? (
            <div style={{ fontSize: 12 }}>
              Active from <strong>{formatDateLabel(proWindow.start)}</strong> to <strong>{formatDateLabel(proWindow.end)}</strong>
            </div>
          ) : proWindow?.start ? (
            <div style={{ fontSize: 12 }}>
              Activated on <strong>{formatDateLabel(proWindow.start)}</strong>
            </div>
          ) : null}
        </div>
      )}

      <div style={{
        fontSize: 11,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        color: C.textMuted,
        fontWeight: 700,
        marginBottom: 6,
      }}>
        Your access keys
      </div>
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

function ActiveOfferBanner({ offers }) {
  if (!offers || offers.length === 0) return null
  // The banner just summarises — applyOffer inside each card does the
  // actual maths. Multiple concurrent offers stack here vertically.
  const fmtEnd = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    } catch { return '—' }
  }
  return (
    <div style={{
      background: C.amberBg,
      border: `1px solid ${C.amberBorder}`,
      borderLeft: `4px solid ${C.amber}`,
      borderRadius: 10,
      padding: '10px 14px',
      marginBottom: 14,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: C.amber,
        marginBottom: 4,
      }}>
        🎉 Live promotion
      </div>
      {offers.map(o => {
        const m = Number(o.multiplier) || 1
        const b = Number(o.bonus_points) || 0
        const piece = m !== 1
          ? `${m}×${b > 0 ? ` + ${b} bonus` : ''}`
          : (b > 0 ? `+${b} bonus` : '—')
        return (
          <div
            key={o.id || o.name}
            style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}
          >
            <strong style={{ color: C.amber }}>{o.name}</strong>{' '}
            <span style={{ color: C.textMuted }}>
              — {piece} until {fmtEnd(o.ends_at)}
              {o.action_type ? ` on ${o.action_type}` : ' on all actions'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function HowToEarnSection({ achievementsEarned, derived, activeOffers }) {
  const [tab, setTab] = useState('daily')

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading>How to earn</SectionHeading>

      {/* Active offer banner — only renders when something is live */}
      <ActiveOfferBanner offers={activeOffers} />

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

      {/* Tab body — all earn arrays come from props (live config-driven) */}
      {tab === 'daily' && (
        <>
          {derived.daily.map((item, i) => <EarningCard key={item.action_type || i} item={item} />)}

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
              {derived.streaks.map(m => {
                const offered = m.offer && Number(m.finalPoints) !== Number(m.points)
                return (
                  <div
                    key={m.days}
                    style={{
                      flexShrink: 0,
                      background: C.surface,
                      border: `1px solid ${offered ? C.amberBorder : C.border}`,
                      borderRadius: 10,
                      padding: '10px 14px',
                      textAlign: 'center',
                      minWidth: 88,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{m.days} days</div>
                    {offered ? (
                      <>
                        <div style={{ fontSize: 11, color: C.textFaint, textDecoration: 'line-through', marginTop: 4 }}>
                          +{m.points}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>
                          +{m.finalPoints}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.amber, marginTop: 4 }}>
                        +{m.points}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {tab === 'learning' && (
        <>
          {derived.learning.map((item, i) => <EarningCard key={item.action_type || i} item={item} />)}
        </>
      )}

      {tab === 'referrals' && (
        <>
          {derived.referrals.map((item, i) => <EarningCard key={item.action_type || i} item={item} />)}
          <p style={{
            marginTop: 10,
            fontSize: 12,
            color: C.amber,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 600,
          }}>
            Up to {derived.referralMax.toLocaleString('en-IN')} points per referral
          </p>
        </>
      )}

      {tab === 'achievements' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
        }}>
          {derived.achievements.map(a => {
            const earned = achievementsEarned[a.localKey]
            return (
              <div
                key={a.localKey}
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

function RedeemModal({ open, item, onClose, totalPoints, onRedeemSuccess }) {
  const { user, refreshProfile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  if (!open || !item) return null

  // Both 1-Week and 1-Month Pro redemptions flow through this modal.
  // Look up days via PRO_REDEMPTION_DAYS so adding a 3-month / 6-month
  // tier later is a single-line addition there, not a new conditional
  // here. Falls back to PAID_PRO_DAYS for any legacy item that didn't
  // carry the right localKey.
  const planKey = String(item.localKey || item.key || '')
  const isPro = isProRedemptionKey(planKey)
  const planDays = PRO_REDEMPTION_DAYS[planKey] || PAID_PRO_DAYS
  const planLabel = planDays === 1 ? '24 hours of Pro access'
    : planDays === 7 ? '1 week Pro access'
    : planDays === 30 ? '1 month Pro access'
    : `${planDays} days of Pro access`

  // Validity preview shown BEFORE the user clicks Confirm so they
  // see exactly what they're paying for.
  const previewExpiry = new Date(Date.now() + planDays * 24 * 60 * 60 * 1000)
  // Include time for the 1-day tier — "Pro valid until 22 Jun" alone
  // would be ambiguous about when in the day access actually ends.
  // Longer tiers drop the time; the date is precise enough.
  const previewExpiryStr = planDays <= 1
    ? previewExpiry.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : previewExpiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  async function handleConfirm() {
    if (!isPro) { onClose(); return }
    if (!user?.id) { setErr('Sign in to redeem.'); return }
    setSaving(true); setErr('')
    try {
      const cost = Number(item.points) || 1000
      const now = new Date()
      const nowIso = now.toISOString()
      const defaultExpiryIso = new Date(now.getTime() + planDays * 24 * 60 * 60 * 1000).toISOString()

      let newTotal = 0
      let redeemedPoints = 0
      let proStartedAt = nowIso
      let proExpiresAt = defaultExpiryIso

      // RPC name is historical ('redeem_pro_month') but it accepts a
      // generic p_days — equally valid for 7-day or 30-day grants.
      const { data: rpcData, error: rpcErr } = await supabase.rpc('redeem_pro_month', {
        p_points_cost: cost,
        p_days: planDays,
      })

      const rpcMissing = /function .*redeem_pro_month|Could not find the function|does not exist/i.test(String(rpcErr?.message || ''))
      if (!rpcErr && rpcData) {
        newTotal = Number(rpcData.new_total || 0)
        redeemedPoints = Number(rpcData.redeemed_points || 0)
        proStartedAt = rpcData.pro_started_at || nowIso
        proExpiresAt = rpcData.pro_expires_at || defaultExpiryIso
      } else {
        if (rpcErr && !rpcMissing) throw rpcErr

        const { data: walletRow, error: walletErr } = await supabase
          .from('user_points')
          .select('total_points, redeemed_points')
          .eq('user_id', user.id)
          .maybeSingle()
        if (walletErr) throw walletErr

        const currentTotal = Number(walletRow?.total_points || 0)
        const currentRedeemed = Number(walletRow?.redeemed_points || 0)
        if (currentTotal < cost) {
          throw new Error('Insufficient balance ? your points may have already been spent.')
        }

        newTotal = currentTotal - cost
        redeemedPoints = currentRedeemed + cost

        const { data: spentRow, error: spendErr } = await supabase
          .from('user_points')
          .update({
            total_points: newTotal,
            redeemed_points: redeemedPoints,
            updated_at: nowIso,
          })
          .eq('user_id', user.id)
          .eq('total_points', currentTotal)
          .gte('total_points', cost)
          .select('user_id, total_points')
          .maybeSingle()
        if (spendErr) throw spendErr
        if (!spentRow) {
          throw new Error('Balance changed while redeeming. Refresh and try again.')
        }

        const { error: planErr } = await supabase
          .from('profiles')
          .update({
            plan: 'pro',
            plan_activated_at: nowIso,
            pro_expires_at: defaultExpiryIso,
            trial_expires_at: null,
            points_balance: newTotal,
          })
          .eq('id', user.id)
        if (planErr) throw planErr

        try {
          await supabase
            .from('points_transactions')
            .insert({
              user_id: user.id,
              action_type: 'pro_redemption',
              points: -cost,
              notes: `Pro access redeemed until ${defaultExpiryIso.slice(0, 10)}`,
            })
        } catch { }
      }

      emitWalletUpdated(newTotal)
      await refreshProfile?.()
      if (onRedeemSuccess) {
        await onRedeemSuccess({
          cost,
          newTotal,
          redeemedPoints,
          proStartedAt,
          proExpiresAt,
        })
      }
      try { sessionStorage.setItem('pinex_pro_just_flipped', '1') } catch { }
      onClose()
    } catch (e) {
      setErr(String(e?.message || e).slice(0, 220))
    } finally {
      setSaving(false)
    }
  }

  const balanceNow = Number(totalPoints) || 0
  const balanceAfter = Math.max(0, balanceNow - (Number(item.points) || 0))

  return (
    <div
      onClick={saving ? undefined : onClose}
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
          maxWidth: 380,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 22,
        }}
      >
        <div style={{
          fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          {isPro ? `Redeem ${item.points.toLocaleString('en-IN')} points for Pro?` : 'Confirm redemption?'}
        </div>

        {isPro ? (
          <>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 14, lineHeight: 1.55 }}>
              Your balance: <strong style={{ color: C.text }}>{balanceNow.toLocaleString('en-IN')}</strong> points
              <br />
              After redemption: <strong style={{ color: C.text }}>{balanceAfter.toLocaleString('en-IN')}</strong> points
            </div>
            <div style={{
              background: C.amberBg,
              border: `1px solid ${C.amberBorder}`,
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 18,
              fontSize: 13,
              color: C.text,
              lineHeight: 1.65,
            }}>
              <div style={{ fontWeight: 700, color: C.amber, marginBottom: 6 }}>{planLabel}</div>
              <div>? Full screener</div>
              <div>? SwingX signals</div>
              <div>? Historical conditions</div>
              <div>? Save conditions</div>
              <div>? Advanced features</div>
              <div style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px solid ${C.amberBorder}`,
                fontSize: 12,
                color: C.textMuted,
              }}>
                Pro valid until <strong style={{ color: C.text }}>{previewExpiryStr}</strong>
              </div>
            </div>
            {err && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.30)',
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 14,
                fontSize: 12,
                color: '#fca5a5',
              }}>
                {err}
              </div>
            )}
          </>
        ) : (
          <>
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
              ? Redemption coming soon. Your points are being tracked ? once
              the redemption store is live, you'll be able to spend them here.
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1,
              padding: '11px 0',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              borderRadius: 9,
              color: C.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Cancel
          </button>
          {isPro && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving || balanceNow < (Number(item.points) || 0)}
              style={{
                flex: 1.4,
                padding: '11px 0',
                background: saving || balanceNow < (Number(item.points) || 0) ? '#56473E' : C.amber,
                border: 'none',
                borderRadius: 9,
                color: '#0B0E11',
                fontSize: 13,
                fontWeight: 700,
                cursor: saving || balanceNow < (Number(item.points) || 0) ? 'default' : 'pointer',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              {saving ? 'Redeeming?' : `Confirm ? Redeem ${(Number(item.points) || 0).toLocaleString('en-IN')} pts`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Feature unlocks ──────────────────────────────────────────────
// Reads feature_unlock_costs and renders one card per feature
// with cost + status + unlock CTA. Advanced is fully wired —
// "Unlock now" deducts the cost from user_points (logs a
// negative points_transactions row, decrements total_points,
// bumps redeemed_points) and flips profiles.advanced_unlocked.
// The other features render as informational catalogue rows
// because their unlock columns don't exist yet; the cost is
// shown so the user can see the access ladder.
//
// "Get points instantly" / payment CTA is intentionally NOT
// surfaced here — held until Robin gives the green light on
// payment integration. Until then the only earn path is the
// existing daily / streak / stock_view / referral hooks.
const FEATURE_UNLOCK_SPEND_ENABLED = false
const PUBLIC_REWARDS_FEATURE_LIMIT = 3
const PUBLIC_REWARDS_FEATURES = new Set([
  'advanced',
  'pro_screener',
  'screener',
  'swingx',
])
const PRIVATE_REWARDS_FEATURES = new Set([
  'iqjet',
  'historical_conditions',
  'historical',
])

function normalizedFeatureKey(item) {
  return String(item?.feature_key || item?.display_name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isPublicRewardsFeature(item) {
  const key = normalizedFeatureKey(item)
  if (!key) return false
  if (PRIVATE_REWARDS_FEATURES.has(key)) return false
  if (key.includes('iqjet')) return false
  if (key.includes('historical')) return false
  if (key.includes('advanced')) return true
  if (key.includes('pro_screener')) return true
  if (key.includes('swingx')) return true
  return PUBLIC_REWARDS_FEATURES.has(key)
}

function FeatureUnlocksSection({ user, profile, totalPoints, redeemedPoints, onUnlocked }) {
  const [costs,   setCosts]   = useState([])
  const [busyKey, setBusyKey] = useState(null)
  const [error,   setError]   = useState(null)
  const visibleCosts = useMemo(
    () => (costs || []).filter(isPublicRewardsFeature).slice(0, PUBLIC_REWARDS_FEATURE_LIMIT),
    [costs]
  )
  const isProActive = ['pro', 'pro_trial'].includes(String(profile?.plan || '').toLowerCase())

  useEffect(() => {
    let cancelled = false
    supabase
      .from('feature_unlock_costs')
      .select('feature_key, display_name, points_cost, notes')
      .eq('is_active', true)
      .order('points_cost', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setCosts(data || [])
      })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [])

  function isUnlocked(featureKey) {
    if (featureKey === 'advanced') return profile?.advanced_unlocked === true
    // Other features don't have unlock columns yet — never marked
    // as unlocked at runtime, but the cost is still shown.
    return false
  }

  async function handleUnlock(item) {
    if (!FEATURE_UNLOCK_SPEND_ENABLED) return
    // Only Advanced is wired for the actual flip + deduction. Other
    // features show their cost so users see the ladder but the CTA
    // is informational ("Coming soon") until each gets its own
    // column / route guard.
    if (normalizedFeatureKey(item) !== 'advanced') return
    if ((totalPoints || 0) < item.points_cost) return
    if (busyKey) return
    setBusyKey(item.feature_key)
    setError(null)
    try {
      const { data: walletRow, error: walletErr } = await supabase
        .from('user_points')
        .select('total_points, redeemed_points')
        .eq('user_id', user.id)
        .maybeSingle()
      if (walletErr) throw walletErr

      const currentTotal = Number(walletRow?.total_points || 0)
      const currentRedeemed = Number(walletRow?.redeemed_points || 0)
      if (currentTotal < item.points_cost) {
        throw new Error('Insufficient points ? refresh and try again.')
      }

      const newTotal = currentTotal - item.points_cost
      const { data: spendRow, error: spendErr } = await supabase
        .from('user_points')
        .update({
          total_points: newTotal,
          redeemed_points: currentRedeemed + item.points_cost,
          updated_at:      new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('total_points', currentTotal)
        .gte('total_points', item.points_cost)
        .select('user_id')
        .maybeSingle()
      if (spendErr) throw spendErr
      if (!spendRow) throw new Error('Balance changed while unlocking. Refresh and try again.')

      try {
        await supabase
          .from('points_transactions')
          .insert({
            user_id: user.id,
            points: -item.points_cost,
            action_type: `unlock_${item.feature_key}`,
            notes: `Unlocked ${item.display_name}`,
          })
      } catch { /* non-fatal audit miss */ }
      // 3. Flip the feature flag.
      await supabase
        .from('profiles')
        .update({
          points_balance:       newTotal,
          advanced_unlocked:    true,
          advanced_unlocked_at: new Date().toISOString(),
        })
        .eq('id', user.id)
      if (profile) profile.advanced_unlocked = true
      if (typeof onUnlocked === 'function') onUnlocked(item.feature_key, item.points_cost)
      // Navigate the user straight to the surface they just unlocked.
      window.location.assign('/breadth-lab')
    } catch (e) {
      setError(e?.message || 'Could not unlock — try again in a moment.')
      setBusyKey(null)
    }
  }

  if (!visibleCosts.length) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading>Use points to unlock</SectionHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visibleCosts.map((item) => {
          const featureKey  = normalizedFeatureKey(item)
          const unlocked   = isUnlocked(featureKey)
          const included   = isProActive && ['advanced', 'pro_screener', 'screener', 'swingx'].includes(featureKey)
          const wired      = FEATURE_UNLOCK_SPEND_ENABLED && featureKey === 'advanced'
          const affordable = (totalPoints || 0) >= item.points_cost
          const remaining  = Math.max(0, item.points_cost - (totalPoints || 0))
          const isBusy     = busyKey === featureKey

          let ctaLabel  = 'Coming soon'
          let ctaActive = false
          if (unlocked) {
            ctaLabel  = 'Unlocked ✓'
            ctaActive = false
          } else if (included) {
            ctaLabel  = 'Active in Pro'
            ctaActive = false
          } else if (wired && affordable) {
            ctaLabel  = isBusy ? 'Unlocking…' : 'Unlock now'
            ctaActive = !isBusy
          } else if (wired && !affordable) {
            ctaLabel  = `Need ${remaining.toLocaleString('en-IN')} more`
            ctaActive = false
          }

          const statusBadge = unlocked
            ? { label: 'Unlocked', color: C.green, bg: C.greenBg, border: C.greenBorder || 'rgba(34,197,94,0.4)' }
            : included
              ? { label: 'Active', color: C.green, bg: C.greenBg, border: C.greenBorder || 'rgba(34,197,94,0.4)' }
            : wired
              ? null
              : { label: 'Pending', color: C.textMuted, bg: C.surface2, border: C.border }

          return (
            <div
              key={item.feature_key}
              style={{
                position: 'relative',
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderLeft: `4px solid ${unlocked ? C.green : C.amberBorder}`,
                borderRadius: 10,
                padding: '14px 16px',
              }}
            >
              {statusBadge && (
                <div style={{
                  position: 'absolute',
                  top: 8,
                  right: 12,
                  fontSize: 10,
                  fontWeight: 700,
                  color: statusBadge.color,
                  background: statusBadge.bg,
                  border: `1px solid ${statusBadge.border}`,
                  borderRadius: 6,
                  padding: '2px 8px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}>
                  {statusBadge.label}
                </div>
              )}
              <div style={{
                fontSize: 15,
                fontWeight: 700,
                color: C.text,
                fontFamily: 'Inter, system-ui, sans-serif',
              }}>
                {item.display_name}
              </div>
              <div style={{
                fontSize: 13,
                color: C.amber,
                marginTop: 4,
                fontWeight: 700,
              }}>
                {Number(item.points_cost).toLocaleString('en-IN')} points
              </div>
              {item.notes && (
                <div style={{
                  fontSize: 12,
                  color: C.textMuted,
                  marginTop: 4,
                  lineHeight: 1.5,
                }}>
                  {item.notes}
                </div>
              )}

              <button
                type="button"
                onClick={() => handleUnlock(item)}
                disabled={!ctaActive}
                style={{
                  marginTop: 12,
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: ctaActive ? C.amber : C.surface2,
                  color: ctaActive ? (C.accentOn || '#000') : C.textFaint,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: ctaActive ? 'pointer' : 'not-allowed',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                {ctaLabel}
              </button>
            </div>
          )
        })}
      </div>

      {error && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          background: C.redBg || 'rgba(239,68,68,0.08)',
          border: `1px solid ${C.redBorder || 'rgba(239,68,68,0.4)'}`,
          borderRadius: 6,
          color: C.red || '#EF4444',
          fontSize: 12,
        }}>
          {error}
        </div>
      )}
    </div>
  )
}

function RedeemSection({ totalPoints, redemptions, onRedeemSuccess }) {
  const [modal, setModal] = useState({ open: false, item: null })
  const [giftEmailFor, setGiftEmailFor] = useState(null)

  function tryRedeem(item) {
    setModal({ open: true, item })
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeading>Redeem points</SectionHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {redemptions.map(r => {
          const affordable = (totalPoints || 0) >= r.points
          const accent = r.badge === 'BEST VALUE' ? C.amber : C.amberBorder
          const isGiftInput = r.input === 'email' && giftEmailFor === r.key
          const isLiveRedemption = isProRedemptionKey(r.key)
          const ctaLabel = isLiveRedemption
            ? (affordable ? (r.cta || 'Redeem') : `Need ${(r.points - (Number(totalPoints) || 0)).toLocaleString('en-IN')} more`)
            : 'Coming soon'
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
                onClick={() => tryRedeem(r)}
                disabled={!isLiveRedemption || !affordable}
                style={{
                  marginTop: 12,
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: isLiveRedemption && affordable ? C.amber : C.surface2,
                  color: isLiveRedemption && affordable ? '#0B0E11' : C.textFaint,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isLiveRedemption && affordable ? 'pointer' : 'not-allowed',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
                title={isLiveRedemption ? 'Redeem with points' : 'Redemption store is coming soon'}
              >
                {ctaLabel}
              </button>
            </div>
          )
        })}
      </div>

      <RedeemModal
        open={modal.open}
        item={modal.item}
        onClose={() => setModal({ open: false, item: null })}
        totalPoints={totalPoints}
        onRedeemSuccess={onRedeemSuccess}
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
  const { user, profile, loading: authLoading } = useAuth()

  const [points, setPoints]               = useState(null)
  const [referralCode, setReferralCode]   = useState(null)
  const [transactions, setTransactions]   = useState([])
  const [leaderboard, setLeaderboard]     = useState(null)
  const [myRank, setMyRank]               = useState(null)
  const [loading, setLoading]             = useState(true)
  const [fetchError, setFetchError]       = useState(null)

  // Live config from the points_config / points_offers / redemption_config
  // tables. configMap is keyed on action_type so the derivation memo can
  // do O(1) lookups while building the four tab arrays. If any fetch
  // fails or returns nothing, the derivation falls back to the *Fallback
  // values embedded in ACHIEVEMENT_LIST / REDEMPTION_LIST + meta defaults.
  const [configMap, setConfigMap]               = useState(null)
  const [activeOffers, setActiveOffers]         = useState([])
  const [redemptionsLive, setRedemptionsLive]   = useState(null)
  const [redemptionNotice, setRedemptionNotice] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    setLoading(true)
    setFetchError(null)

    const withTimeout = (promise, ms = 15000) => {
      const timer = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
      })
      return Promise.race([promise, timer])
    }

    const pointsP = withTimeout(supabase
      .from('user_points')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle())

    const profileP = withTimeout(supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', user.id)
      .maybeSingle())

    const txP = withTimeout(supabase
      .from('points_transactions')
      .select('id, points, action_type, notes, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20))

    // Leaderboard RPCs degrade gracefully — if the SQL migration hasn't
    // been run yet, RPC errors with 42883 and we render the empty state.
    const lbP = withTimeout(supabase.rpc('rewards_weekly_leaderboard'))
    const rankP = withTimeout(supabase.rpc('rewards_user_weekly_rank'))

    // ── Live point catalogue ─────────────────────────────────────────
    // Three new fetches against the admin-editable tables. Each one
    // degrades to "use the hardcoded fallback" if the migration hasn't
    // been run or RLS denies the read.
    const cfgP = withTimeout(supabase.from('points_config')
      .select('action_type,points_value,daily_cap,display_name,is_active')
      .eq('is_active', true))

    const nowIso = new Date().toISOString()
    const offP = withTimeout(supabase.from('points_offers')
      .select('id,name,description,multiplier,bonus_points,action_type,starts_at,ends_at')
      .eq('is_active', true)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso))

    const redP = withTimeout(supabase.from('redemption_config')
      .select('redemption_key,display_name,description,value_label,badge,points_required,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order'))

    Promise.all([pointsP, profileP, txP, lbP, rankP, cfgP, offP, redP]).then(
      ([p, pr, tx, lb, rk, cfg, off, red]) => {
        if (cancelled) return
        setPoints(p?.data || null)
        setReferralCode(pr?.data?.referral_code || null)
        setTransactions(tx?.data || [])
        setLeaderboard(Array.isArray(lb?.data) ? lb.data : [])
        const rankData = Array.isArray(rk?.data) ? rk.data[0] : null
        setMyRank(rankData || null)

        // configMap = { action_type → { points_value, daily_cap, display_name } }
        if (Array.isArray(cfg?.data)) {
          const m = {}
          for (const row of cfg.data) {
            if (row?.action_type) m[row.action_type] = row
          }
          setConfigMap(m)
        } else {
          setConfigMap({})  // empty map → derivation uses fallbacks
        }
        setActiveOffers(Array.isArray(off?.data) ? off.data : [])
        setRedemptionsLive(Array.isArray(red?.data) ? red.data : [])

        setLoading(false)
      },
    ).catch((err) => {
      if (cancelled) return
      console.error('[Rewards] load error:', err)
      setFetchError(err?.message || 'Could not load rewards right now.')
      setPoints((cur) => cur || { total_points: 0, lifetime_points: 0, redeemed_points: 0, current_streak: 0, longest_streak: 0 })
      setReferralCode(null)
      setTransactions([])
      setLeaderboard([])
      setMyRank(null)
      setConfigMap({})
      setActiveOffers([])
      setRedemptionsLive([])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [user?.id])

  // ── Derive earn arrays from live config (memoised on config + offers) ──
  // For each entry in ACTION_LISTS, look up the live points_config row,
  // fall back to a sensible default if missing, then apply any active
  // offer to compute finalPoints. Result is passed to HowToEarnSection.
  const derived = useMemo(() => {
    const cfg = configMap || {}

    function buildEarnItem(action_type, titleFallback, pointsFallback) {
      const liveRow = cfg[action_type]
      const meta    = ACTION_META[action_type] || {}
      const points  = liveRow?.points_value ?? pointsFallback ?? 0
      const title   = liveRow?.display_name || titleFallback || action_type
      const cap     = fmtCap(action_type, liveRow?.daily_cap)
      const { final, offer } = applyOffer(action_type, points, activeOffers)
      return {
        action_type,
        icon: meta.icon || '⭐',
        title,
        cap,
        points,
        finalPoints: final,
        offer,
      }
    }

    // Daily / Learning / Referrals — straightforward map from ACTION_LISTS.
    const dailyTitles = {
      daily_login:      'Open app + check watchlist',
      daily_question:   'Answer daily question',
      classify_stock:   'Classify a stock',
      run_screen:       'Run a screen',
      read_methodology: 'Read methodology article',
      discovery_tap: 'Tap a home nudge stock',
      validation_earned: 'Watchlist improvement nudge',
    }
    const learningTitles = {
      module_complete_1:   'Complete Module 1',
      module_complete_2_7: 'Complete Modules 2–7',
      module_complete_8:   'Complete Module 8',
      certification:       'Pass certification',
      featured_answer:     'Featured daily answer',
      ten_upvotes:         '10 upvotes on answer',
    }
    const referralTitles = {
      referral_click:     'Your link clicked',
      referral_register:  'Friend registers',
      referral_module1:   'Friend completes Module 1',
      referral_30day:     'Friend active 30 days',
      referral_certified: 'Friend gets certified',
    }
    // Hardcoded fallbacks per action_type — used when points_config row
    // is missing AND the fallback metadata above doesn't have a value.
    const fallbacks = {
      daily_login: 2, daily_question: 5, classify_stock: 3, run_screen: 2, read_methodology: 3, discovery_tap: 1, validation_earned: 5,
      module_complete_1: 50, module_complete_2_7: 40, module_complete_8: 75, certification: 200, featured_answer: 25, ten_upvotes: 20,
      referral_click: 10, referral_register: 100, referral_module1: 200, referral_30day: 500, referral_certified: 300,
      streak_3_days: 15, streak_7_days: 35, streak_14_days: 75, streak_30_days: 150, streak_100_days: 600,
    }

    const daily = ACTION_LISTS.daily.map(at =>
      buildEarnItem(at, dailyTitles[at], fallbacks[at]),
    )
    const learning = ACTION_LISTS.learning.map(at =>
      buildEarnItem(at, learningTitles[at], fallbacks[at]),
    )
    const referrals = ACTION_LISTS.referrals.map(at =>
      buildEarnItem(at, referralTitles[at], fallbacks[at]),
    )
    const referralMax = referrals.reduce((s, r) => s + (Number(r.finalPoints) || 0), 0)

    // Streak milestones — same shape but renders in a horizontal scroll.
    const streaks = ACTION_LISTS.streaks.map(at => {
      const liveRow = cfg[at]
      const base = liveRow?.points_value ?? fallbacks[at] ?? 0
      const days = parseInt(at.replace('streak_', '').replace('_days', ''), 10) || 0
      const { final, offer } = applyOffer(at, base, activeOffers)
      return { days, action_type: at, points: base, finalPoints: final, offer }
    })

    // Achievements — bridge localKey ↔ action_type, then merge live points.
    const achievements = ACHIEVEMENT_LIST.map(a => {
      const liveRow = cfg[a.action_type]
      const points  = liveRow?.points_value ?? a.pointsFallback
      const title   = liveRow?.display_name || a.titleFallback
      const icon    = (ACTION_META[a.action_type] || {}).icon || '⭐'
      return { localKey: a.localKey, action_type: a.action_type, icon, title, points }
    })

    // Redemptions — merge live redemption_config rows by redemption_key.
    const liveByKey = {}
    if (Array.isArray(redemptionsLive)) {
      for (const r of redemptionsLive) {
        if (r?.redemption_key) liveByKey[r.redemption_key] = r
      }
    }
    // Strip any rupee figure from the value caption. Beta = no
    // published pricing — the redemption_catalog rows still carry
    // legacy "Worth ₹299" / "Worth ₹3,588" strings, so we drop
    // anything containing a ₹ glyph back to the curated fallback.
    // Same idea for the badge — a "Save ₹X" badge would leak the
    // same price the value caption is trying to hide.
    const dropRupeeStr = (s, fallback) =>
      (typeof s === 'string' && s.includes('₹')) ? fallback : s

    const redemptions = REDEMPTION_LIST.map(r => {
      const live = liveByKey[r.redemption_key]
      return {
        key:    r.localKey,
        title:  live?.display_name   || r.titleFallback,
        points: live?.points_required ?? r.pointsFallback,
        value:  dropRupeeStr(live?.value_label, r.valueFallback) || r.valueFallback,
        badge:  dropRupeeStr(live?.badge,       r.badgeFallback) ?? r.badgeFallback,
        cta:    r.cta,
        input:  r.input,
      }
    })

    return { daily, learning, referrals, referralMax, streaks, achievements, redemptions }
  }, [configMap, activeOffers, redemptionsLive])

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
          {fetchError && (
            <div style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 12,
              background: C.redBg,
              border: `1px solid ${C.redBorder}`,
              color: C.text,
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              Rewards data is partially unavailable. Showing a fallback view.
              <div style={{ marginTop: 4, color: C.textMuted }}>{fetchError}</div>
            </div>
          )}
          {/* SECTION ORDER (Jun 2026 rework)
              Redeem is now the FIRST card after the hero. The earn
              catalogue used to sit on top, which buried the actual
              "spend your points" CTA under a long list of micro-
              earning tasks. Lead with the spend; the earning ladder
              is still discoverable below for users who want it. */}
          <HeroSection
            points={points?.total_points}
            lifetime={points?.lifetime_points}
            referralCode={referralCode}
            profile={profile}
            redemptionNotice={redemptionNotice}
          />
          <RedeemSection
            totalPoints={points?.total_points}
            redemptions={derived.redemptions}
            onRedeemSuccess={({ cost, newTotal, redeemedPoints, proStartedAt, proExpiresAt }) => {
              setPoints((cur) => ({
                ...(cur || {}),
                total_points: newTotal,
                redeemed_points: redeemedPoints,
              }))
              setTransactions((cur) => ([{
                id: `local-pro-redemption-${Date.now()}`,
                points: -cost,
                action_type: 'pro_redemption',
                notes: `Pro access redeemed until ${String(proExpiresAt || '').slice(0, 10)}`,
                created_at: new Date().toISOString(),
              }, ...(cur || [])].slice(0, 20)))
              setRedemptionNotice({ proStartedAt, proExpiresAt })
            }}
          />
          <HowToEarnSection
            achievementsEarned={achievementsEarned}
            derived={derived}
            activeOffers={activeOffers}
          />
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
          <Icon name="arrow-left" style={{ fontSize: 20 }} />
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
