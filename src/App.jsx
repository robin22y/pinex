import { lazy, Suspense } from 'react'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useLocation,
} from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import ErrorBoundary from './components/ErrorBoundary'
import DefaultSeo from './components/DefaultSeo'
import BottomNav from './components/BottomNav'
// Mobile-only points chip — fixed top-right, taps to /rewards.
// Self-gates to null on desktop / signed-out users / missing
// balance, so mounting alongside BottomNav (same showShellNav
// gate, same in-shell pages) is safe.
import MobilePointsBar from './components/MobilePointsBar'
import DisclaimerStrip from './components/DisclaimerStrip'
import CookieBanner from './components/CookieBanner'
import DesktopSidebar from './components/DesktopSidebar'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import Footer from './components/layout/Footer'
import AcademyGate from './components/AcademyGate'
import PublicGate from './components/PublicGate'
import { SignupPromptProvider } from './components/SignupPrompt'
import TelegramSubscribePrompt from './components/TelegramSubscribePrompt'
import FeedbackWidget from './components/FeedbackWidget'
import { AuthProvider, useAuth } from './context'

// ── AdvancedGate ───────────────────────────────────────────────
// Wraps the /breadth-lab route so anonymous + locked users get
// bounced back to /home with a ?advanced=locked marker the home
// page can use to show a tasteful 'this unlocks as you explore
// more' line. Admins + superadmins bypass the gate.
function AdvancedGate({ children }) {
  const { user, profile, loading } = useAuth()
  if (loading) return null
  const role = String(profile?.role || '').toLowerCase()
  const isAdminish = role === 'admin' || role === 'superadmin'
  const unlocked = profile?.advanced_unlocked === true
  if (!user || (!unlocked && !isAdminish)) {
    return <Navigate to="/home?advanced=locked" replace />
  }
  return children
}
import { shouldShowAppShellNav } from './lib/appNav'

// Eager — primary routes
import Home from './pages/Home'
import Pulse from './pages/Pulse'
// Landing (the prior invite-only waitlist) is no longer rendered anywhere
// since /waitlist now redirects to /home. The file is kept under
// src/pages/Landing.jsx for reference but not imported.

// All other routes are lazy — only downloaded when the user navigates there.
// This keeps the initial bundle small and defers Recharts (377 KB) until needed.
const About        = lazy(() => import('./pages/About'))
const Disclaimer   = lazy(() => import('./pages/Disclaimer'))
const CompanyStudy   = lazy(() => import('./pages/CompanyStudy'))
const CompanyStudies = lazy(() => import('./pages/CompanyStudies'))
const Screener     = lazy(() => import('./pages/Screener'))
const Lab          = lazy(() => import('./pages/Lab'))
const Explore      = lazy(() => import('./pages/Explore'))
const Help         = lazy(() => import('./pages/Help'))
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
const AuthCallback   = lazy(() => import('./pages/AuthCallback'))
const ResetPassword  = lazy(() => import('./pages/ResetPassword'))
const Unsubscribe    = lazy(() => import('./pages/Unsubscribe'))
const Dashboard    = lazy(() => import('./pages/Dashboard'))
const Portfolio    = lazy(() => import('./pages/Portfolio'))
const MyCalls      = lazy(() => import('./pages/MyCalls'))
const Account      = lazy(() => import('./pages/Account'))
// Legacy tap-through Learn page replaced by PineX Academy. File kept in repo
// (src/pages/Learn.jsx) but no longer imported — safe to delete later.
const Academy      = lazy(() => import('./pages/Academy'))
const ModuleLesson = lazy(() => import('./pages/ModuleLesson'))
const Certificate  = lazy(() => import('./pages/Certificate'))
const AcademyAdmin = lazy(() => import('./pages/admin/AcademyAdmin'))
const AdminFlags   = lazy(() => import('./pages/admin/AdminFlags'))
const EmailAdmin   = lazy(() => import('./pages/admin/EmailAdmin'))
const SendEmail    = lazy(() => import('./pages/admin/SendEmail'))
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

