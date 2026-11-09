/**
 * /admin/studies/:id/preview — the public StudyPage rendered from the
 * current SAVED data (all statuses), inside .study-surface. noindex.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import StudyPage from '../../study/StudyPage.jsx'
import '../../../styles/study.css'
import { loadStudy, previewSiteContent, resolveStudyMedia } from './api.js'
import { STATUS_LABELS } from './config.js'
import { ErrorBox, Spinner } from './ui.jsx'

export default function StudyPreview({ id }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    ;(async () => {
      const [s, site] = await Promise.all([loadStudy(id, { withPeriods: true }), previewSiteContent()])
      if (!live) return
      if (!s.data) {
        setError(s.error)
        return
      }
      const m = await resolveStudyMedia(s.data)
      if (!live) return
      setState({ study: m.data, site: site.data })
      setError([s.error, m.error, site.error].filter(Boolean).join('\n') || null)
    })()
    return () => {
      live = false
    }
  }, [id, tick])

  const status = state?.study.company.status
  return (
    <>
      <Helmet>
        <title>{`Preview: ${state?.study.company.name || 'study'}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className={`sa-preview-banner sa-preview-${status || 'draft'}`} role="status">
        <span>
          <strong>Draft preview</strong> — status: {STATUS_LABELS[status] || '…'}. Shows saved data only.
        </span>
        <span className="sa-row">
          <button type="button" className="sa-btn sa-btn-sm sa-btn-default" onClick={() => setTick((t) => t + 1)}>
            Reload
          </button>
          <Link className="sa-btn sa-btn-sm sa-btn-default" to={`/admin/studies/${id}`}>
            Edit
          </Link>
        </span>
      </div>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
      {!state ? (
        error ? null : <Spinner />
      ) : (
        <div className="sa-preview-frame">
          <StudyPage
            study={state.study}
            labels={state.site.labels}
            sectionTitles={state.site.sectionTitles}
            disclaimer={state.site.disclaimer}
          />
        </div>
      )}
    </>
  )
}
