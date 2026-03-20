import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle, Image, Pressable, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize, FontWeight, Shadow, STATUS_CONFIG } from '../../constants/theme';

// ─── Button ───────────────────────────────────────────────────────────────────

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title, onPress, variant = 'primary', size = 'md',
  loading, disabled, icon, iconRight = false, style, fullWidth = true,
}) => {
  const isDisabled = disabled || loading;
  const [pressed, setPressed] = useState(false);

  const containerStyle: ViewStyle = {
    ...styles.btn,
    ...variantBtnStyle[variant],
    ...sizeBtnStyle[size],
    ...(fullWidth ? { alignSelf: 'stretch' } : {}),
    ...(isDisabled ? styles.btn_disabled : {}),
    ...(pressed && !isDisabled ? { transform: [{ scale: 0.98 }] } : {}),
    ...(style as object || {}),
  };
  const iconColor = ['primary', 'secondary', 'danger', 'gold'].includes(variant) ? Colors.white
    : variant === 'outline' ? Colors.teal : Colors.teal;
  const ic = size === 'sm' ? 15 : size === 'lg' ? 22 : 18;

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={isDisabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      activeOpacity={0.9}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} size="small" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {icon && !iconRight && <Ionicons name={icon} size={ic} color={iconColor} />}
          <Text style={{ ...variantTextStyle[variant], ...sizeTextStyle[size] }}>{title}</Text>
          {icon && iconRight && <Ionicons name={icon} size={ic} color={iconColor} />}
        </View>
      )}
    </TouchableOpacity>
  );
};

const variantBtnStyle: Record<string, ViewStyle> = {
  primary:   { backgroundColor: Colors.teal,    ...Shadow.teal },
  secondary: { backgroundColor: Colors.navy,    ...Shadow.sm },
  outline:   { backgroundColor: 'transparent',  borderWidth: 1.5, borderColor: Colors.teal },
  ghost:     { backgroundColor: 'transparent' },
  danger:    { backgroundColor: Colors.error,   ...Shadow.sm },
  gold:      { backgroundColor: Colors.gold,    ...Shadow.gold },
};
const variantTextStyle: Record<string, TextStyle> = {
  primary:   { color: Colors.white,  fontWeight: FontWeight.semibold },
  secondary: { color: Colors.white,  fontWeight: FontWeight.semibold },
  outline:   { color: Colors.teal,   fontWeight: FontWeight.semibold },
  ghost:     { color: Colors.teal,   fontWeight: FontWeight.semibold },
  danger:    { color: Colors.white,  fontWeight: FontWeight.semibold },
  gold:      { color: Colors.white,  fontWeight: FontWeight.bold },
};
const sizeBtnStyle: Record<string, ViewStyle> = {
  sm: { paddingVertical: 9,  paddingHorizontal: 16, borderRadius: Radius.md },
  md: { paddingVertical: 14, paddingHorizontal: 22, borderRadius: Radius.lg },
  lg: { paddingVertical: 17, paddingHorizontal: 28, borderRadius: Radius.xl },
};
const sizeTextStyle: Record<string, TextStyle> = {
  sm: { fontSize: FontSize.sm },
  md: { fontSize: FontSize.base },
  lg: { fontSize: FontSize.lg },
};

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad' | 'decimal-pad';
  multiline?: boolean;
  numberOfLines?: number;
  error?: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rightElement?: React.ReactNode;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
  maxLength?: number;
}

export const Input: React.FC<InputProps> = ({
  label, placeholder, value, onChangeText, secureTextEntry,
  keyboardType = 'default', multiline, numberOfLines = 4, error, hint,
  icon, rightElement, autoCapitalize, editable = true, maxLength,
}) => {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const isMulti = multiline;

  return (
    <View style={{ marginBottom: Spacing.md }}>
      {label && (
        <Text style={styles.inputLabel}>
          {label}
        </Text>
      )}
      <View style={[
        styles.inputWrap,
        focused && styles.inputFocused,
        !!error && styles.inputError,
        !editable && styles.inputDisabled,
        isMulti && { alignItems: 'flex-start', paddingTop: 12 },
      ]}>
        {icon && (
          <Ionicons
            name={icon}
            size={17}
            color={focused ? Colors.teal : Colors.gray400}
            style={{ marginRight: 8, marginTop: isMulti ? 2 : 0 }}
          />
        )}
        <TextInput
          style={[
            styles.inputField,
            isMulti && { height: numberOfLines * 22, textAlignVertical: 'top', paddingTop: 0 },
          ]}
          placeholder={placeholder}
          placeholderTextColor={Colors.gray300}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !visible}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={isMulti ? numberOfLines : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize={autoCapitalize ?? (keyboardType === 'email-address' ? 'none' : 'sentences')}
          editable={editable}
          maxLength={maxLength}
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setVisible(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={17} color={Colors.gray400} />
          </TouchableOpacity>
        )}
        {rightElement}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }}>
          <Ionicons name="alert-circle-outline" size={13} color={Colors.error} />
          <Text style={styles.inputErrorText}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.inputHint}>{hint}</Text>
      ) : null}
    </View>
  );
};

