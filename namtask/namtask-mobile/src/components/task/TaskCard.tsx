import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Task } from '../../services/api';
import { Avatar, StatusBadge, StarRating } from '../common';
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow, TASK_CATEGORIES } from '../../constants/theme';
import { formatDistanceToNow } from 'date-fns';

interface TaskCardProps {
  task: Task;
  variant?: 'feed' | 'mine';
  onPress?: () => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, variant = 'feed', onPress }) => {
  const cat     = TASK_CATEGORIES.find(c => c.id === task.category);
  const timeAgo = task.scheduled_time
    ? formatDistanceToNow(new Date(task.scheduled_time), { addSuffix: true })
    : formatDistanceToNow(new Date(task.created_at ?? Date.now()), { addSuffix: true });

  return (
    <Pressable
      onPress={onPress ?? (() => router.push(`/(task)/${task.id}` as any))}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.97, transform: [{ scale: 0.992 }] },
      ]}
    >
      {/* Category stripe */}
      <View style={[styles.stripe, { backgroundColor: cat?.color ?? Colors.teal }]} />

      <View style={styles.body}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.catIcon, { backgroundColor: (cat?.color ?? Colors.teal) + '18' }]}>
            <Ionicons name={(cat?.icon ?? 'grid-outline') as any} size={16} color={cat?.color ?? Colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.catLabel}>{cat?.label ?? task.category}</Text>
            <Text style={styles.title} numberOfLines={1}>{task.title}</Text>
          </View>
          <StatusBadge status={task.status} size="xs" />
        </View>

        {/* Description */}
        {task.description ? (
          <Text style={styles.desc} numberOfLines={2}>{task.description}</Text>
        ) : null}

        {/* Meta row */}
        <View style={styles.metaRow}>
          {task.location_city && (
            <View style={styles.meta}>
              <Ionicons name="location-outline" size={12} color={Colors.gray400} />
              <Text style={styles.metaText}>{task.location_city}</Text>
            </View>
          )}
          {task.distance_km != null && (
            <View style={styles.meta}>
              <Ionicons name="navigate-outline" size={12} color={Colors.teal} />
              <Text style={[styles.metaText, { color: Colors.teal }]}>{task.distance_km.toFixed(1)} km</Text>
            </View>
          )}
          <View style={styles.meta}>
            <Ionicons name="time-outline" size={12} color={Colors.gray400} />
            <Text style={styles.metaText}>{timeAgo}</Text>
          </View>
          {(task.offer_count ?? 0) > 0 && (
            <View style={styles.meta}>
              <Ionicons name="people-outline" size={12} color={Colors.gold} />
              <Text style={[styles.metaText, { color: Colors.gold }]}>{task.offer_count} offer{task.offer_count !== 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          {task.customer_name && variant === 'feed' ? (
            <View style={styles.personRow}>
              <Avatar uri={task.customer_avatar} name={task.customer_name} size={24} />
              <Text style={styles.personName} numberOfLines={1}>{task.customer_name}</Text>
              {task.customer_rating != null && (
                <StarRating rating={Number(task.customer_rating)} size={11} showValue />
              )}
            </View>
          ) : (
            <View />
          )}
          <View style={styles.priceWrap}>
            <Text style={styles.priceCur}>NAD</Text>
            <Text style={styles.price}>{Number(task.budget).toFixed(0)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card:       { backgroundColor: Colors.card, borderRadius: Radius.xl, marginBottom: Spacing.sm, flexDirection: 'row', overflow: 'hidden', ...Shadow.md },
  stripe:     { width: 4, borderTopLeftRadius: Radius.xl, borderBottomLeftRadius: Radius.xl },
  body:       { flex: 1, padding: Spacing.md },
  header:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  catIcon:    { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  catLabel:   { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.gray400, textTransform: 'uppercase', letterSpacing: 0.4 },
  title:      { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray900, marginTop: 1 },
  desc:       { fontSize: FontSize.sm, color: Colors.gray500, lineHeight: 19, marginBottom: 8 },
  metaRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  meta:       { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText:   { fontSize: FontSize.xs, color: Colors.gray400 },
  footer:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  personRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  personName: { fontSize: FontSize.xs, color: Colors.gray500, fontWeight: FontWeight.medium, maxWidth: 100 },
  priceWrap:  { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  priceCur:   { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.semibold },
  price:      { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.teal },
});