// IQjet — private intelligence layer behind a per-user access code.
// Standalone product surface (own gate, own header, own viewport).
// Not in the public nav; access via direct URL only.
const IQjet                = lazy(() => import('./pages/IQjet'))
// IQjet Desk — admin-only morning brief generator. Hard-coded to
// robin22y@gmail.com inside the page; any other user is redirected
// to /dashboard. URL is intentionally not surfaced in nav.
const IQjetDesk            = lazy(() => import('./pages/IQjetDesk'))

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
  // NAVIGATION-FIX REVERT (was: AnimatePresence + motion.div around
  // Outlet for a 0.15-s fade on route change). The pattern breaks
  // navigation on createBrowserRouter's data router: <Outlet /> is
  // a function component whose output is computed at render time
  // from the live router context, so when AnimatePresence snapshots
  // the outgoing motion.div it captures the JSX <Outlet/> reference
  // — not the rendered tree. On the next render Outlet re-reads the
  // (now-changed) router context and the "exiting" page paints the
  // INCOMING route instead, masking real navigation. Reported
  // symptom: clicking a stock from /sector/:name didn't land on
  // /stock/:symbol.
  //
  // Page-transition polish can return via a useOutlet()-captured
  // pattern in a focused follow-up; bare <Outlet /> for now.
  return <Outlet />
}

