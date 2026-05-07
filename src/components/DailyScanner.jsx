import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Badge from './ui/Badge'
import Card from './ui/Card'
import SectionLabel from './ui/SectionLabel'
import { C } from '../styles/tokens'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function stageStatus(stage) {
  const v = String(stage || '').toLowerCase().replace(/\s+/g, '')
  if (v === 'stage2') return 'green'
  if (v === 'stage1') return 'amber'
  if (v === 'stage3' || v === 'stage4') return 'red'
  return 'neutral'
}

function stageNum(stage) {
  const m = String(stage || '').match(/stage\s*([1-4])/i)
  return m ? Number(m[1]) : 9
}

function stageLabel(stage) {
  return String(stage || '').toUpperCase() || 'N/A'
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
        .select('symbol,conditions_met,breakout_52w,stage2_new_this_week,trading_date')
        .eq('trading_date', today)
        .gte('conditions_met', 3)
        .limit(500)

      const swingRows = swingRes.data || []
      const symbols = [...new Set(swingRows.map((r) => r.symbol).filter(Boolean))]
      if (!symbols.length) {
        if (active) setRows([])
        return
      }

      const [companiesRes, priceDateRes] = await Promise.all([
        supabase.from('companies').select('symbol,name').in('symbol', symbols),
        supabase.from('price_data').select('trading_date').order('trading_date', { ascending: false }).limit(1),
      ])
      const latestPriceDate = priceDateRes.data?.[0]?.trading_date
      const priceRes = latestPriceDate
        ? await supabase
            .from('price_data')
            .select('symbol,stage')
            .eq('trading_date', latestPriceDate)
            .in('symbol', symbols)
        : { data: [] }

      const nameBySymbol = Object.fromEntries((companiesRes.data || []).map((c) => [c.symbol, c.name]))
      const stageBySymbol = Object.fromEntries((priceRes.data || []).map((p) => [p.symbol, p.stage]))

      const mapped = swingRows
        .map((r) => ({
          symbol: r.symbol,
          name: nameBySymbol[r.symbol] || r.symbol,
          stage: stageBySymbol[r.symbol] || null,
          conditions_met: Number(r.conditions_met) || 0,
          breakout_52w: Boolean(r.breakout_52w),
          stage2_new: Boolean(r.stage2_new_this_week),
        }))
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
      <SectionLabel text="Today's Swing Setups" action={<span>{dateText} — Updated after market close</span>} />

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
                  <Badge status={stageStatus(row.stage)} text={stageLabel(row.stage)} size="sm" />
                  <span className="text-xs" style={{ color: C.textMuted }}>
                    {row.breakout_52w ? '🚀' : ''} {row.stage2_new ? '⭐' : ''}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="w-12 text-xs" style={{ color: C.textMuted }}>{row.conditions_met}/5</span>
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
          <p className="text-sm" style={{ color: C.textMuted }}>No setups available for today yet.</p>
        )}
      </div>

      {hasLocked ? (
        <p className="mt-3 text-sm" style={{ color: C.textMuted }}>
          {!loggedIn ? 'Sign up free to see all setups' : 'Upgrade to see full list'}
        </p>
      ) : null}

      <p className="mt-3 text-xs italic" style={{ color: C.textMuted }}>
        Swing conditions are technical observations only.
        <br />
        This is not a trade recommendation.
      </p>
    </Card>
  )
}
