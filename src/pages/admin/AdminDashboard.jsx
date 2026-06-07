import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

// ── /admin Dashboard ─────────────────────────────────────────────────────
// Read-only overview. Four stat cards in a 2×2 grid + a stale-pipeline
// banner when today's run hasn't happened yet. No actions, no widgets,
// no scroll-forever list of every internal metric — those moved to
// /admin/users, /admin/engagement, /admin/pipeline etc.
//
// All counts use Supabase `count: 'exact', head: true` HEAD-only queries
// where possible (cheaper than fetching rows just to .length them).

// ── Card primitive ─────────────────────────────────────────────────────
function StatCard({ title, icon, children, accent = C.text }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {icon && (
          <span style={{
            width: 28, height: 28, borderRadius: 8,
            background: `${accent}1a`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className={`ti ${icon}`} style={{ fontSize: 15, color: accent }} />
          </span>
        )}
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: C.textMuted,
        }}>
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function StatRow({ label, value, color = C.text }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12, color: C.textMuted }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value === null || value === undefined ? '—' : value.toLocaleString('en-IN')}
      </span>
    </div>
  )
}

// ── Helper: HEAD count of a Supabase filter expression ─────────────────
async function headCount(promise) {
  const { count } = await promise
  return typeof count === 'number' ? count : 0
}

