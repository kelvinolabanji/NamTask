import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { tasksApi, Task } from '../../src/services/api';
import { TaskCard } from '../../src/components/task/TaskCard';
import { LoadingSpinner, EmptyState, Button } from '../../src/components/common';
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow, STATUS_CONFIG } from '../../src/constants/theme';

const STATUS_TABS = [
  { key: null,          label: 'All' },
  { key: 'pending',     label: 'Pending' },
  { key: 'accepted',    label: 'Accepted' },
  { key: 'in_progress', label: 'Active' },
  { key: 'completed',   label: 'Done' },
  { key: 'cancelled',   label: 'Cancelled' },
];

export default function TasksTab() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const isTasker = user?.role === 'tasker';

  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey: ['tasks', 'mine', 'all'],
    queryFn:  () => tasksApi.list({ limit: 50 }),
    select:   r => r.data.data as Task[],
  });

  const filtered = activeTab ? tasks.filter(t => t.status === activeTab) : tasks;
  const counts   = STATUS_TABS.reduce<Record<string, number>>((acc, tab) => {
    acc[tab.key ?? 'all'] = tab.key ? tasks.filter(t => t.status === tab.key).length : tasks.length;
    return acc;
  }, {});

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Tasks</Text>
        {!isTasker && (
          <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/(task)/create')}>
            <Ionicons name="add" size={20} color={Colors.white} />
          </TouchableOpacity>
        )}
      </View>

      {/* Status tabs */}
      <View style={styles.tabsWrap}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUS_TABS}
          keyExtractor={t => String(t.key)}
          contentContainerStyle={styles.tabsContent}
          renderItem={({ item }) => {
            const active = activeTab === item.key;
            const cfg    = item.key ? STATUS_CONFIG[item.key] : null;
            const count  = counts[item.key ?? 'all'] ?? 0;
            return (
              <TouchableOpacity
                onPress={() => setActiveTab(item.key)}
                style={[
                  styles.tab,
                  active && { backgroundColor: cfg?.color ?? Colors.teal, borderColor: cfg?.color ?? Colors.teal },
                ]}
              >
                {item.key && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? Colors.white : (cfg?.color ?? Colors.gray400) }} />
                )}
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
                {count > 0 && (
                  <View style={[styles.tabCount, active && { backgroundColor: Colors.white + '30' }]}>
                    <Text style={[styles.tabCountText, active && { color: Colors.white }]}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Task list */}
      {isLoading && !tasks.length ? (
        <LoadingSpinner fullScreen message="Loading your tasks…" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={t => t.id}
          renderItem={({ item }) => (
            <TaskCard task={item} variant="mine" />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.teal} />
          }
          ListHeaderComponent={
            filtered.length > 0 ? (
              <View style={styles.listHeader}>
                <Text style={styles.listCount}>{filtered.length} task{filtered.length !== 1 ? 's' : ''}</Text>
                <Text style={styles.listSub}>{activeTab ? STATUS_CONFIG[activeTab]?.label : 'All statuses'}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="clipboard-outline"
              title={activeTab ? `No ${STATUS_CONFIG[activeTab]?.label?.toLowerCase()} tasks` : 'No tasks yet'}
              message={
                !isTasker && !activeTab
                  ? 'Post your first task and get help from verified taskers in your area.'
                  : 'Try a different filter to see your tasks.'
              }
              action={
                !isTasker && !activeTab
                  ? { label: 'Post a Task', onPress: () => router.push('/(task)/create') }
                  : activeTab
                  ? { label: 'View All', onPress: () => setActiveTab(null) }
                  : undefined
              }
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Colors.surface },
  header:         { backgroundColor: Colors.navy, paddingTop: 56, paddingBottom: 18, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle:    { fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold, color: Colors.white },
  addBtn:         { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center', ...Shadow.teal },

  tabsWrap:       { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabsContent:    { paddingHorizontal: Spacing.lg, paddingVertical: 10, gap: 7 },
  tab:            { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.gray100, borderWidth: 1, borderColor: Colors.border },
  tabText:        { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  tabTextActive:  { color: Colors.white },
  tabCount:       { backgroundColor: Colors.gray200, paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.full },
  tabCountText:   { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.gray600 },

  list:           { padding: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxxl },
  listHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  listCount:      { fontSize: FontSize.sm, color: Colors.gray500, fontWeight: FontWeight.medium },
  listSub:        { fontSize: FontSize.xs, color: Colors.gray400 },
});
