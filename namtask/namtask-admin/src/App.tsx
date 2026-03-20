import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout        from './components/layout/Layout'
import LoginPage     from './pages/Login'
import DashboardPage from './pages/dashboard/DashboardPage'
import UsersPage     from './pages/users/UsersPage'
import KYCPage       from './pages/kyc/KYCPage'
import DisputesPage  from './pages/disputes/DisputesPage'
import TasksPage     from './pages/tasks/TasksPage'
import TransactionsPage from './pages/transactions/TransactionsPage'
import SOSPage       from './pages/sos/SOSPage'
import { Spinner }   from './components/ui'

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center">
      <Spinner className="w-8 h-8 text-teal-500" />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={
        <RequireAdmin>
          <Layout />
        </RequireAdmin>
      }>
        <Route index              element={<DashboardPage />} />
        <Route path="users"       element={<UsersPage />} />
        <Route path="tasks"       element={<TasksPage />} />
        <Route path="kyc"         element={<KYCPage />} />
        <Route path="disputes"    element={<DisputesPage />} />
        <Route path="transactions"element={<TransactionsPage />} />
        <Route path="sos"         element={<SOSPage />} />
        <Route path="*"           element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
