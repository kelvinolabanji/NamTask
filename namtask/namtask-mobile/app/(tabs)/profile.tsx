import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Switch, Image,
} from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { authApi, profileApi, User } from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import { Button, Input, Avatar } from '../../src/components/common';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
} from '../../src/constants/theme';
import { BASE_URL } from '../../src/services/api';

// ─── Menu row ─────────────────────────────────────────────────────────────────
function MenuRow({
  icon, label, value, onPress, color = Colors.gray700, rightEl, danger,
}: {
  icon: string; label: string; value?: string;
  onPress?: () => void; color?: string;
  rightEl?: React.ReactNode; danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={s.menuRow}
      onPress={onPress}
      disabled={!onPress && !rightEl}
      activeOpacity={0.7}
    >
      <View style={[s.menuIcon, { backgroundColor: (danger ? Colors.errorLight : Colors.tealXLight) }]}>
        <Ionicons name={icon as any} size={19} color={danger ? Colors.error : Colors.teal} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.menuLabel, danger && { color: Colors.error }]}>{label}</Text>
        {value && <Text style={s.menuValue} numberOfLines={1}>{value}</Text>}
      </View>
      {rightEl ?? (onPress && <Ionicons name="chevron-forward" size={17} color={Colors.gray300} />)}
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

