/**
 * SafetyStatusBar
 *
 * A persistent safety widget shown at the top of the screen when a task
 * is in progress. Shows:
 *  - Session status (active / paused / overdue)
 *  - Countdown timer to next check-in
 *  - One-tap check-in button
 *  - SOS quick-trigger button
 *
 * Usage:
 *   <SafetyStatusBar taskId="..." onSOS={() => router.push('/safety')} />
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafetySession } from '../../hooks/useSafetySession';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '../../constants/theme';

interface Props {
  taskId:  string;
  visible: boolean;
}

const formatTime = (secs: number | null): string => {
  if (secs === null) return '—';
  const abs = Math.abs(secs);
  const m   = Math.floor(abs / 60);
  const s   = abs % 60;
  const prefix = secs < 0 ? '-' : '';
  return `${prefix}${m}:${String(s).padStart(2, '0')}`;
};

export const SafetyStatusBar: React.FC<Props> = ({ taskId, visible }) => {
  const { session, secondsUntilDue, urgency, checkIn, isLoading } = useSafetySession();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Auto-fetch session on mount
  useEffect(() => {
    if (!taskId || !visible) return;
    import('../../services/api').then(({ safetyApi }) => {
      safetyApi.sessionStatus(taskId).then(r => {
        // session state handled by hook
      }).catch(() => {});
    });
  }, [taskId, visible]);

  // Pulse animation for overdue
  useEffect(() => {
    if (urgency === 'overdue') {
      Vibration.vibrate([0, 200, 100, 200]);
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [urgency]);

  // Shake for due_soon
  useEffect(() => {
    if (urgency === 'due_soon') {
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 6,  duration: 80, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -6, duration: 80, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 4,  duration: 80, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0,  duration: 80, useNativeDriver: true }),
      ]).start();
    }
  }, [urgency === 'due_soon' && Math.floor((secondsUntilDue ?? 0) / 30)]); // shake every 30s when due_soon

  if (!visible || !session || session.status !== 'active') return null;

  const BG_COLOR = {
    ok:       Colors.teal,
    due_soon: Colors.gold,
    overdue:  Colors.error,
  }[urgency];

  return (
    <Animated.View
      style={[
        styles.bar,
        { backgroundColor: BG_COLOR, opacity: urgency === 'overdue' ? pulseAnim : 1 },
        { transform: [{ translateX: shakeAnim }] },
      ]}
    >
      {/* Left: status + timer */}
      <TouchableOpacity
        style={styles.left}
        onPress={() => router.push(`/safety/${taskId}` as any)}
        activeOpacity={0.8}
      >
        <Ionicons
          name={urgency === 'overdue' ? 'warning' : 'shield-checkmark'}
          size={16}
          color={Colors.white}
        />
        <View style={{ marginLeft: 7 }}>
          <Text style={styles.label}>
            {urgency === 'overdue' ? 'CHECK-IN OVERDUE' : urgency === 'due_soon' ? 'CHECK-IN DUE SOON' : 'SAFETY ACTIVE'}
          </Text>
          <Text style={styles.timer}>
            {urgency === 'overdue'
              ? `${formatTime(secondsUntilDue)} overdue`
              : `Next check-in: ${formatTime(secondsUntilDue)}`
            }
          </Text>
        </View>
      </TouchableOpacity>

      {/* Right: check-in button + SOS */}
      <View style={styles.right}>
        <TouchableOpacity
          style={styles.checkinBtn}
          onPress={() => checkIn(taskId)}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading
            ? <Ionicons name="hourglass" size={14} color={BG_COLOR} />
            : <Text style={[styles.checkinText, { color: BG_COLOR }]}>Check In</Text>
          }
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sosBtn}
          onPress={() => router.push(`/safety/${taskId}` as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.sosText}>SOS</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  bar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 9, borderRadius: 0 },
  left:        { flexDirection: 'row', alignItems: 'center', flex: 1 },
  label:       { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white, letterSpacing: 0.5 },
  timer:       { fontSize: 12, fontWeight: FontWeight.extrabold, color: Colors.white, marginTop: 1 },
  right:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkinBtn:  { backgroundColor: Colors.white, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  checkinText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  sosBtn:      { backgroundColor: Colors.error, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.white },
  sosText:     { fontSize: FontSize.xs, fontWeight: FontWeight.black, color: Colors.white, letterSpacing: 0.5 },
});
