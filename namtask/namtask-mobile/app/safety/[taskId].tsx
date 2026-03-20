import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Vibration, Animated, Platform,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { safetyApi, tasksApi } from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import { useSafetySession } from '../../src/hooks/useSafetySession';
import { useLocation } from '../../src/hooks/useLocation';
import { Button, Avatar } from '../../src/components/common';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
} from '../../src/constants/theme';

// ─── Countdown ring ───────────────────────────────────────────────────────────
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const progress = Math.max(0, seconds / total);
  const color = seconds < 60 ? Colors.error : seconds < 300 ? Colors.warning : Colors.teal;

  return (
    <View style={ring.wrap}>
      <View style={[ring.bg, { borderColor: Colors.gray200 }]} />
      <View style={[ring.progress, {
        borderColor: color,
        borderTopColor: progress > 0.75 ? color : 'transparent',
        borderRightColor: progress > 0.5 ? color : 'transparent',
        borderBottomColor: progress > 0.25 ? color : 'transparent',
        borderLeftColor: color,
      }]} />
      <View style={ring.center}>
        <Text style={[ring.time, { color }]}>
          {seconds < 0 ? '-' : ''}
          {String(Math.floor(Math.abs(seconds) / 60)).padStart(2, '0')}:{String(Math.abs(seconds) % 60).padStart(2, '0')}
        </Text>
        <Text style={ring.label}>
          {seconds < 0 ? 'OVERDUE' : 'until check-in'}
        </Text>
      </View>
    </View>
  );
}

