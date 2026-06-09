import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from './ui/Card'
import SectionLabel from './ui/SectionLabel'
import { C } from '../styles/tokens'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import StagePill from './StagePill'
import ProBadge from './ProBadge'

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Tie-break sort: Stage 1 → Emerging → Stage 2–4 → unknown last. */
function stageNum(stage) {
  const s = String(stage || '')
  if (/stage\s*1\+/i.test(s)) return 1.5
  const m = s.match(/stage\s*([1-4])/i)
  return m ? Number(m[1]) : 9
}

export default function DailyScanner({ loggedIn = false, isPaid = false }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true
    ;(async () => {
      const today = todayKey()
      const swingRes = await supabase
        .from('swing_conditions')
        .select('company_id,conditions_met,breakout_52w,stage2_new_this_week,date')
        .eq('date', today)
        .gte('conditions_met', 3)
        .limit(500)

      const swingRows = swingRes.data || []
      const companyIds = [...new Set(swingRows.map((r) => r.company_id).filter(Boolean))]
      if (!companyIds.length) {
        if (active) setRows([])
        return
      }

      const [companiesRes, priceDateRes] = await Promise.all([
        supabase.from('companies').select('id,symbol,name').in('id', companyIds),
        supabase.from('price_data').select('date').order('date', { ascending: false }).limit(1),
      ])
      const latestPriceDate = priceDateRes.data?.[0]?.date
      const priceRes = latestPriceDate
        ? await supabase
            .from('price_data')
            .select('company_id,stage')
            .eq('date', latestPriceDate)
            .in('company_id', companyIds)
        : { data: [] }

      const companyById = Object.fromEntries((companiesRes.data || []).map((c) => [c.id, c]))
      const stageByCompanyId = Object.fromEntries((priceRes.data || []).map((p) => [p.company_id, p.stage]))

      const mapped = swingRows
        .map((r) => ({
          symbol: companyById[r.company_id]?.symbol || '',
          name: companyById[r.company_id]?.name || companyById[r.company_id]?.symbol || 'Unknown',
          stage: stageByCompanyId[r.company_id] || null,
          conditions_met: Number(r.conditions_met) || 0,
          breakout_52w: Boolean(r.breakout_52w),
          stage2_new: Boolean(r.stage2_new_this_week),
        }))
        .filter((r) => r.symbol)
        .sort((a, b) => {
          if (b.conditions_met !== a.conditions_met) return b.conditions_met - a.conditions_met
          return stageNum(a.stage) - stageNum(b.stage)
        })

      if (!active) return
      setRows(mapped)
    })()

    return () => {
      active = false
    }
  }, [])

  const visibleCount = useMemo(() => {
    if (isPaid) return rows.length
    if (!loggedIn) return 3
    return 10
  }, [rows.length, loggedIn, isPaid])

  const hasLocked = rows.length > visibleCount
  const dateText = new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <Card>
      <SectionLabel text={<span style={{ display: 'inline-flex', alignItems: 'center' }}>SwingX Criteria Results<ProBadge /></span>} action={<span>{dateText} — Updated after market close</span>} />

      <div className="space-y-2">
        {rows.length ? rows.map((row, idx) => {
          const locked = idx >= visibleCount
          const barColor = row.conditions_met >= 4 ? C.green : row.conditions_met >= 3 ? C.amber : C.red
          return (
            <button
              key={`${row.symbol}-${idx}`}
              type="button"
              onClick={() => !locked && navigate(`/stock/${row.symbol}`)}
              className={`relative w-full rounded-lg border p-2 text-left ${locked ? 'cursor-not-allowed' : ''}`}
              style={{ borderColor: C.border, background: C.surface2 }}
            >
              <div className={`${locked ? 'blur-[2px]' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-5 text-xs font-semibold" style={{ color: C.textMuted }}>{idx + 1}</span>
                  <span className="text-sm font-semibold" style={{ color: C.text }}>{row.name}</span>
                  <span className="text-xs" style={{ color: C.textMuted }}>({row.symbol})</span>
                  <StagePill stage={row.stage} />
                  <span className="text-xs" style={{ color: C.textMuted }}>
                    {row.breakout_52w ? '🚀' : ''} {row.stage2_new ? '⭐' : ''}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="whitespace-nowrap text-xs" style={{ color: C.textMuted }}>{row.conditions_met}/5 criteria</span>
                  <div className="h-1.5 flex-1 rounded-full" style={{ background: C.border }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, (row.conditions_met / 5) * 100)}%`, background: barColor }}
                    />
                  </div>
                </div>
              </div>
              {locked ? <span className="absolute right-2 top-2 text-sm">🔒</span> : null}
            </button>
          )
        }) : (
          <p className="text-sm" style={{ color: C.textMuted }}>No criteria matches for today yet.</p>
        )}
      </div>

      {hasLocked ? (
        <p className="mt-3 text-sm" style={{ color: C.textMuted }}>
          {!loggedIn ? 'Sign up free to see all matches' : 'Upgrade to see full list'}
        </p>
      ) : null}

      <p className="mt-3 text-xs italic" style={{ color: C.textMuted }}>
        Cycle criteria are technical observations only.
        <br />
        This is not a trade recommendation.
      </p>
    </Card>
  )
}
