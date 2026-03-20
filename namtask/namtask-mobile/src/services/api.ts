/**
 * Nam Task — API Client
 *
 * Fixes applied:
 *  [4]  401 handler calls Zustand logout + navigates (not just clears SecureStore)
 *  [6]  AbortController cancels in-flight requests on unmount
 *  [7]  Network errors classified into readable messages
 *  [2]  URL resolved from environment with platform-aware fallback
 */

import axios, {
  AxiosInstance,
  InternalAxiosRequestConfig,
  AxiosError,
  CancelTokenSource,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ─── Base URL resolution ───────────────────────────────────────────────────────
// Priority: app.json extra.apiBaseUrl → env-specific fallback
//
// Android emulator:  localhost maps to the emulator itself, not host machine.
//                    Use 10.0.2.2 to reach host.
// iOS simulator:     localhost works fine.
// Physical device:   Must use machine's LAN IP (set in app.json / .env).

const resolveBaseUrl = (): string => {
  // Explicit config in app.json takes priority
  const configured = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
  if (configured && configured !== 'http://localhost:3000/api/v1') return configured;

  // Platform-aware fallback for development
  if (__DEV__) {
    if (Platform.OS === 'android') return 'http://10.0.2.2:3000/api/v1';
    return 'http://localhost:3000/api/v1'; // iOS simulator
  }

  return 'https://api.namtask.com/api/v1'; // production fallback
};

export const BASE_URL    = resolveBaseUrl();
export const SOCKET_URL  = BASE_URL.replace('/api/v1', '');

// ─── Axios instance ────────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'X-App-Version': Constants.expoConfig?.version ?? '1.0.0',
    'X-Platform':    Platform.OS,
  },
});

// ─── Request interceptor — attach JWT ─────────────────────────────────────────

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await SecureStore.getItemAsync('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Debug logging in dev
    if (__DEV__) {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response interceptor — 401 logout + error classification ─────────────────

let isLoggingOut = false; // prevent multiple concurrent logout calls

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    // Network error (no response at all)
    if (!error.response) {
      const networkErr = new Error(
        error.code === 'ECONNABORTED'
          ? 'Request timed out. Check your connection and try again.'
          : 'No internet connection. Please check your network.'
      );
      (networkErr as any).isNetworkError = true;
      return Promise.reject(networkErr);
    }

    const { status, data } = error.response;

    // 401 — token expired or invalid: clear session and redirect to login
    if (status === 401 && !isLoggingOut) {
      isLoggingOut = true;
      try {
        await SecureStore.deleteItemAsync('auth_token');
        await SecureStore.deleteItemAsync('auth_user');

        // Signal Zustand store (lazy import avoids circular dependency)
        const { useAuthStore } = await import('../store/authStore');
        useAuthStore.getState().forceLogout();
      } finally {
        isLoggingOut = false;
      }
    }

    // Attach backend message to error for consistent handling in UI
    const message = (data as any)?.message ?? error.message;
    (error as any).displayMessage = message;

    return Promise.reject(error);
  }
);

export default api;

// ─── Request cancellation helper ──────────────────────────────────────────────
// Usage in components:
//   const src = createCancelSource();
//   api.get('/tasks', { cancelToken: src.token });
//   return () => src.cancel();

export const createCancelSource = (): CancelTokenSource =>
  axios.CancelToken.source();

export const isCancel = (err: unknown) => axios.isCancel(err);

// ─── Typed API modules ────────────────────────────────────────────────────────

export const authApi = {
  register:       (data: RegisterPayload)               => api.post('/auth/register', data),
  login:          (phone: string, password: string)     => api.post('/auth/login', { phone, password }),
  me:             ()                                     => api.get('/auth/me'),
  changePassword: (data: ChangePasswordPayload)         => api.patch('/auth/password', data),
};

export const tasksApi = {
  list:         (params?: TaskListParams)               => api.get('/tasks', { params }),
  nearby:       (params: NearbyParams)                  => api.get('/tasks/nearby', { params }),
  get:          (id: string)                            => api.get(`/tasks/${id}`),
  create:       (data: CreateTaskPayload)               => api.post('/tasks', data),
  updateStatus: (id: string, status: TaskStatus, reason?: string) =>
                  api.patch(`/tasks/${id}/status`, { status, reason }),
  submitOffer:  (taskId: string, data: OfferPayload)    => api.post(`/tasks/${taskId}/offers`, data),
  acceptOffer:  (taskId: string, offerId: string)       => api.patch(`/tasks/${taskId}/offers/${offerId}/accept`),
  uploadImages: (taskId: string, formData: FormData)    =>
                  api.post(`/tasks/${taskId}/images`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                  }),
  review:       (taskId: string, data: ReviewPayload)   => api.post(`/tasks/${taskId}/reviews`, data),
};

