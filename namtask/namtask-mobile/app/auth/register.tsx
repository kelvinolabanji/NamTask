import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { Button, Input, Card } from '../../src/components/common';
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '../../src/constants/theme';

type Role = 'customer' | 'tasker';

const ROLE_CONFIG = {
  customer: {
    icon:    'storefront-outline' as const,
    title:   'I need help',
    sub:     'Post tasks, hire verified taskers',
    color:   Colors.teal,
    bg:      Colors.tealXLight,
  },
  tasker: {
    icon:    'briefcase-outline' as const,
    title:   'I can help',
    sub:     'Take jobs, earn money nearby',
    color:   Colors.gold,
    bg:      Colors.goldXLight,
  },
};

export default function RegisterScreen() {
  const { register, isLoading } = useAuthStore();
  const [step, setStep]         = useState<1 | 2>(1);
  const [role, setRole]         = useState<Role>('customer');
  const [name, setName]         = useState('');
  const [phone, setPhone]       = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [errors, setErrors]     = useState<Record<string, string>>({});

  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!name.trim() || name.length < 2)  e.name  = 'Full name required (min 2 characters)';
    if (!phone.trim())                     e.phone = 'Phone number required';
    else if (!/^\+?[0-9]{7,15}$/.test(phone.replace(/\s/g, '')))
                                           e.phone = 'Enter a valid phone number';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const validateStep2 = () => {
    const e: Record<string, string> = {};
    if (!password || password.length < 8) e.password = 'Password must be at least 8 characters';
    if (password !== confirm)             e.confirm  = 'Passwords do not match';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleNext = () => {
    if (validateStep1()) { setErrors({}); setStep(2); }
  };

  const handleRegister = async () => {
    if (!validateStep2()) return;
    try {
      await register({ name: name.trim(), phone: phone.replace(/\s/g, ''), email: email.trim() || undefined, password, role });
      showMessage({ message: `Welcome to Nam Task! 🎉`, description: 'Your account is ready.', type: 'success' });
      router.replace('/(tabs)');
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message ?? 'Registration failed', type: 'danger' });
    }
  };

  const rc = ROLE_CONFIG[role];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* Header */}
      <View style={styles.header}>
        {step === 2 && (
          <TouchableOpacity onPress={() => setStep(1)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Create account</Text>
          <Text style={styles.headerSub}>Step {step} of 2</Text>
        </View>
        {/* Step indicator */}
        <View style={styles.stepDots}>
          {[1, 2].map(s => (
            <View key={s} style={[styles.dot, step >= s && styles.dotActive]} />
          ))}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: Colors.surface }}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 1 ? (
          <>
            {/* Role picker */}
            <Text style={styles.sectionLabel}>I want to…</Text>
            <View style={styles.roleRow}>
              {(['customer', 'tasker'] as Role[]).map(r => {
                const cfg = ROLE_CONFIG[r];
                const active = role === r;
                return (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setRole(r)}
                    style={[styles.roleCard, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.roleIconWrap, { backgroundColor: active ? cfg.color : Colors.gray100 }]}>
                      <Ionicons name={cfg.icon} size={24} color={active ? Colors.white : Colors.gray400} />
                    </View>
                    <Text style={[styles.roleTitle, active && { color: cfg.color }]}>{cfg.title}</Text>
                    <Text style={styles.roleSub}>{cfg.sub}</Text>
                    {active && (
                      <View style={[styles.roleCheck, { backgroundColor: cfg.color }]}>
                        <Ionicons name="checkmark" size={12} color={Colors.white} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.formCard}>
              <Input label="Full Name" placeholder="e.g. Maria Nghipunya" value={name} onChangeText={setName} icon="person-outline" error={errors.name} autoCapitalize="words" />
              <Input label="Phone Number" placeholder="+264 81 234 5678" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="call-outline" error={errors.phone} autoCapitalize="none" />
              <Input label="Email address (optional)" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" icon="mail-outline" autoCapitalize="none" />
            </View>

            <Button title="Continue" onPress={handleNext} icon="arrow-forward" iconRight />
          </>
        ) : (
          <>
            {/* Role summary */}
            <View style={[styles.roleSummary, { backgroundColor: rc.bg, borderColor: rc.color + '30' }]}>
              <Ionicons name={rc.icon} size={18} color={rc.color} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.roleSummaryName, { color: rc.color }]}>{name}</Text>
                <Text style={styles.roleSummaryRole}>{rc.title} · {phone}</Text>
              </View>
              <TouchableOpacity onPress={() => setStep(1)}>
                <Text style={[styles.editLink, { color: rc.color }]}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.formCard}>
              <Input label="Password" placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry icon="lock-closed-outline" error={errors.password} autoCapitalize="none" />
              <Input label="Confirm Password" placeholder="Repeat password" value={confirm} onChangeText={setConfirm} secureTextEntry icon="shield-checkmark-outline" error={errors.confirm} autoCapitalize="none" />

              {/* Password strength indicator */}
              {password.length > 0 && (
                <PasswordStrength password={password} />
              )}
            </View>

            <View style={styles.termsRow}>
              <Ionicons name="shield-outline" size={14} color={Colors.gray400} />
              <Text style={styles.termsText}>
                By creating an account you agree to our{' '}
                <Text style={{ color: Colors.teal }}>Terms of Service</Text>
                {' '}and{' '}
                <Text style={{ color: Colors.teal }}>Privacy Policy</Text>
              </Text>
            </View>

            <Button title="Create Account" onPress={handleRegister} loading={isLoading} variant="gold" icon="rocket-outline" />
          </>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.replace('/auth/login')}>
            <Text style={styles.footerLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: '8+ chars',      ok: password.length >= 8 },
    { label: 'Number',        ok: /[0-9]/.test(password) },
    { label: 'Uppercase',     ok: /[A-Z]/.test(password) },
    { label: 'Special char',  ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const strength = checks.filter(c => c.ok).length;
  const [color, label] = strength <= 1
    ? [Colors.error, 'Weak']
    : strength <= 2
    ? [Colors.warning, 'Fair']
    : strength === 3
    ? [Colors.teal, 'Good']
    : [Colors.success, 'Strong'];

  return (
    <View style={{ marginTop: -8, marginBottom: Spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
        {[1, 2, 3, 4].map(i => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= strength ? color : Colors.gray200 }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: FontSize.xs, color, fontWeight: FontWeight.semibold }}>{label}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {checks.map(c => (
            <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name={c.ok ? 'checkmark-circle' : 'ellipse-outline'} size={11} color={c.ok ? Colors.success : Colors.gray300} />
              <Text style={{ fontSize: 10, color: c.ok ? Colors.gray600 : Colors.gray300 }}>{c.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header:         { backgroundColor: Colors.navy, paddingTop: 56, paddingBottom: 24, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  backBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.navyLight, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.white },
  headerSub:      { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2 },
  stepDots:       { flexDirection: 'row', gap: 6 },
  dot:            { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.navyLight },
  dotActive:      { backgroundColor: Colors.teal, width: 20 },

  scroll:         { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  sectionLabel:   { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray700, marginBottom: Spacing.sm },
  roleRow:        { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  roleCard:       { flex: 1, borderWidth: 2, borderColor: Colors.border, borderRadius: Radius.xl, padding: Spacing.md, alignItems: 'center', gap: 6, backgroundColor: Colors.white, position: 'relative', ...Shadow.sm },
  roleIconWrap:   { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  roleTitle:      { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray800, textAlign: 'center' },
  roleSub:        { fontSize: FontSize.xs, color: Colors.gray400, textAlign: 'center', lineHeight: 16 },
  roleCheck:      { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  formCard:       { backgroundColor: Colors.white, borderRadius: Radius.xxl, padding: Spacing.lg, marginBottom: Spacing.lg, ...Shadow.md },

  roleSummary:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1.5, borderRadius: Radius.xl, padding: Spacing.md, marginBottom: Spacing.lg },
  roleSummaryName:{ fontSize: FontSize.base, fontWeight: FontWeight.bold },
  roleSummaryRole:{ fontSize: FontSize.xs, color: Colors.gray500 },
  editLink:       { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  termsRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginBottom: Spacing.md },
  termsText:      { flex: 1, fontSize: FontSize.xs, color: Colors.gray500, lineHeight: 18 },

  footer:         { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.xl },
  footerText:     { fontSize: FontSize.md, color: Colors.gray500 },
  footerLink:     { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.teal },
});