// ─── Card ─────────────────────────────────────────────────────────────────────

export const Card: React.FC<{
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  padding?: number;
}> = ({ children, style, onPress, padding = Spacing.md }) => {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          { padding },
          pressed && { opacity: 0.97, transform: [{ scale: 0.993 }] },
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, { padding }, style]}>{children}</View>;
};

// ─── Badge / Chip ─────────────────────────────────────────────────────────────

export const Badge: React.FC<{
  label: string;
  color?: string;
  bg?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'xs' | 'sm' | 'md';
}> = ({ label, color = Colors.teal, bg, icon, size = 'sm' }) => {
  const bgColor = bg ?? color + '18';
  const fs = size === 'xs' ? 10 : size === 'md' ? 13 : 11;
  const px = size === 'xs' ? 6 : size === 'md' ? 12 : 8;
  const py = size === 'xs' ? 2 : size === 'md' ? 6 : 4;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: bgColor, paddingHorizontal: px, paddingVertical: py, borderRadius: Radius.full }}>
      {icon && <Ionicons name={icon} size={fs} color={color} />}
      <Text style={{ fontSize: fs, fontWeight: FontWeight.semibold, color }}>{label}</Text>
    </View>
  );
};

export const StatusBadge: React.FC<{ status: string; size?: 'xs' | 'sm' | 'md' }> = ({ status, size = 'sm' }) => {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: Colors.gray500, bg: Colors.gray100 };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: cfg.bg, paddingHorizontal: size === 'sm' ? 8 : 12, paddingVertical: size === 'sm' ? 4 : 6, borderRadius: Radius.full }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: cfg.color }} />
      <Text style={{ fontSize: size === 'sm' ? 11 : 13, fontWeight: FontWeight.semibold, color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
};

// ─── Avatar ───────────────────────────────────────────────────────────────────

export const Avatar: React.FC<{
  uri?: string | null;
  name?: string | null;
  size?: number;
  online?: boolean;
}> = ({ uri, name, size = 44, online }) => {
  const initials = name
    ? name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';
  const r = size / 2;
  const fs = size * 0.36;
  return (
    <View style={{ position: 'relative' }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r, backgroundColor: Colors.gray200 }} />
      ) : (
        <View style={{ width: size, height: size, borderRadius: r, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.white, fontSize: fs, fontWeight: FontWeight.bold }}>{initials}</Text>
        </View>
      )}
      {online && (
        <View style={{ position: 'absolute', bottom: 1, right: 1, width: size * 0.25, height: size * 0.25, borderRadius: size * 0.125, backgroundColor: Colors.success, borderWidth: 2, borderColor: Colors.white }} />
      )}
    </View>
  );
};

// ─── StarRating ───────────────────────────────────────────────────────────────

export const StarRating: React.FC<{
  rating: number;
  size?: number;
  showValue?: boolean;
  count?: number;
}> = ({ rating, size = 13, showValue, count }) => {
  const r = parseFloat(String(rating)) || 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={i <= Math.round(r) ? 'star' : 'star-outline'}
          size={size}
          color={Colors.gold}
        />
      ))}
      {showValue && (
        <Text style={{ fontSize: size, color: Colors.gray500, marginLeft: 3 }}>
          {r.toFixed(1)}{count ? ` (${count})` : ''}
        </Text>
      )}
    </View>
  );
};

// ─── LoadingSpinner ───────────────────────────────────────────────────────────

export const LoadingSpinner: React.FC<{
  fullScreen?: boolean;
  message?: string;
  color?: string;
}> = ({ fullScreen, message, color = Colors.teal }) => (
  <View style={[{ flex: fullScreen ? 1 : 0, alignItems: 'center', justifyContent: 'center', gap: 14, padding: Spacing.xl }, fullScreen && { backgroundColor: Colors.surface }]}>
    <ActivityIndicator size="large" color={color} />
    {message && <Text style={{ fontSize: FontSize.md, color: Colors.gray500 }}>{message}</Text>}
  </View>
);

