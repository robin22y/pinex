// useGuruScore — self-contained hook that fetches watchlist +
// company + price history independently, then computes the full
// Guru Score (with gain components) for the home page widget.
//
// ⚠ Real schema, not the spec's stale view:
//   watchlists       plural, keyed by company_id (not symbol)
//   price_data       columns are company_id + date (not symbol +
//                    trading_date). We join through companies to
//                    back-map company_id → symbol for the scorer.

import { useEffect, useState } from 'react'
import { computeGuruScore } from '../lib/guruScore'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

export function useGuruScore(userId) {
  const [scoreResult, setScoreResult] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!userId || !hasSupabaseEnv) return
    let active = true

    async function load() {
      setLoading(true)
      try {
        const { data: watchRows } = await supabase
          .from('watchlists')
          .select('company_id,added_at')
          .eq('user_id', userId)
          .order('added_at', { ascending: false })
          .limit(50)

        if (!watchRows || watchRows.length === 0) {
          if (active) setScoreResult(null)
          return
        }

        const companyIds = [...new Set(watchRows.map((w) => w.company_id).filter(Boolean))]

        const [companiesRes, allPriceRes] = await Promise.all([
          supabase
            .from('companies')
            .select('id,symbol,name,sector')
            .in('id', companyIds),
          supabase
            .from('price_data')
            .select('company_id,date,close,stage')
            .in('company_id', companyIds)
            .order('date', { ascending: true }),
        ])

        const companyById = Object.fromEntries(
          (companiesRes.data || []).map((c) => [c.id, c])
        )

        const priceRowsByCompany = {}
        for (const row of (allPriceRes.data || [])) {
          if (!row?.company_id) continue
          if (!priceRowsByCompany[row.company_id]) priceRowsByCompany[row.company_id] = []
          priceRowsByCompany[row.company_id].push(row)
        }

        const items = watchRows.map((w) => {
          const callDateStr = (w.added_at || '').slice(0, 10)
          const rows = priceRowsByCompany[w.company_id] || []
          const company = companyById[w.company_id] || {}

          // Closest row on or before call date (rows are sorted asc).
          let callRow = null
          for (const row of rows) {
            if (row.date <= callDateStr) callRow = row
            else break
          }
          const currentRow = rows.length > 0 ? rows[rows.length - 1] : null
          const callPrice = callRow ? Number(callRow.close) || null : null
          const currentPrice = currentRow ? Number(currentRow.close) || null : null

          return {
            symbol: company.symbol || '',
            name: company.name || company.symbol || '',
            sector: company.sector || '',
            callDate: callDateStr,
            callPrice,
            callStage: callRow?.stage || null,
            currentPrice,
            currentStage: currentRow?.stage || null,
            gainPct: callPrice && callPrice > 0 && currentPrice
              ? ((currentPrice - callPrice) / callPrice) * 100
              : null,
          }
        })

        if (active) setScoreResult(computeGuruScore(items))
      } catch {
        /* fail silently — home widget hides on null */
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [userId])

  return { scoreResult, loading }
}
