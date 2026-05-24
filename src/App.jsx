import { lazy, Suspense } from 'react'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useLocation,
} from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import DefaultSeo from './components/DefaultSeo'
import BottomNav from './components/BottomNav'
import { ToastProvider } from './components/ui/Toast'
import CookieBanner from './components/CookieBanner'
import DesktopSidebar from './components/DesktopSidebar'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import AcademyGate from './components/AcademyGate'
import FeedbackWidget from './components/FeedbackWidget'
import { AuthProvider, useAuth } from './context'
import { shouldShowAppShellNav } from './lib/appNav'

// Eager — primary routes
import Home from './pages/Home'
import Landing from './pages/Landing'

// All other routes are lazy — only downloaded when the user navigates there.
// This keeps the initial bundle small and defers Recharts (377 KB) until needed.
const About        = lazy(() => import('./pages/About'))
const Screener     = lazy(() => import('./pages/Screener'))
const Heatmap      = lazy(() => import('./pages/Heatmap'))
const StockDetail  = lazy(() => import('./pages/StockDetail'))
const SectorDetail = lazy(() => import('./pages/SectorDetail'))
const Login        = lazy(() => import('./pages/Login'))
const Register     = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword  = lazy(() => import('./pages/ResetPassword'))
const Dashboard    = lazy(() => import('./pages/Dashboard'))
const Portfolio    = lazy(() => import('./pages/Portfolio'))
const Account      = lazy(() => import('./pages/Account'))
// Legacy tap-through Learn page replaced by PineX Academy. File kept in repo
// (src/pages/Learn.jsx) but no longer imported — safe to delete later.
const Academy      = lazy(() => import('./pages/Academy'))
const ModuleLesson = lazy(() => import('./pages/ModuleLesson'))
const Certificate  = lazy(() => import('./pages/Certificate'))
const AcademyAdmin = lazy(() => import('./pages/admin/AcademyAdmin'))
const EmailAdmin   = lazy(() => import('./pages/admin/EmailAdmin'))
const Terms        = lazy(() => import('./pages/Terms'))
const Privacy      = lazy(() => import('./pages/Privacy'))

const TosAcceptance        = lazy(() => import('./pages/TosAcceptance'))
const Welcome              = lazy(() => import('./pages/Welcome'))
const InviteAccept         = lazy(() => import('./pages/InviteAccept'))

const AdminLayout          = lazy(() => import('./pages/admin/AdminLayout'))
const AdminDashboard       = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminStocks          = lazy(() => import('./pages/admin/AdminStocks'))
const AdminStockEdit       = lazy(() => import('./pages/admin/AdminStockEdit'))
const AdminDescriptions    = lazy(() => import('./pages/admin/AdminDescriptions'))
const AdminUsers           = lazy(() => import('./pages/admin/AdminUsers'))
const AdminCorporateActions = lazy(() => import('./pages/admin/AdminCorporateActions'))
const AdminCompanies       = lazy(() => import('./pages/admin/AdminCompanies'))
const AdminAnnouncements   = lazy(() => import('./pages/admin/AdminAnnouncements'))
const AdminStats           = lazy(() => import('./pages/admin/AdminStats'))
const AdminResultCalendar  = lazy(() => import('./pages/admin/AdminResultCalendar'))
const AdminTelegram        = lazy(() => import('./pages/admin/AdminTelegram'))
const WaitlistAdmin        = lazy(() => import('./pages/admin/WaitlistAdmin'))

function TosGate() {
  const { user, profile, loading } = useAuth()
  // Show ToS screen for any logged-in user whose
  // profile does not have tos_accepted === true.
  // Covers explicit false AND null/undefined (new
  // users where the column was never written).
  if (!loading && user && profile && !profile.tos_accepted) {
    return (
      <Suspense fallback={<div />}>
        <TosAcceptance user={user} onAccepted={() => window.location.reload()} />
      </Suspense>
    )
  }
  return <Outlet />
}

