// YouWereRight — watchlist criteria-improvement card.
//
// Surfaces the user's own stocks that strengthened (conditions_met
// went up) since the previous trading day. Visual + animation upgrade
// per the poll-driven home redesign: subtle green gradient, soft glow
// corner, framer-motion entry, animated score-change pills, animated
// pulse on a fresh 5/5 ribbon, and a per-session dismiss action.
//
// SEBI-safe by construction — every label is neutral data framing.
// Header reads "📊 Criteria update on your watchlist" (not "You were
// right"); legal footer + score deltas + change reasons are all
// objective. No buy/sell, no targets, no price values.
//
// Self-fetching by design: the data (today's + previous trading day's
// swing_conditions for the user's watchlist company_ids) isn't reused
// elsewhere on the page, so centralising it in Home.jsx wouldn't pay
// for the cost of threading state through ~4 k lines.
//
// Points side-effect (config-driven, capped 1/day): once at least one
// improvement has rendered, awardPoints fires 'validation_earned'.
// Cap enforcement happens upstream (points_config.daily_cap) — we
// just fire-and-forget. The visible card itself IS the reward.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { awardPoints } from '../lib/pointsAwarder'
import { C } from '../styles/tokens'

const MAX_RESULTS = 3

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function isWeekendIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

function shortDate(iso) {
  if (!iso) return ''
  try {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
    })
  } catch { return iso }
}

const DISMISS_LS_KEY = 'pinex_ywr_dismissed'

function readDismissedDate() {
  try { return sessionStorage.getItem(DISMISS_LS_KEY) || null }
  catch { return null }
}

function writeDismissedDate(iso) {
  try { sessionStorage.setItem(DISMISS_LS_KEY, iso) } catch { /* private browsing */ }
}

