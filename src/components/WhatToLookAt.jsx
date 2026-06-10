// WhatToLookAt — 3 personalised stock suggestions on Home for logged-
// in users with at least 1 watchlist stock.
//
// Pulls the watchlist symbols, derives the unique sectors the user is
// actually following, then surfaces today's highest-criteria-score
// stocks IN those sectors that aren't already in the watchlist. If the
// sector overlap is empty (every watched stock is in a unique sector,
// or no sectors are tagged), falls back to any-sector top picks so the
// component is still useful instead of going dark.
//
// Tapping a row navigates to /stock/<symbol> and awards 1 discovery
// point (config-driven cap 3/day enforced upstream).
//
// Returns null entirely (no empty card) when:
//   - no userId
//   - no watchlist rows
//   - latest swing_conditions date is older than today AND today is a
//     trading day (pipeline hasn't run yet) — we don't surface stale
//     data on a fresh trading day. On weekends / holidays we DO show
//     last-trading-day data with an "as of" label so the component
//     stays useful while markets are closed.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { awardPoints } from '../lib/pointsAwarder'
import { C } from '../styles/tokens'

const MAX_RESULTS = 3
const POOL_SIZE   = 6  // server-side LIMIT before client-side pick

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Returns true when the given YYYY-MM-DD is a weekend (Sat/Sun). NSE
// holidays beyond weekends are inferred from the freshness gap below
// (pipeline didn't run = treat as holiday).
function isWeekendIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

export default function WhatToLookAt({ userId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows]       = useState([])
  const [tradingDate, setTradingDate] = useState(null)

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
        // 1. User's watchlist symbols + the sectors of those companies
        // in a single round-trip via the watchlist→companies inner join.
        const { data: wlData } = await supabase
          .from('watchlist')
          .select('symbol,companies(symbol,sector)')
          .eq('user_id', userId)
        const watchlistSymbols = new Set()
        const sectorSet = new Set()
        for (const r of wlData || []) {
          const sym = (r?.symbol || r?.companies?.symbol || '').toUpperCase()
          const sec = (r?.companies?.sector || '').trim()
          if (sym) watchlistSymbols.add(sym)
          if (sec) sectorSet.add(sec)
        }
        if (watchlistSymbols.size === 0) {
          if (!cancelled) { setRows([]); setLoading(false) }
          return
        }

        // 2. Latest swing_conditions date. One round-trip.
        const { data: latestRow } = await supabase
          .from('swing_conditions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        const latestDate = latestRow?.date || null
        if (!latestDate) {
          if (!cancelled) { setRows([]); setLoading(false) }
          return
        }
        // Freshness gate: if today is a TRADING day and the pipeline
        // hasn't written for today, skip rather than show stale data.
        // On weekends / holidays we keep showing last-trading-day data.
        const t = todayIso()
        if (latestDate < t && !isWeekendIso(t)) {
          // Pipeline late on a trading day — don't surface stale picks.
          if (!cancelled) { setRows([]); setLoading(false); setTradingDate(latestDate) }
          return
        }

        // 3. Top-N candidates with conditions_met >= 4 for latestDate,
        // filtered to the user's sectors (when known) and excluding any
        // symbol already on the watchlist. The sector filter only kicks
        // in when sectorSet is non-empty; otherwise we fall through to
        // the any-sector fallback per the spec.
        let candidates = []
        const baseSelect = supabase
          .from('swing_conditions')
          .select('conditions_met,criteria_change_reason,companies!inner(symbol,name,sector)')
          .eq('date', latestDate)
          .gte('conditions_met', 4)
          .order('conditions_met', { ascending: false })
          .limit(POOL_SIZE)
        if (sectorSet.size > 0) {
          const { data } = await baseSelect.in('companies.sector', Array.from(sectorSet))
          candidates = data || []
          // Edge case: empty sector overlap or sector tags missing →
          // any-sector fallback so the card still has something to
          // show.
          if (candidates.length === 0) {
            const { data: fb } = await supabase
              .from('swing_conditions')
              .select('conditions_met,criteria_change_reason,companies!inner(symbol,name,sector)')
              .eq('date', latestDate)
              .gte('conditions_met', 4)
              .order('conditions_met', { ascending: false })
              .limit(POOL_SIZE)
            candidates = fb || []
          }
        } else {
          const { data } = await baseSelect
          candidates = data || []
        }

        const picked = []
        for (const c of candidates) {
          const sym = (c?.companies?.symbol || '').toUpperCase()
          if (!sym || watchlistSymbols.has(sym)) continue
          picked.push({
            symbol: sym,
            name:   c.companies?.name   || sym,
            sector: c.companies?.sector || '',
            score:  Number(c.conditions_met) || 0,
            reason: c.criteria_change_reason || '',
          })
          if (picked.length >= MAX_RESULTS) break
        }
        if (cancelled) return
        setRows(picked)
        setTradingDate(latestDate)
        setLoading(false)
      } catch {
        if (!cancelled) { setRows([]); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  // Skeleton: brief 400 ms shimmer so the layout doesn't snap. Hidden
  // entirely once the fetch resolves OR if there are no rows to show.
  if (loading) {
    return (
      <div
        aria-hidden
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          height: 132,
          opacity: 0.6,
          animation: 'pulse 1.5s infinite',
        }}
      />
    )
  }
  if (!rows.length) return null

  // "As of <date>" label only when we're showing previous-trading-day
  // data (weekend / holiday). On a fresh trading-day pipeline we trust
  // the freshness without needing to surface the timestamp.
  const isHistorical = tradingDate && tradingDate !== todayIso()

  function handleTap(symbol) {
    if (!userId) return
    // Discovery tap — 1 pt, capped at 3/day in points_config. Fire-
    // and-forget; the navigation runs via the <Link> wrapping the row.
    awardPoints(userId, 'discovery_tap', {
      fallbackPoints: 1,
      notes: `Discovery: ${symbol}`,
      referenceId: null,
    }).catch(() => {})
  }

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: C.textMuted,
          }}
        >
          In your sectors today
        </span>
        {isHistorical && (
          <span style={{ fontSize: 10, color: C.textFaint }}>
            As of {tradingDate}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          color: C.textFaint,
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        Stocks with strong criteria in sectors you follow
      </div>

      {/* Rows */}
      {rows.map((r, i) => {
        const isLast = i === rows.length - 1
        const scoreColour = r.score >= 5 ? C.green : C.amber
        return (
          <Link
            key={r.symbol}
            to={`/stock/${r.symbol}`}
            onClick={() => handleTap(r.symbol)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
              textDecoration: 'none',
              color: 'inherit',
              gap: 12,
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
                {r.sector || '—'}
              </div>
              {r.reason && (
                <div
                  style={{
                    fontSize: 10,
                    color: C.amber,
                    marginTop: 2,
                  }}
                >
                  ↑ Changed today: {r.reason}
                </div>
              )}
            </div>
            <span
              style={{
                background: C.surface2,
                border: `1px solid ${C.border}`,
                color: scoreColour,
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 6,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {r.score}/5
            </span>
          </Link>
        )
      })}

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