function HomeGate() {
  // Auth-aware landing:
  //   - Signed-out visitors land on /pulse (the public daily market
  //     snapshot — the public face of PineX).
  //   - Signed-in users land on /home (their dashboard) so the
  //     existing in-app flow isn't disrupted.
  // While auth is still resolving, render nothing so we don't
  // briefly flash the wrong destination.
  const { user, loading } = useAuth()
  if (loading) return null
  return <Navigate to={user ? '/home' : '/pulse'} replace />
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
  // /pulse (latest) and /pulse/:date (historical archive) are fully
  // public landing surfaces — they bring their own header / footer
  // and shouldn't carry the in-app shell nav. Suppression is
  // co-located with the route definitions below rather than in
  // lib/appNav.js so the rule stays next to the routes that need it.
  const isPulseRoute = pathname === '/pulse' || pathname.startsWith('/pulse/')
  // /iqjet is a private product surface: own gate, own header, no
  // app chrome. Suppress the floating FeedbackWidget (💬 bubble) and
  // the TelegramSubscribePrompt nudge dialog so the page reads as
  // its own self-contained surface. CookieBanner stays — /iqjet uses
  // localStorage for the access code, so consent is still relevant.
  const isIqjetRoute = pathname === '/iqjet'
  const showShellNav = !isPulseRoute && shouldShowAppShellNav(pathname)
  // BottomNav also runs on /pulse so mobile visitors get the same
  // tab bar as the rest of the app. The component itself is
  // md:hidden — desktop /pulse stays uncluttered for the public
  // landing-page aesthetic; only mobile sees it.
  const showBottomNav = showShellNav || isPulseRoute

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
          <main
            className={`flex min-h-screen flex-1 flex-col${showShellNav ? ' main-content' : ''}`}
            style={{
              overflowX: 'clip',
              minWidth: 0,
              width: 0,
              flex: '1 1 0%',
              // BottomNav is fixed at 60 px + the safe-area inset, so
              // any main that mounts BottomNav needs that much bottom
              // padding to keep the last row of content above the
              // bar. Inline rather than the Tailwind `pb-24 md:pb-0`
              // pair the original code used — the content scanner
              // wasn't emitting that utility, so the class was silent.
              // Desktop is unaffected: BottomNav self-hides at md+
              // via `md:hidden`; the harmless 60 px of empty bottom
              // padding has no visual cost on /pulse, and the rest of
              // the app shell already sat above the bar.
              paddingBottom: showBottomNav
                ? 'calc(60px + env(safe-area-inset-bottom))'
                : undefined,
            }}
          >
            <Suspense fallback={<PageFallback />}>
              <TosGate />
            </Suspense>
            {/* Persistent product disclaimer — sits at the bottom of
                every in-shell page. Suppressed on /pulse (own
                footer) and /iqjet (own footer) for the same reason
                those routes opt out of the shell nav. */}
            {!isPulseRoute && !isIqjetRoute && <Footer />}
          </main>
        </div>
        {showBottomNav ? <BottomNav /> : null}
        {showShellNav ? <MobilePointsBar /> : null}
        {showShellNav ? <DisclaimerStrip /> : null}
        {!isIqjetRoute && <FeedbackWidget />}
        <CookieBanner />
        {/* Recurring nudge for signed-in users without telegram_chat_id.
            Self-gates internally (auth + linked + session-dismiss) so
            mounting unconditionally is safe — it renders null otherwise.
            Hard-suppressed on /pulse so the public landing surface stays
            friction-free for every visitor (signed in or not). */}
        {!isPulseRoute && !isIqjetRoute && <TelegramSubscribePrompt />}
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
      // /pulse — public daily market-pulse landing page. No auth gate,
      // no app shell nav (RootLayout suppresses it for this path).
      // The :date variant powers the historical archive — ~1,600
      // indexable pages back to 2020-01-28. Both share the same
      // component; Pulse reads useParams() to know which date to fetch.
      { path: '/pulse', element: <Pulse /> },
      { path: '/pulse/:date', element: <Pulse /> },
      // IQjet — private intelligence layer. Self-gated via
      // localStorage code + verify_iqjet_access RPC. Not behind
      // PublicGate or AcademyGate because IQjet has its own access
      // model entirely separate from the academy + signup flow.
      // noindex/nofollow is set in the page's Helmet.
      { path: '/iqjet', element: <IQjet /> },
      // /iqjet-desk — admin-only morning brief generator. Hard-coded
      // to robin22y@gmail.com inside the page; everyone else is
      // silently redirected to /dashboard. Not surfaced in nav —
      // secret URL only.
      { path: '/iqjet-desk', element: <IQjetDesk /> },
      // /lab is the SwingX screen template runner, /breadth-lab is the
      // experimental breadth dashboard. Both require an account so the
      // soft signup prompt fires for anonymous visitors.
      { path: '/lab', element: <PublicGate><Lab /></PublicGate> },
      // Explore — neutral landing for the 10 pre-built explorations.
      // Same PublicGate as Lab; cards link to /lab?template=… so the
      // existing template loader picks them up without further wiring.
      { path: '/explore', element: <PublicGate><Explore /></PublicGate> },
      // /help — comprehensive how-to-read guide. Public surface, no
      // gate. Sits next to /about and /methodology in spirit but
      // covers the four PineX read primitives + SwingX.
      { path: '/help', element: <Help /> },
      { path: '/breadth-lab', element: <PublicGate><AdvancedGate><BreadthLab /></AdvancedGate></PublicGate> },
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
      { path: '/disclaimer', element: <Disclaimer /> },
      // Company Studies (Robin's long-form podcast companion series).
      // /learn/companies is the public index, /learn/company/:symbol
      // is the per-company page. RLS on company_studies gates the
      // visible rows to is_published=true for everyone except the
      // admin email — no router-level gate needed.
      { path: '/learn/companies',         element: <CompanyStudies /> },
      { path: '/learn/company/:symbol',   element: <CompanyStudy   /> },
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
      // OAuth + email-confirm landing. Supabase Dashboard must list this
      // path under URL Configuration → Redirect URLs. The page itself
      // just waits for getSession() to resolve and forwards to /home
      // (or /login?error=auth_failed on miss). See src/lib/auth.js for
      // the redirectTo wiring on signInWithGoogle / signUpWithEmail.
      { path: '/auth/callback', element: <AuthCallback /> },
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
        path: '/my-calls',
        element: (
          <ProtectedRoute>
            <MyCalls />
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
          { path: 'flags',   element: <AdminFlags /> },
          // /admin/email is the bulk-send composer (SendEmail). The
          // template editor that used to live at this path moved to
          // /admin/email-templates per the email-facility restore spec.
          { path: 'email',           element: <SendEmail /> },
          { path: 'email-templates', element: <EmailAdmin /> },
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
      <RouterProvider router={router} />
      <Toaster
        position="bottom-center"
        gutter={8}
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--bg-card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontSize: '13px',
            fontFamily: 'inherit',
          },
          success: { iconTheme: { primary: '#16A34A', secondary: 'transparent' } },
          error: { iconTheme: { primary: '#DC2626', secondary: 'transparent' } },
        }}
      />
    </ErrorBoundary>
  )
}
