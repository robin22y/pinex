/**
 * /admin/studies — counts by status, "needs attention" from study_freshness
 * (each flag links to the tab that fixes it), and the searchable list with
 * Add / Open / Duplicate / Archive.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createStudy, duplicateStudy, lastBuildInfo, listFreshness, listStudies, publishAction, updateStudy } from './api.js'
import { STATUSES, STATUS_LABELS, activeFlags } from './config.js'
import { Button, ErrorBox, Field, Notice, Spinner, StatusPill } from './ui.jsx'

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export default function StudiesDashboard() {
  const navigate = useNavigate()
  const [studies, setStudies] = useState(null)
  const [fresh, setFresh] = useState(new Map())
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')
  const [adding, setAdding] = useState(false)
  const [newStudy, setNewStudy] = useState({ name: '', exchange: '', ticker: '' })
  const [busy, setBusy] = useState(null)
  const [tick, setTick] = useState(0)
  const [lastBuild, setLastBuild] = useState(null)
  const [noticeKind, setNoticeKind] = useState('ok')

  useEffect(() => {
    let live = true
    Promise.all([listStudies(), listFreshness(), lastBuildInfo()]).then(([s, f, b]) => {
      if (!live) return
      setStudies(s.data || [])
      setFresh(new Map((f.data || []).map((r) => [r.study_company_id, r])))
      setLastBuild(b.data)
      setError([s.error, f.error, b.error].filter(Boolean).join('\n') || null)
    })
    return () => {
      live = false
    }
  }, [tick])
  const reload = () => setTick((t) => t + 1)

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0]))
    for (const s of studies || []) c[s.status] = (c[s.status] || 0) + 1
    return c
  }, [studies])

  const attention = useMemo(
    () =>
      (studies || [])
        .filter((s) => s.status !== 'archived')
        .map((s) => ({ s, flags: activeFlags(fresh.get(s.id)) }))
        .filter((x) => x.flags.length),
    [studies, fresh],
  )

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (studies || []).filter((s) => {
      if (status === 'active' ? s.status === 'archived' : status !== 'all' && s.status !== status) return false
      if (!term) return true
      return [s.name, s.ticker, s.exchange, s.sector, s.exchange && s.ticker ? `${s.exchange}:${s.ticker}` : '']
        .some((v) => String(v || '').toLowerCase().includes(term))
    })
  }, [studies, q, status])

  async function add(e) {
    e.preventDefault()
    if (!newStudy.name.trim()) {
      setError('A new study needs a company name.')
      return
    }
    setBusy('add')
    const r = await createStudy(newStudy)
    setBusy(null)
    if (r.error) setError(r.error)
    else navigate(`/admin/studies/${r.data.id}`)
  }

  async function duplicate(s) {
    if (!window.confirm(`Duplicate “${s.name}”? Content is copied; financials, segments, shareholding and ownership data are not. The copy is a draft with no ticker.`)) return
    setBusy(s.id)
    const r = await duplicateStudy(s.id)
    setBusy(null)
    if (r.error) setError(r.error)
    if (r.data?.id) {
      setNoticeKind('ok')
      setNotice(
        <>
          Copied. <Link to={`/admin/studies/${r.data.id}`}>Open the copy</Link>
        </>,
      )
      reload()
    }
  }

  async function archive(s) {
    const pub = s.status === 'published' ? ' It is published, so it will be removed from the public site at the next rebuild.' : ''
    if (!window.confirm(`Archive “${s.name}”?${pub}`)) return
    setBusy(s.id)
    // Archiving a published study goes through the publish function (rebuild); otherwise direct.
    const r = s.status === 'published' ? await publishAction('archive', s.id) : await updateStudy(s.id, { status: 'archived' })
    setBusy(null)
    if (r.error) return setError(r.error)
    if (r.data?.reason) {
      setNoticeKind('warn')
      setNotice(`Archived. ${r.data.reason}`)
    }
    reload()
  }

  async function rebuild() {
    if (!window.confirm('Rebuild the public site now? Published study pages are regenerated from the current saved content (about 2 minutes).')) return
    setBusy('rebuild')
    const r = await publishAction('rebuild')
    setBusy(null)
    if (r.error) return setError(r.error)
    setNoticeKind(r.data.queued ? 'ok' : 'warn')
    setNotice(r.data.queued ? 'Rebuild started. The live pages update in about 2 minutes.' : r.data.reason)
    if (r.data.built_at) setLastBuild((b) => ({ ...(b || {}), at: r.data.built_at, action: 'rebuild', slug: null }))
  }

  return (
    <div className="sa-page">
      <div className="sa-row sa-row-between">
        <h1 className="sa-h1">Company Studies</h1>
        <div className="sa-row">
          <Link className="sa-btn sa-btn-default" to="/admin/media">
            Media library
          </Link>
          <Button onClick={rebuild} disabled={busy === 'rebuild'} title="Regenerate the static study pages from saved content">
            {busy === 'rebuild' ? 'Starting…' : 'Rebuild site'}
          </Button>
          <Button variant="primary" onClick={() => setAdding((a) => !a)}>
            + Add study
          </Button>
        </div>
      </div>

      {adding && (
        <form className="sa-panel" onSubmit={add}>
          <div className="sa-grid3">
            <Field label="Company name" required>
              <input className="sa-input" autoFocus value={newStudy.name} onChange={(e) => setNewStudy((n) => ({ ...n, name: e.target.value }))} />
            </Field>
            <Field label="Exchange" help="e.g. NSE, NYSE, LSE">
              <input className="sa-input" value={newStudy.exchange} onChange={(e) => setNewStudy((n) => ({ ...n, exchange: e.target.value.toUpperCase() }))} />
            </Field>
            <Field label="Ticker">
              <input className="sa-input" value={newStudy.ticker} onChange={(e) => setNewStudy((n) => ({ ...n, ticker: e.target.value.toUpperCase() }))} />
            </Field>
          </div>
          <div className="sa-row">
            <Button type="submit" variant="primary" disabled={busy === 'add'}>
              {busy === 'add' ? 'Creating…' : 'Create draft'}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <p className="sa-help">
        Last site build:{' '}
        {lastBuild?.at
          ? `${new Date(lastBuild.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${lastBuild.action ? ` (${lastBuild.action}${lastBuild.slug ? ` ${lastBuild.slug}` : ''})` : ''}`
          : 'not recorded yet'}
        . Content edits to a published study go live after a rebuild.
      </p>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <Notice kind={noticeKind} onDismiss={() => setNotice(null)}>
        {notice}
      </Notice>

      {!studies ? (
        <Spinner />
      ) : (
        <>
          <ul className="sa-counts" aria-label="Studies by status">
            {STATUSES.map((s) => (
              <li key={s}>
                <button type="button" className={status === s ? 'is-active' : ''} onClick={() => setStatus(status === s ? 'active' : s)}>
                  <span className="sa-count">{counts[s]}</span>
                  <span>{STATUS_LABELS[s]}</span>
                </button>
              </li>
            ))}
          </ul>

          {attention.length > 0 && (
            <section className="sa-panel">
              <h2 className="sa-h2">Needs attention</h2>
              <ul className="sa-attention">
                {attention.map(({ s, flags }) => (
                  <li key={s.id}>
                    <Link to={`/admin/studies/${s.id}`} className="sa-attn-name">
                      {s.name}
                    </Link>
                    <span className="sa-flags">
                      {flags.map((f) => (
                        <Link key={f.key} className="sa-flag" to={`/admin/studies/${s.id}?tab=${f.tab}`}>
                          {f.label}
                        </Link>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="sa-row sa-filters">
            <input
              className="sa-input sa-search"
              type="search"
              placeholder="Search name, ticker, exchange, sector"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search studies"
            />
            <select className="sa-input sa-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
              <option value="active">All except archived</option>
              <option value="all">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {shown.length === 0 ? (
            <p className="sa-muted">{studies.length ? 'No studies match.' : 'No studies yet. Add the first one.'}</p>
          ) : (
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Exchange:ticker</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th>Flags</th>
                  <th>
                    <span className="sa-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const flags = activeFlags(fresh.get(s.id))
                  return (
                    <tr key={s.id}>
                      <td data-label="Name">
                        <Link to={`/admin/studies/${s.id}`} className="sa-strong">
                          {s.name}
                        </Link>
                        {s.sector && <span className="sa-muted sa-block">{s.sector}</span>}
                      </td>
                      <td data-label="Exchange:ticker" className="sa-mono">
                        {s.exchange || s.ticker ? `${s.exchange || '—'}:${s.ticker || '—'}` : '—'}
                      </td>
                      <td data-label="Status">
                        <StatusPill status={s.status} />
                      </td>
                      <td data-label="Updated">{fmtDate(s.updated_at)}</td>
                      <td data-label="Flags">
                        {flags.length ? (
                          <span className="sa-flags">
                            {flags.map((f) => (
                              <Link key={f.key} className="sa-flag" to={`/admin/studies/${s.id}?tab=${f.tab}`}>
                                {f.label}
                              </Link>
                            ))}
                          </span>
                        ) : (
                          <span className="sa-muted">—</span>
                        )}
                      </td>
                      <td className="sa-actions">
                        <Link className="sa-btn sa-btn-default sa-btn-sm" to={`/admin/studies/${s.id}`}>
                          Open
                        </Link>
                        {fresh.get(s.id)?.financials_stale && s.status !== 'archived' && (
                          <Link className="sa-btn sa-btn-primary sa-btn-sm" to={`/admin/studies/${s.id}/quarterly`}>
                            Quarterly update
                          </Link>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => duplicate(s)} disabled={busy === s.id}>
                          Duplicate
                        </Button>
                        {s.status !== 'archived' && (
                          <Button size="sm" variant="ghost" onClick={() => archive(s)} disabled={busy === s.id}>
                            Archive
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
