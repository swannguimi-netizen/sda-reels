import { Stack, router, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { AuthProvider, useAuth } from '@/lib/auth'
import { isConfigured } from '@/lib/supabase'
import { registerForPush, useNotificationNavigation } from '@/lib/notifications'
import { C, Loading } from '@/components/ui'

export { ErrorBoundary } from 'expo-router'

function Gate() {
  const { loading, session, company } = useAuth()
  const segments = useSegments()
  const onLogin = segments[0] === 'login'

  useEffect(() => {
    if (loading) return
    if (!session && !onLogin) router.replace('/login')
    else if (session && onLogin) router.replace('/')
  }, [loading, session, onLogin])

  // Notifications : enregistrement de l'appareil à la connexion, ouverture de l'écran au toucher
  useEffect(() => { if (session) registerForPush(session.user.id) }, [session])
  useNotificationNavigation(!!session)

  if (loading) return <Loading />
  if (session && !company) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.bg }}>
        <Text style={{ textAlign: 'center', color: C.muted }}>Créez d’abord votre entreprise depuis l’application web, puis revenez ici.</Text>
      </View>
    )
  }
  return (
    <Stack screenOptions={{ headerTintColor: C.brand, headerTitleStyle: { color: C.text }, contentStyle: { backgroundColor: C.bg }, headerBackTitle: 'Retour' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="devis/nouveau" options={{ title: 'Nouveau devis', presentation: 'modal' }} />
      <Stack.Screen name="devis/[id]" options={{ title: 'Devis' }} />
      <Stack.Screen name="messages/[id]" options={{ title: 'Conversation' }} />
    </Stack>
  )
}

export default function RootLayout() {
  if (!isConfigured) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center' }}>Configuration requise : renseignez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY (fichier .env).</Text>
      </View>
    )
  }
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Gate />
    </AuthProvider>
  )
}
