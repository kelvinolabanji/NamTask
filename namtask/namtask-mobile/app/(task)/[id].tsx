import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, Image,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { tasksApi, Task, TaskOffer } from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import {
  Button, Avatar, StatusBadge, StarRating, Card,
  LoadingSpinner, Badge, Input, SectionHeader, RowItem,
} from '../../src/components/common';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
  TASK_CATEGORIES, STATUS_CONFIG,
} from '../../src/constants/theme';
import { format } from 'date-fns';
import { useTaskRoom } from '../../src/hooks/useSocket';

export default function TaskDetailScreen() {
  const { id }     = useLocalSearchParams<{ id: string }>();
  const { user }   = useAuthStore();
  const qc         = useQueryClient();
  const [showOffer, setShowOffer] = useState(false);
  const [bidPrice, setBidPrice]   = useState('');
  const [bidMsg, setBidMsg]       = useState('');

  const { data: task, isLoading, refetch } = useQuery({
    queryKey: ['task', id],
    queryFn:  () => tasksApi.get(id),
    select:   r  => r.data.data as Task,
  });

  // Live updates via socket
  useTaskRoom(id, {
    onStatusUpdate: useCallback((d: any) => {
      if (d.taskId === id) qc.invalidateQueries({ queryKey: ['task', id] });
    }, [id]),
  });

  const offerMut = useMutation({
    mutationFn: () => tasksApi.submitOffer(id, { bid_price: parseFloat(bidPrice), message: bidMsg }),
    onSuccess: () => {
      showMessage({ message: '✅ Offer submitted!', type: 'success' });
      setShowOffer(false); setBidPrice(''); setBidMsg('');
      qc.invalidateQueries({ queryKey: ['task', id] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed to submit offer', type: 'danger' }),
  });

  const acceptMut = useMutation({
    mutationFn: (offerId: string) => tasksApi.acceptOffer(id, offerId),
    onSuccess: () => {
      showMessage({ message: '✅ Offer accepted!', type: 'success' });
      qc.invalidateQueries({ queryKey: ['task', id] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const statusMut = useMutation({
    mutationFn: (status: string) => tasksApi.updateStatus(id, status as any),
    onSuccess: (_, st) => {
      showMessage({ message: `Task marked as ${STATUS_CONFIG[st]?.label ?? st}`, type: 'success' });
      qc.invalidateQueries({ queryKey: ['task', id] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  if (isLoading || !task) return <LoadingSpinner fullScreen message="Loading task…" />;

  const cat          = TASK_CATEGORIES.find(c => c.id === task.category);
  const isCustomer   = user?.id === task.customer_id;
  const isAssigned   = user?.id === task.tasker_id;
  const canChat      = (isCustomer || isAssigned) && !['pending','cancelled'].includes(task.status);
  const canOffer     = user?.role === 'tasker' && task.status === 'pending' && !isAssigned;
  const myOffer      = task.offers?.find(o => o.tasker_id === user?.id);
  const pendingOffers = task.offers?.filter(o => o.status === 'pending') ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: task.title,
          headerRight: () => canChat ? (
            <TouchableOpacity
              onPress={() => router.push(`/(task)/chat/${id}` as any)}
              style={{ marginRight: 4, padding: 6 }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={Colors.gold} />
            </TouchableOpacity>
          ) : null,
        }}
      />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.teal} />}
      >
        {/* ── Category hero ─────────────────────────────────────────────── */}
        <View style={[styles.hero, { backgroundColor: (cat?.color ?? Colors.teal) + '12' }]}>
          <View style={[styles.heroCatIcon, { backgroundColor: cat?.color ?? Colors.teal }]}>
            <Ionicons name={(cat?.icon ?? 'grid-outline') as any} size={28} color={Colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroCategory, { color: cat?.color ?? Colors.teal }]}>{cat?.label}</Text>
            <Text style={styles.heroTitle}>{task.title}</Text>
          </View>
          <StatusBadge status={task.status} size="md" />
        </View>

        {/* ── Images ────────────────────────────────────────────────────── */}
        {task.images && task.images.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
            {task.images.map((img, i) => (
              <Image key={i} source={{ uri: img.url }} style={styles.taskImage} />
            ))}
          </ScrollView>
        )}

        <View style={styles.body}>
          {/* ── Budget + meta ────────────────────────────────────────────── */}
          <Card style={styles.card}>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Budget</Text>
              <View style={styles.priceValRow}>
                <Text style={styles.priceCur}>NAD</Text>
                <Text style={styles.priceVal}>{Number(task.budget).toFixed(2)}</Text>
              </View>
            </View>
            {task.final_price && Number(task.final_price) !== Number(task.budget) && (
              <View style={[styles.priceRow, { marginTop: 4 }]}>
                <Text style={styles.priceLabel}>Agreed</Text>
                <View style={styles.priceValRow}>
                  <Text style={[styles.priceCur, { color: Colors.success }]}>NAD</Text>
                  <Text style={[styles.priceVal, { color: Colors.success, fontSize: FontSize.xl }]}>
                    {Number(task.final_price).toFixed(2)}
                  </Text>
                </View>
              </View>
            )}
            <View style={styles.divider} />
            {task.location_address && (
              <View style={styles.metaLine}>
                <Ionicons name="location-outline" size={15} color={Colors.teal} />
                <Text style={styles.metaVal}>{task.location_address}</Text>
              </View>
            )}
            {task.scheduled_time && (
              <View style={styles.metaLine}>
                <Ionicons name="calendar-outline" size={15} color={Colors.teal} />
                <Text style={styles.metaVal}>{format(new Date(task.scheduled_time), 'PPp')}</Text>
              </View>
            )}
          </Card>

          {/* ── Description ───────────────────────────────────────────────── */}
          {task.description && (
            <Card style={styles.card}>
              <Text style={styles.sectionTitle}>About this task</Text>
              <Text style={styles.description}>{task.description}</Text>
            </Card>
          )}

          {/* ── Customer / Tasker info ───────────────────────────────────── */}
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Posted by</Text>
            <View style={styles.personRow}>
              <Avatar uri={task.customer_avatar} name={task.customer_name} size={50} />
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{task.customer_name}</Text>
                <StarRating rating={Number(task.customer_rating ?? 0)} showValue size={13} />
              </View>
            </View>
          </Card>

          {task.tasker_id && task.tasker_name && (
            <Card style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
                <Text style={styles.sectionTitle}>Assigned Tasker</Text>
                <Badge label="Verified" icon="shield-checkmark" color={Colors.success} />
              </View>
              <View style={styles.personRow}>
                <Avatar uri={task.tasker_avatar} name={task.tasker_name} size={50} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.personName}>{task.tasker_name}</Text>
                  <StarRating rating={Number(task.tasker_rating ?? 0)} showValue size={13} />
                </View>
              </View>
            </Card>
          )}

          {/* ── Offers (customer view) ────────────────────────────────────── */}
          {isCustomer && task.status === 'pending' && pendingOffers.length > 0 && (
            <View>
              <SectionHeader title={`Offers (${pendingOffers.length})`} />
              {pendingOffers.map(offer => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  loading={acceptMut.isPending}
                  onAccept={() => Alert.alert(
                    'Accept Offer',
                    `Accept NAD ${offer.bid_price} from ${offer.tasker_name}?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Accept', style: 'default', onPress: () => acceptMut.mutate(offer.id) },
                    ]
                  )}
                />
              ))}
            </View>
          )}

          {/* ── Action zone ───────────────────────────────────────────────── */}
          <View style={styles.actions}>

            {/* Tasker: submit offer */}
            {canOffer && !myOffer && (
              <Button
                title={showOffer ? 'Hide Offer Form' : 'Submit an Offer'}
                onPress={() => setShowOffer(v => !v)}
                variant={showOffer ? 'outline' : 'primary'}
                icon="hand-left-outline"
              />
            )}

            {/* My offer status */}
            {myOffer && (
              <View style={[styles.myOfferBanner, { borderColor: Colors.teal + '30' }]}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.teal} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.myOfferText}>Your offer: NAD {myOffer.bid_price}</Text>
                  <Text style={styles.myOfferStatus}>{STATUS_CONFIG[myOffer.status]?.label ?? myOffer.status}</Text>
                </View>
              </View>
            )}

            {/* Status buttons */}
            {isAssigned && task.status === 'accepted' && (
              <Button
                title="Start Task"
                onPress={() => statusMut.mutate('in_progress')}
                loading={statusMut.isPending}
                icon="play"
              />
            )}
            {(isCustomer || isAssigned) && task.status === 'in_progress' && (
              <Button
                title="Mark as Completed"
                onPress={() => Alert.alert('Complete Task', 'Mark this task as completed?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Complete ✓', onPress: () => statusMut.mutate('completed') },
                ])}
                variant="gold"
                loading={statusMut.isPending}
                icon="checkmark-done"
              />
            )}
            {canChat && (
              <Button
                title="Open Chat"
                onPress={() => router.push(`/(task)/chat/${id}` as any)}
                variant="outline"
                icon="chatbubbles-outline"
              />
            )}
            {(isCustomer || isAssigned) && task.status === 'in_progress' && (
              <Button
                title="Raise Dispute"
                onPress={() => statusMut.mutate('disputed')}
                variant="ghost"
                icon="alert-circle-outline"
                style={{ opacity: 0.7 }}
              />
            )}
          </View>

          {/* ── Offer form ────────────────────────────────────────────────── */}
          {showOffer && (
            <Card style={[styles.card, { borderWidth: 1.5, borderColor: Colors.teal + '30' }]}>
              <SectionHeader title="Your Offer" />
              <Input
                label="Offer Price (NAD)"
                placeholder={`Budget: ${task.budget}`}
                value={bidPrice}
                onChangeText={setBidPrice}
                keyboardType="decimal-pad"
                icon="cash-outline"
                hint="Enter the price you'd like to charge for this task"
              />
              <Input
                label="Message (optional)"
                placeholder="Tell the customer why you're the best fit…"
                value={bidMsg}
                onChangeText={setBidMsg}
                multiline
                numberOfLines={3}
                maxLength={500}
              />
              <Button
                title="Submit Offer"
                onPress={() => {
                  if (!bidPrice || parseFloat(bidPrice) < 1) {
                    showMessage({ message: 'Enter a valid price', type: 'warning' }); return;
                  }
                  offerMut.mutate();
                }}
                loading={offerMut.isPending}
                icon="send"
                iconRight
              />
            </Card>
          )}
        </View>
      </ScrollView>
    </>
  );
}

function OfferCard({ offer, onAccept, loading }: { offer: TaskOffer; onAccept: () => void; loading: boolean }) {
  return (
    <Card style={{ marginBottom: Spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={offer.tasker_name} size={46} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray900 }}>
              {offer.tasker_name}
            </Text>
            {offer.ai_recommended && (
              <Badge label="AI Pick" icon="sparkles" color={Colors.teal} size="xs" />
            )}
          </View>
          <StarRating rating={Number(offer.tasker_rating ?? 0)} size={12} showValue />
        </View>
        <Text style={{ fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.teal }}>
          NAD {Number(offer.bid_price).toFixed(0)}
        </Text>
      </View>
      {offer.message && (
        <Text style={{ fontSize: FontSize.sm, color: Colors.gray500, marginTop: 10, lineHeight: 20 }}>
          "{offer.message}"
        </Text>
      )}
      <Button title="Accept Offer" onPress={onAccept} loading={loading} size="sm" style={{ marginTop: Spacing.sm }} />
    </Card>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.surface },
  hero:         { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.lg },
  heroCatIcon:  { width: 56, height: 56, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center', ...Shadow.teal },
  heroCategory: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroTitle:    { fontSize: FontSize.lg, fontWeight: FontWeight.extrabold, color: Colors.gray900, marginTop: 3, lineHeight: 24 },
  taskImage:    { width: 220, height: 150, borderRadius: Radius.lg, marginRight: Spacing.sm, marginLeft: Spacing.lg },
  body:         { padding: Spacing.lg, gap: Spacing.md },
  card:         { marginBottom: 0 },

  priceRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceLabel:   { fontSize: FontSize.sm, color: Colors.gray400, fontWeight: FontWeight.medium },
  priceValRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  priceCur:     { fontSize: FontSize.sm, color: Colors.gray400, fontWeight: FontWeight.semibold },
  priceVal:     { fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold, color: Colors.teal },
  divider:      { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  metaLine:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  metaVal:      { fontSize: FontSize.sm, color: Colors.gray600, flex: 1 },

  sectionTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray800, marginBottom: Spacing.sm },
  description:  { fontSize: FontSize.md, color: Colors.gray600, lineHeight: 23 },

  personRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  personName:   { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray900, marginBottom: 3 },

  actions:      { gap: 10, paddingBottom: Spacing.md },
  myOfferBanner:{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.tealXLight, borderWidth: 1.5 },
  myOfferText:  { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.teal },
  myOfferStatus:{ fontSize: FontSize.xs, color: Colors.teal, marginTop: 1 },
});
