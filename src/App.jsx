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
import DisclaimerStrip from './components/DisclaimerStrip'
import { ToastProvider } from './components/ui/Toast'
import CookieBanner from './components/CookieBanner'
import DesktopSidebar from './components/DesktopSidebar'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import AcademyGate from './components/AcademyGate'
import PublicGate from './components/PublicGate'
import { SignupPromptProvider } from './components/SignupPrompt'
import TelegramSubscribePrompt from './components/TelegramSubscribePrompt'
import FeedbackWidget from './components/FeedbackWidget'
import { AuthProvider, useAuth } from './context'
import { shouldShowAppShellNav } from './lib/appNav'

// Eager — primary routes
import Home from './pages/Home'
// Landing (the prior invite-only waitlist) is no longer rendered anywhere
// since /waitlist now redirects to /home. The file is kept under
// src/pages/Landing.jsx for reference but not imported.

// All other routes are lazy — only downloaded when the user navigates there.
// This keeps the initial bundle small and defers Recharts (377 KB) until needed.
const About        = lazy(() => import('./pages/About'))
const Screener     = lazy(() => import('./pages/Screener'))
const Lab          = lazy(() => import('./pages/Lab'))
const BreadthLab   = lazy(() => import('./pages/BreadthLab'))
const WhenToSell   = lazy(() => import('./pages/WhenToSell'))
const RiskManagement = lazy(() => import('./pages/RiskManagement'))
const SectorRotation = lazy(() => import('./pages/SectorRotation'))
const Heatmap      = lazy(() => import('./pages/Heatmap'))
const StockDetail  = lazy(() => import('./pages/StockDetail'))
const SectorDetail = lazy(() => import('./pages/SectorDetail'))
const Login        = lazy(() => import('./pages/Login'))
const Register     = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword  = lazy(() => import('./pages/ResetPassword'))
const Unsubscribe    = lazy(() => import('./pages/Unsubscribe'))
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
const Methodology  = lazy(() => import('./pages/Methodology'))
const Pricing      = lazy(() => import('./pages/Pricing'))

