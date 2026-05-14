import { useCallback, useEffect, useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import SectionLabel from '../../components/ui/SectionLabel'
import { useAuth } from '../../context'
import { hasSupabaseEnv, supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'

/** RFC date string YYYY-MM-DD or null */
function parseDate(s) {
  const raw = String(s || '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const mSlash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (mSlash) {
    const [, d, mo, y] = mSlash
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10)
  }
  const tryParse = new Date(raw)
  if (!Number.isNaN(tryParse.getTime())) return tryParse.toISOString().slice(0, 10)
  return null
}

/**
 * NSE CF-Event exports are tab-delimited when copied from the web table
 * but become comma-CSV (often with quoted, multi-line headers) when
 * downloaded. Try tab first, then fall back to a quoted-comma parser.
 */
function parseCSVLine(line) {
  if (line.includes('\t')) {
    return line.split('\t').map((s) => s.replace(/^"|"$/g, '').trim())
  }
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

const HEADER_KEYWORDS = new Set([
  'symbol',
  'company',
  'purpose',
  'details',
  'date',
  'securitycode',
  'scrip',
  'scripcode',
])

/**
 * True when a parsed row looks like a header rather than data.
 * Handles:
 *   - Normal headers: ["SYMBOL", "COMPANY", ...]
 *   - Fragmented multi-line headers (e.g. cell ended mid-quote so the
 *     header bleeds onto its own line and shows up as a single cell
 *     like `"SYMBOL` or `SYMBOL \n"`).
 */
function isHeader(parts) {
  if (!parts || parts.length === 0) return false
  const norm = (cell) =>
    String(cell || '')
      .toLowerCase()
      .replace(/["\s]/g, '')
  const first = norm(parts[0])
  if (HEADER_KEYWORDS.has(first)) return true
  // Multi-cell header: at least two cells are recognisable header tokens.
  const matches = parts.filter((p) => HEADER_KEYWORDS.has(norm(p))).length
  return matches >= 2
}

/**
 * NSE CF-Event row layout (5 cells):
 *   SYMBOL, COMPANY, PURPOSE, DETAILS, DATE
 */
function parseInput(text) {
  const lines = String(text || '').trim().split(/\r?\n/)
  const results = []

  for (const line of lines) {
    if (!line.trim()) continue

    const parts = parseCSVLine(line)

    // Skip header lines (covers fragmented multi-line headers too).
    if (isHeader(parts)) continue
    if (parts.length < 5) continue

    const clean = (v) => String(v || '').replace(/"/g, '').trim()
    const symbol = clean(parts[0])
    const company = clean(parts[1])
    const purpose = clean(parts[2])
    const details = clean(parts[3])
    const dateStr = clean(parts[4])

    if (!symbol || !dateStr) continue

    const pLower = purpose.toLowerCase()
    const isResult = pLower.includes('financial results') || pLower.includes('result')

    const parsed = parseDate(dateStr)
    if (!parsed) continue

    let eventType = 'board_meeting'
    if (pLower.includes('financial results')) eventType = 'financial_results'
    if (pLower.includes('dividend')) eventType = 'dividend'
    if (pLower.includes('bonus')) eventType = 'bonus'
    if (pLower.includes('buyback')) eventType = 'buyback'

    results.push({
      symbol,
      security_name: company,
      purpose,
      details,
      result_date: parsed,
      event_type: eventType,
      is_result: isResult,
    })
  }

  return results
}

function statusLabel(row, companyId) {
  if (!companyId) return 'No match'
  return 'In DB'
}

export default function AdminResultCalendar() {
  const { user } = useAuth()
  const [rawText, setRawText] = useState('')
  const [parsed, setParsed] = useState([])
  const [previewCompany, setPreviewCompany] = useState({})
  const [resultsOnly, setResultsOnly] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [upcoming, setUpcoming] = useState([])
  const [loadingUpcoming, setLoadingUpcoming] = useState(false)
  const [autoFetching, setAutoFetching] = useState(false)
  const [autoFetchStatus, setAutoFetchStatus] = useState('')

  const previewRows = useMemo(() => {
    if (!resultsOnly) return parsed
    return parsed.filter((p) => p.is_result)
  }, [parsed, resultsOnly])

  const loadUpcoming = useCallback(async () => {
    if (!hasSupabaseEnv) return
    setLoadingUpcoming(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('result_calendar')
        .select('*')
        .gte('result_date', today)
        .order('result_date', { ascending: true })
        .limit(200)
      if (error) throw error
      setUpcoming(data || [])
    } catch (e) {
      console.error(e)
      setUpcoming([])
    } finally {
      setLoadingUpcoming(false)
    }
  }, [])

  useEffect(() => {
    loadUpcoming()
  }, [loadUpcoming])

  useEffect(() => {
    const rows = parseInput(rawText)
    setParsed(rows)
  }, [rawText])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const syms = [...new Set(previewRows.map((r) => r.symbol.toUpperCase()).filter(Boolean))]
      if (!syms.length || !hasSupabaseEnv) {
        if (!cancelled) setPreviewCompany({})
        return
      }
      const { data, error } = await supabase.from('companies').select('id, symbol').in('symbol', syms)
      if (cancelled || error) return
      const map = Object.fromEntries((data || []).map((c) => [c.symbol, c.id]))
      setPreviewCompany(map)
    })()
    return () => {
      cancelled = true
    }
  }, [previewRows])

  async function handleSave() {
    if (!hasSupabaseEnv) {
      setSaveMsg('Supabase env missing')
      return
    }
    const rows = previewRows
    if (!rows.length) {
      setSaveMsg('Nothing to save (check paste or toggle).')
      return
    }
    setSaving(true)
    setSaveMsg('')
    setAutoFetchStatus('')
    let ok = 0
    let err = 0
    const email = user?.email || null

    try {
      for (const entry of rows) {
        const sym = entry.symbol.toUpperCase()
        const { data: company } = await supabase
          .from('companies')
          .select('id, symbol')
          .eq('symbol', sym)
          .maybeSingle()

        const row = {
          symbol: sym,
          security_name: entry.security_name || null,
          result_date: entry.result_date,
          purpose: entry.purpose || null,
          details: entry.details || null,
          event_type: entry.event_type || null,
          company_id: company?.id ?? null,
          updated_by: email,
          indianapi_fetched: false,
        }

        const { error } = await supabase.from('result_calendar').upsert(row, {
          onConflict: 'symbol,result_date',
        })
        if (error) {
          console.error(error)
          err += 1
        } else {
          ok += 1
        }
      }
      setSaveMsg(err ? `Saved ${ok}, failed ${err}` : `Saved ${ok} row(s).`)
      await loadUpcoming()

      const todayStr = new Date().toISOString().split('T')[0]
      const todayEntries = rows.filter((p) => p.result_date === todayStr && p.is_result)

      if (todayEntries.length > 0) {
        setAutoFetching(true)
        setAutoFetchStatus(`Fetching ${todayEntries.length} companies announcing today...`)
        try {
          const resp = await fetch('/.netlify/functions/admin-fetch-results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: todayStr,
              symbols: todayEntries.map((e) => e.symbol.toUpperCase()).filter(Boolean),
            }),
          })
          const result = await resp.json()
          setAutoFetchStatus(`OK — queued ${result.fetched || 0} companies (workflow dispatch).`)
        } catch (fetchErr) {
          setAutoFetchStatus(`Auto-fetch failed — run pipeline manually (${fetchErr?.message || fetchErr})`)
        } finally {
          setAutoFetching(false)
          loadUpcoming()
        }
      } else {
        setAutoFetchStatus('No result events for today — future rows will fetch when scheduled.')
      }
    } catch (e) {
      setSaveMsg(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: '20px 22px 40px', maxWidth: 1100, margin: '0 auto' }}>
      <SectionLabel>Result calendar</SectionLabel>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 16px', color: C.text }}>NSE CF-Event import</h1>
      <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 18, lineHeight: 1.5 }}>
        Paste CSV with columns:         <code style={{ color: C.textFaint }}>SYMBOL, COMPANY, PURPOSE, DETAILS, DATE</code>.
        Rows are matched to <code style={{ color: C.textFaint }}>companies.symbol</code> and upserted into{' '}
        <code style={{ color: C.textFaint }}>result_calendar</code> on <code style={{ color: C.textFaint }}>(symbol, result_date)</code>.
      </p>

      <div style={{ marginBottom: 18 }}>
        <Card>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="Paste NSE CF-Event export here..."
          style={{
            width: '100%',
            minHeight: 180,
            background: C.surface2,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.text,
            fontSize: 12,
            fontFamily: 'ui-monospace, monospace',
            padding: 12,
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Preview:</span>
          <button
            type="button"
            onClick={() => setResultsOnly(true)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${resultsOnly ? C.green : C.border}`,
              background: resultsOnly ? 'rgba(52,211,153,0.12)' : 'transparent',
              color: resultsOnly ? C.green : C.textMuted,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: resultsOnly ? 700 : 500,
            }}
          >
            Results only
          </button>
          <button
            type="button"
            onClick={() => setResultsOnly(false)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${!resultsOnly ? C.blue : C.border}`,
              background: !resultsOnly ? 'rgba(56,189,248,0.12)' : 'transparent',
              color: !resultsOnly ? C.blue : C.textMuted,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: !resultsOnly ? 700 : 500,
            }}
          >
            All events
          </button>
          <span style={{ fontSize: 12, color: C.textMuted, marginLeft: 'auto' }}>
            {previewRows.length} row{previewRows.length === 1 ? '' : 's'} · parsed {parsed.length} total
          </span>
        </div>
      </Card>
      </div>

      <div style={{ marginBottom: 18, overflowX: 'auto' }}>
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '8px 10px' }}>Symbol</th>
              <th style={{ padding: '8px 10px' }}>Company</th>
              <th style={{ padding: '8px 10px' }}>Purpose</th>
              <th style={{ padding: '8px 10px' }}>Date</th>
              <th style={{ padding: '8px 10px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 16, color: C.textMuted }}>
                  No rows yet. Paste CSV above.
                </td>
              </tr>
            ) : (
              previewRows.map((r, i) => {
                const cid = previewCompany[r.symbol.toUpperCase()]
                return (
                  <tr key={`${r.symbol}-${r.result_date}-${i}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: C.text }}>{r.symbol}</td>
                    <td style={{ padding: '8px 10px', color: C.textMuted }}>{r.security_name || '—'}</td>
                    <td style={{ padding: '8px 10px', color: C.textMuted, maxWidth: 360 }}>{r.purpose || '—'}</td>
                    <td style={{ padding: '8px 10px', color: C.textMuted }}>{r.result_date}</td>
                    <td style={{ padding: '8px 10px', color: cid ? C.green : C.amber }}>{statusLabel(r, cid)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
        <button
          type="button"
          disabled={saving || !previewRows.length}
          onClick={handleSave}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: saving || !previewRows.length ? C.border : C.green,
            color: '#04120a',
            fontWeight: 700,
            cursor: saving || !previewRows.length ? 'default' : 'pointer',
            fontSize: 13,
          }}
        >
          {saving ? 'Saving…' : 'Save to database'}
        </button>
        {saveMsg ? (
          <div style={{ fontSize: 12, color: saveMsg.includes('fail') ? C.red : C.textMuted }}>{saveMsg}</div>
        ) : null}
        {autoFetchStatus ? (
          <div
            style={{
              marginTop: 2,
              padding: '8px 12px',
              background: autoFetching ? 'rgba(96,165,250,.1)' : autoFetchStatus.startsWith('OK') ? 'rgba(0,200,5,.1)' : 'rgba(251,191,36,.1)',
              border: `1px solid ${
                autoFetching ? '#60A5FA44' : autoFetchStatus.startsWith('OK') ? '#00C80544' : '#FBBF2444'
              }`,
              borderRadius: 6,
              fontSize: 12,
              color: autoFetching ? '#60A5FA' : autoFetchStatus.startsWith('OK') ? '#00C805' : '#FBBF24',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {autoFetching ? <i className="ti ti-loader-2 animate-spin" style={{ fontSize: 14 }} /> : null}
            {autoFetchStatus}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 28 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: C.text }}>Upcoming (from DB)</h2>
          <button
            type="button"
            onClick={loadUpcoming}
            style={{
              fontSize: 12,
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: C.surface2,
              color: C.textMuted,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
        {loadingUpcoming ? (
          <p style={{ color: C.textMuted, fontSize: 12 }}>Loading…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: '6px 8px' }}>Symbol</th>
                  <th style={{ padding: '6px 8px' }}>Date</th>
                  <th style={{ padding: '6px 8px' }}>Purpose</th>
                  <th style={{ padding: '6px 8px' }}>Fetched</th>
                </tr>
              </thead>
              <tbody>
                {(upcoming || []).map((u) => (
                  <tr key={`${u.symbol}-${u.result_date}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{u.symbol}</td>
                    <td style={{ padding: '6px 8px' }}>{u.result_date}</td>
                    <td style={{ padding: '6px 8px', color: C.textMuted, maxWidth: 400 }}>{u.purpose || '—'}</td>
                    <td style={{ padding: '6px 8px', color: u.indianapi_fetched ? C.green : C.textMuted }}>
                      {u.indianapi_fetched ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>
    </div>
  )
}
