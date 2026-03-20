import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { notificationsApi, Notification } from '../../src/services/api';
import { useNotificationSocket } from '../../src/hooks/useSocket';
import { LoadingSpinner, EmptyState } from '../../src/components/common';
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '../../src/constants/theme';
import { formatDistanceToNow } from 'date-fns';

// ─── Notification type config ─────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  task_offer:       { icon: 'pricetag',            color: Colors.teal,    bg: Colors.tealXLight },
  task_accepted:    { icon: 'checkmark-circle',    color: Colors.success, bg: Colors.successLight },
  task_completed:   { icon: 'trophy',              color: Colors.gold,    bg: Colors.goldXLight },
  payment:          { icon: 'cash',                color: Colors.success, bg: Colors.successLight },
  sos:              { icon: 'warning',             color: Colors.error,   bg: Colors.errorLight },
  system:           { icon: 'information-circle',  color: Colors.info,    bg: Colors.infoLight },
  chat:             { icon: 'chatbubble',          color: Colors.teal,    bg: Colors.tealXLight },
  safety_checkin:   { icon: 'shield-checkmark',    color: Colors.teal,    bg: Colors.tealXLight },
  safety_missed:    { icon: 'alert-circle',        color: Colors.warning, bg: Colors.warningLight },
  safety_session:   { icon: 'shield',              color: Colors.teal,    bg: Colors.tealXLight },
};

const getConfig = (type: string) => TYPE_CONFIG[type] ?? TYPE_CONFIG.system;

// ─── Navigate on tap ──────────────────────────────────────────────────────────
const handleTap = (n: Notification) => {
  const data = n.data as Record<string, any>;
  const taskId = data?.task_id || data?.taskId;

  if (n.type === 'sos' && taskId) { router.push(`/(task)/${taskId}` as any); return; }
  if (n.type === 'payment')        { router.push('/(tabs)/wallet');           return; }
  if (n.type === 'chat' && taskId) { router.push(`/(task)/chat/${taskId}` as any); return; }
  if (taskId)                      { router.push(`/(task)/${taskId}` as any); return; }
};

// ─── Single notification row ──────────────────────────────────────────────────
function NotifRow({ item, onRead }: { item: Notification; onRead: (id: string) => void }) {
  const cfg = getConfig(item.type);
  return (
    <TouchableOpacity
      onPress={() => { if (!item.is_read) onRead(item.id); handleTap(item); }}
      style={[s.row, !item.is_read && s.rowUnread]}
      activeOpacity={0.8}
    >
      {!item.is_read && <View style={s.unreadDot} />}
      <View style={[s.iconWrap, { backgroundColor: cfg.bg }]}>
        <Ionicons name={cfg.icon as any} size={21} color={cfg.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.title, !item.is_read && s.titleUnread]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={s.body} numberOfLines={2}>{item.message}</Text>
        <Text style={s.time}>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function NotificationsTab() {
  const qc = useQueryClient();

  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn:  () => notificationsApi.list({ limit: 50 }),
    select:   r => r.data.data as Notification[],
    refetchInterval: 60_000,
  });

  const markOneMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markOneRead(id),
    onSuccess:  ()           => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllMut = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Live socket feed
  useNotificationSocket(useCallback((n: any) => {
    qc.setQueryData(['notifications'], (old: any) => {
      const existing = old?.data?.data ?? [];
      return { ...old, data: { ...old?.data, data: [n, ...existing] } };
    });
  }, []));

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <Text style={s.headerSub}>{unreadCount} unread</Text>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity
            onPress={() => markAllMut.mutate()}
            style={s.markAllBtn}
            disabled={markAllMut.isPending}
          >
            <Ionicons name="checkmark-done" size={16} color={Colors.teal} />
            <Text style={s.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <LoadingSpinner fullScreen message="Loading…" />
      ) : notifications.length === 0 ? (
        <EmptyState icon="notifications-off-outline" title="All caught up" message="You have no notifications yet" />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={n => n.id}
          renderItem={({ item }) => (
            <NotifRow item={item} onRead={id => markOneMut.mutate(id)} />
          )}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.teal} />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={s.sep} />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.surface },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: 56, paddingBottom: Spacing.md, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle:  { fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold, color: Colors.navy },
  headerSub:    { fontSize: FontSize.sm, color: Colors.teal, fontWeight: FontWeight.semibold, marginTop: 2 },
  markAllBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.tealXLight },
  markAllText:  { fontSize: FontSize.sm, color: Colors.teal, fontWeight: FontWeight.semibold },
  row:          { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: Spacing.lg, paddingVertical: 14, backgroundColor: Colors.white },
  rowUnread:    { backgroundColor: Colors.tealXLight + '60' },
  unreadDot:    { position: 'absolute', left: 8, top: '50%', width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.teal },
  iconWrap:     { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', shrink: 0 },
  title:        { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.gray700 },
  titleUnread:  { fontWeight: FontWeight.bold, color: Colors.navy },
  body:         { fontSize: FontSize.sm, color: Colors.gray500, lineHeight: 18 },
  time:         { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2 },
  sep:          { height: 1, backgroundColor: Colors.borderLight, marginLeft: Spacing.lg + 44 + 12 },
});
