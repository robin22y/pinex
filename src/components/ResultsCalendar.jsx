import { useEffect, useMemo, useState } from 'react'
import { C } from '../styles/tokens'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function sameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function startOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfWeek(date) {
  const d = startOfWeek(date)
  d.setDate(d.getDate() + 6)
  d.setHours(23, 59, 59, 999)
  return d
}

function fmtDate(date) {
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function categoryFor(date, now) {
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  if (date >= weekStart && date <= weekEnd) return 'this week'
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return 'this month'
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  if (date.getMonth() === nextMonth.getMonth() && date.getFullYear() === nextMonth.getFullYear()) return 'next month'
  return 'later'
}

export default function ResultsCalendar({ watchlistCompanyIds = [] }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!hasSupabaseEnv || !watchlistCompanyIds?.length) {
      return
    }
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const ids = [...new Set(watchlistCompanyIds.filter(Boolean))]
        const [companiesRes, finRes] = await Promise.all([
          supabase.from('companies').select('id,name,symbol').in('id', ids),
          supabase
            .from('financials')
            .select('company_id,filed_at,quarter_name,updated_at')
            .in('company_id', ids)
            .order('filed_at', { ascending: false })
            .limit(5000),
        ])

        const companyById = Object.fromEntries((companiesRes.data || []).map((c) => [c.id, c]))
        const latestByCompany = {}
        for (const row of finRes.data || []) {
          const cid = row?.company_id
          if (!cid || latestByCompany[cid]) continue
          latestByCompany[cid] = row
        }

        const built = ids
          .map((cid) => {
            const c = companyById[cid]
            const f = latestByCompany[cid]
            if (!c || !f) return null
            const baseRaw = f.filed_at || f.updated_at
            const baseDate = baseRaw ? new Date(baseRaw) : null
            if (!baseDate || Number.isNaN(baseDate.getTime())) return null
            const next = addDays(baseDate, 90)
            return {
              company_id: cid,
              name: c.name || c.symbol || 'Company',
              symbol: c.symbol || '',
              date: next,
            }
          })
          .filter(Boolean)
          .sort((a, b) => a.date - b.date)

        if (!active) return
        setRows(built)
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [watchlistCompanyIds])

  const grouped = useMemo(() => {
    const now = new Date()
    const out = { 'this week': [], 'this month': [], 'next month': [], later: [] }
    for (const row of rows) {
      out[categoryFor(row.date, now)].push(row)
    }
    return out
  }, [rows])

  if (!watchlistCompanyIds?.length) {
    return (
      <div>
        <p className="text-sm" style={{ color: C.textMuted }}>No watchlist companies selected.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm" style={{ color: C.textMuted }}>Loading estimated dates...</p>
      ) : null}

      {['this week', 'this month', 'next month'].map((bucket) => (
        <div key={bucket}>
          <p className="mb-1 text-xs uppercase tracking-wider" style={{ color: C.textMuted }}>
            {bucket}
          </p>
          <div className="space-y-1">
            {grouped[bucket].length ? (
              grouped[bucket].map((row) => {
                const isToday = sameDate(row.date, new Date())
                return (
                  <div
                    key={`${row.company_id}-${row.date.toISOString()}`}
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{
                      borderColor: isToday ? C.blue : C.border,
                      background: isToday ? C.blueBg : C.surface,
                      color: C.text,
                    }}
                  >
                    <span style={{ color: C.textMuted }}>{fmtDate(row.date)}</span>
                    {'  →  '}
                    <span className="font-medium">{row.name}</span>
                    {'  →  '}
                    <span style={{ color: isToday ? C.blue : C.textMuted }}>
                      {isToday ? 'Results day' : 'Results expected'}
                    </span>
                  </div>
                )
              })
            ) : (
              <p className="text-sm" style={{ color: C.textMuted }}>No companies in this bucket.</p>
            )}
          </div>
        </div>
      ))}

      <p className="pt-1 text-xs" style={{ color: C.textMuted }}>
        Estimated dates based on filing patterns.
        <br />
        Actual dates may vary.
      </p>
    </div>
  )
}