const TosAcceptance        = lazy(() => import('./pages/TosAcceptance'))
const Welcome              = lazy(() => import('./pages/Welcome'))
const InviteAccept         = lazy(() => import('./pages/InviteAccept'))
const Join                 = lazy(() => import('./pages/Join'))
const Rewards              = lazy(() => import('./pages/Rewards'))
const ResearchNotes        = lazy(() => import('./pages/ResearchNotes'))

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
const AdminPoints          = lazy(() => import('./pages/admin/AdminPoints'))
const AdminEngagement      = lazy(() => import('./pages/admin/AdminEngagement'))
const AdminQuestions       = lazy(() => import('./pages/admin/AdminQuestions'))
const AdminPipeline        = lazy(() => import('./pages/admin/AdminPipeline'))

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
  // PineX is now open access — anyone can browse without an invite.
  // Both anonymous and signed-in users land directly at /home which
  // renders the app shell nav. Landing (the prior waitlist gate) is
  // still reachable at /waitlist for legacy marketing links and the
  // Login / Register routes remain unchanged.
  return <Navigate to="/home" replace />
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
      {/* SignupPromptProvider wraps everything inside AuthProvider so the
          soft-gate bottom sheet can read the auth state and pop up on any
          interaction that requires an account (search, click-through,
          protected-route landing). Renders <SignupModal /> itself when
          opened — no extra mount point needed. */}
      <SignupPromptProvider>
        <DefaultSeo />
        <ScrollRestoration getKey={(location) => location.pathname} />
        <div className="flex min-h-screen" style={{ maxWidth: '100vw', overflow: 'hidden' }}>
          {showShellNav ? <DesktopSidebar /> : null}
          <main className={`flex min-h-screen flex-1 flex-col${showShellNav ? ' pb-24 md:pb-0 main-content' : ''}`} style={{ overflowX: 'clip', minWidth: 0, width: 0, flex: '1 1 0%' }}>
            <Suspense fallback={<PageFallback />}>
              <TosGate />
            </Suspense>
          </main>
        </div>
        {showShellNav ? <BottomNav /> : null}
        {showShellNav ? <DisclaimerStrip /> : null}
        <FeedbackWidget />
        <CookieBanner />
        {/* Recurring nudge for signed-in users without telegram_chat_id.
            Self-gates internally (auth + linked + session-dismiss) so
            mounting unconditionally is safe — it renders null otherwise. */}
        <TelegramSubscribePrompt />
      </SignupPromptProvider>
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomeGate /> },
      { path: '/home', element: <Home /> },
      // /lab is the SwingX screen template runner, /breadth-lab is the
      // experimental breadth dashboard. Both require an account so the
      // soft signup prompt fires for anonymous visitors.
      { path: '/lab', element: <PublicGate><Lab /></PublicGate> },
      { path: '/breadth-lab', element: <PublicGate><BreadthLab /></PublicGate> },
      // Waitlist is retired — PineX is now open access. Any legacy
      // /waitlist link (emails, social posts, bookmarks) bounces to
      // /home so users never hit a dead end.
      { path: '/waitlist', element: <Navigate to="/home" replace /> },
      { path: '/learn', element: <Academy /> },
      { path: '/learn/when-to-sell', element: <WhenToSell /> },
      { path: '/learn/risk-management', element: <RiskManagement /> },
      { path: '/learn/sector-rotation', element: <SectorRotation /> },
      { path: '/learn/:moduleId', element: <ModuleLesson /> },
      { path: '/certificate', element: <Certificate /> },
      // WHY: Catches any hardcoded /watchlist
      // links (legacy code, external bookmarks).
      // Canonical watchlist page lives at /dashboard.
      { path: '/watchlist', element: <Navigate to="/dashboard" replace /> },
      { path: '/about', element: <About /> },
      { path: '/terms', element: <Terms /> },
      { path: '/privacy', element: <Privacy /> },
      { path: '/methodology', element: <Methodology /> },
      // /pricing is intentionally a "coming soon" page — no prices are
      // displayed. Every Pro-gate / "Unlock Pro" CTA in the app links
      // here so users never hit a 404. Publish refund + cancellation
      // terms in /terms BEFORE flipping any numeric price on.
      { path: '/pricing', element: <Pricing /> },
      // Token-based one-click unsubscribe — reached from every
      // re-engagement email's footer link. Anonymous-friendly so
      // users don't need to remember a password to opt out.
      { path: '/unsubscribe', element: <Unsubscribe /> },
      // Screener-level gating — 2 modules
      // (Core Foundation + Volume Rules)
      // unlocks stage list, heatmap, stock
      // detail, and sector drill-down.
      //
      // Wrapped in <PublicGate> so anonymous users hit a signup prompt
      // instead of the full screener — they get bounced to /home and the
      // bottom-sheet pops up. Signed-in users continue through the
      // (now soft) AcademyGate as before.
      { path: '/screener', element: <PublicGate><AcademyGate level="screener"><Screener /></AcademyGate></PublicGate> },
      { path: '/heatmap', element: <PublicGate><AcademyGate level="screener"><Heatmap /></AcademyGate></PublicGate> },
      { path: '/stock/:symbol', element: <PublicGate><AcademyGate level="screener"><StockDetail /></AcademyGate></PublicGate> },
      { path: '/sector/:name', element: <PublicGate><AcademyGate level="screener"><SectorDetail /></AcademyGate></PublicGate> },
      { path: '/welcome', element: <Welcome /> },
      { path: '/invite/:code', element: <InviteAccept /> },
      // /join/:code — referral on-ramp. Captures the code into
      // localStorage and bounces straight to /register. The code
      // is consumed by downstream signup credit logic; this route
      // is purely capture + redirect (no UI).
      { path: '/join/:code', element: <Join /> },
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
        path: '/rewards',
        element: (
          <ProtectedRoute>
            <Rewards />
          </ProtectedRoute>
        ),
      },
      {
        // /research-notes — index of AI insights the user saved via the
        // Research Assistant. Gated to authenticated users; ResearchNotes
        // also self-redirects to /login if user is null (belt-and-braces).
        path: '/research-notes',
        element: (
          <ProtectedRoute>
            <ResearchNotes />
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
          // ── New admin pages — points/engagement/questions/pipeline.
          // All sit under the same AdminRoute wrapper above, so no
          // extra protection needed.
          { path: 'points',     element: <AdminPoints /> },
          { path: 'engagement', element: <AdminEngagement /> },
          { path: 'questions',  element: <AdminQuestions /> },
          { path: 'pipeline',   element: <AdminPipeline /> },
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
