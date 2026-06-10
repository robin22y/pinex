// YouWereRight — surfaces watchlist stocks whose criteria score
// IMPROVED today vs the previous trading day. Sits ABOVE the watchlist
// section on Home, dismissible per-stock per-day via sessionStorage.
//
// Final header copy reads "📊 Watchlist criteria updates" + neutral
// data framing per the SEBI-safe pass — earlier "✅ You were right"
// validation language was dropped before shipping.
//
// Logic:
//   - Read user's watchlist symbols → fetch latest swing_conditions
//     for those companies + the previous trading day's rows.
//   - Keep rows where today_score > yesterday_score.
//   - Sort by biggest jump, cap at 3.
//   - Render nothing if empty (no empty card).
//
// Points side-effect (config-driven, capped 1/day): once the component
// has confirmed at least one improvement and rendered, awardPoints
// fires for 'validation_earned'. Cap enforcement happens upstream
// (points_config.daily_cap) — we just fire-and-forget.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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

const DISMISS_LS_KEY = (iso) => `pinex_validated_dismissed_${iso}`

function readDismissed(iso) {
  try {
    const raw = sessionStorage.getItem(DISMISS_LS_KEY(iso))
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function writeDismissed(iso, set) {
  try {
    sessionStorage.setItem(DISMISS_LS_KEY(iso), JSON.stringify(Array.from(set)))
  } catch { /* private browsing — silent miss */ }
}

export default function YouWereRight({ userId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows]       = useState([])
  const [tradingDate, setTradingDate] = useState(null)
  // Local copy of the dismissed set so a click hides immediately
  // without waiting for sessionStorage to come back through state.
  const [dismissed, setDismissed] = useState(() => readDismissed(todayIso()))

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        // 1. Watchlist company_ids — we need the ids for swing_conditions joins.
        const { data: wlData } = await supabase
          .from('watchlist')
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

        // 2. Latest swing_conditions date + the previous trading day's
        // date. Two cheap maybeSingle reads ordered desc — relying on
        // the existing (date, conditions_met) index rather than scanning.
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

        // 3. Today's + previous day's swing_conditions for these
        // company_ids in parallel.
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
        for (const r of prevRows || []) {
          prevMap.set(r.company_id, Number(r.conditions_met) || 0)
        }

        // 4. Diff. Keep only improvements.
        const improvements = []
        for (const r of todayRows || []) {
          const cid = r.company_id
          const today = Number(r.conditions_met) || 0
          const yest = prevMap.has(cid) ? prevMap.get(cid) : 0
          if (today > yest) {
            const co = idToCompany.get(cid)
            if (!co) continue
            improvements.push({
              symbol: co.symbol,
              name:   co.name,
              today,
              yest,
              jump:   today - yest,
              reason: r.criteria_change_reason || '',
              meaningful: today >= 4 && yest < 4,
            })
          }
        }
        improvements.sort((a, b) => b.jump - a.jump)
        const top = improvements.slice(0, MAX_RESULTS)
        if (cancelled) return
        setRows(top)
        setTradingDate(todayDate)
        setLoading(false)

        // Validation-earned points — fires once per session per day
        // (config daily_cap=1). Only when at least one row renders.
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
  }, [userId])

  // Skeleton (brief). Hidden entirely once resolved if there's nothing
  // to surface.
  if (loading) {
    return (
      <div
        aria-hidden
        style={{
          background: 'rgba(0,200,5,0.06)',
          border: '1px solid rgba(0,200,5,0.2)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          height: 120,
          opacity: 0.6,
          animation: 'pulse 1.5s infinite',
        }}
      />
    )
  }
  const visible = rows.filter((r) => !dismissed.has(r.symbol))
  if (!visible.length) return null

  const isHistorical = tradingDate && tradingDate !== todayIso()

  function handleDismissAll() {
    const next = new Set(dismissed)
    for (const r of visible) next.add(r.symbol)
    setDismissed(next)
    writeDismissed(todayIso(), next)
  }

  return (
    <div
      style={{
        background: 'rgba(0,200,5,0.06)',
        border: '1px solid rgba(0,200,5,0.2)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        position: 'relative',
      }}
    >
      {/* Close × top-right — dismisses every currently-rendered symbol
          for the rest of the session. */}
      <button
        type="button"
        onClick={handleDismissAll}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          top: 8,
          right: 10,
          background: 'transparent',
          border: 'none',
          color: C.textMuted,
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 4,
        }}
      >
        ×
      </button>

      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: C.green,
          marginBottom: 4,
        }}
      >
        📊 Watchlist criteria updates
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

      {visible.map((r) => (
        <Link
          key={r.symbol}
          to={`/stock/${r.symbol}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            textDecoration: 'none',
            color: 'inherit',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                color: C.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {r.name}
            </div>
            {r.reason && (
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                {r.reason}
              </div>
            )}
          </div>
          <span
            style={{
              color: C.green,
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {r.yest}/5 → {r.today}/5
          </span>
        </Link>
      ))}

      {/* Footer disclaimer — SEBI-safe neutral framing. */}
      <div
        style={{
          fontSize: 10,
          color: C.textFaint,
          marginTop: 8,
        }}
      >
        Data only · Not investment advice
      </div>
    </div>
  )
}
