/**
 * Nam Task — Auth Store (Zustand)
 *
 * Fixes applied:
 *  [4]  forceLogout() method called by API interceptor on 401
 *  [5]  login() writes SecureStore THEN updates state — socket reads from SecureStore so no race
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { router }       from 'expo-router';
import { authApi, User } from '../services/api';

const TOKEN_KEY = 'auth_token';
const USER_KEY  = 'auth_user';

interface AuthState {
  user:        User | null;
  token:       string | null;
  isLoading:   boolean;
  isHydrated:  boolean;
  /** Read persisted session from SecureStore on app boot */
  hydrate:     () => Promise<void>;
  /** Normal login from login screen */
  login:       (phone: string, password: string) => Promise<void>;
  /** Register new account */
  register:    (payload: RegisterPayload)         => Promise<void>;
  /** User-initiated logout (from profile screen) */
  logout:      () => Promise<void>;
  /** Called by API interceptor when backend returns 401 */
  forceLogout: () => void;
  /** Patch local user state after profile update */
  updateUser:  (patch: Partial<User>)            => void;
}

interface RegisterPayload {
  name:      string;
  phone:     string;
  email?:    string;
  password:  string;
  role:      'customer' | 'tasker';
}

const persistUser = async (token: string, user: User) => {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
  ]);
};

const clearPersisted = async () => {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user:       null,
  token:      null,
  isLoading:  false,
  isHydrated: false,

  // ── Boot hydration ────────────────────────────────────────────────────────────
  hydrate: async () => {
    try {
      const [token, userStr] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);

      if (token && userStr) {
        const user = JSON.parse(userStr) as User;
        set({ token, user, isHydrated: true });

        // Silently refresh user profile in background
        authApi.me()
          .then(res => {
            const fresh = res.data.data as User;
            set({ user: fresh });
            SecureStore.setItemAsync(USER_KEY, JSON.stringify(fresh)).catch(() => {});
          })
          .catch(() => {
            // If 401, the interceptor will call forceLogout()
          });
      } else {
        set({ isHydrated: true });
      }
    } catch {
      set({ isHydrated: true });
    }
  },

  // ── Login ─────────────────────────────────────────────────────────────────────
  login: async (phone, password) => {
    set({ isLoading: true });
    try {
      const res    = await authApi.login(phone, password);
      const { user, token } = res.data.data as { user: User; token: string };

      // Write to SecureStore FIRST so initSocket() can immediately read the token
      await persistUser(token, user);

      set({ user, token, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  // ── Register ──────────────────────────────────────────────────────────────────
  register: async (payload) => {
    set({ isLoading: true });
    try {
      const res    = await authApi.register(payload);
      const { user, token } = res.data.data as { user: User; token: string };

      await persistUser(token, user);
      set({ user, token, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  // ── Normal logout (user action) ───────────────────────────────────────────────
  logout: async () => {
    set({ isLoading: true });
    try {
      // Disconnect socket before clearing token
      const { disconnectSocket } = await import('../hooks/useSocket');
      disconnectSocket();

      await clearPersisted();
      set({ user: null, token: null, isLoading: false });
      router.replace('/auth/login');
    } catch {
      set({ isLoading: false });
    }
  },

  // ── Force logout (called by 401 interceptor) ──────────────────────────────────
  forceLogout: () => {
    // Sync — don't await, don't set isLoading
    clearPersisted().catch(() => {});

    import('../hooks/useSocket').then(({ disconnectSocket }) => {
      disconnectSocket();
    });

    set({ user: null, token: null });

    // Navigate after current render cycle
    setTimeout(() => {
      router.replace('/auth/login');
    }, 0);
  },

  // ── Patch local user data ─────────────────────────────────────────────────────
  updateUser: (patch) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...patch };
    set({ user: updated });
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated)).catch(() => {});
  },
}));
