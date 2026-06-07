// ── MorningBrief ────────────────────────────────────────────────────────────
// Per-user daily card. Renders at the top of Home for logged-in users on
// weekdays only. Data is written nightly by scripts/generate_morning_briefs.py
// into the morning_briefs table — this component just reads today's row.
//
// Rules (from spec):
//   - No row in DB for today → render null (don't show stale yesterday data)
//   - Weekend → render null (markets are closed; no fresh brief)
//   - Anonymous user → render null (only logged-in audience)
//   - Loading → show 3-line skeleton matching card height
//
// Icons use the existing @tabler/icons-webfont approach (<i className="ti
// ti-...">) — the codebase doesn't have @tabler/icons-react installed; using
// the webfont keeps bundle size flat and matches every other Home component.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context'
import { C } from '../styles/tokens'
import Skeleton from './ui/Skeleton'

import Icon from './ui/Icon'
// ─────────────────────────────────────────────────────────────────
// IST helpers — brief_date is stored as the IST trading day, not
// UTC. A 21:00 IST refresh is already past UTC midnight, so we
// can't just slice ISOString() in the user's local zone.
// ─────────────────────────────────────────────────────────────────

function istDate() {
  // Shift UTC by +05:30, then take YYYY-MM-DD.
  const utcMs = Date.now()
  const istMs = utcMs + (5.5 * 60 * 60 * 1000)
  return new Date(istMs).toISOString().slice(0, 10)
}

function istIsWeekday() {
  const utcMs = Date.now()
  const istMs = utcMs + (5.5 * 60 * 60 * 1000)
  const day = new Date(istMs).getUTCDay() // 0=Sun .. 6=Sat
  return day >= 1 && day <= 5
}

// ─────────────────────────────────────────────────────────────────
// Character → palette. Falls back to MIXED neutral for unexpected
// values (e.g. an old row written by a future script version).
// ─────────────────────────────────────────────────────────────────

const CHARACTER_STYLE = {
  STRONG:    { color: C.green,     bg: C.greenBg,    border: C.greenBorder },
  SELECTIVE: { color: C.amber,     bg: C.amberBg,    border: C.amberBorder },
  MIXED:     { color: C.textMuted, bg: C.surfaceCard, border: C.border },
  WEAK:      { color: C.red,       bg: C.redBg,      border: C.redBorder },
}

// ─────────────────────────────────────────────────────────────────
// Card chrome — single source for outer styling so the skeleton
// and the populated card share dimensions and there's no visual
// pop when loading resolves.
// ─────────────────────────────────────────────────────────────────

const cardStyle = {
  background: C.surfaceCard,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export default function MorningBrief() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [brief, setBrief] = useState(null)
  const [loading, setLoading] = useState(true)

  // Early bail before the fetch effect runs — saves a network call
  // when the user is anonymous or it's a weekend. Effect still
  // mounts so React's hook order stays stable across renders.
  const weekday = istIsWeekday()

  useEffect(() => {
    if (!user || !weekday) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const today = istDate()
        const { data, error } = await supabase
          .from('morning_briefs')
          .select(
            'market_character,breadth_pct,watchlist_total,' +
            'watchlist_changed,changed_symbols,top_sector,' +
            'top_sector_trend,daily_question'
          )
          .eq('user_id', user.id)
          .eq('brief_date', today)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          // Soft fail — never crash Home. The card just doesn't render.
          console.warn('[MorningBrief] fetch error:', error.message)
          setBrief(null)
        } else {
          setBrief(data || null)
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('[MorningBrief] fetch threw:', e)
          setBrief(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user, weekday])

  // Bail-out branches — return null per spec. Each is unambiguous;
  // ordering matches: anon → weekend → no-row → render.
  if (!user) return null
  if (!weekday) return null
  if (loading) return <MorningBriefSkeleton />
  if (!brief) return null

  const character = brief.market_character || 'MIXED'
  const palette = CHARACTER_STYLE[character] || CHARACTER_STYLE.MIXED
  const breadth = brief.breadth_pct
  const wlTotal = brief.watchlist_total || 0
  const wlChanged = brief.watchlist_changed || 0
  const topSector = brief.top_sector
  const topSectorTrend = brief.top_sector_trend
  const dailyQuestion = brief.daily_question

  return (
    <div style={cardStyle} aria-label="Morning brief">
      {/* ── Line 1: market-character badge + breadth % ───────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 9px',
            borderRadius: 6,
            background: palette.bg,
            border: `1px solid ${palette.border}`,
            color: palette.color,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
          }}
        >
          <Icon name="circle-filled" style={{ fontSize: 8 }} />
          {character}
        </span>
        {breadth != null && (
          <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'var(--font-mono)' }}>
            Breadth {Number(breadth).toFixed(0)}%
          </span>
        )}
      </div>

      {/* ── Line 2: watchlist count + changed-since-yesterday link ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: C.text }}>
          <Icon name="bookmark" style={{ fontSize: 14, marginRight: 5, color: C.textMuted }} />
          Your watchlist · <strong style={{ color: C.textHeading }}>{wlTotal}</strong> stock{wlTotal === 1 ? '' : 's'}
        </span>
        {wlChanged > 0 && (
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 6,
              background: C.blueBg,
              border: `1px solid ${C.blue}33`,
              color: C.blue,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            aria-label={`${wlChanged} watchlist stocks changed since yesterday — open watchlist`}
          >
            {wlChanged} changed since yesterday
            <Icon name="arrow-right" style={{ fontSize: 12 }} />
          </button>
        )}
      </div>

      {/* ── Line 3: sector insight (only when top_sector exists) ── */}
      {topSector && (
        <div style={{ fontSize: 12, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon
            name={
              topSectorTrend === 'rising'
                ? 'trending-up'
                : topSectorTrend === 'weakening'
                ? 'trending-down'
                : 'minus'
            }
            size={14}
            style={{
              color:
                topSectorTrend === 'rising' ? C.green
                  : topSectorTrend === 'weakening' ? C.red
                  : C.textMuted,
            }}
          />
          <span>
            <strong style={{ color: C.text, fontWeight: 600 }}>{topSector}</strong>
            {topSectorTrend ? ` ${topSectorTrend}` : ''}
          </span>
        </div>
      )}

      {/* ── Bottom: daily question, subtle + italic ─────────── */}
      {dailyQuestion && (
        <div
          style={{
            marginTop: 4,
            paddingTop: 10,
            borderTop: `1px solid ${C.border}`,
            fontSize: 12,
            fontStyle: 'italic',
            color: C.textFaint,
            lineHeight: 1.55,
          }}
        >
          {dailyQuestion}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Skeleton — same outer chrome as the populated card so swap is
// visually stable. Three lines match Line 1 / 2 / Question.
// ─────────────────────────────────────────────────────────────────

function MorningBriefSkeleton() {
  return (
    <div style={cardStyle} aria-hidden="true">
      {/* Badge + breadth */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Skeleton height={20} width={84} />
        <Skeleton height={20} width={80} />
      </div>
      {/* Watchlist line */}
      <Skeleton height={14} width="70%" />
      {/* Question line */}
      <div style={{ paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
        <Skeleton height={12} width="92%" />
      </div>
    </div>
  )
}