// ─── EmptyState ───────────────────────────────────────────────────────────────

export const EmptyState: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}> = ({ icon, title, message, action }) => (
  <View style={{ alignItems: 'center', padding: Spacing.xxl, gap: Spacing.md }}>
    <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.tealXLight, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={40} color={Colors.teal} />
    </View>
    <Text style={{ fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.gray800, textAlign: 'center' }}>{title}</Text>
    {message && <Text style={{ fontSize: FontSize.md, color: Colors.gray500, textAlign: 'center', lineHeight: 22, maxWidth: 280 }}>{message}</Text>}
    {action && (
      <Button title={action.label} onPress={action.onPress} fullWidth={false} style={{ marginTop: 4, paddingHorizontal: Spacing.xl }} />
    )}
  </View>
);

// ─── Divider ─────────────────────────────────────────────────────────────────

export const Divider: React.FC<{ label?: string; style?: ViewStyle }> = ({ label, style }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.md }, style]}>
    <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
    {label && <Text style={{ fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.medium }}>{label}</Text>}
    <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
  </View>
);

// ─── SectionHeader ────────────────────────────────────────────────────────────

export const SectionHeader: React.FC<{
  title: string;
  action?: { label: string; onPress: () => void };
  style?: ViewStyle;
}> = ({ title, action, style }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm }, style]}>
    <Text style={{ fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray900 }}>{title}</Text>
    {action && (
      <TouchableOpacity onPress={action.onPress}>
        <Text style={{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.teal }}>{action.label}</Text>
      </TouchableOpacity>
    )}
  </View>
);

// ─── StatCard ─────────────────────────────────────────────────────────────────

export const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  style?: ViewStyle;
}> = ({ label, value, icon, color = Colors.teal, style }) => (
  <View style={[{ flex: 1, backgroundColor: color + '10', borderRadius: Radius.lg, padding: Spacing.md, gap: 6 }, style]}>
    {icon && <Ionicons name={icon} size={20} color={color} />}
    <Text style={{ fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold, color }}>{value}</Text>
    <Text style={{ fontSize: FontSize.xs, color: Colors.gray500, fontWeight: FontWeight.medium }}>{label}</Text>
  </View>
);

// ─── RowItem ──────────────────────────────────────────────────────────────────

export const RowItem: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  rightElement?: React.ReactNode;
}> = ({ icon, iconColor = Colors.teal, label, value, onPress, danger, rightElement }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={!onPress}
    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: Spacing.md }}
    activeOpacity={0.7}
  >
    <View style={{ width: 36, height: 36, borderRadius: Radius.md, backgroundColor: (danger ? Colors.error : iconColor) + '15', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={18} color={danger ? Colors.error : iconColor} />
    </View>
    <Text style={{ flex: 1, fontSize: FontSize.base, color: danger ? Colors.error : Colors.gray800, fontWeight: FontWeight.medium }}>{label}</Text>
    {value && <Text style={{ fontSize: FontSize.sm, color: Colors.gray500 }}>{value}</Text>}
    {rightElement}
    {onPress && !rightElement && <Ionicons name="chevron-forward" size={16} color={Colors.gray300} />}
  </TouchableOpacity>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btn_disabled: { opacity: 0.45 },

  inputLabel:     { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700, marginBottom: 7 },
  inputWrap:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, backgroundColor: Colors.white, minHeight: 52 },
  inputFocused:   { borderColor: Colors.teal, ...Shadow.xs },
  inputError:     { borderColor: Colors.error },
  inputDisabled:  { backgroundColor: Colors.gray50 },
  inputField:     { flex: 1, fontSize: FontSize.base, color: Colors.gray900, paddingVertical: 14 },
  inputErrorText: { fontSize: FontSize.xs, color: Colors.error },
  inputHint:      { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 5 },

  card: { backgroundColor: Colors.card, borderRadius: Radius.xl, ...Shadow.md },
});

// ─── Modal ────────────────────────────────────────────────────────────────────

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <View style={StyleSheet.absoluteFill as ViewStyle} pointerEvents="box-none">
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: Colors.white, borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
        padding: Spacing.lg, paddingBottom: 36, maxHeight: '90%',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg }}>
          <Text style={{ fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.navy }}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Ionicons name="close" size={22} color={Colors.gray500} />
          </TouchableOpacity>
        </View>
        {children}
      </View>
    </View>
  );
};