// ── Main ────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        const weekAgo  = new Date(Date.now() - 7 * 86400000).toISOString()
        const dayAgo   = new Date(Date.now() - 86400000).toISOString()
        const todayIso = now.toISOString().split('T')[0]

        const [
          totalUsersR, activeTodayR, activeWeekR, newWeekR,
          totalAcademyR, genuineR, grandfatheredR, pendingR,
          totalPointsRowsR, questionsTodayR, referralsWeekR,
          pipelineLastR, descCountR, swingCountR, errorsTodayR,
          tgTotalR, tgLinkedR, tgWeekR,
        ] = await Promise.all([
          // Users card
          headCount(supabase.from('profiles').select('id', { count: 'exact', head: true })),
          headCount(supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active_at', dayAgo)),
          headCount(supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active_at', weekAgo)),
          headCount(supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo)),
          // Academy card
          headCount(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('academy_completed', true)),
          // Genuine = completed AND NOT grandfathered. Two separate counts
          // can't be combined into a single PostgREST head call without an
          // RPC, so fetch the small (~10-row) detail.
          supabase.from('profiles').select('id,academy_completed,academy_grandfathered').eq('academy_completed', true).limit(500),
          headCount(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('academy_grandfathered', true)),
          // Pending = not yet completed, no grandfather either
          headCount(
            supabase.from('profiles').select('id', { count: 'exact', head: true })
              .eq('academy_completed', false)
              .neq('academy_grandfathered', true)
          ),
          // Engagement card — pull all user_points rows (small table) for streak avg + points sum
          supabase.from('user_points').select('total_points,current_streak').limit(5000),
          headCount(
            supabase.from('points_transactions').select('id', { count: 'exact', head: true })
              .eq('action_type', 'daily_question').gte('created_at', todayStart)
          ),
          headCount(
            supabase.from('points_transactions').select('id', { count: 'exact', head: true })
              .like('action_type', '%referral%').gte('created_at', weekAgo)
          ),
          // Platform Health card — latest pipeline event
          supabase.from('usage_events').select('created_at,event_type')
            .or('event_type.eq.calc_swing_conditions_finished,event_type.eq.fetch_bhav_daily,event_type.eq.generate_descriptions')
            .order('created_at', { ascending: false }).limit(1).maybeSingle(),
          headCount(supabase.from('stock_descriptions').select('id', { count: 'exact', head: true })),
          headCount(supabase.from('swing_conditions').select('id', { count: 'exact', head: true }).eq('date', todayIso)),
          headCount(
            supabase.from('usage_events').select('id', { count: 'exact', head: true })
              .or('event_type.like.%failed%,event_type.like.%error%').gte('created_at', todayStart)
          ),
          // Telegram bot card — total subscribers ever (anyone who hit /start),
          // subscribers linked to a PineX account (user_id NOT NULL),
          // and new subscribers in the last 7 days. All HEAD counts.
          // Returns 0 silently if the RLS policy isn't in place — run
          // scripts/sql/admin_read_telegram_subscribers.sql once.
          headCount(supabase.from('telegram_subscribers').select('chat_id', { count: 'exact', head: true })),
          headCount(supabase.from('telegram_subscribers').select('chat_id', { count: 'exact', head: true }).not('user_id', 'is', null)),
          headCount(supabase.from('telegram_subscribers').select('chat_id', { count: 'exact', head: true }).gte('created_at', weekAgo)),
        ])

        if (cancelled) return

        const compRows = genuineR?.data || []
        const genuineCount = compRows.filter(r => r.academy_completed === true && r.academy_grandfathered !== true).length

        const pointsRows = totalPointsRowsR?.data || []
        const totalPointsDistributed = pointsRows.reduce((s, r) => s + (Number(r.total_points) || 0), 0)
        const activeStreakRows = pointsRows.filter(r => (Number(r.current_streak) || 0) > 0)
        const avgStreak = activeStreakRows.length
          ? Math.round(activeStreakRows.reduce((s, r) => s + r.current_streak, 0) / activeStreakRows.length)
          : 0

        const lastPipeline = pipelineLastR?.data?.created_at || null

        setData({
          // Users
          totalUsers: totalUsersR, activeToday: activeTodayR, activeWeek: activeWeekR, newWeek: newWeekR,
          // Academy
          totalAcademy: totalAcademyR, genuine: genuineCount, grandfathered: grandfatheredR, pending: pendingR,
          // Engagement
          avgStreak, totalPointsDistributed, questionsToday: questionsTodayR, referralsWeek: referralsWeekR,
          // Platform
          lastPipeline, descCount: descCountR, swingCount: swingCountR, errorsToday: errorsTodayR,
          // Telegram bot
          tgTotal: tgTotalR, tgLinked: tgLinkedR, tgWeek: tgWeekR,
        })
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('[AdminDashboard] load failed:', e)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, maxWidth: 1100 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            height: 200, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, opacity: 0.5,
          }} />
        ))}
      </div>
    )
  }

  if (!data) {
    return <p style={{ color: C.textMuted }}>Dashboard data unavailable.</p>
  }

  // Format pipeline timestamp + freshness check
  const lastPipelineLabel = data.lastPipeline
    ? new Date(data.lastPipeline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
    : 'Never'
  const errorsBadge = data.errorsToday > 0
    ? <span style={{ color: C.red, fontWeight: 700 }}>YES ({data.errorsToday})</span>
    : <span style={{ color: C.green, fontWeight: 700 }}>NO</span>

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
          Read-only overview. Drill into specific surfaces from the sidebar.
        </p>
      </div>

      {/* 2×2 stat grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 16,
      }}>
        <StatCard title="Users" icon="ti-users" accent={C.blue}>
          <StatRow label="Total registered" value={data.totalUsers} />
          <StatRow label="Active today"     value={data.activeToday} color={C.green} />
          <StatRow label="Active this week" value={data.activeWeek} />
          <StatRow label="New this week"    value={data.newWeek} color={C.amber} />
        </StatCard>

        <StatCard title="Academy" icon="ti-school" accent={C.amber}>
          <StatRow label="Total graduates"      value={data.totalAcademy} />
          <StatRow label="Genuine completions"  value={data.genuine} color={C.green} />
          <StatRow label="Grandfathered"        value={data.grandfathered} color={C.textMuted} />
          <StatRow label="Pending assessment"   value={data.pending} />
        </StatCard>

        <StatCard title="Engagement" icon="ti-flame" accent={C.amber}>
          <StatRow label="Avg streak (active)"        value={`${data.avgStreak}d`} />
          <StatRow label="Total points distributed"   value={data.totalPointsDistributed} color={C.amber} />
          <StatRow label="Questions answered today"   value={data.questionsToday} />
          <StatRow label="Referrals this week"        value={data.referralsWeek} color={C.green} />
        </StatCard>

        <StatCard title="Platform Health" icon="ti-activity" accent={C.green}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, color: C.textMuted }}>Pipeline last ran</span>
            <span style={{ fontSize: 12, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{lastPipelineLabel}</span>
          </div>
          <StatRow label="Descriptions generated" value={data.descCount} />
          <StatRow label="Swing conditions today" value={data.swingCount} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, color: C.textMuted }}>Errors today</span>
            <span style={{ fontSize: 14 }}>{errorsBadge}</span>
          </div>
        </StatCard>

        {/* Telegram bot card — counts from telegram_subscribers via an
            admin-only RLS policy (scripts/sql/admin_read_telegram_subscribers.sql).
            If the count shows 0 with the bot known to be active, the RLS
            policy isn't in place — service-role writes still work but the
            browser session can't read. */}
        <StatCard title="Telegram Bot" icon="ti-brand-telegram" accent="#229ED9">
          <StatRow label="Total subscribers"     value={data.tgTotal} color="#229ED9" />
          <StatRow label="Linked to PineX"       value={data.tgLinked} color={C.green} />
          <StatRow label="Unlinked"              value={Math.max(0, (data.tgTotal || 0) - (data.tgLinked || 0))} color={C.textMuted} />
          <StatRow label="New this week"         value={data.tgWeek} color={C.amber} />
        </StatCard>
      </div>

      {/* Footer links — quick jumps */}
      <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {[
          { to: '/admin/points',     label: 'Points & Rewards', icon: 'ti-star' },
          { to: '/admin/engagement', label: 'Engagement',       icon: 'ti-flame' },
          { to: '/admin/pipeline',   label: 'Pipeline Logs',    icon: 'ti-activity' },
          { to: '/admin/questions',  label: 'Daily Questions',  icon: 'ti-message-question' },
        ].map(l => (
          <Link
            key={l.to}
            to={l.to}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px',
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.textMuted, textDecoration: 'none',
              fontSize: 12, fontWeight: 600,
            }}
          >
            <i className={`ti ${l.icon}`} style={{ fontSize: 14 }} />
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