export default function ProfileTab() {
  const { user, logout, updateUser } = useAuthStore();
  const qc = useQueryClient();
  const isTasker = user?.role === 'tasker';

  const [editMode, setEditMode] = useState(false);
  const [name, setName]         = useState(user?.name ?? '');
  const [email, setEmail]       = useState(user?.email ?? '');

  // Profile update mutation
  const updateMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('name', name.trim());
      if (email.trim()) fd.append('email', email.trim());
      return profileApi.update(fd);
    },
    onSuccess: (res) => {
      const updated = res.data.data as User;
      updateUser(updated);
      showMessage({ message: 'Profile updated', type: 'success' });
      setEditMode(false);
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Update failed', type: 'danger' }),
  });

  // Avatar upload
  const avatarMut = useMutation({
    mutationFn: async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true, aspect: [1, 1], quality: 0.8,
      });
      if (result.canceled) return null;
      const asset = result.assets[0];
      const fd = new FormData();
      fd.append('avatar', { uri: asset.uri, type: 'image/jpeg', name: 'avatar.jpg' } as any);
      return profileApi.update(fd);
    },
    onSuccess: (res) => {
      if (!res) return;
      updateUser(res.data.data as User);
      showMessage({ message: 'Photo updated', type: 'success' });
    },
  });

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const avatarUrl = user?.avatar_url
    ? (user.avatar_url.startsWith('http') ? user.avatar_url : BASE_URL.replace('/api/v1','') + user.avatar_url)
    : undefined;

  return (
    <ScrollView style={s.container} showsVerticalScrollIndicator={false}>
      {/* Hero */}
      <View style={s.hero}>
        <TouchableOpacity style={s.avatarWrap} onPress={() => avatarMut.mutate()} activeOpacity={0.8}>
          <Avatar name={user?.name} url={avatarUrl} size={22} />
          <View style={s.avatarEdit}>
            <Ionicons name="camera" size={13} color={Colors.white} />
          </View>
        </TouchableOpacity>

        {!editMode ? (
          <View style={s.heroInfo}>
            <Text style={s.heroName}>{user?.name}</Text>
            <Text style={s.heroPhone}>{user?.phone}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <View style={[s.roleBadge, { backgroundColor: isTasker ? Colors.tealXLight : Colors.goldXLight }]}>
                <Text style={[s.roleBadgeText, { color: isTasker ? Colors.teal : Colors.goldDark }]}>
                  {isTasker ? '🔧 Tasker' : '👤 Customer'}
                </Text>
              </View>
              {isTasker && user?.verification_status && (
                <View style={[s.roleBadge, {
                  backgroundColor: user.verification_status === 'approved' ? Colors.successLight : Colors.warningLight
                }]}>
                  <Text style={[s.roleBadgeText, {
                    color: user.verification_status === 'approved' ? Colors.success : Colors.warning
                  }]}>
                    {user.verification_status === 'approved' ? '✓ Verified' : '⏳ Pending KYC'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={{ width: '100%', gap: Spacing.sm, marginTop: Spacing.md }}>
            <Input label="Full name" value={name} onChangeText={setName} icon="person-outline" />
            <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" icon="mail-outline" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Cancel" variant="ghost" onPress={() => setEditMode(false)} fullWidth={false} style={{ flex: 1 }} />
              <Button title={updateMut.isPending ? 'Saving…' : 'Save'} onPress={() => updateMut.mutate()} loading={updateMut.isPending} fullWidth={false} style={{ flex: 1 }} />
            </View>
          </View>
        )}

        {!editMode && (
          <TouchableOpacity style={s.editBtn} onPress={() => setEditMode(true)}>
            <Ionicons name="pencil" size={15} color={Colors.teal} />
            <Text style={s.editBtnText}>Edit profile</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats */}
      {user && (
        <View style={s.stats}>
          {[
            { label: 'Rating',    value: user.rating > 0 ? `${Number(user.rating).toFixed(1)} ★` : '—' },
            { label: 'Balance',   value: `N$${Number(user.balance ?? 0).toFixed(0)}` },
            { label: 'Reviews',   value: String(user.rating_count ?? 0) },
          ].map(stat => (
            <View key={stat.label} style={s.statItem}>
              <Text style={s.statValue}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Account */}
      <SectionHeader title="Account" />
      <View style={s.section}>
        <MenuRow icon="call-outline"    label="Phone number"  value={user?.phone} />
        <MenuRow icon="mail-outline"    label="Email"         value={user?.email ?? 'Not set'} onPress={() => setEditMode(true)} />
        <MenuRow icon="lock-closed-outline" label="Change password" onPress={() => router.push('/auth/change-password' as any)} />
      </View>

      {/* Safety */}
      <SectionHeader title="Safety" />
      <View style={s.section}>
        <MenuRow
          icon="people-outline"
          label="Emergency contacts"
          value="Keep loved ones informed"
          onPress={() => router.push('/safety/contacts' as any)}
        />
        <MenuRow
          icon="shield-checkmark-outline"
          label="Safety history"
          value="View past check-ins & alerts"
          onPress={() => router.push('/safety/history' as any)}
        />
      </View>

      {/* Tasker-specific */}
      {isTasker && (
        <>
          <SectionHeader title="Tasker Settings" />
          <View style={s.section}>
            <MenuRow
              icon="construct-outline"
              label="Skills & categories"
              onPress={() => router.push('/profile/tasker' as any)}
            />
            <MenuRow
              icon="card-outline"
              label="Earnings & payouts"
              onPress={() => router.push('/(tabs)/wallet' as any)}
            />
            <MenuRow
              icon="document-text-outline"
              label="KYC documents"
              value={user?.verification_status === 'approved' ? 'Verified ✓' : 'Pending review'}
              onPress={() => router.push('/profile/kyc' as any)}
            />
          </View>
        </>
      )}

      {/* Support */}
      <SectionHeader title="Support" />
      <View style={s.section}>
        <MenuRow icon="help-circle-outline" label="Help centre"     onPress={() => {}} />
        <MenuRow icon="document-outline"    label="Terms of service" onPress={() => {}} />
        <MenuRow icon="shield-outline"      label="Privacy policy"   onPress={() => {}} />
      </View>

      {/* Sign out */}
      <View style={[s.section, { marginBottom: 60 }]}>
        <MenuRow icon="log-out-outline" label="Sign out" onPress={handleLogout} danger />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.surface },

  hero:            { alignItems: 'center', paddingTop: 56, paddingBottom: Spacing.xl, paddingHorizontal: Spacing.lg, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  avatarWrap:      { position: 'relative', marginBottom: Spacing.md },
  avatarEdit:      { position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.white },
  heroInfo:        { alignItems: 'center' },
  heroName:        { fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold, color: Colors.navy },
  heroPhone:       { fontSize: FontSize.base, color: Colors.gray400, marginTop: 3 },
  roleBadge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  roleBadgeText:   { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  editBtn:         { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.md, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.tealXLight },
  editBtnText:     { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.teal },

  stats:           { flexDirection: 'row', backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: Spacing.md },
  statItem:        { flex: 1, alignItems: 'center' },
  statValue:       { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.navy },
  statLabel:       { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.semibold, marginTop: 2 },

  sectionHeader:   { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: 8 },
  section:         { backgroundColor: Colors.white, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border },
  menuRow:         { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: Spacing.lg, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  menuIcon:        { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel:       { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.gray800 },
  menuValue:       { fontSize: FontSize.sm, color: Colors.gray400, marginTop: 1 },
});
