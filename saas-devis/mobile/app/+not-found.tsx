import { Link, Stack } from 'expo-router'
import { Text, View } from 'react-native'
import { C } from '@/components/ui'

export default function NotFound() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Introuvable' }} />
      <Text style={{ fontSize: 18, fontWeight: '600' }}>Cette page n’existe pas.</Text>
      <Link href="/" style={{ color: C.brand }}>Retour à l’accueil</Link>
    </View>
  )
}
