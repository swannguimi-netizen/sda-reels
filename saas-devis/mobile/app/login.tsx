import { useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { APP_URL, frenchAuthError, supabase } from '@/lib/supabase'
import { Button, C, Field, s } from '@/components/ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(frenchAuthError(error.message))
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <View style={{ gap: 6, marginBottom: 12 }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>D</Text>
          </View>
          <Text style={s.h1}>Devis & Assistant IA</Text>
          <Text style={s.muted}>Vos devis sur le chantier, vos clients dans la poche.</Text>
        </View>
        {error && <Text accessibilityRole="alert" style={{ color: C.red, backgroundColor: C.redSoft, padding: 12, borderRadius: 10 }}>{error}</Text>}
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
        <Button title="Se connecter" onPress={submit} loading={busy} disabled={!email || !password} />
        {!!APP_URL && (
          <Pressable onPress={() => Linking.openURL(`${APP_URL}/inscription`)} style={{ padding: 8 }}>
            <Text style={{ color: C.brand, textAlign: 'center' }}>Pas encore de compte ? Essai gratuit de 14 jours</Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
