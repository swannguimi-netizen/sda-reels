import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { dateFr, eur } from '@/lib/format'
import { QUOTE_STATUS, quoteDisplayStatus, type QuoteStatus } from '../../../src/lib/documents'
import { Badge, C, Empty, Button, Icon, QUOTE_TONE, s } from '@/components/ui'

interface Row { id: string; number: string; title: string | null; status: QuoteStatus; valid_until: string | null; total_ttc: number; issue_date: string; ai_generated: boolean; client: { name: string; company_name: string | null } | null }
const FILTERS: Array<[string, string]> = [['all', 'Tous'], ['draft', 'Brouillons'], ['sent', 'En attente'], ['accepted', 'Acceptés'], ['closed', 'Refusés']]

export default function QuotesList() {
  const { company } = useAuth()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!company) return
    const { data } = await supabase.from('quotes').select('id, number, title, status, valid_until, total_ttc, issue_date, ai_generated, client:clients(name, company_name)')
      .eq('company_id', company.id).order('created_at', { ascending: false }).limit(200)
    setRows((data as unknown as Row[]) ?? [])
  }, [company])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const visible = useMemo(() => (rows ?? []).filter((r) => {
    const st = quoteDisplayStatus(r)
    return filter === 'all' || (filter === 'closed' ? st === 'refused' || st === 'expired' : st === filter)
  }), [rows, filter])

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {FILTERS.map(([k, label]) => (
          <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="button" accessibilityState={{ selected: filter === k }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: filter === k ? C.brand : '#fff', borderWidth: 1, borderColor: filter === k ? C.brand : C.border }}>
            <Text style={{ color: filter === k ? '#fff' : C.text, fontWeight: '500' }}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList data={visible} keyExtractor={(r) => r.id} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 100, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
        ListEmptyComponent={rows ? <Empty title="Aucun devis" text="Créez votre premier devis depuis le chantier, en quelques secondes avec l’IA." /> : undefined}
        renderItem={({ item: r }) => {
          const st = quoteDisplayStatus(r)
          return (
            <Pressable onPress={() => router.push(`/devis/${r.id}`)} accessibilityRole="button"
              style={({ pressed }) => [{ backgroundColor: pressed ? '#f1f5f9' : '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 }]}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.strong}>{r.number}{r.ai_generated ? '  ✨' : ''}</Text>
                <Text style={s.strong}>{eur(r.total_ttc)}</Text>
              </View>
              <Text style={s.muted} numberOfLines={1}>{r.client?.company_name ?? r.client?.name ?? 'Sans client'}{r.title ? ` · ${r.title}` : ''}</Text>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Badge label={QUOTE_STATUS[st].label} tone={QUOTE_TONE[st]} />
                <Text style={[s.muted, { fontSize: 12 }]}>{dateFr(r.issue_date)}</Text>
              </View>
            </Pressable>
          )
        }} />
      <View style={{ position: 'absolute', right: 16, bottom: 16 }}>
        <Button title="Nouveau" onPress={() => router.push('/devis/nouveau')} icon={<Icon ios="plus" android="add" color="#fff" />}
          style={{ borderRadius: 999, paddingHorizontal: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 }} />
      </View>
    </View>
  )
}
