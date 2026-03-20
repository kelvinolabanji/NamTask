/**
 * Nam Task — Root Layout
 *
 * Fixes applied:
 *  [5]  socket init deferred 100 ms after login state lands so SecureStore write completes
 *  [4]  forceLogout in store handles 401 navigation — layout just watches state
 */

import React, { useEffect, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar }    from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FlashMessage from 'react-native-flash-message';

import { useAuthStore }         from '../src/store/authStore';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { initSocket, disconnectSocket } from '../src/hooks/useSocket';
import { Colors } from '../src/constants/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries:   { retry: 2, staleTime: 30_000, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

const PUBLIC_SEGMENTS = ['auth', 'index'];

function AuthGuard() {
  const { user, isHydrated } = useAuthStore();
  const segments = useSegments();

  useEffect(() => {
    if (!isHydrated) return;

    const inPublic = PUBLIC_SEGMENTS.some(s => segments.includes(s as never));
    const inTabs   = segments.includes('(tabs)' as never);

    if (!user && !inPublic) {
      router.replace('/auth/login');
    } else if (user && (inPublic || segments.length === 0)) {
      router.replace('/(tabs)');
    }
  }, [user, isHydrated, segments]);

  return null;
}

// ─── Socket lifecycle ─────────────────────────────────────────────────────────

function SocketManager() {
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      disconnectSocket();
      return;
    }

    // Small delay ensures SecureStore.setItemAsync has flushed after login()
    const timer = setTimeout(() => {
      initSocket().catch(err => {
        console.warn('[SocketManager] init failed:', err.message);
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [user?.id]);

  return null;
}

// ─── Splash / loading screen ─────────────────────────────────────────────────

function SplashScreen() {
  return (
    <View style={styles.splash}>
      <View style={styles.splashLogo}>
        <ActivityIndicator size="large" color={Colors.teal} />
      </View>
    </View>
  );
}

// ─── App inner ────────────────────────────────────────────────────────────────

function AppInner() {
  const { isHydrated, hydrate } = useAuthStore();
  usePushNotifications();

  useEffect(() => { hydrate(); }, []);

  if (!isHydrated) return <SplashScreen />;

  return (
    <>
      <AuthGuard />
      <SocketManager />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" />

        {/* Auth */}
        <Stack.Screen name="auth/login"    options={{ animation: 'fade' }} />
        <Stack.Screen name="auth/register" options={{ animation: 'slide_from_bottom' }} />

        {/* Main tabs */}
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />

        {/* Task screens */}
        <Stack.Screen
          name="(task)/[id]"
          options={{
            headerShown:      true,
            title:            'Task Details',
            headerStyle:      { backgroundColor: Colors.navy },
            headerTintColor:  Colors.white,
            headerTitleStyle: { fontWeight: '700' as const, color: Colors.white },
            headerBackTitle:  'Back',
          }}
        />
        <Stack.Screen
          name="(task)/create"
          options={{
            headerShown:      true,
            title:            'Post a Task',
            presentation:     'modal',
            headerStyle:      { backgroundColor: Colors.navy },
            headerTintColor:  Colors.white,
            headerTitleStyle: { fontWeight: '700' as const, color: Colors.white },
          }}
        />
        <Stack.Screen
          name="(task)/chat/[taskId]"
          options={{
            headerShown:      true,
            headerStyle:      { backgroundColor: Colors.navy },
            headerTintColor:  Colors.white,
            headerTitleStyle: { fontWeight: '700' as const, color: Colors.white },
          }}
        />
      </Stack>

      <StatusBar style="light" />
      <FlashMessage position="top" floating statusBarHeight={52} />
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AppInner />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex:            1,
    backgroundColor: Colors.navy,
    alignItems:      'center',
    justifyContent:  'center',
  },
  splashLogo: {
    width:           80,
    height:          80,
    borderRadius:    40,
    backgroundColor: Colors.tealGlass,
    alignItems:      'center',
    justifyContent:  'center',
  },
});
