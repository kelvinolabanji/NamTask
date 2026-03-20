import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  RefreshControl, TouchableOpacity, TextInput, Animated,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { tasksApi, Task } from '../../src/services/api';
import { TaskCard } from '../../src/components/task/TaskCard';
import { LoadingSpinner, EmptyState, StatCard, Button, Badge } from '../../src/components/common';
import { useLocation } from '../../src/hooks/useLocation';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
  TASK_CATEGORIES, STATUS_CONFIG,
} from '../../src/constants/theme';

const GREETING = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function HomeTab() {
  const { user }           = useAuthStore();
  const { location }       = useLocation();
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const isTasker = user?.role === 'tasker';

  // ── My tasks (customer) ───────────────────────────────────────────────────
  const { data: myTasks = [], isLoading: loadingMine, refetch: refetchMine } = useQuery({
    queryKey: ['tasks', 'mine'],
    queryFn:  () => tasksApi.list({ limit: 30 }),
    enabled:  !isTasker,
    select:   r => r.data.data as Task[],
  });

  // ── Nearby tasks (tasker) ─────────────────────────────────────────────────
  const { data: nearbyTasks = [], isLoading: loadingNearby, refetch: refetchNearby } = useQuery({
    queryKey: ['tasks', 'nearby', location?.latitude, activeCat],
    queryFn:  () => tasksApi.nearby({
      latitude:  location!.latitude,
      longitude: location!.longitude,
      radius_km: 25,
      category:  activeCat ?? undefined,
    }),
    enabled:  isTasker && !!location,
    select:   r => r.data.data as Task[],
  });

  const rawList = isTasker ? nearbyTasks : myTasks;
  const loading = isTasker ? loadingNearby : loadingMine;
  const refetch = isTasker ? refetchNearby : refetchMine;

  const filtered = rawList.filter(t => {
    const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !activeStatus || t.status === activeStatus;
    return matchSearch && matchStatus;
  });

  // ── Customer stats ────────────────────────────────────────────────────────
  const stats = {
    active:    myTasks.filter(t => ['pending','accepted','in_progress'].includes(t.status)).length,
    completed: myTasks.filter(t => t.status === 'completed').length,
    total:     myTasks.length,
  };

  const statusFilters = ['pending', 'accepted', 'in_progress', 'completed'];

  return (
    <View style={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{GREETING()},</Text>
          <Text style={styles.name} numberOfLines={1}>
            {user?.name?.split(' ')[0]} {isTasker ? '🔧' : '👋'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {!isTasker && (
            <TouchableOpacity
              style={styles.postBtn}
              onPress={() => router.push('/(task)/create')}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color={Colors.navy} />
              <Text style={styles.postBtnText}>Post Task</Text>
            </TouchableOpacity>
          )}
          {isTasker && location && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          )}
          <TouchableOpacity style={styles.notifBtn} onPress={() => router.push('/(tabs)/notifications')}>
            <Ionicons name="notifications-outline" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Customer stats bar ───────────────────────────────────────────── */}
      {!isTasker && (
        <View style={styles.statsRow}>
          <StatCard label="Active" value={stats.active} icon="flash-outline" color={Colors.teal} style={{ flex: 1 }} />
          <StatCard label="Completed" value={stats.completed} icon="checkmark-circle-outline" color={Colors.success} style={{ flex: 1 }} />
          <StatCard label="Total" value={stats.total} icon="grid-outline" color={Colors.gold} style={{ flex: 1 }} />
        </View>
      )}

      {/* ── Search bar ───────────────────────────────────────────────────── */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={17} color={Colors.gray400} />
          <TextInput
            style={styles.searchInput}
            placeholder={isTasker ? 'Search tasks near you…' : 'Search your tasks…'}
            placeholderTextColor={Colors.gray300}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={17} color={Colors.gray400} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Category filter (tasker) ─────────────────────────────────────── */}
      {isTasker && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          <TouchableOpacity
            onPress={() => setActiveCat(null)}
            style={[styles.filterChip, !activeCat && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, !activeCat && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {TASK_CATEGORIES.map(c => (
            <TouchableOpacity
              key={c.id}
              onPress={() => setActiveCat(activeCat === c.id ? null : c.id)}
              style={[styles.filterChip, activeCat === c.id && { backgroundColor: c.color, borderColor: c.color }]}
            >
              <Ionicons name={c.icon as any} size={13} color={activeCat === c.id ? Colors.white : Colors.gray500} />
              <Text style={[styles.filterChipText, activeCat === c.id && styles.filterChipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Status filter (customer) ─────────────────────────────────────── */}
      {!isTasker && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          <TouchableOpacity
            onPress={() => setActiveStatus(null)}
            style={[styles.filterChip, !activeStatus && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, !activeStatus && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {statusFilters.map(s => {
            const cfg = STATUS_CONFIG[s];
            const active = activeStatus === s;
            return (
              <TouchableOpacity
                key={s}
                onPress={() => setActiveStatus(active ? null : s)}
                style={[styles.filterChip, active && { backgroundColor: cfg.color, borderColor: cfg.color }]}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? Colors.white : cfg.color }} />
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{cfg.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* ── Task list ────────────────────────────────────────────────────── */}
      {loading && !rawList.length ? (
        <LoadingSpinner fullScreen message={isTasker ? 'Finding tasks near you…' : 'Loading your tasks…'} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={t => t.id}
          renderItem={({ item }) => <TaskCard task={item} variant={isTasker ? 'feed' : 'mine'} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.teal} colors={[Colors.teal]} />
          }
          ListHeaderComponent={filtered.length > 0 ? (
            <Text style={styles.listCount}>{filtered.length} task{filtered.length !== 1 ? 's' : ''}</Text>
          ) : null}
          ListEmptyComponent={
            <EmptyState
              icon={isTasker ? 'search-outline' : 'clipboard-outline'}
              title={isTasker ? 'No tasks nearby' : 'No tasks yet'}
              message={
                isTasker
                  ? 'Try expanding radius or clearing category filter.'
                  : 'Post your first task and get help from verified taskers!'
              }
              action={!isTasker ? { label: 'Post a Task', onPress: () => router.push('/(task)/create') } : undefined}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: Colors.surface },

  header:             { backgroundColor: Colors.navy, paddingTop: 56, paddingBottom: 18, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  greeting:           { fontSize: FontSize.sm, color: Colors.gray400 },
  name:               { fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold, color: Colors.white },
  headerActions:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postBtn:            { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.gold, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Radius.full, ...Shadow.gold },
  postBtnText:        { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.navy },
  notifBtn:           { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.navyLight, alignItems: 'center', justifyContent: 'center' },
  liveBadge:          { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.tealGlass, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.teal + '40' },
  liveDot:            { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  liveText:           { fontSize: FontSize.xs, color: Colors.tealLight, fontWeight: FontWeight.bold },

  statsRow:           { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.navyMid },

  searchRow:          { paddingHorizontal: Spacing.lg, paddingVertical: 10, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  searchBox:          { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.gray50, borderRadius: Radius.full, paddingHorizontal: Spacing.md, gap: 8, height: 42, borderWidth: 1, borderColor: Colors.border },
  searchInput:        { flex: 1, fontSize: FontSize.sm, color: Colors.gray900 },

  filterScroll:       { flexGrow: 0, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterContent:      { paddingHorizontal: Spacing.lg, paddingVertical: 10, gap: 7, flexDirection: 'row' },
  filterChip:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.gray100, borderWidth: 1, borderColor: Colors.border },
  filterChipActive:   { backgroundColor: Colors.teal, borderColor: Colors.teal },
  filterChipText:     { fontSize: FontSize.xs, color: Colors.gray500, fontWeight: FontWeight.semibold },
  filterChipTextActive: { color: Colors.white },

  list:               { padding: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxxl },
  listCount:          { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.medium, marginBottom: Spacing.sm },
});
