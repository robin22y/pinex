// src/lib/guruScore.js

/**
 * Computes the PineX Guru Score from pre-fetched watchlist + price data.
 * No DB calls here — all data passed in.
 *
 * @param {Array} watchItems - Array of enriched watchlist items (see MyCalls.jsx)
 * Each item shape:
 * {
 *   symbol: string,
 *   name: string,
 *   sector: string,
 *   callDate: string (ISO),
 *   callPrice: number | null,
 *   callStage: string | null,
 *   currentPrice: number | null,
 *   currentStage: string | null,
 * }
 * @returns {object} score result
 */
export function computeGuruScore(watchItems) {
  if (!watchItems || watchItems.length === 0) {
    return { score: 0, title: 'Learning the Cycles', emoji: 'fi-rr-seedling', breakdown: null, stats: null }
  }

  const itemsWithPrices = watchItems.filter(
    (w) => w.callPrice && w.callPrice > 0 && w.currentPrice && w.currentPrice > 0
  )

  // --- COMPONENT 1: % of watchlist currently in Stage 2 (30 pts) ---
  const stage2Items = watchItems.filter((w) => {
    const s = String(w.currentStage || '').toLowerCase().replace(/\s+/g, '')
    return s === 'stage2'
  })
  const stage2Pct = watchItems.length > 0 ? stage2Items.length / watchItems.length : 0
  const comp1 = Math.round(stage2Pct * 30)

  // --- COMPONENT 2: Average gain since call date (35 pts) ---
  let avgGain = 0
  if (itemsWithPrices.length > 0) {
    const gains = itemsWithPrices.map((w) => (w.currentPrice - w.callPrice) / w.callPrice)
    avgGain = gains.reduce((a, b) => a + b, 0) / gains.length
  }
  // Map avgGain to 0–35: -10% or worse = 0, +20% or better = 35
  const gainNorm = Math.max(0, Math.min(1, (avgGain + 0.1) / 0.3))
  const comp2 = Math.round(gainNorm * 35)

  // --- COMPONENT 3: Early spotter bonus — called in Stage 1 (20 pts) ---
  const earlySpots = watchItems.filter((w) => {
    const s = String(w.callStage || '').toLowerCase().replace(/\s+/g, '')
    return s === 'stage1'
  })
  const earlyPct = watchItems.length > 0 ? earlySpots.length / watchItems.length : 0
  const comp3 = Math.round(earlyPct * 20)

  // --- COMPONENT 4: Sector diversity (15 pts) ---
  const uniqueSectors = new Set(watchItems.map((w) => w.sector).filter(Boolean))
  const diversityScore = Math.min(uniqueSectors.size, 5) / 5
  const comp4 = Math.round(diversityScore * 15)

  const total = Math.min(100, comp1 + comp2 + comp3 + comp4)

  // Title mapping. `emoji` retained as a field name for back-compat
  // with existing readers but its value is now a Flaticon class
  // suffix (e.g. 'fi-rr-trophy'). Consumers render via:
  //   <i className={`fi ${score.emoji}`} />
  let title, emoji
  if (total >= 85) { title = 'Market Sage';        emoji = 'fi-rr-trophy' }
  else if (total >= 70) { title = 'Cycle Reader';  emoji = 'fi-rr-binoculars' }
  else if (total >= 55) { title = 'Pattern Spotter'; emoji = 'fi-rr-chart-line-up' }
  else if (total >= 40) { title = 'Market Observer'; emoji = 'fi-rr-compass' }
  else { title = 'Learning the Cycles';            emoji = 'fi-rr-seedling' }

  // Stats for display
  const winners = itemsWithPrices.filter((w) => w.currentPrice > w.callPrice)
  const bestCall = itemsWithPrices.length > 0
    ? itemsWithPrices.reduce((best, w) => {
        const g = (w.currentPrice - w.callPrice) / w.callPrice
        const bestG = (best.currentPrice - best.callPrice) / best.callPrice
        return g > bestG ? w : best
      }, itemsWithPrices[0])
    : null
  const bestGainPct = bestCall
    ? ((bestCall.currentPrice - bestCall.callPrice) / bestCall.callPrice) * 100
    : null

  return {
    score: total,
    title,
    emoji,
    breakdown: { comp1, comp2, comp3, comp4 },
    stats: {
      totalCalls: watchItems.length,
      advancingNow: stage2Items.length,
      winners: winners.length,
      avgGainPct: itemsWithPrices.length > 0
        ? (avgGain * 100)
        : null,
      bestCallSymbol: bestCall?.symbol || null,
      bestCallName: bestCall?.name || null,
      bestGainPct,
      earlySpots: earlySpots.length,
    },
  }
}
