import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { useAuth } from '@/lib/auth'
import { APP_URL, supabase } from '@/lib/supabase'
import { registerForPush, unregisterPush, type PushStatus } from '@/lib/notifications'
import { relative } from '@/lib/format'
import { Button, C, Card, SectionTitle, s } from '@/components/ui'

interface Notif { id: string; title: string; body: string; created_at: string }

export default function Account() {
  const { session, fullName, company, companies, switchCompany, signOut } = useAuth()
  const [push, setPush] = useState<PushStatus | null>(null)
  const [notifs, setNotifs] = useState<Notif[]>([])

  useFocusEffect(useCallback(() => {
    if (!company) return
    supabase.from('notification_events').select('id, title, body, created_at').eq('company_id', company.id)
      .order('created_at', { ascending: false }).limit(15).then(({ data }) => setNotifs((data as Notif[]) ?? []))
  }, [company]))

  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Card>
        <Text style={s.strong}>{fullName ?? 'Mon compte'}</Text>
        <Text style={s.muted}>{session?.user.email}</Text>
      </Card>

      {companies.length > 1 && (
        <>
          <SectionTitle>Entreprise</SectionTitle>
          <Card style={{ padding: 0 }}>
            {companies.map((c, i) => (
              <Pressable key={c.id} onPress={() => switchCompany(c.id)} style={[s.row, { padding: 14, borderTopWidth: i ? 1 : 0, borderColor: C.border }]}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.id === company?.id ? C.brand : C.border }} />
                <Text style={s.strong}>{c.name}</Text>
              </Pressable>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>Recevoir les alertes</Text>
            <Text style={s.muted}>Devis signé, acompte, demande de devis, visiteur en attente, rendez-vous.</Text>
          </View>
          <Switch value={push === 'granted'} trackColor={{ true: C.brand }}
            onValueChange={async (v) => {
              if (!session) return
              if (v) setPush(await registerForPush(session.user.id))
              else { await unregisterPush(); setPush('denied') }
            }} />
        </View>
        {push === 'denied' && <Text style={[s.muted, { marginTop: 8 }]}>Autorisez les notifications dans les réglages du téléphone.</Text>}
        {push === 'unavailable' && <Text style={[s.muted, { marginTop: 8 }]}>Disponible sur un téléphone (pas sur simulateur ni sur le web).</Text>}
      </Card>
      {notifs.length > 0 && (
        <Card style={{ padding: 0 }}>
          {notifs.map((n, i) => (
            <View key={n.id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderColor: C.border, gap: 2 }}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={[s.strong, { fontSize: 15, flex: 1 }]} numberOfLines={1}>{n.title}</Text>
                <Text style={[s.muted, { fontSize: 12 }]}>{relative(n.created_at)}</Text>
              </View>
              <Text style={s.muted} numberOfLines={2}>{n.body}</Text>
            </View>
          ))}
        </Card>
      )}

      {!!APP_URL && <Button variant="secondary" title="Ouvrir l’application web" onPress={() => Linking.openURL(APP_URL)} />}
      <Button variant="secondary" title="Se déconnecter" onPress={async () => { await unregisterPush(); await signOut() }} />
    </ScrollView>
  )
}
