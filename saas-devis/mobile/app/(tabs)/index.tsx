import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { eur } from '@/lib/format'
import { Button, C, Card, Icon, SectionTitle, s } from '@/components/ui'

interface Stats {
  signed_revenue_ht_this_month: number; pending_quotes_amount_ht: number; acceptance_rate: number | null
  unpaid_invoices_amount: number; overdue_invoices_count: number; unread_conversations: number
}
interface Todo { key: string; title: string; detail: string; href: string; tone: string }

const eur0 = (n: number) => eur(n).replace(/,00\s€$/, ' €')

export default function Home() {
  const { company, fullName } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [todos, setTodos] = useState<Todo[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!company) return
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const [{ data: st }, { data: req }, { data: human }, { data: follow }] = await Promise.all([
      supabase.rpc('dashboard_stats', { p_company_id: company.id }),
      supabase.from('leads').select('id, name, need, conversation_id').eq('company_id', company.id).eq('is_quote_request', true).eq('status', 'new').limit(5),
      supabase.from('conversations').select('id, contact_name').eq('company_id', company.id).eq('mode', 'human').eq('status', 'open').eq('unread', true).limit(5),
      supabase.from('quotes').select('id, number, total_ttc, client:clients(name)').eq('company_id', company.id).eq('status', 'sent').lt('sent_at', old).limit(5),
    ])
    setStats(st as Stats)
    setTodos([
      ...(req ?? []).map((l) => ({ key: `l${l.id}`, title: `Demande de devis${l.name ? ` – ${l.name}` : ''}`, detail: l.need ?? '', href: l.conversation_id ? `/messages/${l.conversation_id}` : '/messages', tone: C.amber })),
      ...(human ?? []).map((c) => ({ key: `c${c.id}`, title: `${c.contact_name ?? 'Un visiteur'} vous attend`, detail: 'Conversation à traiter', href: `/messages/${c.id}`, tone: C.red })),
      ...((follow ?? []) as unknown as Array<{ id: string; number: string; total_ttc: number; client: { name: string } | null }>).map((q) => ({
        key: `q${q.id}`, title: `Relancer ${q.client?.name ?? 'le client'}`, detail: `${q.number} · ${eur(q.total_ttc)}`, href: `/devis/${q.id}`, tone: C.sky })),
    ])
  }, [company])

  useFocusEffect(useCallback(() => { load() }, [load]))

  return (
    <ScrollView contentContainerStyle={s.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}>
      <Text style={s.h1}>Bonjour {fullName?.split(' ')[0] ?? ''}</Text>
      <Text style={s.muted}>{company?.name}</Text>

      <Button title="Nouveau devis" onPress={() => router.push('/devis/nouveau')} icon={<Icon ios="sparkles" android="auto_awesome" color="#fff" />} style={{ marginTop: 8 }} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Tile label="CA signé ce mois (HT)" value={stats ? eur0(stats.signed_revenue_ht_this_month) : '…'} />
        <Tile label="Devis en attente (HT)" value={stats ? eur0(stats.pending_quotes_amount_ht) : '…'} />
        <Tile label="Taux d’acceptation" value={stats ? (stats.acceptance_rate == null ? '—' : `${String(stats.acceptance_rate).replace('.', ',')} %`) : '…'} />
        <Tile label="Impayés (TTC)" value={stats ? eur0(stats.unpaid_invoices_amount) : '…'}
          hint={stats?.overdue_invoices_count ? `${stats.overdue_invoices_count} en retard` : undefined} />
      </View>

      <SectionTitle>À faire</SectionTitle>
      <Card style={{ padding: 0 }}>
        {todos.length === 0 ? <Text style={[s.muted, { padding: 16 }]}>Tout est à jour 👍</Text> : todos.map((t, i) => (
          <Pressable key={t.key} onPress={() => router.push(t.href as never)} accessibilityRole="button"
            style={({ pressed }) => [s.row, { padding: 14, borderTopWidth: i ? 1 : 0, borderColor: C.border, backgroundColor: pressed ? '#f1f5f9' : undefined }]}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.tone }} />
            <View style={{ flex: 1 }}>
              <Text style={s.strong} numberOfLines={1}>{t.title}</Text>
              {!!t.detail && <Text style={s.muted} numberOfLines={1}>{t.detail}</Text>}
            </View>
            <Icon ios="chevron.right" android="chevron_right" size={16} color={C.faint} />
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1, padding: 14 }}>
      <Text style={[s.muted, { fontSize: 13 }]}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '700', color: C.text, marginTop: 2 }}>{value}</Text>
      {hint && <Text style={{ color: C.red, fontSize: 12, fontWeight: '600' }}>{hint}</Text>}
    </Card>
  )
}