export default function YouWereRight({ userId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [tradingDate, setTradingDate] = useState(null)
  // Initialised from sessionStorage — if dismissed earlier today, the
  // card starts hidden and never queries.
  const [dismissed, setDismissed] = useState(() => readDismissedDate() === todayIso())

  useEffect(() => {
    if (!userId || dismissed) {
      setLoading(false)
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        // Watchlist → company_ids + display names.
        const { data: wlData } = await supabase
          .from('watchlists')
          .select('symbol,companies(id,symbol,name)')
          .eq('user_id', userId)
        const companies = []
        for (const r of wlData || []) {
          const id = r?.companies?.id
          const sym = r?.companies?.symbol || r?.symbol
          const name = r?.companies?.name || sym
          if (id) companies.push({ id, symbol: String(sym || '').toUpperCase(), name })
        }
        if (companies.length === 0) {
          if (!cancelled) { setRows([]); setLoading(false) }
          return
        }
        const companyIds = companies.map((c) => c.id)
        const idToCompany = new Map(companies.map((c) => [c.id, c]))

        // Latest swing_conditions date — anchors both "today" and the
        // pull of "previous trading day" below.
        const { data: latest } = await supabase
          .from('swing_conditions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        const todayDate = latest?.date || null
        if (!todayDate) {
          if (!cancelled) { setRows([]); setLoading(false) }
          return
        }
        // Freshness gate — on a trading day the pipeline must have
        // landed; weekends/holidays we trust last-trading-day data and
        // show "as of <date>" in the subtitle.
        const t = todayIso()
        if (todayDate < t && !isWeekendIso(t)) {
          if (!cancelled) { setRows([]); setLoading(false); setTradingDate(todayDate) }
          return
        }
        const { data: prevRow } = await supabase
          .from('swing_conditions')
          .select('date')
          .lt('date', todayDate)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        const prevDate = prevRow?.date || null

        const [{ data: todayRows }, { data: prevRows }] = await Promise.all([
          supabase
            .from('swing_conditions')
            .select('company_id,conditions_met,criteria_change_reason')
            .eq('date', todayDate)
            .in('company_id', companyIds),
          prevDate
            ? supabase
                .from('swing_conditions')
                .select('company_id,conditions_met')
                .eq('date', prevDate)
                .in('company_id', companyIds)
            : Promise.resolve({ data: [] }),
        ])
        const prevMap = new Map()
        for (const r of prevRows || []) prevMap.set(r.company_id, Number(r.conditions_met) || 0)

        const improvements = []
        for (const r of todayRows || []) {
          const today = Number(r.conditions_met) || 0
          const yest = prevMap.has(r.company_id) ? prevMap.get(r.company_id) : 0
          if (today > yest) {
            const co = idToCompany.get(r.company_id)
            if (!co) continue
            improvements.push({
              symbol: co.symbol,
              name:   co.name,
              today,
              yest,
              jump:   today - yest,
              reason: r.criteria_change_reason || '',
              maxedOut: today === 5,
            })
          }
        }
        improvements.sort((a, b) => b.jump - a.jump)
        const top = improvements.slice(0, MAX_RESULTS)
        if (cancelled) return
        setRows(top)
        setTradingDate(todayDate)
        setLoading(false)

        // Once-per-day validation earn — points_config.daily_cap=1
        // enforces the once-per-day rule server-side.
        if (top.length > 0) {
          awardPoints(userId, 'validation_earned', {
            fallbackPoints: 5,
            notes: `Watchlist improvements: ${top.map((x) => x.symbol).join(', ')}`,
            referenceId: null,
          }).catch(() => {})
        }
      } catch {
        if (!cancelled) { setRows([]); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [userId, dismissed])

  // No skeleton — either we show or we don't (spec). The brief
  // shimmer would create a flash on quiet days when the resolved
  // state is "render nothing".
  if (loading) return null
  if (!rows.length) return null

  const isHistorical = tradingDate && tradingDate !== todayIso()

  function handleDismiss() {
    writeDismissedDate(todayIso())
    setDismissed(true)
  }

  return (
    <AnimatePresence initial={false}>
      {!dismissed && (
        <motion.div
          key="ywr"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            background:
              'linear-gradient(135deg, rgba(0,200,5,0.08) 0%, rgba(0,200,5,0.03) 100%)',
            border: '1px solid rgba(0,200,5,0.25)',
            borderRadius: 16,
            padding: '16px 18px',
            marginBottom: 16,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Soft top-right glow — pure decoration, ignore taps. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: -20,
              right: -20,
              width: 80,
              height: 80,
              background:
                'radial-gradient(circle, rgba(0,200,5,0.15), transparent 70%)',
              pointerEvents: 'none',
            }}
          />

          {/* Header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>📊</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: C.green,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Criteria update on your watchlist
              </span>
            </div>
            <span style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>
              {shortDate(tradingDate || todayIso())}
            </span>
          </div>

          <div
            style={{
              fontSize: 11,
              color: C.textMuted,
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            These stocks in your watchlist had criteria changes today
            {isHistorical ? ` · as of ${tradingDate}` : ''}
          </div>

          {/* Stock rows */}
          {rows.map((r, i) => (
            <motion.div
              key={r.symbol}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.08 * i }}
              style={{ marginBottom: 6 }}
            >
              <Link
                to={`/stock/${r.symbol}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: 'rgba(0,200,5,0.05)',
                  borderRadius: 10,
                  border: '1px solid rgba(0,200,5,0.12)',
                  textDecoration: 'none',
                  color: 'inherit',
                  gap: 10,
                  minHeight: 48,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: C.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {r.name}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {r.symbol}
                  </div>
                  {r.reason && (
                    <div
                      style={{
                        fontSize: 10,
                        color: C.textMuted,
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.reason}
                    </div>
                  )}
                </div>
                {/* Score-change pills — old (muted) → arrow → new (green).
                    The new pill PULSES once on mount when the jump lands
                    on 5/5 (fully met). One animation, not a loop. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span
                    style={{
                      background: C.surface2,
                      border: `1px solid ${C.border}`,
                      color: C.textMuted,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.yest}/5
                  </span>
                  <span style={{ color: C.textMuted, fontSize: 11 }}>→</span>
                  <motion.span
                    initial={r.maxedOut ? { scale: 1 } : false}
                    animate={r.maxedOut ? { scale: [1, 1.12, 1] } : undefined}
                    transition={r.maxedOut ? { duration: 0.4 } : undefined}
                    style={{
                      background: 'rgba(0,200,5,0.15)',
                      border: '1px solid rgba(0,200,5,0.4)',
                      color: C.green,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                    }}
                  >
                    {r.today}/5
                  </motion.span>
                </div>
              </Link>
            </motion.div>
          ))}

          {/* Dismiss + SEBI legal footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              fontSize: 10,
              color: C.textFaint,
            }}
          >
            <span>Criteria data only · Not investment advice</span>
            <button
              type="button"
              onClick={handleDismiss}
              style={{
                background: 'transparent',
                border: 'none',
                color: C.textFaint,
                fontSize: 10,
                cursor: 'pointer',
                padding: '6px 0',
                minHeight: 32,
              }}
            >
              ×  Dismiss for today
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
