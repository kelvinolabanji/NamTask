import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, TouchableOpacity,
  ImageBackground, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { Button, Input, Divider } from '../../src/components/common';
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '../../src/constants/theme';

const { height } = Dimensions.get('window');

export default function LoginScreen() {
  const { login, isLoading } = useAuthStore();
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors]     = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!phone.trim())    e.phone    = 'Phone number is required';
    if (!password.trim()) e.password = 'Password is required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    try {
      await login(phone.trim(), password);
      router.replace('/(tabs)');
    } catch (err: any) {
      showMessage({
        message: err?.response?.data?.message ?? 'Login failed. Check your details.',
        type: 'danger',
        icon: 'danger',
      });
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>

        {/* Hero header */}
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            <View style={styles.logoInner}>
              <Text style={styles.logoText}>NT</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>Nam Task</Text>
          <Text style={styles.heroSub}>Africa's trusted task marketplace</Text>

          {/* Decorative blobs */}
          <View style={[styles.blob, styles.blobTL]} />
          <View style={[styles.blob, styles.blobBR]} />
        </View>

        {/* Form card */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.heading}>Welcome back</Text>
            <Text style={styles.subheading}>Sign in to your account</Text>

            <View style={{ marginTop: Spacing.lg }}>
              <Input
                label="Phone Number"
                placeholder="+264 81 234 5678"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                icon="call-outline"
                error={errors.phone}
                autoCapitalize="none"
              />
              <Input
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                icon="lock-closed-outline"
                error={errors.password}
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity style={styles.forgotBtn}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <Button
              title="Sign In"
              onPress={handleLogin}
              loading={isLoading}
              icon="arrow-forward"
              iconRight
              style={{ marginTop: Spacing.sm }}
            />

            <Divider label="or" style={{ marginVertical: Spacing.lg }} />

            {/* Demo credentials */}
            <View style={styles.demoCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Ionicons name="flask-outline" size={14} color={Colors.teal} />
                <Text style={styles.demoTitle}>Demo credentials</Text>
              </View>
              {[
                { role: 'Customer', phone: '+264811234567', pass: 'Password@123' },
                { role: 'Tasker',   phone: '+264813456789', pass: 'Password@123' },
              ].map(d => (
                <TouchableOpacity
                  key={d.role}
                  onPress={() => { setPhone(d.phone); setPassword(d.pass); }}
                  style={styles.demoRow}
                >
                  <View style={[styles.demoRoleBadge, { backgroundColor: d.role === 'Tasker' ? Colors.tealXLight : Colors.goldXLight }]}>
                    <Text style={[styles.demoRoleText, { color: d.role === 'Tasker' ? Colors.teal : Colors.goldDark }]}>{d.role}</Text>
                  </View>
                  <Text style={styles.demoCredText}>{d.phone}</Text>
                  <Ionicons name="copy-outline" size={13} color={Colors.gray400} />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/auth/register')}>
              <Text style={styles.footerLink}>Create account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.surface },
  hero:          { backgroundColor: Colors.navy, paddingTop: 60, paddingBottom: 36, paddingHorizontal: Spacing.lg, alignItems: 'center', overflow: 'hidden' },
  logoWrap:      { width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.tealGlass, borderWidth: 2, borderColor: Colors.teal + '40', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  logoInner:     { width: 58, height: 58, borderRadius: 29, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center', ...Shadow.teal },
  logoText:      { fontSize: FontSize.xl, fontWeight: FontWeight.black, color: Colors.white, letterSpacing: 1 },
  heroTitle:     { fontSize: FontSize.xxxl, fontWeight: FontWeight.black, color: Colors.white, letterSpacing: 0.5 },
  heroSub:       { fontSize: FontSize.sm, color: Colors.gray400, marginTop: 4 },
  blob:          { position: 'absolute', borderRadius: 999, opacity: 0.06, backgroundColor: Colors.teal },
  blobTL:        { width: 200, height: 200, top: -80, left: -60 },
  blobBR:        { width: 160, height: 160, bottom: -60, right: -40 },

  scroll:        { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card:          { backgroundColor: Colors.white, borderRadius: Radius.xxl, padding: Spacing.lg, marginTop: -20, ...Shadow.lg },
  heading:       { fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold, color: Colors.gray900 },
  subheading:    { fontSize: FontSize.sm, color: Colors.gray500, marginTop: 3 },

  forgotBtn:     { alignSelf: 'flex-end', marginTop: -6, marginBottom: Spacing.md },
  forgotText:    { fontSize: FontSize.sm, color: Colors.teal, fontWeight: FontWeight.medium },

  demoCard:      { backgroundColor: Colors.gray50, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  demoTitle:     { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.teal, textTransform: 'uppercase', letterSpacing: 0.5 },
  demoRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  demoRoleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  demoRoleText:  { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  demoCredText:  { flex: 1, fontSize: FontSize.sm, color: Colors.gray600, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  footer:        { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.lg },
  footerText:    { fontSize: FontSize.md, color: Colors.gray500 },
  footerLink:    { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.teal },
});
