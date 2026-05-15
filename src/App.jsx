import {
  createBrowserRouter,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useLocation,
} from 'react-router-dom'
import BottomNav from './components/BottomNav'
import DesktopSidebar from './components/DesktopSidebar'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context'
import { shouldShowAppShellNav } from './lib/appNav'
import Home from './pages/Home'
import About from './pages/About'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Screener from './pages/Screener'
import Heatmap from './pages/Heatmap'
import StockDetail from './pages/StockDetail'
import SectorDetail from './pages/SectorDetail'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Portfolio from './pages/Portfolio'
import Account from './pages/Account'

import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminStocks from './pages/admin/AdminStocks'
import AdminStockEdit from './pages/admin/AdminStockEdit'
import AdminDescriptions from './pages/admin/AdminDescriptions'
import AdminUsers from './pages/admin/AdminUsers'
import AdminCorporateActions from './pages/admin/AdminCorporateActions'
import AdminCompanies from './pages/admin/AdminCompanies'
import AdminAnnouncements from './pages/admin/AdminAnnouncements'
import AdminStats from './pages/admin/AdminStats'
import AdminResultCalendar from './pages/admin/AdminResultCalendar'
import AdminTelegram from './pages/admin/AdminTelegram'

function RootLayout() {
  const { pathname } = useLocation()
  const showShellNav = shouldShowAppShellNav(pathname)

  return (
    <AuthProvider>
      <ScrollRestoration getKey={(location) => location.pathname} />
      <div className="flex min-h-screen" style={{ maxWidth: '100vw', overflowX: 'clip' }}>
        {showShellNav ? <DesktopSidebar /> : null}
        <main className="flex min-h-screen min-w-0 flex-1 flex-col pb-16 md:pb-0" style={{ overflowX: 'clip', minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
      {showShellNav ? <BottomNav /> : null}
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/screener', element: <Screener /> },
      { path: '/heatmap', element: <Heatmap /> },
      { path: '/stock/:symbol', element: <StockDetail /> },
      { path: '/sector/:name', element: <SectorDetail /> },
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/forgot-password', element: <ForgotPassword /> },
      { path: '/reset-password', element: <ResetPassword /> },
      { path: '/about', element: <About /> },
      { path: '/privacy', element: <Privacy /> },
      { path: '/terms', element: <Terms /> },

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
        ],
      },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
