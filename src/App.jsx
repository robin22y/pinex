import { Routes, Route } from 'react-router-dom'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context'
import Home from './pages/Home'
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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/stock/:symbol" element={<StockDetail />} />
        <Route path="/sector/:name" element={<SectorDetail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portfolio"
          element={
            <ProtectedRoute>
              <Portfolio />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <Account />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="stocks" element={<AdminStocks />} />
          <Route path="stocks/:symbol" element={<AdminStockEdit />} />
          <Route path="descriptions" element={<AdminDescriptions />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="corporate-actions" element={<AdminCorporateActions />} />
          <Route path="companies" element={<AdminCompanies />} />
          <Route path="announcements" element={<AdminAnnouncements />} />
          <Route path="stats" element={<AdminStats />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