export default function SOSScreen() {
  const { taskId }    = useLocalSearchParams<{ taskId: string }>();
  const { user }      = useAuthStore();
  const { location }  = useLocation(true);
  const qc            = useQueryClient();
  const pulseAnim     = useRef(new Animated.Value(1)).current;
  const { session, secondsUntilDue, urgency, openSession, closeSession, checkIn, isLoading: sessionLoading } = useSafetySession();

  const [sosPressed, setSosPressed] = useState(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const sosTimer = useRef<ReturnType<typeof setInterval>>();

  const { data: task } = useQuery({
    queryKey: ['task', taskId],
    queryFn:  () => tasksApi.get(taskId),
    select:   r => r.data.data,
  });

  // Pull session on load
  useEffect(() => {
    if (taskId) {
      safetyApi.sessionStatus(taskId).then(r => {}).catch(() => {});
    }
  }, [taskId]);

  // Pulse when overdue
  useEffect(() => {
    if (urgency === 'overdue') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.00, duration: 700, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [urgency]);

  // SOS hold-to-send (3 second countdown)
  const startSosCountdown = () => {
    setSosPressed(true);
    setSosCountdown(3);
    Vibration.vibrate(200);
    let count = 3;
    sosTimer.current = setInterval(() => {
      count -= 1;
      setSosCountdown(count);
      Vibration.vibrate(100);
      if (count <= 0) {
        clearInterval(sosTimer.current);
        setSosPressed(false);
        setSosCountdown(null);
        sendSOS();
      }
    }, 1000);
  };

  const cancelSos = () => {
    clearInterval(sosTimer.current);
    setSosPressed(false);
    setSosCountdown(null);
  };

  const sosMut = useMutation({
    mutationFn: () => safetyApi.sos({
      task_id:   taskId,
      latitude:  location?.latitude,
      longitude: location?.longitude,
      notes:     'SOS triggered from app',
    }),
    onSuccess: () => {
      showMessage({
        message:     '🚨 SOS Alert Sent',
        description: 'Admins and your emergency contacts have been notified.',
        type:        'danger',
        duration:    5000,
      });
      Vibration.vibrate([0, 500, 200, 500]);
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'SOS failed — call emergency services', type: 'danger' }),
  });

  const sendSOS = () => sosMut.mutate();

  const handleCheckIn = async () => {
    if (!taskId) return;
    const result = await checkIn(taskId, 'Manual check-in');
    if (result.success) {
      showMessage({ message: '✅ Checked in', description: result.next_checkin_due ? `Next check-in due in ${session?.interval_minutes} min` : '', type: 'success' });
    } else {
      showMessage({ message: result.message, type: 'danger' });
    }
  };

  const handleToggleSession = () => {
    if (!taskId) return;
    if (session?.status === 'active') {
      Alert.alert('End Safety Session?', 'Your check-in reminders will stop.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Session', style: 'destructive', onPress: () => closeSession(taskId) },
      ]);
    } else {
      Alert.alert('Start Safety Session?', 'You\'ll receive check-in reminders every 30 minutes to let your partner know you\'re safe.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => openSession(taskId, 30) },
      ]);
    }
  };

  const isSessionActive = session?.status === 'active';

  return (
    <View style={s.container}>
      <Stack.Screen options={{
        headerShown: true,
        title: 'Safety',
        headerStyle: { backgroundColor: Colors.navy },
        headerTintColor: Colors.white,
        headerTitleStyle: { fontWeight: FontWeight.bold, color: Colors.white },
        headerRight: () => (
          <TouchableOpacity onPress={() => router.push('/safety/contacts' as any)} style={{ marginRight: 12 }}>
            <Ionicons name="people-outline" size={22} color={Colors.white} />
          </TouchableOpacity>
        ),
      }} />

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* Task context */}
        {task && (
          <View style={s.taskCard}>
            <Ionicons name="shield-checkmark" size={20} color={Colors.teal} />
            <View style={{ flex: 1 }}>
              <Text style={s.taskLabel}>Active task</Text>
              <Text style={s.taskTitle} numberOfLines={1}>{task.title}</Text>
            </View>
            <View style={[s.dot, { backgroundColor: isSessionActive ? Colors.success : Colors.gray300 }]} />
          </View>
        )}

        {/* Session / countdown */}
        <View style={s.sessionSection}>
          {isSessionActive && secondsUntilDue !== null ? (
            <>
              <CountdownRing seconds={secondsUntilDue} total={(session?.interval_minutes ?? 30) * 60} />
              <Button
                title="✅ Check In Now"
                onPress={handleCheckIn}
                loading={sessionLoading}
                variant={urgency === 'overdue' ? 'danger' : urgency === 'due_soon' ? 'gold' : 'outline'}
                style={{ marginTop: Spacing.lg }}
              />
            </>
          ) : (
            <View style={s.noSession}>
              <Ionicons name="shield-outline" size={56} color={Colors.gray300} />
              <Text style={s.noSessionTitle}>Safety session inactive</Text>
              <Text style={s.noSessionSub}>Start a session to enable check-in reminders</Text>
            </View>
          )}

          {task && (
            <TouchableOpacity style={s.sessionToggle} onPress={handleToggleSession}>
              <Ionicons name={isSessionActive ? 'stop-circle-outline' : 'play-circle-outline'} size={18} color={isSessionActive ? Colors.error : Colors.teal} />
              <Text style={[s.sessionToggleText, { color: isSessionActive ? Colors.error : Colors.teal }]}>
                {isSessionActive ? 'End safety session' : 'Start safety session'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* SOS panic button */}
        <View style={s.sosSection}>
          <Text style={s.sosSectionTitle}>Emergency</Text>
          <Text style={s.sosSectionSub}>Hold the button for 3 seconds to send an SOS alert to admins and your emergency contacts</Text>

          {sosCountdown !== null ? (
            <View style={s.sosCounting}>
              <Text style={s.sosCountText}>Sending in {sosCountdown}…</Text>
              <TouchableOpacity style={s.cancelSos} onPress={cancelSos}>
                <Ionicons name="close" size={18} color={Colors.white} />
                <Text style={s.cancelSosText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Animated.View style={[{ transform: [{ scale: pulseAnim }] }]}>
              <TouchableOpacity
                style={s.sosBtn}
                onLongPress={startSosCountdown}
                delayLongPress={0}
                disabled={sosMut.isPending}
                activeOpacity={0.85}
              >
                <Ionicons name="warning" size={44} color={Colors.white} />
                <Text style={s.sosBtnLabel}>SOS</Text>
                <Text style={s.sosBtnSub}>Hold 3 seconds</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {sosMut.isSuccess && (
            <View style={s.sosSent}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
              <Text style={s.sosSentText}>SOS alert sent successfully</Text>
            </View>
          )}
        </View>

        {/* Proof of arrival */}
        {task?.status === 'in_progress' && (
          <TouchableOpacity style={s.proofBtn} onPress={() => router.push(`/safety/proof/${taskId}` as any)}>
            <Ionicons name="camera-outline" size={20} color={Colors.navy} />
            <View>
              <Text style={s.proofLabel}>Proof of Arrival</Text>
              <Text style={s.proofSub}>Take a photo to confirm you've arrived</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.gray400} />
          </TouchableOpacity>
        )}

        {/* Emergency number */}
        <View style={s.emergencyCard}>
          <Ionicons name="call" size={22} color={Colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={s.emergencyLabel}>Namibia Emergency Services</Text>
            <Text style={s.emergencyNumber}>10111 (Police) · 061-211111 (Ambulance)</Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const ring = StyleSheet.create({
  wrap:     { width: 180, height: 180, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  bg:       { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 12 },
  progress: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 12, borderTopColor: Colors.teal },
  center:   { alignItems: 'center' },
  time:     { fontSize: FontSize.xxxl, fontWeight: FontWeight.black },
  label:    { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.semibold, textTransform: 'uppercase', marginTop: 2 },
});

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.surface },
  taskCard:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.md, marginBottom: Spacing.lg, ...Shadow.sm },
  taskLabel:       { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.semibold },
  taskTitle:       { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.navy },
  dot:             { width: 10, height: 10, borderRadius: 5 },

  sessionSection:  { backgroundColor: Colors.white, borderRadius: Radius.xxl, padding: Spacing.lg, marginBottom: Spacing.lg, alignItems: 'center', ...Shadow.sm },
  noSession:       { alignItems: 'center', gap: 8, paddingVertical: Spacing.xl },
  noSessionTitle:  { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray600 },
  noSessionSub:    { fontSize: FontSize.sm, color: Colors.gray400, textAlign: 'center' },
  sessionToggle:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md, paddingVertical: 8 },
  sessionToggleText:{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  sosSection:      { backgroundColor: Colors.white, borderRadius: Radius.xxl, padding: Spacing.lg, alignItems: 'center', marginBottom: Spacing.lg, ...Shadow.sm },
  sosSectionTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.navy, marginBottom: 4 },
  sosSectionSub:   { fontSize: FontSize.sm, color: Colors.gray400, textAlign: 'center', marginBottom: Spacing.lg, lineHeight: 20 },
  sosBtn:          { width: 160, height: 160, borderRadius: 80, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', ...Shadow.lg, shadowColor: Colors.error, shadowOpacity: 0.4 },
  sosBtnLabel:     { fontSize: FontSize.xxl, fontWeight: FontWeight.black, color: Colors.white, marginTop: 4 },
  sosBtnSub:       { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  sosCounting:     { alignItems: 'center', gap: Spacing.md },
  sosCountText:    { fontSize: FontSize.xxl, fontWeight: FontWeight.black, color: Colors.error },
  cancelSos:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.navy, paddingHorizontal: 20, paddingVertical: 12, borderRadius: Radius.full },
  cancelSosText:   { color: Colors.white, fontWeight: FontWeight.bold, fontSize: FontSize.base },
  sosSent:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  sosSentText:     { fontSize: FontSize.sm, color: Colors.success, fontWeight: FontWeight.semibold },

  proofBtn:        { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.md, marginBottom: Spacing.lg, ...Shadow.sm },
  proofLabel:      { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.navy },
  proofSub:        { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2 },

  emergencyCard:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.errorLight, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.error + '30' },
  emergencyLabel:  { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.error },
  emergencyNumber: { fontSize: FontSize.sm, color: Colors.gray600, marginTop: 2 },
});
