import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { safetyApi, EmergencyContact } from '../../src/services/api';
import { Button, Input, Modal } from '../../src/components/common';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
} from '../../src/constants/theme';

const RELATIONSHIPS = [
  'Partner', 'Spouse', 'Parent', 'Sibling', 'Child', 'Friend', 'Colleague', 'Other',
];

function ContactCard({
  contact, onEdit, onDelete,
}: {
  contact: EmergencyContact;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardIcon}>
        <Text style={s.cardIconText}>{contact.name[0].toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.cardName}>{contact.name}</Text>
          {contact.is_primary && (
            <View style={s.primaryBadge}>
              <Text style={s.primaryBadgeText}>Primary</Text>
            </View>
          )}
        </View>
        <Text style={s.cardPhone}>{contact.phone}</Text>
        {contact.relationship && (
          <Text style={s.cardRel}>{contact.relationship}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <TouchableOpacity style={s.iconBtn} onPress={onEdit}>
          <Ionicons name="pencil-outline" size={17} color={Colors.teal} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.iconBtn, { backgroundColor: Colors.errorLight }]} onPress={onDelete}>
          <Ionicons name="trash-outline" size={17} color={Colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function EmergencyContactsScreen() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState<EmergencyContact | null>(null);

  const [name, setName]           = useState('');
  const [phone, setPhone]         = useState('');
  const [rel, setRel]             = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['emergency-contacts'],
    queryFn:  () => safetyApi.getContacts(),
    select:   r => r.data.data as EmergencyContact[],
  });

  const openAdd = () => {
    setEditing(null);
    setName(''); setPhone(''); setRel(''); setIsPrimary(contacts.length === 0);
    setShowModal(true);
  };

  const openEdit = (c: EmergencyContact) => {
    setEditing(c);
    setName(c.name); setPhone(c.phone); setRel(c.relationship ?? ''); setIsPrimary(c.is_primary);
    setShowModal(true);
  };

  const saveMut = useMutation({
    mutationFn: () =>
      editing
        ? safetyApi.updateContact(editing.id, { name, phone, relationship: rel || undefined, is_primary: isPrimary })
        : safetyApi.addContact({ name, phone, relationship: rel || undefined, is_primary: isPrimary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emergency-contacts'] });
      setShowModal(false);
      showMessage({ message: editing ? 'Contact updated' : 'Contact added', type: 'success' });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => safetyApi.deleteContact(id),
    onSuccess:  ()            => qc.invalidateQueries({ queryKey: ['emergency-contacts'] }),
  });

  const confirmDelete = (c: EmergencyContact) => {
    Alert.alert('Remove contact?', `Remove ${c.name} from your emergency contacts?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteMut.mutate(c.id) },
    ]);
  };

  return (
    <View style={s.container}>
      <Stack.Screen options={{
        headerShown: true, title: 'Emergency Contacts',
        headerStyle: { backgroundColor: Colors.navy },
        headerTintColor: Colors.white,
        headerTitleStyle: { fontWeight: FontWeight.bold, color: Colors.white },
      }} />

      {/* Info banner */}
      <View style={s.infoBanner}>
        <Ionicons name="information-circle-outline" size={18} color={Colors.teal} />
        <Text style={s.infoText}>
          These contacts are notified automatically when you trigger an SOS or miss 3 consecutive check-ins.
          You can add up to 3 contacts.
        </Text>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.teal} />
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={c => c.id}
          renderItem={({ item }) => (
            <ContactCard contact={item} onEdit={() => openEdit(item)} onDelete={() => confirmDelete(item)} />
          )}
          contentContainerStyle={{ padding: Spacing.lg, gap: 12, paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="people-outline" size={52} color={Colors.gray300} />
              <Text style={s.emptyTitle}>No emergency contacts</Text>
              <Text style={s.emptySub}>Add someone who should be notified in an emergency</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add button */}
      {contacts.length < 3 && (
        <View style={s.fab}>
          <Button title="Add Contact" onPress={openAdd} icon="person-add-outline" />
        </View>
      )}

      {/* Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Contact' : 'Add Emergency Contact'}
      >
        <View style={{ gap: Spacing.md }}>
          <Input label="Full name" value={name} onChangeText={setName} icon="person-outline" placeholder="Jane Doe" />
          <Input label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="call-outline" placeholder="+264 81 XXX XXXX" />

          {/* Relationship picker */}
          <View>
            <Text style={s.fieldLabel}>Relationship</Text>
            <View style={s.relGrid}>
              {RELATIONSHIPS.map(r => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRel(r === rel ? '' : r)}
                  style={[s.relChip, rel === r && s.relChipActive]}
                >
                  <Text style={[s.relChipText, rel === r && s.relChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Primary toggle */}
          <TouchableOpacity style={s.primaryRow} onPress={() => setIsPrimary(!isPrimary)}>
            <View style={[s.checkbox, isPrimary && s.checkboxChecked]}>
              {isPrimary && <Ionicons name="checkmark" size={14} color={Colors.white} />}
            </View>
            <View>
              <Text style={s.primaryLabel}>Set as primary contact</Text>
              <Text style={s.primarySub}>Called first in an emergency</Text>
            </View>
          </TouchableOpacity>

          <Button
            title={saveMut.isPending ? 'Saving…' : editing ? 'Update Contact' : 'Add Contact'}
            onPress={() => saveMut.mutate()}
            loading={saveMut.isPending}
            disabled={!name.trim() || !phone.trim()}
          />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.surface },
  infoBanner:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, margin: Spacing.lg, marginBottom: 0, backgroundColor: Colors.tealXLight, padding: Spacing.md, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.tealLight + '50' },
  infoText:        { flex: 1, fontSize: FontSize.sm, color: Colors.tealDark, lineHeight: 19 },

  card:            { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.md, ...Shadow.sm },
  cardIcon:        { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.tealXLight, alignItems: 'center', justifyContent: 'center' },
  cardIconText:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.teal },
  cardName:        { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.navy },
  cardPhone:       { fontSize: FontSize.sm, color: Colors.gray500, marginTop: 2 },
  cardRel:         { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2 },
  primaryBadge:    { backgroundColor: Colors.goldXLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  primaryBadgeText:{ fontSize: 10, fontWeight: FontWeight.bold, color: Colors.goldDark },
  iconBtn:         { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.tealXLight, alignItems: 'center', justifyContent: 'center' },

  empty:           { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle:      { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  emptySub:        { fontSize: FontSize.sm, color: Colors.gray400, textAlign: 'center', lineHeight: 20 },

  fab:             { position: 'absolute', bottom: 32, left: Spacing.lg, right: Spacing.lg },

  fieldLabel:      { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700, marginBottom: 8 },
  relGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  relChip:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white },
  relChipActive:   { backgroundColor: Colors.teal, borderColor: Colors.teal },
  relChipText:     { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  relChipTextActive:{ color: Colors.white },

  primaryRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 4 },
  checkbox:        { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  primaryLabel:    { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray800 },
  primarySub:      { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 1 },
});
