/**
 * useSafetySession
 *
 * Manages the full lifecycle of a safety check-in session for an active task:
 *  - Opens/closes sessions when task status changes to/from in_progress
 *  - Maintains a live countdown to the next check-in
 *  - Fires local notifications when a check-in is due
 *  - Emits GPS location with each check-in
 *  - Handles missed check-in warnings
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import { safetyApi, SafetySession } from '../services/api';
import { useLocation } from './useLocation';
import { getSocket } from './useSocket';

export type SessionUrgency = 'ok' | 'due_soon' | 'overdue';

interface UseSafetySessionResult {
  session:          SafetySession | null;
  secondsUntilDue:  number | null;
  urgency:          SessionUrgency;
  isLoading:        boolean;
  openSession:      (taskId: string, intervalMinutes?: number) => Promise<void>;
  closeSession:     (taskId: string) => Promise<void>;
  checkIn:          (taskId: string, notes?: string) => Promise<CheckInResult>;
  refreshSession:   (taskId: string) => Promise<void>;
}

interface CheckInResult {
  success: boolean;
  next_checkin_due: string | null;
  message: string;
}

const REMINDER_NOTIFICATION_ID = 'safety-checkin-reminder';

export const useSafetySession = (): UseSafetySessionResult => {
  const [session,    setSession]    = useState<SafetySession | null>(null);
  const [isLoading,  setIsLoading]  = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval>>();
  const { location } = useLocation(true); // watch=true for live GPS

  // ── Countdown ticker ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.next_checkin_due || session.status !== 'active') {
      setSecondsLeft(null);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }

    const update = () => {
      const diff = Math.floor(
        (new Date(session.next_checkin_due!).getTime() - Date.now()) / 1000
      );
      setSecondsLeft(diff);
    };

    update();
    countdownRef.current = setInterval(update, 1000);
    return () => clearInterval(countdownRef.current);
  }, [session?.next_checkin_due, session?.status]);

  // ── Schedule local check-in reminder ─────────────────────────────────────────
  const scheduleReminder = useCallback(async (nextDueISO: string, intervalMins: number) => {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_NOTIFICATION_ID).catch(() => {});

    const nextDue   = new Date(nextDueISO).getTime();
    const reminderAt = nextDue - 5 * 60 * 1000; // 5 min before
    const delayMs   = reminderAt - Date.now();

    if (delayMs > 0) {
      await Notifications.scheduleNotificationAsync({
        identifier: REMINDER_NOTIFICATION_ID,
        content: {
          title:  '⏰ Safety Check-In Due Soon',
          body:   'Your check-in is due in 5 minutes. Tap to check in.',
          sound:  'default',
          data:   { screen: 'Safety', type: 'checkin_reminder' },
          categoryIdentifier: 'safety',
        },
        trigger: { seconds: Math.floor(delayMs / 1000) },
      }).catch(() => {});
    }

    // Also schedule an overdue warning
    const overdueDelay = nextDue - Date.now() + 2 * 60 * 1000; // 2 min after due
    if (overdueDelay > 0) {
      await Notifications.scheduleNotificationAsync({
        identifier: REMINDER_NOTIFICATION_ID + '-overdue',
        content: {
          title:  '⚠️ Missed Safety Check-In',
          body:   'You missed your check-in. Please check in now or your partner will be alerted.',
          sound:  'default',
          data:   { screen: 'Safety', type: 'checkin_overdue' },
        },
        trigger: { seconds: Math.floor(overdueDelay / 1000) },
      }).catch(() => {});
    }
  }, []);

  // ── Open session ──────────────────────────────────────────────────────────────
  const openSession = useCallback(async (taskId: string, intervalMinutes = 30) => {
    setIsLoading(true);
    try {
      const res = await safetyApi.openSession(taskId, intervalMinutes);
      const sess = res.data.data as SafetySession;
      setSession(sess);
      if (sess.next_checkin_due) {
        await scheduleReminder(sess.next_checkin_due, intervalMinutes);
      }

      // Tell socket room session is open
      getSocket()?.emit('safety:session_update', {
        taskId,
        status: 'active',
        nextDue: sess.next_checkin_due,
      });
    } finally {
      setIsLoading(false);
    }
  }, [scheduleReminder]);

  // ── Close session ─────────────────────────────────────────────────────────────
  const closeSession = useCallback(async (taskId: string) => {
    setIsLoading(true);
    try {
      await safetyApi.closeSession(taskId);
      setSession(null);
      setSecondsLeft(null);
      await Notifications.cancelScheduledNotificationAsync(REMINDER_NOTIFICATION_ID).catch(() => {});
      await Notifications.cancelScheduledNotificationAsync(REMINDER_NOTIFICATION_ID + '-overdue').catch(() => {});
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Check in ──────────────────────────────────────────────────────────────────
  const checkIn = useCallback(async (taskId: string, notes?: string): Promise<CheckInResult> => {
    setIsLoading(true);
    try {
      const res = await safetyApi.checkIn({
        task_id:   taskId,
        latitude:  location?.latitude,
        longitude: location?.longitude,
        notes,
      });
      const { session: updatedSession, next_checkin_due } = res.data.data;

      if (updatedSession) {
        setSession(updatedSession);
        if (next_checkin_due) {
          await scheduleReminder(next_checkin_due, updatedSession.interval_minutes);
        }
      }

      // Broadcast to task room via socket
      getSocket()?.emit('safety:checkin', { taskId });

      return { success: true, next_checkin_due, message: res.data.message };
    } catch (err: any) {
      return {
        success: false,
        next_checkin_due: null,
        message: err?.response?.data?.message ?? 'Check-in failed',
      };
    } finally {
      setIsLoading(false);
    }
  }, [location, scheduleReminder]);

  // ── Refresh session from server ───────────────────────────────────────────────
  const refreshSession = useCallback(async (taskId: string) => {
    try {
      const res = await safetyApi.sessionStatus(taskId);
      if (res.data.data) {
        setSession(res.data.data);
      } else {
        setSession(null);
      }
    } catch {}
  }, []);

  // ── Compute urgency ───────────────────────────────────────────────────────────
  const urgency: SessionUrgency =
    secondsLeft === null     ? 'ok'
    : secondsLeft < 0        ? 'overdue'
    : secondsLeft < 5 * 60   ? 'due_soon'
    : 'ok';

  return { session, secondsUntilDue: secondsLeft, urgency, isLoading, openSession, closeSession, checkIn, refreshSession };
};
