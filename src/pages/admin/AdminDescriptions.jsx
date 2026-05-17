import { useEffect, useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import Skeleton from '../../components/ui/Skeleton'
import { logAdminAction } from '../../lib/adminLog'
import { buildCompanyPatch, formatSupabaseError, normalizeCompanyDescription } from '../../lib/companyPatch'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

const MUTED = '#64748B'
const CARD_BG = '#0F1217'
const CARD_BORDER = '#1E2530'
const GREEN = '#00C805'
const BLUE = '#60A5FA'

const FN_ROOT = (import.meta.env.VITE_NETLIFY_FUNCTIONS_URL || '/.netlify/functions').replace(/\/$/, '')

const ENRICHED_SELECT = `
  id, name, symbol, sector,
  description, description_approved,
  updated_at,
  price_data!inner(
    stage, rs_vs_nifty, close
  ),
  shareholding(
    promoter_pct, promoter_pledge_pct, quarter
  ),
  financials(
    revenue_growth_yoy, margin, quarter
  )
`

function hasDescription(row) {
  return Boolean(String(row?.description || '').trim())
}

function latestByQuarter(rows) {
  const list = Array.isArray(rows) ? [...rows] : []
  return list.sort((a, b) => String(b.quarter || '').localeCompare(String(a.quarter || '')))[0] || {}
}

function rowContext(row) {
  const priceData = Array.isArray(row.price_data) ? row.price_data[0] : row.price_data || {}
  const latestSh = latestByQuarter(row.shareholding)
  const latestFin = latestByQuarter(row.financials)
  return {
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    stage: priceData.stage,
    rs_vs_nifty: priceData.rs_vs_nifty,
    promoter_pct: latestSh.promoter_pct,
    promoter_pledge_pct: latestSh.promoter_pledge_pct,
    revenue_growth: latestFin.revenue_growth_yoy,
    margin: latestFin.margin,
    existing_description: row.description || '',
  }
}

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

export default function AdminDescriptions() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('missing')
  const [model, setModel] = useState('gemini')
  const [drafts, setDrafts] = useState({})
  const [busyById, setBusyById] = useState({})
  const [message, setMessage] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [isBulkRunning, setIsBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(0)
  const [bulkTotal, setBulkTotal] = useState(0)

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        let list = []
        const enriched = await supabase
          .from('companies')
          .select(ENRICHED_SELECT)
          .eq('price_data.is_latest', true)
          .order('symbol')
          .limit(5000)

        if (!enriched.error && enriched.data) {
          list = enriched.data
        } else {
          console.warn('Enriched companies fetch failed, using simple query:', enriched.error)
          const simple = await supabase
            .from('companies')
            .select('id, name, symbol, sector, description, description_approved, updated_at')
            .order('symbol')
            .limit(5000)
          if (simple.error) {
            console.error('Companies fetch error:', simple.error)
            if (active) setMessage(`Could not load companies: ${formatSupabaseError(simple.error)}`)
            return
          }
          list = simple.data || []
        }

        if (!active) return
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
    const missing = rows.filter((r) => !hasDescription(r)).length
    const pending = rows.filter((r) => hasDescription(r) && r.description_approved !== true).length
    const approved = rows.filter((r) => r.description_approved === true).length
    return { missing, pending, approved, all: rows.length }
  }, [rows])

  const pendingList = useMemo(
    () => rows.filter((r) => hasDescription(r) && r.description_approved !== true),
    [rows],
  )

  const visibleRows = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'approved') return rows.filter((r) => r.description_approved === true)
    if (filter === 'pending') return pendingList
    return rows.filter((r) => !hasDescription(r))
  }, [rows, filter, pendingList])

  function setBusy(id, value) {
    setBusyById((prev) => ({ ...prev, [id]: value }))
  }

  function generateEndpoint() {
    return model === 'gemini'
      ? `${FN_ROOT}/generate-description-gemini`
      : `${FN_ROOT}/generate-description-claude`
  }

  function modelLabel() {
    return model === 'gemini' ? 'Gemini Flash Lite' : 'Claude Haiku'
  }

  async function fetchGeneratedDescription(row) {
    const res = await fetch(generateEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rowContext(row)),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    const text = normalizeCompanyDescription(data.description)
    if (!text) throw new Error('Empty description returned')
    return text
  }

  async function generate(row) {
    setBusy(row.id, true)
    setMessage(`Generating for ${row.symbol}…`)
    try {
      const text = await fetchGeneratedDescription(row)
      setDrafts((prev) => ({ ...prev, [row.id]: text }))
      setMessage(`Generated for ${row.symbol} using ${modelLabel()}. Review and approve below.`)
    } catch (err) {
      console.error('Generate error:', err)
      setMessage(`Failed for ${row.symbol}: ${err.message}`)
    } finally {
      setBusy(row.id, false)
    }
  }

  async function approve(row) {
    const text = normalizeCompanyDescription(drafts[row.id] || '').trim()
    if (!text) {
      setMessage('Description cannot be empty.')
      return
    }
    if (text.length < 20) {
      setMessage('Description too short (min 20 chars).')
      return
    }

    setBusy(row.id, true)
    setMessage(`Saving ${row.symbol}…`)

    try {
      const payload = buildCompanyPatch(row, {
        description: text,
        description_approved: true,
      })
      const { error } = await supabase.from('companies').update(payload).eq('id', row.id)
      if (error) {
        console.error('Supabase save error:', error)
        throw new Error(formatSupabaseError(error))
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

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, description: text, description_approved: true } : r,
        ),
      )
      setMessage(`✅ Saved: ${row.symbol}`)
    } catch (err) {
      console.error('Save failed:', err)
      setMessage(`❌ Save failed for ${row.symbol}: ${err.message}`)
    } finally {
      setBusy(row.id, false)
    }
  }

  async function unapprove(row) {
    setBusy(row.id, true)
    setMessage(`Unlocking ${row.symbol} for edit…`)
    try {
      const payload = buildCompanyPatch(row, { description_approved: false })
      const { error } = await supabase.from('companies').update(payload).eq('id', row.id)
      if (error) {
        console.error('Unapprove error:', error)
        throw new Error(formatSupabaseError(error))
      }
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, description_approved: false } : r)),
      )
      setMessage(`${row.symbol} marked pending — edit and approve again.`)
    } catch (err) {
      console.error('Unapprove failed:', err)
      setMessage(`❌ Could not unapprove ${row.symbol}: ${err.message}`)
    } finally {
      setBusy(row.id, false)
    }
  }

  async function bulkApproveAll() {
    const targets = pendingList
    if (!targets.length) return
    const ok = window.confirm(
      `Approve ${targets.length} pending description(s)? They will go live for SEO and stock pages.`,
    )
    if (!ok) return

    setBulkBusy(true)
    setMessage('')
    let okCount = 0
    let failCount = 0
    const failedSymbols = []
    const CHUNK = 12

    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK)
      const results = await Promise.all(
        chunk.map(async (row) => {
          const nextText = normalizeCompanyDescription(drafts[row.id] ?? row.description ?? '').trim()
          if (!nextText || nextText.length < 20) return { ok: false, symbol: row.symbol }
          const payload = buildCompanyPatch(row, {
            description: nextText,
            description_approved: true,
          })
          const { error } = await supabase.from('companies').update(payload).eq('id', row.id)
          if (error) return { ok: false, symbol: row.symbol }
          return { ok: true, symbol: row.symbol, text: nextText }
        }),
      )
      for (const r of results) {
        if (r.ok) {
          okCount += 1
          setRows((prev) =>
            prev.map((row) =>
              row.symbol === r.symbol
                ? { ...row, description: r.text, description_approved: true }
                : row,
            ),
          )
        } else {
          failCount += 1
          failedSymbols.push(r.symbol)
        }
      }
      setMessage(`Approving… ${okCount + failCount} / ${targets.length}`)
    }

    try {
      await logAdminAction({
        action: 'description_bulk_approve',
        target_type: 'company',
        new_value: okCount,
        notes:
          failCount > 0
            ? `${okCount} ok, ${failCount} failed: ${failedSymbols.slice(0, 20).join(', ')}`
            : `${okCount} companies`,
      })
    } catch {
      /* optional */
    }

    setBulkBusy(false)
    setMessage(
      failCount
        ? `Approved ${okCount}; ${failCount} failed (${failedSymbols.slice(0, 8).join(', ')}${failedSymbols.length > 8 ? '…' : ''}).`
        : `Approved ${okCount} description(s).`,
    )
  }

  async function bulkGenerate() {
    const missing = visibleRows.filter((r) => !hasDescription(r))
    if (!missing.length) {
      setMessage('No missing descriptions in this view.')
      return
    }

    if (
      !window.confirm(
        `Generate descriptions for ${missing.length} stocks using ${modelLabel()}? They will be saved as pending drafts.`,
      )
    ) {
      return
    }

    setIsBulkRunning(true)
    setBulkProgress(0)
    setBulkTotal(missing.length)
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < missing.length; i++) {
      const row = missing[i]
      setBulkProgress(i + 1)
      try {
        const text = await fetchGeneratedDescription(row)
        const payload = buildCompanyPatch(row, {
          description: text,
          description_approved: false,
        })
        const { error: saveError } = await supabase.from('companies').update(payload).eq('id', row.id)
        if (saveError) throw saveError

        setDrafts((prev) => ({ ...prev, [row.id]: text }))
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, description: text } : r)))
        successCount += 1
      } catch (err) {
        console.error(`Bulk failed ${row.symbol}:`, err)
        failCount += 1
      }
      await new Promise((r) => setTimeout(r, 800))
    }

    setIsBulkRunning(false)
    setMessage(
      `✅ Bulk complete: ${successCount} generated, ${failCount} failed. Review and approve each one.`,
    )
    setReloadTick((x) => x + 1)
  }

  const anyBusy = bulkBusy || isBulkRunning

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Descriptions</h1>
        <div className="flex flex-wrap items-center gap-2">
          {pendingList.length > 0 ? (
            <button
              type="button"
              disabled={anyBusy || loading}
              onClick={() => void bulkApproveAll()}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{
                borderColor: C.green,
                background: 'rgba(52,211,153,0.12)',
                color: C.green,
              }}
            >
              {bulkBusy ? 'Approving…' : `Approve all pending (${pendingList.length})`}
            </button>
          ) : null}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={anyBusy}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: C.border, background: C.surface2, color: C.text }}
          >
            <option value="missing">Missing ({counts.missing})</option>
            <option value="pending">Pending ({counts.pending})</option>
            <option value="approved">Approved ({counts.approved})</option>
            <option value="all">All ({counts.all})</option>
          </select>
        </div>
      </div>

      <p className="text-sm" style={{ color: MUTED }}>
        <span className="font-semibold text-slate-200">{counts.missing}</span> missing ·{' '}
        <span className="font-semibold text-slate-200">{counts.pending}</span> pending ·{' '}
        <span className="font-semibold text-slate-200">{counts.approved}</span> approved
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}>
        <span style={{ fontSize: 12, color: MUTED }}>AI Model:</span>
        {['gemini', 'claude'].map((m) => (
          <button
            key={m}
            type="button"
            disabled={anyBusy}
            onClick={() => setModel(m)}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: model === m ? '1px solid rgba(0,200,5,.4)' : `1px solid ${CARD_BORDER}`,
              background: model === m ? 'rgba(0,200,5,.08)' : 'transparent',
              color: model === m ? GREEN : MUTED,
              fontSize: 11,
              fontWeight: 600,
              cursor: anyBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {m === 'gemini' ? '✦ Gemini Flash Lite' : '◆ Claude Haiku'}
          </button>
        ))}
      </div>

      {message ? (
        <p className="text-sm" style={{ color: MUTED }}>
          {message}
        </p>
      ) : null}

      {filter === 'missing' && visibleRows.length > 0 ? (
        <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => void bulkGenerate()}
            disabled={isBulkRunning || anyBusy}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid rgba(96,165,250,.4)',
              background: 'rgba(96,165,250,.08)',
              color: isBulkRunning ? '#475569' : BLUE,
              fontSize: 12,
              fontWeight: 600,
              cursor: isBulkRunning ? 'not-allowed' : 'pointer',
            }}
          >
            {isBulkRunning
              ? `Generating ${bulkProgress}/${bulkTotal}…`
              : `✦ Generate All Missing (${visibleRows.length})`}
          </button>
          {isBulkRunning ? (
            <div style={{ flex: 1, height: 4, background: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${bulkTotal > 0 ? (bulkProgress / bulkTotal) * 100 : 0}%`,
                  height: '100%',
                  background: BLUE,
                  borderRadius: 2,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.length ? (
            visibleRows.map((row) => {
              const isBusy = anyBusy || Boolean(busyById[row.id])
              const draft = drafts[row.id] || ''
              const draftTrim = draft.trim()
              return (
                <div
                  key={row.id}
                  style={{
                    background: CARD_BG,
                    border: row.description_approved
                      ? '1px solid rgba(0,200,5,.2)'
                      : `1px solid ${CARD_BORDER}`,
                    borderRadius: 10,
                    padding: 16,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 10,
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0' }}>{row.symbol}</span>
                      <span style={{ fontSize: 11, color: MUTED }}>{row.name}</span>
                      <span style={{ fontSize: 11, color: MUTED }}>{row.sector || '—'}</span>
                      {row.description_approved ? (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: 'rgba(0,200,5,.12)',
                            color: GREEN,
                            border: '1px solid rgba(0,200,5,.3)',
                          }}
                        >
                          ✓ APPROVED
                        </span>
                      ) : null}
                      {!hasDescription(row) && !draftTrim ? (
                        <span style={{ fontSize: 10, color: '#475569' }}>No description</span>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => void generate(row)}
                        disabled={isBusy}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 6,
                          border: '1px solid rgba(96,165,250,.3)',
                          background: 'rgba(96,165,250,.08)',
                          color: isBusy ? '#475569' : BLUE,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: isBusy ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {busyById[row.id] ? '⏳ Generating…' : '✦ Generate'}
                      </button>

                      {draftTrim ? (
                        <button
                          type="button"
                          onClick={() => void approve(row)}
                          disabled={isBusy}
                          style={{
                            padding: '5px 12px',
                            borderRadius: 6,
                            border: '1px solid rgba(0,200,5,.4)',
                            background: 'rgba(0,200,5,.08)',
                            color: isBusy ? '#475569' : GREEN,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {busyById[row.id] ? 'Saving…' : '✓ Approve'}
                        </button>
                      ) : null}

                      {row.description_approved ? (
                        <button
                          type="button"
                          onClick={() => void unapprove(row)}
                          disabled={isBusy}
                          style={{
                            padding: '5px 12px',
                            borderRadius: 6,
                            border: `1px solid ${CARD_BORDER}`,
                            background: 'transparent',
                            color: MUTED,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <textarea
                    value={draft}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.id]: e.target.value,
                      }))
                    }
                    placeholder="No description yet. Click Generate to create one."
                    rows={3}
                    disabled={isBusy}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: '#0B0E11',
                      border: `1px solid ${CARD_BORDER}`,
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 12,
                      color: '#CBD5E1',
                      lineHeight: 1.6,
                      resize: 'vertical',
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />

                  {draftTrim ? (
                    <div
                      style={{
                        fontSize: 10,
                        color: '#475569',
                        marginTop: 4,
                        textAlign: 'right',
                      }}
                    >
                      {wordCount(draft)} words · {draftTrim.length} chars
                    </div>
                  ) : null}
                </div>
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
