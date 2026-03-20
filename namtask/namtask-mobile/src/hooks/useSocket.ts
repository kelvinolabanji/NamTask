/**
 * Nam Task — Socket.io Client
 *
 * Fixes applied:
 *  [3]  useTaskRoom registers handlers from a stable ref — no stale closures, no duplicate listeners
 *  [5]  initSocket waits for SecureStore (token already written by login() before called)
 *  [8]  auth callback re-reads SecureStore on reconnect so refreshed tokens are used
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket }   from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { SOCKET_URL }   from '../services/api';

// ─── Singleton socket ─────────────────────────────────────────────────────────

let globalSocket: Socket | null = null;
let connectingPromise: Promise<Socket> | null = null;

export const getSocket = (): Socket | null => globalSocket;

/**
 * Initialise (or return existing) socket connection.
 * Reads the JWT from SecureStore on every (re)connect so refreshed tokens work.
 */
export const initSocket = async (): Promise<Socket> => {
  // Return existing connected socket immediately
  if (globalSocket?.connected) return globalSocket;

  // Deduplicate concurrent initSocket() calls
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const token = await SecureStore.getItemAsync('auth_token');
    if (!token) throw new Error('AUTH_REQUIRED: no token in SecureStore');

    // Disconnect stale socket before creating a new one
    if (globalSocket) {
      globalSocket.removeAllListeners();
      globalSocket.disconnect();
      globalSocket = null;
    }

    const socket = io(SOCKET_URL, {
      // Auth object — re-read on every reconnect via function form
      auth: (cb) => {
        SecureStore.getItemAsync('auth_token').then(t => cb({ token: t ?? '' }));
      },
      transports:           ['websocket'],
      reconnection:         true,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 15,
      timeout:              10000,
    });

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => { resolve(); cleanup(); };
      const onError   = (err: Error) => { reject(err); cleanup(); };
      const cleanup   = () => { socket.off('connect', onConnect); socket.off('connect_error', onError); };

      socket.once('connect',       onConnect);
      socket.once('connect_error', onError);

      // Timeout after 10 s
      setTimeout(() => { reject(new Error('SOCKET_TIMEOUT')); cleanup(); }, 10_000);
    });

    globalSocket = socket;

    // Global error / disconnect logging
    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });
    socket.on('connect_error', (err) => {
      console.warn('[Socket] Connect error:', err.message);
    });
    socket.on('error', (err) => {
      console.warn('[Socket] Error:', err);
    });

    console.log('[Socket] Connected ✅', socket.id);
    return socket;
  })().finally(() => { connectingPromise = null; });

  return connectingPromise;
};

export const disconnectSocket = () => {
  if (globalSocket) {
    globalSocket.removeAllListeners();
    globalSocket.disconnect();
    globalSocket = null;
  }
  connectingPromise = null;
};

// ─── useConnectionState — reactive socket status ───────────────────────────────

export const useConnectionState = () => {
  const [connected, setConnected] = useState(globalSocket?.connected ?? false);

  useEffect(() => {
    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    initSocket()
      .then(socket => {
        setConnected(socket.connected);
        socket.on('connect',    onConnect);
        socket.on('disconnect', onDisconnect);
      })
      .catch(() => {});

    return () => {
      globalSocket?.off('connect',    onConnect);
      globalSocket?.off('disconnect', onDisconnect);
    };
  }, []);

  return connected;
};

// ─── useTaskRoom ──────────────────────────────────────────────────────────────
//
// Joins a task room and wires up event handlers.
// Handlers are stored in a ref so they stay up-to-date without re-triggering
// the effect — no stale closures, no duplicate `.on()` calls.

export interface TaskRoomHandlers {
  onMessage?:       (msg: unknown) => void;
  onTyping?:        (d: unknown)   => void;
  onReadAck?:       (d: unknown)   => void;
  onTracking?:      (d: unknown)   => void;
  onStatusUpdate?:  (d: unknown)   => void;
  onOfferReceived?: (d: unknown)   => void;
}

const TASK_EVENTS: Array<[keyof TaskRoomHandlers, string]> = [
  ['onMessage',      'chat:message'],
  ['onTyping',       'chat:typing'],
  ['onReadAck',      'chat:read_ack'],
  ['onTracking',     'tracking:update'],
  ['onStatusUpdate', 'task:status_updated'],
  ['onOfferReceived','task:offer_received'],
];

export const useTaskRoom = (taskId: string | null | undefined, handlers: TaskRoomHandlers) => {
  const socketRef  = useRef<Socket | null>(null);
  const handlersRef = useRef<TaskRoomHandlers>(handlers);

  // Keep handlersRef fresh on every render — no need to re-run the effect
  useEffect(() => { handlersRef.current = handlers; });

  useEffect(() => {
    if (!taskId) return;

    let mounted = true;

    initSocket().then(socket => {
      if (!mounted) return;

      socketRef.current = socket;
      socket.emit('join:task', { taskId });

      // Register stable wrappers that delegate to the latest handler ref
      for (const [key, event] of TASK_EVENTS) {
        socket.on(event, (...args: unknown[]) => {
          const handler = handlersRef.current[key] as ((...a: unknown[]) => void) | undefined;
          handler?.(...args);
        });
      }
    }).catch(err => {
      console.warn('[useTaskRoom] init failed:', err.message);
    });

    return () => {
      mounted = false;
      const s = socketRef.current;
      if (!s) return;

      s.emit('leave:task', { taskId });
      for (const [, event] of TASK_EVENTS) {
        s.removeAllListeners(event);
      }
    };
  }, [taskId]); // only re-run when taskId changes

  // ── Stable action callbacks ─────────────────────────────────────────────────

  const sendMessage = useCallback((message: string, imageUrl?: string) => {
    socketRef.current?.emit('chat:send', { taskId, message, imageUrl });
  }, [taskId]);

  const sendTyping = useCallback((isTyping: boolean) => {
    socketRef.current?.emit('chat:typing', { taskId, isTyping });
  }, [taskId]);

  const sendLocation = useCallback((latitude: number, longitude: number, accuracy?: number) => {
    socketRef.current?.emit('tracking:send', { taskId, latitude, longitude, accuracy });
  }, [taskId]);

  const markRead = useCallback(() => {
    socketRef.current?.emit('chat:read', { taskId });
  }, [taskId]);

  const triggerSOS = useCallback((latitude?: number, longitude?: number, notes?: string) => {
    socketRef.current?.emit('sos:trigger', { taskId, latitude, longitude, notes });
  }, [taskId]);

  return { sendMessage, sendTyping, sendLocation, markRead, triggerSOS };
};

// ─── useNotificationSocket ────────────────────────────────────────────────────

export const useNotificationSocket = (onNotification: (n: unknown) => void) => {
  const handlerRef = useRef(onNotification);
  useEffect(() => { handlerRef.current = onNotification; });

  useEffect(() => {
    let mounted = true;

    initSocket().then(socket => {
      if (!mounted) return;
      socket.on('notification:new', (n) => handlerRef.current(n));
      socket.on('sos:confirmed',    (d) => console.log('[SOS] confirmed', d));
    }).catch(() => {});

    return () => {
      mounted = false;
      globalSocket?.removeAllListeners('notification:new');
      globalSocket?.removeAllListeners('sos:confirmed');
    };
  }, []);
};
