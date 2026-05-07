import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/AdminLayout'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

export default function AdminDescriptions() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('pending')
  const [drafts, setDrafts] = useState({})
  const [busyById, setBusyById] = useState({})
  const [message, setMessage] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const { data } = await supabase
          .from('companies')
          .select('id,name,symbol,description,description_approved,sector,updated_at')
          .order('updated_at', { ascending: false })
          .limit(10000)
        if (!active) return
        const list = (data || []).filter((r) => String(r.description || '').trim())
        setRows(list)
        const nextDrafts = {}
        for (const row of list) {
          nextDrafts[row.id] = row.description || ''
        }
        setDrafts(nextDrafts)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [reloadTick])

  const counts = useMemo(() => {
    const total = rows.length
    const approved = rows.filter((r) => r.description_approved === true).length
    return { total, approved }
  }, [rows])

  const visibleRows = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'approved') return rows.filter((r) => r.description_approved === true)
    return rows.filter((r) => r.description_approved !== true)
  }, [rows, filter])

  function setBusy(id, value) {
    setBusyById((prev) => ({ ...prev, [id]: value }))
  }

  async function approve(row, edited = false) {
    const nextText = (drafts[row.id] || '').trim()
    if (!nextText) {
      setMessage('Description cannot be empty.')
      return
    }
    setBusy(row.id, true)
    const payload = {
      description: nextText,
      description_approved: true,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('companies').update(payload).eq('id', row.id)
    setBusy(row.id, false)
    setMessage(error ? `Could not approve ${row.symbol}.` : `${edited ? 'Edited + approved' : 'Approved'} ${row.symbol}.`)
    if (!error) setReloadTick((x) => x + 1)
  }

  async function regenerate(row) {
    setBusy(row.id, true)
    setMessage('')
    try {
      const question = `Rewrite company description in plain English (max 80 words) for ${row.name} (${row.symbol}). No advice.`
      const context = `Sector: ${row.sector || 'Unknown'}. Existing description: ${row.description || ''}`
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          context,
          symbol: row.symbol,
        }),
      })
      const data = await res.json()
      const nextText = String(data?.answer || '').trim()
      if (!nextText) {
        setMessage(`Regenerate failed for ${row.symbol}.`)
        return
      }
      setDrafts((prev) => ({ ...prev, [row.id]: nextText }))
      setMessage(`Regenerated draft for ${row.symbol}.`)
    } catch {
      setMessage(`Regenerate failed for ${row.symbol}.`)
    } finally {
      setBusy(row.id, false)
    }
  }

  async function skip(row) {
    setBusy(row.id, true)
    const { error } = await supabase
      .from('usage_events')
      .insert({
        event_type: 'admin_description_skipped',
        metadata: { company_id: row.id, symbol: row.symbol },
        created_at: new Date().toISOString(),
      })
    setBusy(row.id, false)
    setMessage(error ? `Could not skip ${row.symbol}.` : `Skipped ${row.symbol} for now.`)
  }

  return (
    <AdminLayout>
      <div className="space-y-5">
        <h2 className="text-xl font-semibold" style={{ color: C.text }}>
          Description Review
        </h2>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" style={{ color: C.text }}>
              {counts.approved} of {counts.total} descriptions approved
            </p>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: C.border, background: C.surface2, color: C.text }}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="all">All</option>
            </select>
          </div>
          {message ? (
            <p className="mt-2 text-sm" style={{ color: C.textMuted }}>{message}</p>
          ) : null}
        </Card>

        {loading ? (
          <div className="space-y-3">
            <Skeleton height={180} />
            <Skeleton height={180} />
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRows.length ? visibleRows.map((row) => {
              const isBusy = Boolean(busyById[row.id])
              return (
                <Card key={row.id}>
                  <SectionLabel text={`${row.name} (${row.symbol})`} />
                  <p className="text-sm leading-6" style={{ color: C.text }}>
                    {row.description}
                  </p>
                  <textarea
                    value={drafts[row.id] || ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    rows={5}
                    className="mt-3 w-full rounded-lg border p-2 text-sm"
                    style={{ borderColor: C.border, background: C.surface2, color: C.text }}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={isBusy} onClick={() => approve(row, false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.green }}>
                      Approve
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => approve(row, true)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.blue }}>
                      Edit &amp; Approve
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => regenerate(row)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.amber }}>
                      Regenerate
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => skip(row)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.textMuted }}>
                      Skip for now
                    </button>
                  </div>
                </Card>
              )
            }) : (
              <Card>
                <p className="text-sm" style={{ color: C.textMuted }}>
                  No descriptions found for this filter.
                </p>
              </Card>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
