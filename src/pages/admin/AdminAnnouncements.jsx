import { useEffect, useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { useAuth } from '../../context'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

function fmtDate(ts) {
  const d = new Date(ts || 0)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString()
}

function truncate(text, max = 220) {
  const t = String(text || '')
  if (t.length <= max) return t
  return `${t.slice(0, max)}...`
}

const RESOLUTIONS = [
  { label: '✅ Delivered', value: 'delivered', color: '#22C55E' },
  { label: '⚠️ Partial', value: 'partial', color: '#F59E0B' },
  { label: '❌ Missed', value: 'missed', color: '#EF4444' },
  { label: '⏭ Skip', value: 'skip', color: '#64748B' },
]

export default function AdminAnnouncements() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [expanded, setExpanded] = useState({})
  const [noteById, setNoteById] = useState({})
  const [busyById, setBusyById] = useState({})
  const [message, setMessage] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true
    ;(async () => {
      setLoading(true)
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
      const iso = sixMonthsAgo.toISOString()
      try {
        const { data } = await supabase
          .from('announcements')
          .select('*')
          .is('delivered', null)
          .gt('announced_at', iso)
          .order('announced_at', { ascending: true })
          .limit(5000)
        if (!active) return

        const companyIds = [...new Set((data || []).map((r) => r.company_id).filter(Boolean))]
        let companyById = {}
        if (companyIds.length) {
          const c = await supabase
            .from('companies')
            .select('id,name,symbol')
            .in('id', companyIds)
          companyById = Object.fromEntries((c.data || []).map((x) => [x.id, x]))
        }
        const merged = (data || []).map((r) => ({
          ...r,
          company_name: companyById[r.company_id]?.name || r.company_name || 'Unknown company',
          symbol: companyById[r.company_id]?.symbol || r.symbol || '-',
        }))
        setRows(merged)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [reloadTick])

  const pendingCount = rows.length

  async function triggerCredibilityRecompute(companyId) {
    if (!companyId) return
    try {
      const { error } = await supabase.rpc('recompute_credibility_score', { company_id: companyId })
      if (!error) return
    } catch {
      // ignore and fallback
    }

    try {
      await supabase.from('usage_events').insert({
        event_type: 'credibility_recompute_requested',
        metadata: { company_id: companyId, source: 'admin_announcements' },
        created_at: new Date().toISOString(),
      })
    } catch {
      // no-op
    }
  }

  async function resolveRow(row, deliveredValue) {
    const id = row.id
    setBusyById((p) => ({ ...p, [id]: true }))
    setMessage('')
    const adminId = user?.id || null
    const payload = {
      delivered: deliveredValue,
      admin_note: noteById[id]?.trim() || null,
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('announcements').update(payload).eq('id', id)
    if (error) {
      setMessage(`Could not resolve announcement ${id}.`)
      setBusyById((p) => ({ ...p, [id]: false }))
      return
    }

    await triggerCredibilityRecompute(row.company_id)
    setBusyById((p) => ({ ...p, [id]: false }))
    setMessage(`Marked ${row.symbol} announcement as ${deliveredValue}.`)
    setReloadTick((x) => x + 1)
  }

  const cards = useMemo(() => rows, [rows])

  return (
    <div className="space-y-5">
        <h2 className="text-xl font-semibold" style={{ color: C.text }}>
          Announcement Resolver
        </h2>
        <Card>
          <p className="text-sm" style={{ color: C.text }}>
            {pendingCount} announcements pending resolution
          </p>
          {message ? (
            <p className="mt-1 text-sm" style={{ color: C.textMuted }}>{message}</p>
          ) : null}
        </Card>

        {loading ? (
          <div className="space-y-3">
            <Skeleton height={180} />
            <Skeleton height={180} />
          </div>
        ) : cards.length ? (
          <div className="space-y-3">
            {cards.map((row) => {
              const isExpanded = Boolean(expanded[row.id])
              const isBusy = Boolean(busyById[row.id])
              const bodyText = String(row.body || row.announcement_body || '')
              return (
                <Card key={row.id}>
                  <SectionLabel text={`${row.company_name} (${row.symbol})`} />
                  <p className="text-sm font-medium" style={{ color: C.text }}>
                    {row.title || row.headline || 'Announcement'}
                  </p>
                  <p className="text-xs" style={{ color: C.textMuted }}>
                    {fmtDate(row.announced_at)}
                  </p>

                  <button
                    type="button"
                    onClick={() => setExpanded((p) => ({ ...p, [row.id]: !p[row.id] }))}
                    className="mt-2 text-left text-sm leading-6"
                    style={{ color: C.textMuted }}
                  >
                    {isExpanded ? bodyText : truncate(bodyText)}
                  </button>

                  <p className="mt-2 text-sm" style={{ color: C.amber }}>
                    Claude verdict: {row.claude_verdict || 'Not available'}
                  </p>

                  <input
                    value={noteById[row.id] || ''}
                    onChange={(e) => setNoteById((p) => ({ ...p, [row.id]: e.target.value }))}
                    placeholder="Optional admin note..."
                    className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: C.border, background: C.surface2, color: C.text }}
                  />

                  <div className="mt-3 flex flex-wrap gap-2">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        disabled={isBusy}
                        onClick={() => resolveRow(row, r.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: C.border, color: r.color, opacity: isBusy ? 0.7 : 1 }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card>
            <p className="text-sm" style={{ color: C.textMuted }}>
              No pending announcements match this resolver queue.
            </p>
          </Card>
        )}
    </div>
  )
}
