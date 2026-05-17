import { useEffect, useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import Skeleton from '../../components/ui/Skeleton'
import { logAdminAction } from '../../lib/adminLog'
import { buildCompanyPatch, formatSupabaseError, normalizeCompanyDescription } from '../../lib/companyPatch'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

const MUTED = '#94a3b8'

async function postGenerate(symbol) {
  const root = (import.meta.env.VITE_NETLIFY_FUNCTIONS_URL || '/.netlify/functions').replace(/\/$/, '')
  try {
    const res = await fetch(`${root}/admin-generate-ai-description`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    })
    if (res.ok) return { ok: true }
  } catch {
    /* fall through */
  }

  const question = `Rewrite company description in plain English (max 80 words) for symbol ${symbol}. No advice.`
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context: '', symbol }),
  })
  return { ok: res.ok }
}

export default function AdminDescriptions() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('pending')
  const [drafts, setDrafts] = useState({})
  const [editingId, setEditingId] = useState(null)
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
          .not('description', 'is', null)
          .neq('description', '')
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

  const pendingList = useMemo(
    () =>
      rows.filter(
        (r) => String(r.description || '').trim() && r.description_approved === false,
      ),
    [rows],
  )

  const visibleRows = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'approved') return rows.filter((r) => r.description_approved === true)
    return pendingList
  }, [rows, filter, pendingList])

  function setBusy(id, value) {
    setBusyById((prev) => ({ ...prev, [id]: value }))
  }

  async function approve(row, overrideText) {
    const nextText = (overrideText !== undefined ? overrideText : drafts[row.id] ?? row.description ?? '').trim()
    if (!nextText) {
      setMessage('Description cannot be empty.')
      return
    }
    setBusy(row.id, true)
    const payload = buildCompanyPatch(row, {
      description: normalizeCompanyDescription(nextText),
      description_approved: true,
    })
    const { error } = await supabase.from('companies').update(payload).eq('id', row.id)
    setBusy(row.id, false)
    if (error) {
      setMessage(`Could not approve ${row.symbol}: ${formatSupabaseError(error)}`)
      return
    }
    try {
      await logAdminAction({
        action: 'description_approve',
        target_type: 'company',
        target_id: row.id,
        old_value: row.description_approved,
        new_value: true,
        notes: row.symbol,
      })
    } catch {
      /* optional */
    }
    setEditingId(null)
    setMessage(`${overrideText !== undefined ? 'Saved & approved' : 'Approved'} ${row.symbol}.`)
    setReloadTick((x) => x + 1)
  }

  async function regenerate(row) {
    setBusy(row.id, true)
    setMessage('')
    try {
      const { ok } = await postGenerate(row.symbol)
      if (!ok) {
        setMessage(`Regenerate request failed for ${row.symbol}.`)
        return
      }
      setMessage(`Regenerate queued for ${row.symbol}. Refreshing…`)
      setTimeout(() => setReloadTick((x) => x + 1), 5000)
    } catch {
      setMessage(`Regenerate failed for ${row.symbol}.`)
    } finally {
      setBusy(row.id, false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Descriptions</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: C.border, background: C.surface2, color: C.text }}
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
        </select>
      </div>

      <p className="text-sm" style={{ color: MUTED }}>
        <span className="font-semibold text-slate-200">{pendingList.length}</span> descriptions pending review
      </p>

      {message ? (
        <p className="text-sm" style={{ color: MUTED }}>
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      ) : (
        <div className="space-y-4">
          {visibleRows.length ? (
            visibleRows.map((row) => {
              const isBusy = Boolean(busyById[row.id])
              const isEditing = editingId === row.id
              return (
                <Card key={row.id}>
                  <SectionLabel text={`${row.name} (${row.symbol}) • ${row.sector || '—'}`} />
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{row.description}</p>

                  {!isEditing ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => approve(row)}
                        className="rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: C.border, color: C.green }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setEditingId(row.id)}
                        className="rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: C.border, color: C.blue }}
                      >
                        Edit &amp; Approve
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => regenerate(row)}
                        className="rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: C.border, color: C.amber }}
                      >
                        Regenerate
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-2">
                      <textarea
                        value={drafts[row.id] || ''}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [row.id]: e.target.value,
                          }))
                        }
                        rows={6}
                        className="w-full rounded-lg border p-3 text-sm"
                        style={{ borderColor: C.border, background: C.surface2, color: C.text }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => approve(row, drafts[row.id])}
                          className="rounded-lg border px-3 py-2 text-sm"
                          style={{ borderColor: C.border, color: C.green }}
                        >
                          Save &amp; Approve
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border px-3 py-2 text-sm"
                          style={{ borderColor: C.border, color: C.textMuted }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              )
            })
          ) : (
            <Card>
              <p className="text-sm" style={{ color: C.textMuted }}>
                No companies for this filter.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
