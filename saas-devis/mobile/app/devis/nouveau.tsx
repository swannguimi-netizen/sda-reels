import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useAuth } from '@/lib/auth'
import { invoke, supabase } from '@/lib/supabase'
import { eur, parseNumber } from '@/lib/format'
import { computeTotals, newLine, toPayload, type LineItem } from '../../../src/lib/documents'
import { Button, C, Card, Field, Icon, SectionTitle, s } from '@/components/ui'

interface Client { id: string; name: string; company_name: string | null; email: string | null; phone: string | null; city: string | null }
interface Product { id: string; name: string; description: string | null; unit: string; unit_price: number; vat_rate: number }
interface Proposal { title: string; intro: string; lines: Array<Omit<LineItem, 'key' | 'discount_percent'> & { is_estimate: boolean }>; questions: string[] }

export default function NewQuote() {
  const { company } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [client, setClient] = useState<Client | null>(null)
  const [search, setSearch] = useState('')
  const [newClient, setNewClient] = useState<{ name: string; phone: string; email: string } | null>(null)
  const [description, setDescription] = useState('')
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<LineItem[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [picker, setPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const vatApplies = company?.vat_regime === 'assujetti'

  useEffect(() => {
    if (!company) return
    supabase.from('clients').select('id, name, company_name, email, phone, city').eq('company_id', company.id).order('name').then(({ data }) => setClients((data as Client[]) ?? []))
    supabase.from('products').select('id, name, description, unit, unit_price, vat_rate').eq('company_id', company.id).eq('is_active', true).order('name').then(({ data }) => setProducts((data as Product[]) ?? []))
  }, [company])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? clients.filter((c) => [c.name, c.company_name, c.phone, c.city].some((v) => v?.toLowerCase().includes(q))).slice(0, 5) : []
  }, [clients, search])
  const totals = computeTotals(lines, 0, company?.vat_regime ?? 'assujetti')

  async function generate() {
    if (description.trim().length < 10) return Alert.alert('Décrivez le chantier', 'Une phrase suffit, par exemple : « Remplacement d’un chauffe-eau 200 L, maison à Kourou ».')
    setAiBusy(true)
    try {
      const p = await invoke<Proposal>('generate-quote', { company_id: company!.id, client_id: client?.id ?? null, description: description.trim() }, 'La génération a échoué.')
      setLines(p.lines.map((l) => newLine({ ...l, vat_rate: vatApplies ? l.vat_rate : 0 })))
      setTitle((t) => t || p.title)
      setQuestions(p.questions)
    } catch (e) {
      Alert.alert('IA indisponible', (e as Error).message)
    }
    setAiBusy(false)
  }

  async function createClient() {
    if (!newClient?.name.trim()) return
    const { data, error } = await supabase.from('clients').insert({
      company_id: company!.id, name: newClient.name.trim(), phone: newClient.phone.trim() || null, email: newClient.email.trim().toLowerCase() || null, source: 'mobile',
    }).select('id, name, company_name, email, phone, city').single()
    if (error) return Alert.alert('Erreur', error.message)
    setClients([...clients, data as Client]); setClient(data as Client); setNewClient(null); setSearch('')
  }

  async function save() {
    const payload = toPayload(lines)
    if (!payload.length) return Alert.alert('Devis vide', 'Ajoutez au moins une ligne.')
    setSaving(true)
    const { data, error } = await supabase.from('quotes').insert({
      company_id: company!.id, client_id: client?.id ?? null, title: title.trim() || null, ai_generated: lines.length > 0 && !!description.trim(),
      deposit_percent: company!.deposit_percent,
    }).select('id').single()
    if (error) { setSaving(false); return Alert.alert('Erreur', error.message.includes('row-level security') ? 'Votre abonnement est inactif.' : error.message) }
    const { error: e2 } = await supabase.rpc('save_document_items', { p_doc_type: 'quote', p_doc_id: data.id, p_items: payload })
    setSaving(false)
    if (e2) return Alert.alert('Erreur', e2.message)
    router.replace(`/devis/${data.id}`)
  }

  const update = (key: string, patch: Partial<LineItem>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
        <SectionTitle>Client</SectionTitle>
        {client ? (
          <Card style={[s.row, { justifyContent: 'space-between' }]}>
            <View style={{ flex: 1 }}><Text style={s.strong}>{client.company_name ?? client.name}</Text><Text style={s.muted}>{[client.phone, client.email].filter(Boolean).join(' · ') || 'Sans coordonnées'}</Text></View>
            <Pressable onPress={() => setClient(null)} accessibilityLabel="Changer de client" style={{ padding: 8 }}><Icon ios="xmark.circle.fill" android="cancel" color={C.faint} /></Pressable>
          </Card>
        ) : newClient ? (
          <Card style={{ gap: 10 }}>
            <Field label="Nom" value={newClient.name} onChangeText={(v) => setNewClient({ ...newClient, name: v })} autoFocus />
            <Field label="Téléphone" value={newClient.phone} onChangeText={(v) => setNewClient({ ...newClient, phone: v })} keyboardType="phone-pad" />
            <Field label="Email" value={newClient.email} onChangeText={(v) => setNewClient({ ...newClient, email: v })} keyboardType="email-address" autoCapitalize="none" />
            <View style={s.row}><Button variant="secondary" title="Annuler" onPress={() => setNewClient(null)} style={{ flex: 1 }} /><Button title="Ajouter" onPress={createClient} style={{ flex: 1 }} /></View>
          </Card>
        ) : (
          <View style={{ gap: 8 }}>
            <TextInput placeholder="Rechercher un client…" placeholderTextColor={C.faint} value={search} onChangeText={setSearch} style={s.input} />
            {matches.map((c) => (
              <Pressable key={c.id} onPress={() => { setClient(c); setSearch('') }} style={{ padding: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
                <Text style={s.strong}>{c.company_name ?? c.name}</Text><Text style={s.muted}>{c.city ?? c.phone ?? ''}</Text>
              </Pressable>
            ))}
            <Button variant="secondary" title="Nouveau client" onPress={() => setNewClient({ name: search, phone: '', email: '' })} icon={<Icon ios="person.badge.plus" android="person_add" />} />
          </View>
        )}

        <SectionTitle>Décrire le chantier</SectionTitle>
        <Card style={{ gap: 10 }}>
          <TextInput multiline placeholder="Ex. Remplacement d’un chauffe-eau 200 L, maison de 15 ans à Kourou, évacuation de l’ancien. (Astuce : dictez avec le micro du clavier.)"
            placeholderTextColor={C.faint} value={description} onChangeText={setDescription} style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} />
          <Button title={aiBusy ? 'L’IA prépare votre devis…' : 'Proposer les lignes avec l’IA'} onPress={generate} loading={aiBusy}
            icon={!aiBusy ? <Icon ios="sparkles" android="auto_awesome" color="#fff" /> : undefined} />
          {questions.length > 0 && (
            <View style={{ backgroundColor: C.brandSoft, padding: 12, borderRadius: 10, gap: 4 }}>
              <Text style={{ fontWeight: '600', color: C.brandDark }}>À vérifier avec le client</Text>
              {questions.map((q) => <Text key={q} style={{ color: C.brandDark }}>• {q}</Text>)}
            </View>
          )}
        </Card>

        <SectionTitle right={<Text style={s.muted}>{lines.length} ligne{lines.length > 1 ? 's' : ''}</Text>}>Prestations</SectionTitle>
        <Field label="Objet du devis" value={title} onChangeText={setTitle} placeholder="Ex. Remplacement du chauffe-eau" />
        {lines.map((l) => (
          <Card key={l.key} style={{ gap: 8, padding: 12 }}>
            <View style={[s.row, { alignItems: 'flex-start' }]}>
              <TextInput multiline value={l.description} onChangeText={(v) => update(l.key, { description: v })} placeholder="Désignation" placeholderTextColor={C.faint}
                style={[s.input, { flex: 1, minHeight: 44 }]} />
              <Pressable onPress={() => setLines(lines.filter((x) => x.key !== l.key))} accessibilityLabel="Supprimer la ligne" style={{ padding: 10 }}><Icon ios="trash" android="delete" color={C.faint} /></Pressable>
            </View>
            <View style={s.row}>
              <NumField label="Qté" value={l.quantity} onChange={(n) => update(l.key, { quantity: n })} />
              <NumField label="Prix HT" value={l.unit_price} onChange={(n) => update(l.key, { unit_price: n })} />
              {vatApplies && <NumField label="TVA %" value={l.vat_rate} onChange={(n) => update(l.key, { vat_rate: n })} />}
            </View>
          </Card>
        ))}
        <View style={s.row}>
          <Button variant="secondary" title="Catalogue" onPress={() => setPicker(true)} style={{ flex: 1 }} icon={<Icon ios="shippingbox" android="inventory_2" />} />
          <Button variant="secondary" title="Ligne libre" onPress={() => setLines([...lines, newLine({ vat_rate: vatApplies ? company!.default_vat_rate : 0 })])} style={{ flex: 1 }} icon={<Icon ios="plus" android="add" />} />
        </View>

        <Card style={{ gap: 4 }}>
          <Row label="Total HT" value={eur(totals.total_ht)} />
          {totals.vat_breakdown.map((v) => <Row key={v.rate} label={`TVA ${String(v.rate).replace('.', ',')} %`} value={eur(v.amount)} />)}
          <Row label={vatApplies ? 'Total TTC' : 'Total'} value={eur(totals.total_ttc)} strong />
        </Card>
        <Button title="Enregistrer le devis" onPress={save} loading={saving} />
      </ScrollView>

      <Modal visible={picker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(false)}>
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={[s.row, { justifyContent: 'space-between', padding: 16 }]}>
            <Text style={s.h1}>Catalogue</Text>
            <Pressable onPress={() => setPicker(false)} style={{ padding: 8 }}><Text style={{ color: C.brand, fontSize: 16 }}>Fermer</Text></Pressable>
          </View>
          <FlatList data={products} keyExtractor={(p) => p.id} contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item: p }) => (
              <Pressable onPress={() => {
                setLines([...lines, newLine({ product_id: p.id, description: p.description ? `${p.name}\n${p.description}` : p.name, unit: p.unit, unit_price: Number(p.unit_price), vat_rate: vatApplies ? Number(p.vat_rate) : 0 })])
                setPicker(false)
              }} style={[s.row, { padding: 14, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border, justifyContent: 'space-between' }]}>
                <Text style={[s.strong, { flex: 1 }]}>{p.name}</Text>
                <Text style={s.muted}>{eur(p.unit_price)} / {p.unit}</Text>
              </Pressable>
            )} />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const [raw, setRaw] = useState(String(value).replace('.', ','))
  useEffect(() => { if (parseNumber(raw) !== value) setRaw(String(value).replace('.', ',')) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[s.muted, { fontSize: 12 }]}>{label}</Text>
      <TextInput keyboardType="decimal-pad" value={raw} onChangeText={(v) => { setRaw(v); onChange(parseNumber(v)) }} style={[s.input, { textAlign: 'right' }]} accessibilityLabel={label} />
    </View>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={strong ? s.strong : s.muted}>{label}</Text>
      <Text style={[strong ? s.strong : { color: C.text }, strong && { fontSize: 18 }]}>{value}</Text>
    </View>
  )
}
