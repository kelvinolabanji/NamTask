import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'

interface User { id: string; name: string; role: string; email?: string }
interface AuthCtx {
  user: User | null
  loading: boolean
  login: (phone: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser]       = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate              = useNavigate()

  useEffect(() => {
    const token = localStorage.getItem('admin_token')
    if (token) {
      authApi.me()
        .then(r => {
          const u = r.data.data
          if (u.role !== 'admin') { logout(); return }
          setUser(u)
        })
        .catch(() => logout())
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (phone: string, password: string) => {
    const res = await authApi.login(phone, password)
    const { user: u, token } = res.data.data
    if (u.role !== 'admin') throw new Error('Access denied: admin only')
    localStorage.setItem('admin_token', token)
    localStorage.setItem('admin_user', JSON.stringify(u))
    setUser(u)
    navigate('/')
  }

  const logout = () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    setUser(null)
    navigate('/login')
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
