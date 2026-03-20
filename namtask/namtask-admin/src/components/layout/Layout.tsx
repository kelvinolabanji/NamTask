import React, { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import {
  LayoutDashboard, Users, ClipboardList, ShieldCheck,
  Scale, CreditCard, AlertTriangle, LogOut, Menu, X,
  Bell, ChevronRight,
} from 'lucide-react'
import { cn } from '../../lib/utils'

const NAV = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard',    end: true },
  { to: '/users',         icon: Users,           label: 'Users' },
  { to: '/tasks',         icon: ClipboardList,   label: 'Tasks' },
  { to: '/kyc',           icon: ShieldCheck,     label: 'KYC Approvals' },
  { to: '/disputes',      icon: Scale,           label: 'Disputes' },
  { to: '/transactions',  icon: CreditCard,      label: 'Transactions' },
  { to: '/sos',           icon: AlertTriangle,   label: 'SOS Alerts',  alert: true },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const [open, setOpen]  = useState(false)
  const loc              = useLocation()

  const pageTitle = NAV.find(n => n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to))?.label ?? 'Admin'

  return (
    <div className="flex h-screen overflow-hidden bg-navy-50">
      {/* Overlay */}
      {open && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 w-64 bg-navy-900 flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-navy-800">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none">Nam Task</p>
            <p className="text-navy-400 text-xs mt-0.5">Admin Console</p>
          </div>
          <button onClick={() => setOpen(false)} className="ml-auto lg:hidden text-navy-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group',
                isActive
                  ? 'bg-teal-600 text-white'
                  : 'text-navy-400 hover:bg-navy-800 hover:text-white'
              )}
            >
              <item.icon className="w-4.5 h-4.5 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.alert && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-navy-800">
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-navy-800">
            <div className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user?.name?.[0] ?? 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user?.name}</p>
              <p className="text-navy-400 text-xs">Administrator</p>
            </div>
            <button onClick={logout} title="Sign out" className="text-navy-500 hover:text-red-400 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-navy-200 flex items-center gap-4 px-5 shrink-0">
          <button onClick={() => setOpen(true)} className="lg:hidden text-navy-500 hover:text-navy-900">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5 text-sm text-navy-400">
            <span>Admin</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="font-medium text-navy-900">{pageTitle}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="relative p-2 text-navy-500 hover:text-navy-900 hover:bg-navy-100 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
            </button>
            <span className="text-xs text-navy-400 border border-navy-200 rounded-full px-2.5 py-1 font-mono">
              {new Date().toLocaleDateString('en-NA', { day: 'numeric', month: 'short', year: '2-digit' })}
            </span>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
