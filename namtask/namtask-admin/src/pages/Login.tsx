import React, { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ShieldCheck, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const [phone, setPhone]       = useState('+264811000000')
  const [password, setPassword] = useState('Admin@123456')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try { await login(phone, password) }
    catch (err: any) { setError(err?.response?.data?.message ?? err.message ?? 'Login failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-600 mb-4 shadow-lg shadow-teal-900/50">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Nam Task Admin</h1>
          <p className="text-navy-400 text-sm mt-1">Sign in to manage the platform</p>
        </div>

        {/* Card */}
        <div className="bg-navy-800 rounded-2xl border border-navy-700 p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-navy-300 mb-1.5">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+264 81 000 0000"
                className="w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2.5 text-white placeholder-navy-500 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-300 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2.5 text-white placeholder-navy-500 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 bg-red-950 border border-red-900 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-navy-700">
            <p className="text-xs text-navy-500 text-center">Admin access only · All actions are logged</p>
          </div>
        </div>
      </div>
    </div>
  )
}