function HomeGate() {
  const { user, loading } = useAuth()
  if (loading) return <PageFallback />
  // Redirect logged-in users to /home so the app shell nav works correctly
  if (user) return <Navigate to="/home" replace />
  return <Landing />
}

function PageFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ width: 28, height: 28, border: '3px solid #1E2530', borderTopColor: '#38BDF8', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function RootLayout() {
  const { pathname } = useLocation()
  const showShellNav = shouldShowAppShellNav(pathname)

  return (
    <AuthProvider>
      <DefaultSeo />
      <ScrollRestoration getKey={(location) => location.pathname} />
      <div className="flex min-h-screen" style={{ maxWidth: '100vw', overflow: 'hidden' }}>
        {showShellNav ? <DesktopSidebar /> : null}
        <main className={`flex min-h-screen flex-1 flex-col${showShellNav ? ' pb-16 md:pb-0 main-content' : ''}`} style={{ overflowX: 'clip', minWidth: 0, width: 0, flex: '1 1 0%' }}>
          <Suspense fallback={<PageFallback />}>
            <TosGate />
          </Suspense>
        </main>
      </div>
      {showShellNav ? <BottomNav /> : null}
      <FeedbackWidget />
      <CookieBanner />
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomeGate /> },
      { path: '/home', element: <Home /> },
      { path: '/waitlist', element: <Landing /> },
      { path: '/learn', element: <Academy /> },
      { path: '/learn/:moduleId', element: <ModuleLesson /> },
      { path: '/certificate', element: <Certificate /> },
      // WHY: Catches any hardcoded /watchlist
      // links (legacy code, external bookmarks).
      // Canonical watchlist page lives at /dashboard.
      { path: '/watchlist', element: <Navigate to="/dashboard" replace /> },
      { path: '/about', element: <About /> },
      { path: '/terms', element: <Terms /> },
      { path: '/privacy', element: <Privacy /> },
      // Screener-level gating — 2 modules
      // (Core Foundation + Volume Rules)
      // unlocks stage list, heatmap, stock
      // detail, and sector drill-down.
      { path: '/screener', element: <AcademyGate level="screener"><Screener /></AcademyGate> },
      { path: '/heatmap', element: <AcademyGate level="screener"><Heatmap /></AcademyGate> },
      { path: '/stock/:symbol', element: <AcademyGate level="screener"><StockDetail /></AcademyGate> },
      { path: '/sector/:name', element: <AcademyGate level="screener"><SectorDetail /></AcademyGate> },
      { path: '/welcome', element: <Welcome /> },
      { path: '/invite/:code', element: <InviteAccept /> },
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/forgot-password', element: <ForgotPassword /> },
      { path: '/reset-password', element: <ResetPassword /> },
      {
        path: '/dashboard',
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: '/portfolio',
        element: (
          <ProtectedRoute>
            <Portfolio />
          </ProtectedRoute>
        ),
      },
      {
        path: '/account',
        element: (
          <ProtectedRoute>
            <Account />
          </ProtectedRoute>
        ),
      },
      {
        path: '/profile',
        element: (
          <ProtectedRoute>
            <Account />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin',
        element: (
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        ),
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: 'stocks', element: <AdminStocks /> },
          { path: 'stocks/:symbol', element: <AdminStockEdit /> },
          { path: 'descriptions', element: <AdminDescriptions /> },
          { path: 'users', element: <AdminUsers /> },
          { path: 'corporate-actions', element: <AdminCorporateActions /> },
          { path: 'companies', element: <AdminCompanies /> },
          { path: 'announcements', element: <AdminAnnouncements /> },
          { path: 'result-calendar', element: <AdminResultCalendar /> },
          { path: 'telegram', element: <AdminTelegram /> },
          { path: 'stats', element: <AdminStats /> },
          { path: 'waitlist', element: <WaitlistAdmin /> },
          { path: 'academy', element: <AcademyAdmin /> },
          { path: 'email', element: <EmailAdmin /> },
        ],
      },
    ],
  },
])

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ErrorBoundary>
  )
}
