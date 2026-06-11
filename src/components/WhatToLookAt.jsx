// WhatToLookAt — sector-curated discovery card.
//
// "PineX knows what I care about and found something for me today."
// Surfaces up to 3 stocks with high SwingX criteria (conditions_met
// >= 4) in sectors the user is already following, excluding anything
// already on the watchlist. Universe fallback when there's no sector
// overlap so the card NEVER goes empty for a logged-in user.
//
// Visual + animation per the poll-driven home redesign: amber
// gradient surface, soft glow corner, header count badge, framer-
// motion entry, per-row stagger, sector pill on each row, "NEW ✨"
// badge for stocks that turned Stage 2 this week.
//
// SEBI-safe by construction — header "🔭 In your sectors today",
// subtext "Stocks with strong criteria in sectors you already
// follow", footer disclaimer "Criteria data only · Not investment
// advice". No buy/sell, no targets, no price.
//
// Self-fetching by design — same rationale as YouWereRight: the
// queries below aren't reused elsewhere on Home, so threading them
// in from Home.jsx would add complexity for no win.
//
// Points side-effect (config-driven, cap 3/day): each row tap fires
// awardPoints('discovery_tap', 1pt). The cap is enforced upstream.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { awardPoints } from '../lib/pointsAwarder'
import { C } from '../styles/tokens'

const MAX_RESULTS = 3
const POOL_SIZE = 8  // server-side limit before client-side dedupe

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function isWeekendIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

