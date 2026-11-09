/**
 * /admin/studies/:id — tabbed editor.
 *
 * Header (always visible): status, Save draft, status dropdown, Mark
 * reviewed, Preview. Overview + Story share one company draft (switching
 * between them keeps edits); list tabs save per row via ChildListEditor.
 *
 * Guards: switching tab while a list row has unsaved edits, and leaving
 * the page (in-app link or tab close) with any unsaved edits, ask first.
 * Publishing asks for confirmation and shows the freshness checklist, but
 * does not block. The content check warns, never blocks.
 * (Static rebuild on publish is Phase 5; this only updates the database.)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { readingMinutes } from '../../study/data.js'
import { clean, freshnessFor, loadStudy, slugTaken, slugify, updateStudy } from './api.js'
import { CHILD_TABLES, COMPANY_FIELDS, COMPANY_TEXT_FIELDS, STATUSES, STATUS_LABELS, TABS, activeFlags } from './config.js'
import { scanFields } from './contentCheck.js'
import { DirtyContext, LEAVE_MESSAGE, useLeaveGuard } from './dirty.js'
import ChildListEditor from './ChildListEditor.jsx'
import OverviewTab from './OverviewTab.jsx'
import SeriesTab from './SeriesTab.jsx'
import StoryTab from './StoryTab.jsx'
import { Button, ContentWarnings, ErrorBox, Modal, Notice, Spinner, StatusPill } from './ui.jsx'

const NUMBER_FIELDS = new Set(['fiscal_year_end_month', 'read_time_minutes'])
const UPPER_FIELDS = new Set(['country', 'exchange', 'ticker', 'isin', 'reporting_currency'])

function norm(key, v) {
  if (key === 'featured') return Boolean(v)
  if (NUMBER_FIELDS.has(key)) {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  const c = clean(v)
  return typeof c === 'string' && UPPER_FIELDS.has(key) ? c.toUpperCase() : c
}

const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never'

export default function StudyEditor({ id }) {
  const [sp, setSp] = useSearchParams()
  const tab = TABS.find((t) => t.id === sp.get('tab'))?.id || 'overview'
  const [study, setStudy] = useState(null)
  const [draft, setDraft] = useState(null)
  const [fresh, setFresh] = useState(null)
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(null)
  const [publishing, setPublishing] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugCheck, setSlugCheck] = useState(null)
  const [flags, setFlags] = useState({})
  const setFlag = useCallback((k, v) => setFlags((p) => (Boolean(p[k]) === v ? p : { ...p, [k]: v })), [])

  // ── load ──
  useEffect(() => {
    let live = true
    Promise.all([loadStudy(id), freshnessFor(id)]).then(([s, f]) => {
      if (!live) return
      if (s.data) {
        setStudy(s.data)
        setDraft(s.data.company)
      }
      setLoadError(s.data ? null : s.error)
      setError(s.data ? s.error : null)
      setFresh(f.data)
      if (f.error) setError((e) => [e, f.error].filter(Boolean).join('\n'))
    })
    return () => {
      live = false
    }
  }, [id])

  const refreshFreshness = useCallback(async () => {
    const f = await freshnessFor(id)
    if (f.error) setError(f.error)
    else setFresh(f.data)
  }, [id])

  // ── dirty state ──
  const patch = useMemo(() => {
    if (!draft || !study) return {}
    const p = {}
    for (const k of COMPANY_FIELDS) {
      const a = norm(k, draft[k])
      if (JSON.stringify(a) !== JSON.stringify(norm(k, study.company[k]))) p[k] = a
    }
    return p
  }, [draft, study])
  const companyDirty = Object.keys(patch).length > 0
  const childDirty = Object.values(flags).some(Boolean)
  const anyDirty = companyDirty || childDirty

  // Leaving the page (links, tab close); a same-page ?tab= link only matters for list rows.
  useLeaveGuard(anyDirty, childDirty)

  function goTab(next) {
    if (next === tab) return
    if (childDirty && !window.confirm(LEAVE_MESSAGE)) return
    setSp(next === 'overview' ? {} : { tab: next })
  }

  // ── slug: auto from name until edited; uniqueness check ──
  const setField = useCallback(
    (key, value) => {
      setDraft((d) => {
        const next = { ...d, [key]: value }
        if (key === 'name' && !slugTouched && study && study.company.status !== 'published') {
          const prevAuto = slugify(d.name)
          if (!d.slug || d.slug === prevAuto) next.slug = slugify(value)
        }
        return next
      })
      if (key === 'slug') setSlugTouched(true)
    },
    [slugTouched, study],
  )

  const slug = draft?.slug
  useEffect(() => {
    if (!slug) return
    let live = true
    const t = setTimeout(async () => {
      const r = await slugTaken(slugify(slug), id)
      if (live) setSlugCheck({ slug, ...r })
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [slug, id])

  const slugNote = useMemo(() => {
    if (!draft) return null
    if (!draft.slug?.trim()) return { error: 'Slug is required.' }
    const s = slugify(draft.slug)
    if (slugCheck?.slug === draft.slug && slugCheck.error) return { error: slugCheck.error }
    if (slugCheck?.slug === draft.slug && slugCheck.taken) return { error: 'Another study already uses this slug.' }
    const notes = []
    if (s !== draft.slug) notes.push(`Will be saved as “${s}”.`)
    if (study?.company.status === 'published' && 'slug' in patch) notes.push('This study is published: changing the slug changes its URL.')
    notes.push(`URL: /company/${s || '…'}`)
    return { info: notes.join(' ') }
  }, [draft, slugCheck, study, patch])

  const minutes = useMemo(() => (study && draft ? readingMinutes({ ...study, company: draft }) : 1), [study, draft])

  // ── save / status ──
  async function saveDraft() {
    if (!companyDirty) return true
    const p = { ...patch }
    if ('slug' in p) {
      p.slug = slugify(p.slug)
      if (!p.slug) {
        setError('Slug is required.')
        return false
      }
      const t = await slugTaken(p.slug, id)
      if (t.error || t.taken) {
        setError(t.error || 'Another study already uses this slug. Choose a different one.')
        return false
      }
    }
    if ('name' in p && !p.name) {
      setError('Company name is required.')
      return false
    }
    const hits = scanFields({ ...draft, ...p }, Object.fromEntries(Object.entries(COMPANY_TEXT_FIELDS).filter(([k]) => k in p)))
    setBusy('save')
    const r = await updateStudy(id, p)
    setBusy(null)
    if (r.error) {
      setError(r.error)
      return false
    }
    setStudy((s) => ({ ...s, company: r.data }))
    setDraft(r.data)
    setSlugTouched(false)
    setWarnings(hits)
    setError(null)
    setNotice(`Saved at ${fmtDateTime(r.data.updated_at)}.`)
    return true
  }

  async function setStatus(next, { skipConfirm = false } = {}) {
    if (next === study.company.status) return
    if (next === 'published' && !skipConfirm) {
      await refreshFreshness()
      setPublishing(true)
      return
    }
    if (next === 'archived' && !window.confirm(`Archive this study?${study.company.status === 'published' ? ' It will stop being public.' : ''}`)) return
    setBusy('status')
    const r = await updateStudy(id, { status: next })
    setBusy(null)
    if (r.error) {
      setError(r.error)
      return
    }
    const pick = ({ status, published_at, updated_at, version }) => ({ status, published_at, updated_at, version })
    setStudy((s) => ({ ...s, company: { ...s.company, ...pick(r.data) } }))
    setDraft((d) => ({ ...d, ...pick(r.data) }))
    setNotice(`Status set to ${STATUS_LABELS[next]}. The public site is rebuilt in Phase 5; for now only the database changed.`)
  }

  async function confirmPublish() {
    setPublishing(false)
    if (companyDirty && !(await saveDraft())) return
    await setStatus('published', { skipConfirm: true })
  }

  async function markReviewed() {
    setBusy('review')
    const r = await updateStudy(id, { reviewed_at: new Date().toISOString() })
    setBusy(null)
    if (r.error) {
      setError(r.error)
      return
    }
    setStudy((s) => ({ ...s, company: { ...s.company, reviewed_at: r.data.reviewed_at, updated_at: r.data.updated_at } }))
    setDraft((d) => ({ ...d, reviewed_at: r.data.reviewed_at, updated_at: r.data.updated_at }))
    setNotice('Marked as reviewed.')
    refreshFreshness()
  }

  if (loadError) {
    return (
      <div className="sa-page">
        <ErrorBox error={loadError} />
        <Link to="/admin/studies">← All studies</Link>
      </div>
    )
  }
  if (!study || !draft) return <Spinner />

  const c = study.company
  const current = TABS.find((t) => t.id === tab)
  const flagsNow = activeFlags(fresh)
  const childKey = current.child
  const publishHits = scanFields({ ...c, ...patch }, COMPANY_TEXT_FIELDS)

  return (
    <DirtyContext.Provider value={setFlag}>
      <Helmet>
        <title>{`${c.name} — Studies admin`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="sa-page sa-editor">
        <header className="sa-editor-head">
          <div className="sa-editor-title">
            <Link to="/admin/studies" className="sa-back">
              ← Studies
            </Link>
            <h1 className="sa-h1">{draft.name || 'Untitled'}</h1>
            <StatusPill status={c.status} />
            {anyDirty && <span className="sa-dirty">Unsaved changes</span>}
          </div>
          <div className="sa-editor-actions">
            <Button variant="primary" onClick={saveDraft} disabled={!companyDirty || busy === 'save'} title={companyDirty ? '' : 'No unsaved Overview/Story changes'}>
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </Button>
            <label className="sa-inline-label">
              <span className="sa-sr">Status</span>
              <select className="sa-input sa-select" value={c.status} onChange={(e) => setStatus(e.target.value)} disabled={busy === 'status'} aria-label="Status">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={markReviewed} disabled={busy === 'review'} title={`Last reviewed: ${fmtDateTime(c.reviewed_at)}`}>
              Mark reviewed
            </Button>
            <a className="sa-btn sa-btn-ghost" href={`/admin/studies/${id}/preview`} target="_blank" rel="noopener">
              Preview ↗
            </a>
          </div>
          <p className="sa-editor-meta">
            Reviewed {fmtDateTime(c.reviewed_at)} · Updated {fmtDateTime(c.updated_at)}
            {c.published_at ? ` · Published ${fmtDateTime(c.published_at)}` : ''}
          </p>
          <ErrorBox error={error} onDismiss={() => setError(null)} />
          <ContentWarnings hits={warnings} onDismiss={() => setWarnings([])} />
          <Notice kind="ok" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        </header>

        <nav className="sa-tabs" aria-label="Study sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`sa-tab${t.id === tab ? ' is-active' : ''}${t.phase ? ' is-disabled' : ''}`}
              aria-current={t.id === tab ? 'page' : undefined}
              aria-disabled={t.phase ? 'true' : undefined}
              disabled={Boolean(t.phase) && t.id !== tab}
              title={t.phase ? `Phase ${t.phase}` : undefined}
              onClick={() => goTab(t.id)}
            >
              {t.label}
              {t.phase && <span className="sa-phase">{t.phase}</span>}
              {flagsNow.some((f) => f.tab === t.id) && <span className="sa-dot" aria-label="needs attention" />}
            </button>
          ))}
        </nav>

        <div className="sa-tabbody">
          {tab === 'overview' && (
            <>
              {flagsNow.length > 0 && (
                <Notice kind="warn">
                  Needs attention:{' '}
                  {flagsNow.map((f, i) => (
                    <span key={f.key}>
                      {i ? ', ' : ''}
                      {f.tab === 'overview' ? (
                        f.label
                      ) : (
                        <button type="button" className="sa-linkbtn" onClick={() => goTab(f.tab)}>
                          {f.label}
                        </button>
                      )}
                    </span>
                  ))}
                </Notice>
              )}
              <OverviewTab draft={draft} setField={setField} computedMinutes={minutes} slugNote={slugNote} />
            </>
          )}
          {tab === 'story' && <StoryTab draft={draft} setField={setField} />}
          {childKey && (
            <ChildListEditor
              key={childKey}
              config={CHILD_TABLES[childKey]}
              studyId={id}
              rows={study[childKey] || []}
              onRowsChange={(rows) => {
                setStudy((s) => ({ ...s, [childKey]: rows }))
                if (childKey === 'sources' || childKey === 'tam') refreshFreshness()
              }}
              sources={study.sources}
              onSourceAdded={(row) => {
                setStudy((s) => ({ ...s, sources: [...s.sources, row] }))
                refreshFreshness()
              }}
            />
          )}
          {tab === 'series' && <SeriesTab studyId={id} />}
          {current.phase && (
            <div className="sa-panel sa-placeholder">
              <h2 className="sa-h2">{current.label}</h2>
              <p>
                Coming in Phase {current.phase}. Period data (financials, segments, shareholding, ownership changes) is append-only and gets its own
                editor.
              </p>
            </div>
          )}
        </div>
      </div>

      {publishing && (
        <Modal
          title="Publish this study?"
          onClose={() => setPublishing(false)}
          footer={
            <>
              <Button variant="primary" onClick={confirmPublish}>
                {companyDirty ? 'Save and publish' : 'Publish'}
              </Button>
              <Button variant="ghost" onClick={() => setPublishing(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <p>Publishing makes the study readable by anyone. You can still publish with open items.</p>
          {companyDirty && <Notice kind="info">Your unsaved Overview/Story changes will be saved first.</Notice>}
          {flagsNow.length > 0 ? (
            <>
              <p>
                <strong>Checklist — open items:</strong>
              </p>
              <ul className="sa-checklist-warn">
                {flagsNow.map((f) => (
                  <li key={f.key}>⚠ {f.label}</li>
                ))}
              </ul>
            </>
          ) : fresh ? (
            <p>✓ No freshness flags.</p>
          ) : (
            <p className="sa-muted">Freshness flags could not be loaded.</p>
          )}
          {publishHits.length > 0 && (
            <>
              <p>
                <strong>Wording to check:</strong>
              </p>
              <ul className="sa-warn-list">
                {publishHits.map((h, i) => (
                  <li key={i}>
                    <b>“{h.term}”</b> in {h.where}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </DirtyContext.Provider>
  )
}
