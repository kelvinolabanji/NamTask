import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { tasksApi, paymentsApi, CreateTaskPayload } from '../../src/services/api';
import { useLocation } from '../../src/hooks/useLocation';
import { Button, Input } from '../../src/components/common';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
  TASK_CATEGORIES, NAMIBIA_CITIES,
} from '../../src/constants/theme';
import { format } from 'date-fns';

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            width:  i === current ? 20 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i === current ? Colors.teal : i < current ? Colors.tealLight : Colors.gray200,
          }}
        />
      ))}
    </View>
  );
}

export default function CreateTaskScreen() {
  const qc = useQueryClient();
  const { location } = useLocation();

  const [step, setStep]             = useState(0);
  const [category, setCategory]     = useState('');
  const [title, setTitle]           = useState('');
  const [description, setDesc]      = useState('');
  const [budget, setBudget]         = useState('');
  const [city, setCity]             = useState('Windhoek');
  const [address, setAddress]       = useState('');
  const [scheduledDate, setSched]   = useState<Date | null>(null);
  const [showDatePicker, setShowDP] = useState(false);
  const [showTimePicker, setShowTP] = useState(false);

  // Fetch price suggestion when category + city change
  const { data: priceSuggestion } = useQuery({
    queryKey: ['price-suggestion', category, city, budget],
    queryFn:  () => tasksApi.create as any, // placeholder
    enabled:  false, // we call manually via suggest btn
  });
  const [suggestion, setSuggestion] = useState<any>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  const fetchSuggestion = async () => {
    if (!category) return;
    setLoadingSuggestion(true);
    try {
      // Use the existing endpoint pattern — backend returns suggestion on task create
      // For now show a sensible local estimate
      const cityFactors: Record<string, number> = {
        'Windhoek': 1.0, 'Walvis Bay': 0.95, 'Swakopmund': 0.95,
        'Oshakati': 0.85, 'Rundu': 0.80,
      };
      const basePrices: Record<string, number> = {
        cleaning: 250, delivery: 120, moving: 450, repairs: 350,
        tutoring: 200, errands: 100, caregiving: 300, other: 200,
      };
      const base = basePrices[category] ?? 200;
      const factor = cityFactors[city] ?? 0.9;
      setSuggestion({
        suggested: Math.round(base * factor),
        min: Math.round(base * factor * 0.75),
        max: Math.round(base * factor * 1.35),
        confidence: 'medium',
      });
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const createMut = useMutation({
    mutationFn: () => {
      const payload: CreateTaskPayload = {
        title:            title.trim(),
        description:      description.trim() || undefined,
        category,
        budget:           parseFloat(budget),
        latitude:         location?.latitude  ?? -22.5597,
        longitude:        location?.longitude ?? 17.0832,
        location_address: address.trim()      || undefined,
        location_city:    city,
        scheduled_time:   scheduledDate?.toISOString() ?? undefined,
      };
      return tasksApi.create(payload);
    },
    onSuccess: (res) => {
      const task = res.data.data?.task;
      showMessage({ message: '✅ Task posted!', description: 'We\'re matching you with taskers now.', type: 'success', duration: 3500 });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      router.replace(`/(task)/${task.id}` as any);
    },
    onError: (e: any) => {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to post task', type: 'danger' });
    },
  });

  // ── Validation per step ────────────────────────────────────────────────────
  const canNext = [
    !!category,
    title.trim().length >= 5 && !!budget && parseFloat(budget) >= 10,
    true,
  ][step];

  const handleDateChange = (_: DateTimePickerEvent, date?: Date) => {
    setShowDP(false);
    if (date) { setSched(date); setShowTP(true); }
  };
  const handleTimeChange = (_: DateTimePickerEvent, time?: Date) => {
    setShowTP(false);
    if (time && scheduledDate) {
      const combined = new Date(scheduledDate);
      combined.setHours(time.getHours(), time.getMinutes());
      setSched(combined);
    }
  };

  // ── Render steps ───────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{
        headerShown: true, title: 'Post a Task',
        headerStyle: { backgroundColor: Colors.navy },
        headerTintColor: Colors.white,
        headerTitleStyle: { fontWeight: FontWeight.bold, color: Colors.white },
      }} />

      <View style={s.container}>
        {/* Progress */}
        <View style={s.progressBar}>
          <View style={{ flex: 1 }}>
            <Text style={s.stepLabel}>Step {step + 1} of 3</Text>
            <Text style={s.stepTitle}>
              {['Choose category', 'Task details', 'Location & time'][step]}
            </Text>
          </View>
          <StepDots total={3} current={step} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Step 0: Category ─────────────────────────────────────────── */}
          {step === 0 && (
            <View>
              <Text style={s.sectionTitle}>What do you need done?</Text>
              <View style={s.catGrid}>
                {TASK_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => setCategory(cat.id)}
                    style={[s.catCard, category === cat.id && { borderColor: cat.color, backgroundColor: cat.color + '12' }]}
                    activeOpacity={0.8}
                  >
                    <View style={[s.catIcon, { backgroundColor: cat.color + '20' }]}>
                      <Ionicons name={cat.icon as any} size={28} color={cat.color} />
                    </View>
                    <Text style={[s.catLabel, category === cat.id && { color: cat.color, fontWeight: FontWeight.bold }]}>
                      {cat.label}
                    </Text>
                    {category === cat.id && (
                      <View style={[s.catCheck, { backgroundColor: cat.color }]}>
                        <Ionicons name="checkmark" size={11} color={Colors.white} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Step 1: Details ──────────────────────────────────────────── */}
          {step === 1 && (
            <View style={{ gap: Spacing.md }}>
              <Text style={s.sectionTitle}>Describe your task</Text>

              <Input
                label="Task title"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Deep clean 3-bedroom house"
                maxLength={120}
                icon="create-outline"
              />

              <View>
                <Text style={s.fieldLabel}>Description (optional)</Text>
                <TextInput
                  style={s.textarea}
                  value={description}
                  onChangeText={setDesc}
                  placeholder="Any specific requirements, materials needed, access instructions…"
                  multiline
                  numberOfLines={4}
                  maxLength={800}
                  textAlignVertical="top"
                />
                <Text style={s.charCount}>{description.length}/800</Text>
              </View>

              {/* Budget */}
              <View>
                <Text style={s.fieldLabel}>Your budget (NAD)</Text>
                <View style={s.budgetRow}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label=""
                      value={budget}
                      onChangeText={setBudget}
                      placeholder="0.00"
                      keyboardType="decimal-pad"
                      icon="cash-outline"
                    />
                  </View>
                  <TouchableOpacity
                    style={s.suggestBtn}
                    onPress={fetchSuggestion}
                    disabled={loadingSuggestion}
                  >
                    <Ionicons name="sparkles" size={14} color={Colors.gold} />
                    <Text style={s.suggestBtnText}>
                      {loadingSuggestion ? '…' : 'Suggest'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {suggestion && (
                  <View style={s.suggestionCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Ionicons name="sparkles" size={14} color={Colors.gold} />
                      <Text style={s.suggestionTitle}>Market rate for {category} in {city}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                      {[
                        { label: 'Min',  value: suggestion.min },
                        { label: 'Fair', value: suggestion.suggested },
                        { label: 'Max',  value: suggestion.max },
                      ].map(r => (
                        <TouchableOpacity
                          key={r.label}
                          onPress={() => setBudget(String(r.value))}
                          style={[s.rangeBtn, r.label === 'Fair' && s.rangeBtnActive]}
                        >
                          <Text style={[s.rangeLabel, r.label === 'Fair' && { color: Colors.white }]}>{r.label}</Text>
                          <Text style={[s.rangeValue, r.label === 'Fair' && { color: Colors.white }]}>
                            N${r.value}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={s.suggestionNote}>Tap a price to use it</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ── Step 2: Location & schedule ──────────────────────────────── */}
          {step === 2 && (
            <View style={{ gap: Spacing.md }}>
              <Text style={s.sectionTitle}>Where and when?</Text>

              <View>
                <Text style={s.fieldLabel}>City</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {NAMIBIA_CITIES.map(c => (
                      <TouchableOpacity
                        key={c}
                        onPress={() => setCity(c)}
                        style={[s.cityChip, city === c && s.cityChipActive]}
                      >
                        <Text style={[s.cityChipText, city === c && s.cityChipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <Input
                label="Specific address (optional)"
                value={address}
                onChangeText={setAddress}
                placeholder="Street address or landmark"
                icon="location-outline"
              />

              <View>
                <Text style={s.fieldLabel}>When do you need it done?</Text>
                <TouchableOpacity
                  onPress={() => setShowDP(true)}
                  style={s.datePicker}
                >
                  <Ionicons name="calendar-outline" size={20} color={Colors.teal} />
                  <Text style={[s.dateText, !scheduledDate && { color: Colors.gray400 }]}>
                    {scheduledDate ? format(scheduledDate, 'EEE d MMM yyyy, HH:mm') : 'Select date & time (optional)'}
                  </Text>
                  {scheduledDate && (
                    <TouchableOpacity onPress={() => setSched(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="close-circle" size={18} color={Colors.gray400} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker mode="date" value={scheduledDate ?? new Date()} onChange={handleDateChange} minimumDate={new Date()} />
                )}
                {showTimePicker && scheduledDate && (
                  <DateTimePicker mode="time" value={scheduledDate} onChange={handleTimeChange} />
                )}
              </View>

              {/* Summary card */}
              <View style={s.summaryCard}>
                <Text style={s.summaryTitle}>Task Summary</Text>
                {[
                  { icon: 'apps-outline',     label: 'Category', value: category },
                  { icon: 'create-outline',   label: 'Title',    value: title },
                  { icon: 'cash-outline',     label: 'Budget',   value: `NAD ${budget}` },
                  { icon: 'location-outline', label: 'City',     value: city },
                ].map(row => (
                  <View key={row.label} style={s.summaryRow}>
                    <Ionicons name={row.icon as any} size={15} color={Colors.teal} />
                    <Text style={s.summaryLabel}>{row.label}</Text>
                    <Text style={s.summaryValue} numberOfLines={1}>{row.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Bottom nav */}
        <View style={s.footer}>
          {step > 0 && (
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(s => s - 1)}>
              <Ionicons name="arrow-back" size={20} color={Colors.gray600} />
              <Text style={s.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            {step < 2 ? (
              <Button
                title="Continue"
                onPress={() => setStep(s => s + 1)}
                disabled={!canNext}
                icon="arrow-forward"
                iconRight
              />
            ) : (
              <Button
                title={createMut.isPending ? 'Posting…' : 'Post Task'}
                onPress={() => createMut.mutate()}
                loading={createMut.isPending}
                disabled={!budget || parseFloat(budget) < 10}
                icon="checkmark-circle"
                variant="gold"
              />
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Colors.surface },
  progressBar:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  stepLabel:      { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  stepTitle:      { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.navy, marginTop: 2 },
  sectionTitle:   { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.navy, marginBottom: Spacing.md },
  fieldLabel:     { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700, marginBottom: 6 },

  catGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  catCard:        { width: '46%', borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.border, padding: Spacing.md, alignItems: 'center', backgroundColor: Colors.white, ...Shadow.sm },
  catIcon:        { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  catLabel:       { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700, textAlign: 'center' },
  catCheck:       { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  textarea:       { borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.lg, padding: Spacing.md, fontSize: FontSize.base, color: Colors.gray800, backgroundColor: Colors.white, minHeight: 100 },
  charCount:      { fontSize: FontSize.xs, color: Colors.gray400, alignSelf: 'flex-end', marginTop: 4 },

  budgetRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  suggestBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 11, borderRadius: Radius.lg, backgroundColor: Colors.goldXLight, borderWidth: 1, borderColor: Colors.gold, marginBottom: 2 },
  suggestBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.goldDark },

  suggestionCard: { backgroundColor: Colors.goldXLight, borderWidth: 1.5, borderColor: Colors.gold + '60', borderRadius: Radius.xl, padding: Spacing.md, marginTop: 4 },
  suggestionTitle:{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.goldDark },
  suggestionNote: { fontSize: FontSize.xs, color: Colors.gold, marginTop: 8, textAlign: 'center' },
  rangeBtn:       { flex: 1, alignItems: 'center', padding: 8, borderRadius: Radius.lg, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  rangeBtnActive: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  rangeLabel:     { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.semibold },
  rangeValue:     { fontSize: FontSize.base, fontWeight: FontWeight.extrabold, color: Colors.navy, marginTop: 2 },

  cityChip:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white },
  cityChipActive: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  cityChipText:   { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  cityChipTextActive: { color: Colors.white },

  datePicker:     { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.white },
  dateText:       { flex: 1, fontSize: FontSize.base, color: Colors.gray800 },

  summaryCard:    { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.md, gap: 10, ...Shadow.sm },
  summaryTitle:   { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.navy, marginBottom: 4 },
  summaryRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLabel:   { fontSize: FontSize.sm, color: Colors.gray400, width: 70 },
  summaryValue:   { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray800, textTransform: 'capitalize' },

  footer:         { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, padding: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border },
  backBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  backBtnText:    { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray600 },
});
