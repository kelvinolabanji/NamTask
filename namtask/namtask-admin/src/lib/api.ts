import axios from 'axios'

export const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('admin_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (phone: string, password: string) =>
    api.post('/auth/login', { phone, password }),
  me: () => api.get('/auth/me'),
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminApi = {
  analytics:        (period = 30)         => api.get(`/admin/analytics?period=${period}`),
  users:            (p: Record<string,unknown> = {}) => api.get('/admin/users',        { params: p }),
  user:             (id: string)           => api.get(`/admin/users/${id}`),
  toggleUser:       (id: string)           => api.patch(`/admin/users/${id}/toggle`),

  kycList:          (p: Record<string,unknown> = {}) => api.get('/admin/kyc',          { params: p }),
  kycDetail:        (id: string)           => api.get(`/admin/kyc/${id}`),
  kycDecision:      (id: string, status: string, reason?: string, admin_notes?: string) =>
                      api.patch(`/admin/kyc/${id}`, { status, reason, admin_notes }),

  tasks:            (p: Record<string,unknown> = {}) => api.get('/admin/tasks',        { params: p }),

  disputes:         (p: Record<string,unknown> = {}) => api.get('/admin/disputes',     { params: p }),
  dispute:          (id: string)           => api.get(`/admin/disputes/${id}`),
  resolveDispute:   (id: string, data: Record<string,unknown>) =>
                      api.patch(`/admin/disputes/${id}/resolve`, data),

  transactions:     (p: Record<string,unknown> = {}) => api.get('/admin/transactions', { params: p }),

  sosList:          (p: Record<string,unknown> = {}) => api.get('/admin/sos',          { params: p }),
  resolveSOSAlert:  (id: string)           => api.patch(`/admin/sos/${id}/resolve`),

  releaseEscrow:    (taskId: string, tasker_id: string) =>
                      api.post(`/payments/escrow/${taskId}/release`, { tasker_id }),
  refundEscrow:     (taskId: string, reason: string) =>
                      api.post(`/payments/escrow/${taskId}/refund`, { reason }),
}
