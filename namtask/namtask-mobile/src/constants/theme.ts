// ─── Nam Task Design System ───────────────────────────────────────────────────
// Palette: Teal (brand) · Gold (action) · Navy (depth)

export const Colors = {
  teal:          '#0D9488',
  tealDark:      '#0F766E',
  tealLight:     '#14B8A6',
  tealXLight:    '#CCFBF1',
  tealGlass:     'rgba(13,148,136,0.12)',

  gold:          '#D4A017',
  goldDark:      '#B8860B',
  goldLight:     '#F0C040',
  goldXLight:    '#FEF9C3',
  goldGlass:     'rgba(212,160,23,0.12)',

  navy:          '#0F172A',
  navyMid:       '#1E293B',
  navyLight:     '#334155',
  navyGlass:     'rgba(15,23,42,0.12)',

  success:       '#10B981',
  successLight:  '#D1FAE5',
  warning:       '#F59E0B',
  warningLight:  '#FEF3C7',
  error:         '#EF4444',
  errorLight:    '#FEE2E2',
  info:          '#3B82F6',
  infoLight:     '#DBEAFE',

  white:         '#FFFFFF',
  black:         '#020617',
  surface:       '#F8FAFC',
  card:          '#FFFFFF',
  border:        '#E2E8F0',
  borderLight:   '#F1F5F9',
  overlay:       'rgba(15,23,42,0.55)',

  gray50:        '#F8FAFC',
  gray100:       '#F1F5F9',
  gray200:       '#E2E8F0',
  gray300:       '#CBD5E1',
  gray400:       '#94A3B8',
  gray500:       '#64748B',
  gray600:       '#475569',
  gray700:       '#334155',
  gray800:       '#1E293B',
  gray900:       '#0F172A',

  statusPending:    '#F59E0B',
  statusAccepted:   '#3B82F6',
  statusInProgress: '#8B5CF6',
  statusCompleted:  '#10B981',
  statusCancelled:  '#94A3B8',
  statusDisputed:   '#EF4444',

  // aliases
  primary:       '#0D9488',
  primaryDark:   '#0F766E',
  primaryLight:  '#14B8A6',
  secondary:     '#0F172A',
  secondaryMid:  '#1E293B',
  secondaryLight:'#334155',
  accent:        '#D4A017',
  accentLight:   '#FEF9C3',
  background:    '#F8FAFC',
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64,
};

export const Radius = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, full: 9999,
};

export const FontSize = {
  xs: 11, sm: 13, md: 15, base: 16, lg: 18, xl: 20, xxl: 24, xxxl: 30, huge: 38,
};

export const FontWeight = {
  regular:   '400' as const,
  medium:    '500' as const,
  semibold:  '600' as const,
  bold:      '700' as const,
  extrabold: '800' as const,
  black:     '900' as const,
};

export const Shadow = {
  xs: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  sm: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  md: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 4 },
  lg: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 8 },
  gold: { shadowColor: '#D4A017', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 12, elevation: 6 },
  teal: { shadowColor: '#0D9488', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6 },
};

export const TASK_CATEGORIES = [
  { id: 'cleaning',   label: 'Cleaning',   icon: 'sparkles',            color: '#0D9488' },
  { id: 'delivery',   label: 'Delivery',   icon: 'bicycle',             color: '#D4A017' },
  { id: 'moving',     label: 'Moving',     icon: 'cube-outline',        color: '#8B5CF6' },
  { id: 'repairs',    label: 'Repairs',    icon: 'construct',           color: '#EF4444' },
  { id: 'tutoring',   label: 'Tutoring',   icon: 'book-outline',        color: '#10B981' },
  { id: 'errands',    label: 'Errands',    icon: 'bag-handle-outline',  color: '#F97316' },
  { id: 'caregiving', label: 'Caregiving', icon: 'heart-outline',       color: '#EC4899' },
  { id: 'other',      label: 'Other',      icon: 'apps-outline',        color: '#64748B' },
];

export const NAMIBIA_CITIES = [
  'Windhoek', 'Walvis Bay', 'Swakopmund', 'Oshakati',
  'Rundu', 'Gobabis', 'Keetmanshoop', 'Otjiwarongo', 'Grootfontein',
];

export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pending',     color: '#F59E0B', bg: '#FEF3C7' },
  accepted:    { label: 'Accepted',    color: '#3B82F6', bg: '#DBEAFE' },
  in_progress: { label: 'In Progress', color: '#8B5CF6', bg: '#EDE9FE' },
  completed:   { label: 'Completed',   color: '#10B981', bg: '#D1FAE5' },
  cancelled:   { label: 'Cancelled',   color: '#94A3B8', bg: '#F1F5F9' },
  disputed:    { label: 'Disputed',    color: '#EF4444', bg: '#FEE2E2' },
};
