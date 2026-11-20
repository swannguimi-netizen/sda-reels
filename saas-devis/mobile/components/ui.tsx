import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type ColorValue, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'

export const C = {
  brand: '#4f46e5', brandDark: '#4338ca', brandSoft: '#eef2ff',
  bg: '#f8fafc', card: '#ffffff', border: '#e2e8f0',
  text: '#0f172a', muted: '#64748b', faint: '#94a3b8',
  green: '#059669', greenSoft: '#ecfdf5', red: '#dc2626', redSoft: '#fef2f2', amber: '#b45309', amberSoft: '#fffbeb', sky: '#0369a1', skySoft: '#e0f2fe',
}

/** Icône multiplateforme : SF Symbols (iOS), Material Symbols (Android, web). */
export function Icon({ ios, android, size = 20, color = C.muted }: { ios: string; android: string; size?: number; color?: ColorValue }) {
  const name = { ios, android, web: android } as unknown as SymbolViewProps['name']
  return <SymbolView name={name} size={size} tintColor={color as string} />
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; loading?: boolean; disabled?: boolean; icon?: ReactNode; style?: ViewStyle
}) {
  const v = variant === 'primary' ? s.btnPrimary : variant === 'danger' ? s.btnDanger : s.btnSecondary
  const tc = variant === 'secondary' ? C.text : '#fff'
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [s.btn, v, (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 }, style]}>
      {loading ? <ActivityIndicator color={tc} /> : icon}
      <Text style={[s.btnText, { color: tc }]}>{title}</Text>
    </Pressable>
  )
}

export function Badge({ label, tone }: { label: string; tone: 'slate' | 'sky' | 'green' | 'red' | 'amber' | 'violet' }) {
  const t = {
    slate: ['#f1f5f9', '#334155'], sky: [C.skySoft, C.sky], green: [C.greenSoft, C.green], red: [C.redSoft, C.red],
    amber: [C.amberSoft, C.amber], violet: ['#f5f3ff', '#6d28d9'],
  }[tone]
  return <Text style={[s.badge, { backgroundColor: t[0], color: t[1] }]}>{label}</Text>
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={C.faint} {...props} style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, props.style]} />
    </View>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.section}>{children}</Text>
      {right}
    </View>
  )
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 6 }}>
      <Text style={{ fontWeight: '600', color: C.text, fontSize: 16 }}>{title}</Text>
      <Text style={{ color: C.muted, textAlign: 'center', maxWidth: 280 }}>{text}</Text>
      {action && <View style={{ marginTop: 12 }}>{action}</View>}
    </View>
  )
}

export function Loading() {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.brand} size="large" /></View>
}

export const QUOTE_TONE = { draft: 'slate', sent: 'sky', accepted: 'green', refused: 'red', expired: 'amber' } as const

export const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnPrimary: { backgroundColor: C.brand },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  btnDanger: { backgroundColor: C.red },
  btnText: { fontSize: 16, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  label: { fontSize: 14, fontWeight: '500', color: '#334155' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: C.text, backgroundColor: '#fff' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  section: { fontSize: 13, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  screen: { padding: 16, gap: 12, paddingBottom: 40 },
  h1: { fontSize: 26, fontWeight: '700', color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  muted: { color: C.muted, fontSize: 14 },
  strong: { color: C.text, fontWeight: '600', fontSize: 16 },
})
