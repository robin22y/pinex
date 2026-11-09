/**
 * /admin/studies/* and /admin/media — the lazy-loaded Studies admin
 * (Phase 4a), one chunk for both. Sits under the existing AdminRoute +
 * AdminLayout; StudiesGate also requires useAuth().isAdmin.
 *
 * Sub-routes are matched here from the pathname rather than with a nested
 * <Routes>, so no extra react-router code lands in the shared (public)
 * vendor-react chunk.
 *   /admin/studies               dashboard + list
 *   /admin/studies/:id           editor (?tab=…)
 *   /admin/studies/:id/preview   draft preview
 *   /admin/studies/:id/quarterly quarterly update wizard
 *   /admin/media                 media library
 */
import { useLocation } from 'react-router-dom'
import StudiesGate from '../../../components/admin/studies/StudiesGate.jsx'
import StudiesDashboard from '../../../components/admin/studies/StudiesDashboard.jsx'
import StudyEditor from '../../../components/admin/studies/StudyEditor.jsx'
import StudyPreview from '../../../components/admin/studies/StudyPreview.jsx'
import QuarterlyWizard from '../../../components/admin/studies/QuarterlyWizard.jsx'
import MediaPage from '../../../components/admin/studies/MediaPage.jsx'
import NotFound from '../../NotFound'

function page(pathname) {
  const rest = pathname.replace(/^\/admin\/?/, '').replace(/\/+$/, '')
  if (rest === 'media') return <MediaPage />
  const m = /^studies(?:\/([^/]+)(?:\/(preview|quarterly))?)?$/.exec(rest)
  if (!m) return <NotFound />
  const id = m[1] && decodeURIComponent(m[1])
  if (!id) return <StudiesDashboard />
  if (m[2] === 'preview') return <StudyPreview key={id} id={id} />
  if (m[2] === 'quarterly') return <QuarterlyWizard key={id} id={id} />
  return <StudyEditor key={id} id={id} />
}

export default function AdminStudies() {
  const { pathname } = useLocation()
  return <StudiesGate>{page(pathname)}</StudiesGate>
}