export const walletApi = {
  get:          ()                                        => api.get('/wallet'),
  transactions: (params?: PaginationParams)               => api.get('/wallet/transactions', { params }),
  statement:    (params?: { month?: number; year?: number }) => api.get('/wallet/statement', { params }),
  escrow:       ()                                        => api.get('/wallet/escrow'),
  // NOTE: deposit goes through /payments/deposit/initiate (mobile money flow)
  // withdraw goes through /payments/withdraw (provider payout)
};

export const paymentsApi = {
  initiate:             (data: PaymentInitiatePayload) => api.post('/payments/deposit/initiate', data),
  verify:               (reference: string)            => api.get(`/payments/deposit/verify/${reference}`),
  history:              (params?: PaginationParams)    => api.get('/payments/history', { params }),
  summary:              ()                             => api.get('/payments/summary'),
  initiateWithdrawal:   (data: WithdrawalPayload)      => api.post('/payments/withdraw', data),
  withdrawalHistory:    (params?: PaginationParams)    => api.get('/payments/withdrawals', { params }),
  withdrawalStatus:     (reference: string)            => api.get(`/payments/withdrawals/${reference}`),
  registerPushToken:    (token: string, appVersion?: string) =>
                          api.post('/push/register', { token, platform: 'expo', app_version: appVersion }),
};

interface WithdrawalPayload {
  amount: number;
  provider: 'fnb_ewallet' | 'bank_windhoek';
  recipient_phone?: string;
  account_number?: string;
  account_name?: string;
  branch_code?: string;
  idempotency_key?: string;
}

export const safetyApi = {
  // SOS
  sos:              (data: SOSPayload)           => api.post('/safety/sos', data),
  escalateSOS:      (id: string)                 => api.patch('/safety/sos/'+id+'/escalate'),
  resolveSOS:       (id: string, notes?: string) => api.patch('/safety/sos/'+id+'/resolve', { notes }),
  // Sessions
  openSession:      (task_id: string, interval_minutes?: number) =>
                      api.post('/safety/sessions', { task_id, interval_minutes }),
  closeSession:     (task_id: string)            => api.delete('/safety/sessions/'+task_id),
  sessionStatus:    (task_id: string)            => api.get('/safety/sessions/'+task_id),
  // Check-in
  checkIn:          (data: CheckInPayload)       => api.post('/safety/checkin', data),
  proofOfArrival:   (formData: FormData)         =>
                      api.post('/safety/proof-of-arrival', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                      }),
  // Emergency contacts
  getContacts:      ()                           => api.get('/safety/contacts'),
  addContact:       (data: EmergencyContactPayload) => api.post('/safety/contacts', data),
  updateContact:    (id: string, data: EmergencyContactPayload) =>
                      api.put('/safety/contacts/'+id, data),
  deleteContact:    (id: string)                 => api.delete('/safety/contacts/'+id),
  // GPS trail
  getGPSTrail:      (task_id: string, limit?: number) =>
                      api.get('/safety/tracking/'+task_id, { params: { limit } }),
  // Logs
  logs:             (params?: SafetyLogParams)   => api.get('/safety/logs', { params }),
};

export interface EmergencyContact {
  id: string; user_id: string; name: string; phone: string;
  relationship?: string; is_primary: boolean; created_at: string;
}
export interface SafetySession {
  id: string; task_id: string; user_id: string; status: string;
  interval_minutes: number; last_checkin_at?: string; next_checkin_due?: string;
  missed_checkins: number; total_checkins: number; seconds_until_due?: number;
  urgency?: 'ok' | 'due_soon' | 'overdue';
}
export interface SafetyLog {
  id: string; user_id: string; task_id?: string; event_type: string;
  latitude?: number; longitude?: number; notes?: string;
  is_resolved: boolean; escalation_level: number; created_at: string;
  task_title?: string; user_name?: string;
}
interface EmergencyContactPayload {
  name: string; phone: string; relationship?: string; is_primary?: boolean;
}
interface SafetyLogParams { event_type?: string; task_id?: string; page?: number; limit?: number; }

export const notificationsApi = {
  list:        (params?: PaginationParams)              => api.get('/notifications', { params }),
  markAllRead: ()                                       => api.patch('/notifications/read'),
  markOneRead: (id: string)                             => api.patch(`/notifications/${id}/read`),
};

export const profileApi = {
  update:       (formData: FormData)                   =>
                  api.patch('/profile', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                  }),
  updateTasker: (data: TaskerProfilePayload)           => api.patch('/profile/tasker', data),
};

