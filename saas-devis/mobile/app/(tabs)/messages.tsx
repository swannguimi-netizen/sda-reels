import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { relative } from '@/lib/format'
import { Badge, C, Empty, s } from '@/components/ui'

interface Conv { id: string; contact_name: string | null; contact_email: string | null; visitor_id: string; unread: boolean; mode: 'ai' | 'human'; status: string; last_message_at: string; last_message_preview: string | null; lead: { is_quote_request: boolean } | null }
const label = (c: Conv) => c.contact_name || c.contact_email || `Visiteur #${c.visitor_id.slice(-4)}`

export default function Messages() {
  const { company } = useAuth()
  const [rows, setRows] = useState<Conv[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!company) return
    const { data } = await supabase.from('conversations').select('*, lead:leads!conversations_lead_id_company_id_fkey(is_quote_request)')
      .eq('company_id', company.id).eq('status', 'open').order('last_message_at', { ascending: false }).limit(100)
    setRows((data as unknown as Conv[]) ?? [])
  }, [company])
  useFocusEffect(useCallback(() => { load() }, [load]))

  // Mise à jour en direct
  useEffect(() => {
    if (!company) return
    const ch = supabase.channel(`m-conv-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `company_id=eq.${company.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [company, load])

  return (
    <FlatList data={rows ?? []} keyExtractor={(c) => c.id} contentContainerStyle={{ padding: 12, gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
      ListEmptyComponent={rows ? <Empty title="Aucune conversation" text="Les échanges de l’assistant avec les visiteurs de votre site arriveront ici." /> : undefined}
      renderItem={({ item: c }) => (
        <Pressable onPress={() => router.push(`/messages/${c.id}`)} accessibilityRole="button"
          style={({ pressed }) => [s.row, { backgroundColor: pressed ? '#f1f5f9' : '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 }]}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.brand, fontWeight: '700' }}>{label(c).charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={[s.strong, !c.unread && { fontWeight: '500' }]} numberOfLines={1}>{label(c)}</Text>
              <Text style={[s.muted, { fontSize: 12 }]}>{relative(c.last_message_at)}</Text>
            </View>
            <Text style={[s.muted, c.unread && { color: C.text }]} numberOfLines={1}>{c.last_message_preview ?? '…'}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {c.lead?.is_quote_request && <Badge label="Devis" tone="amber" />}
              {c.mode === 'human' && <Badge label="À traiter" tone="red" />}
            </View>
          </View>
          {c.unread && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.brand }} accessibilityLabel="Non lu" />}
        </Pressable>
      )} />
  )
}