export default function WhatToLookAt({ userId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [tradingDate, setTradingDate] = useState(null)
  // True when we fell back to the universe-wide top picks (no sector
  // match found). Drives the subtext + footer copy.
  const [universeMode, setUniverseMode] = useState(false)

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
        // Watchlist symbols + their sectors.
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
        // No watchlist → no personalised discovery. Spec keeps this
        // card "personally curated" rather than turning it into a
        // generic top-N (which the search page already covers).
        if (watchlistSymbols.size === 0) {
          if (!cancelled) { setRows([]); setLoading(false) }
          return
        }

        // Latest swing date — single round-trip discovery, then
        // freshness gate identical to YouWereRight.
        const { data: latest } = await supabase
          .from('swing_conditions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        const latestDate = latest?.date || null
        if (!latestDate) {
          if (!cancelled) { setRows([]); setLoading(false) }
          return
        }
        const t = todayIso()
        if (latestDate < t && !isWeekendIso(t)) {
          if (!cancelled) { setRows([]); setLoading(false); setTradingDate(latestDate) }
          return
        }

        // Sector-curated pool: conditions_met >= 4 in the user's
        // sectors, ordered desc. stage2_new_this_week powers the
        // "NEW ✨" badge.
        const baseSel = supabase
          .from('swing_conditions')
          .select('conditions_met,criteria_change_reason,stage2_new_this_week,companies!inner(symbol,name,sector)')
          .eq('date', latestDate)
          .gte('conditions_met', 4)
          .order('conditions_met', { ascending: false })
          .limit(POOL_SIZE)

        let pool = []
        let usedFallback = false
        if (sectorSet.size > 0) {
          const { data } = await baseSel.in('companies.sector', Array.from(sectorSet))
          pool = data || []
        }
        if (pool.length === 0) {
          // Sector fallback per spec — top criteria across the
          // whole universe. Card subtext flips to a universe-mode
          // copy.
          const { data: fb } = await supabase
            .from('swing_conditions')
            .select('conditions_met,criteria_change_reason,stage2_new_this_week,companies!inner(symbol,name,sector)')
            .eq('date', latestDate)
            .gte('conditions_met', 4)
            .order('conditions_met', { ascending: false })
            .limit(POOL_SIZE)
          pool = fb || []
          usedFallback = true
        }

        const picks = []
        for (const r of pool) {
          const sym = (r?.companies?.symbol || '').toUpperCase()
          if (!sym || watchlistSymbols.has(sym)) continue
          picks.push({
            symbol: sym,
            name:   r.companies?.name   || sym,
            sector: r.companies?.sector || '',
            score:  Number(r.conditions_met) || 0,
            isNew:  !!r.stage2_new_this_week,
            reason: r.criteria_change_reason || '',
          })
          if (picks.length >= MAX_RESULTS) break
        }
        if (cancelled) return
        setRows(picks)
        setTradingDate(latestDate)
        setUniverseMode(usedFallback)
        setLoading(false)
      } catch {
        if (!cancelled) { setRows([]); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  // No skeleton — show or hide. A shimmer on quiet days would feel
  // like a phantom card.
  if (loading) return null
  if (!rows.length) return null

  const isHistorical = tradingDate && tradingDate !== todayIso()

  function handleTap(symbol) {
    if (!userId) return
    awardPoints(userId, 'discovery_tap', {
      fallbackPoints: 1,
      notes: `Discovery: ${symbol}`,
      referenceId: null,
    }).catch(() => {})
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // Slight delay so this lands AFTER YouWereRight's entry — the
      // two cards then read as a sequenced reveal rather than a
      // simultaneous flash.
      transition={{ duration: 0.3, delay: 0.15 }}
      style={{
        background:
          'linear-gradient(135deg, rgba(251,191,36,0.07) 0%, rgba(251,191,36,0.02) 100%)',
        border: '1px solid rgba(251,191,36,0.2)',
        borderRadius: 16,
        padding: '16px 18px',
        marginBottom: 16,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Soft amber glow corner */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -20,
          right: -20,
          width: 80,
          height: 80,
          background:
            'radial-gradient(circle, rgba(251,191,36,0.12), transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
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
          <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>🔭</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: C.amber,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            In your sectors today
          </span>
        </div>
        <span
          style={{
            background: 'rgba(251,191,36,0.15)',
            border: '1px solid rgba(251,191,36,0.3)',
            color: C.amber,
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 10,
            whiteSpace: 'nowrap',
          }}
        >
          {rows.length} stocks
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
        {universeMode
          ? 'Top criteria stocks today'
          : 'Stocks with strong criteria in sectors you already follow'}
        {isHistorical ? ` · as of ${tradingDate}` : ''}
      </div>

      {/* Stock rows */}
      {rows.map((r, i) => (
        <motion.div
          key={r.symbol}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 * i }}
          style={{ marginBottom: 6 }}
        >
          <Link
            to={`/stock/${r.symbol}`}
            onClick={() => handleTap(r.symbol)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 12px',
              background: 'rgba(251,191,36,0.04)',
              borderRadius: 10,
              border: '1px solid rgba(251,191,36,0.1)',
              textDecoration: 'none',
              color: 'inherit',
              gap: 10,
              minHeight: 48,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '60vw',
                  }}
                >
                  {r.name}
                </span>
                {r.isNew && (
                  <span
                    style={{
                      background: 'rgba(251,191,36,0.2)',
                      color: C.amber,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      padding: '1px 5px',
                      borderRadius: 4,
                    }}
                  >
                    NEW ✨
                  </span>
                )}
              </div>
              {r.sector && (
                <span
                  style={{
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    fontSize: 10,
                    color: C.textMuted,
                    padding: '1px 6px',
                    borderRadius: 4,
                    display: 'inline-block',
                    marginTop: 4,
                    whiteSpace: 'nowrap',
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={r.sector}
                >
                  {r.sector}
                </span>
              )}
            </div>
            {/* Score pill — green for 5/5, amber for 4/5; label
                below stays neutral. */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div
                style={{
                  display: 'inline-block',
                  background: r.score >= 5 ? 'rgba(0,200,5,0.15)' : 'rgba(251,191,36,0.15)',
                  border: `1px solid ${r.score >= 5 ? 'rgba(0,200,5,0.4)' : 'rgba(251,191,36,0.4)'}`,
                  color: r.score >= 5 ? C.green : C.amber,
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                {r.score}/5
              </div>
              <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>
                criteria
              </div>
            </div>
          </Link>
        </motion.div>
      ))}

      {/* Footer row — left attribution, right SEBI disclaimer */}
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
        <span>
          {universeMode ? 'No sector match · showing top criteria stocks' : 'Based on your watchlist sectors'}
        </span>
        <span>Criteria data only · Not investment advice</span>
      </div>
    </motion.div>
  )
}