export const adminApi = {
  users:          (params?: AdminUserParams)           => api.get('/admin/users', { params }),
  toggleUser:     (id: string)                         => api.patch(`/admin/users/${id}/toggle`),
  tasks:          (params?: TaskListParams)            => api.get('/admin/tasks', { params }),
  approveTasker:  (id: string, status: string)        => api.patch(`/admin/taskers/${id}/approve`, { status }),
  disputes:       ()                                   => api.get('/admin/disputes'),
  resolveDispute: (id: string, data: ResolvePayload)  => api.patch(`/admin/disputes/${id}/resolve`, data),
  analytics:      ()                                   => api.get('/admin/analytics'),
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole   = 'customer' | 'tasker' | 'admin';
export type TaskStatus = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';
export type Provider   = 'fnb_ewallet' | 'bank_windhoek';

export interface User {
  id:                  string;
  name:                string;
  phone:               string;
  email?:              string;
  role:                UserRole;
  avatar_url?:         string | null;
  rating:              number;
  rating_count:        number;
  is_active?:          boolean;
  balance?:            number;
  escrow_balance?:     number;
  verification_status?: string;
  created_at?:         string;
}

export interface Task {
  id:               string;
  title:            string;
  description?:     string;
  category:         string;
  budget:           number;
  final_price?:     number;
  status:           TaskStatus;
  latitude?:        number;
  longitude?:       number;
  location_address?: string;
  location_city?:   string;
  scheduled_time?:  string;
  created_at?:      string;
  customer_id:      string;
  customer_name?:   string;
  customer_avatar?: string | null;
  customer_rating?: number;
  customer_phone?:  string;
  tasker_id?:       string | null;
  tasker_name?:     string | null;
  tasker_avatar?:   string | null;
  tasker_rating?:   number;
  offer_count?:     number;
  distance_km?:     number;
  images?:          { url: string; type: string }[];
  offers?:          TaskOffer[];
  is_sms_booking?:  boolean;
}

export interface TaskOffer {
  id:              string;
  task_id:         string;
  tasker_id:       string;
  tasker_name?:    string;
  tasker_rating?:  number;
  bid_price:       number;
  message?:        string;
  status:          string;
  ai_recommended?: boolean;
  created_at?:     string;
}

export interface Notification {
  id:         string;
  type:       string;
  title:      string;
  message:    string;
  data:       Record<string, unknown>;
  is_read:    boolean;
  created_at: string;
}

export interface Transaction {
  id:             string;
  type:           string;
  amount:         number;
  balance_before: number;
  balance_after:  number;
  reference?:     string;
  description?:   string;
  task_title?:    string;
  created_at:     string;
}

export interface Wallet {
  id:              string;
  user_id:         string;
  balance:         string;
  escrow_balance:  string;
  total_earned:    string;
  total_spent:     string;
  created_at:      string;
}

export interface ChatMessage {
  id:            string;
  task_id:       string;
  sender_id:     string;
  sender_name?:  string;
  sender_avatar?: string;
  message?:      string;
  image_url?:    string;
  is_read:       boolean;
  created_at:    string;
}

export interface PaymentRequest {
  id:                 string;
  reference:          string;
  provider:           Provider;
  provider_reference?: string;
  amount:             string;
  status:             string;
  checkout_url?:      string;
  instructions?:      string;
  mock?:              boolean;
  created_at:         string;
}

// Payload interfaces
interface RegisterPayload       { name: string; phone: string; email?: string; password: string; role: UserRole; }
interface ChangePasswordPayload { current_password: string; new_password: string; }
interface TaskListParams        { status?: string; category?: string; page?: number; limit?: number; }
interface NearbyParams          { latitude: number; longitude: number; radius_km?: number; category?: string; }
interface CreateTaskPayload     { title: string; description?: string; category: string; budget: number; latitude: number; longitude: number; location_address?: string; location_city?: string; scheduled_time?: string; }
interface OfferPayload          { bid_price: number; message?: string; }
interface ReviewPayload         { rating: number; comment?: string; reviewer_id: string; reviewee_id: string; }
interface PaginationParams      { page?: number; limit?: number; }
interface PaymentInitiatePayload { amount: number; provider: Provider; phone: string; }
interface SOSPayload            { task_id?: string; latitude?: number; longitude?: number; notes?: string; }
interface CheckInPayload        { task_id: string; latitude?: number; longitude?: number; }
interface TaskerProfilePayload  { bio?: string; skills?: string[]; categories?: string[]; hourly_rate?: number; service_radius_km?: number; }
interface AdminUserParams       { role?: string; search?: string; page?: number; limit?: number; }
interface ResolvePayload        { resolution: string; status?: string; admin_notes?: string; }
