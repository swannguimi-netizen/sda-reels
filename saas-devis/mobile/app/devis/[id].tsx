import * as Clipboard from 'expo-clipboard'
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Linking, ScrollView, Share, Text, View } from 'react-native'
import { invoke, publicQuoteUrl, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { dateFr, eur, unitLabel } from '@/lib/format'
import { QUOTE_STATUS, quoteDisplayStatus, type Quote } from '../../../src/lib/documents'
import { Badge, Button, C, Card, Icon, Loading, QUOTE_TONE, SectionTitle, s } from '@/components/ui'

type Item = { id: string; kind: string; description: string; quantity: number; unit: string; unit_price: number; total_ht: number }
type QuoteRow = Quote & { client: { name: string; email: string | null; phone: string | null } | null }

export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { company } = useAuth()
  const [q, setQ] = useState<QuoteRow | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data }, { data: it }] = await Promise.all([
      supabase.from('quotes').select('*, client:clients(name, email, phone)').eq('id', id).single(),
      supabase.from('quote_items').select('id, kind, description, quantity, unit, unit_price, total_ht').eq('quote_id', id).order('position'),
    ])
    setQ(data as QuoteRow)
    setItems((it as Item[]) ?? [])
  }, [id])
  useFocusEffect(useCallback(() => { load() }, [load]))

  if (!q || !company) return <Loading />
  const st = quoteDisplayStatus(q)
  const link = publicQuoteUrl(q.public_token)
  const clientName = q.client?.name ?? q.client_snapshot?.name ?? null

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try { await fn() } catch (e) { Alert.alert('Oups', (e as Error).message) }
    setBusy(null)
    load()
  }

  const sendEmail = () => run('email', async () => {
    const to = q.client?.email
    if (!to) throw new Error('Ce client n’a pas d’email : partagez plutôt le lien.')
    await invoke('send-document', {
      type: 'quote', id: q.id, to, subject: `Devis ${q.number} – ${company.name}`,
      message: `Bonjour${clientName ? ` ${clientName}` : ''},\n\nVeuillez trouver notre devis ${q.number}${q.title ? ` pour « ${q.title} »` : ''}, d’un montant de ${eur(q.total_ttc)}.\nVous pouvez le consulter et le signer en ligne grâce au lien ci-dessous.\n\nCordialement,\n${company.name}`,
    }, 'L’envoi a échoué.')
    Alert.alert('Envoyé', `Le devis a été envoyé à ${to}.`)
  })

  const shareLink = () => run('share', async () => {
    const r = await Share.share({ message: `Bonjour${clientName ? ` ${clientName}` : ''}, voici votre devis ${q.number} (${eur(q.total_ttc)}) à consulter et signer en ligne : ${link}` })
    if (r.action === Share.sharedAction && q.status === 'draft') await supabase.from('quotes').update({ status: 'sent' }).eq('id', q.id)
  })

  const remind = () => run('remind', async () => {
    await invoke('send-reminders', { type: 'quote', id: q.id }, 'La relance n’a pas pu être envoyée.')
    Alert.alert('Relance envoyée', 'Votre client a reçu un rappel par email.')
  })

  const markAccepted = () => Alert.alert('Devis accepté ?', 'Le client a accepté le devis hors ligne (téléphone, papier…).', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Marquer accepté', onPress: () => run('accept', async () => { await supabase.from('quotes').update({ status: 'accepted' }).eq('id', q.id) }) },
  ])

  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Stack.Screen options={{ title: q.number ?? 'Devis' }} />
      <Card style={{ gap: 6 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Badge label={QUOTE_STATUS[st].label} tone={QUOTE_TONE[st]} />
          <Text style={[s.muted, { fontSize: 12 }]}>Valable jusqu’au {dateFr(q.valid_until)}</Text>
        </View>
        <Text style={[s.h1, { fontSize: 30 }]}>{eur(q.total_ttc)}</Text>
        {q.title && <Text style={s.strong}>{q.title}</Text>}
        <Text style={s.muted}>{clientName ?? 'Sans client'}</Text>
        {q.status === 'accepted' && (
          <Text style={{ color: C.green, fontWeight: '600', marginTop: 4 }}>
            {q.signed_by_name ? `Signé par ${q.signed_by_name}` : 'Accepté'} le {dateFr(q.accepted_at)}{q.deposit_paid_at ? ' · acompte reçu' : q.deposit_percent > 0 ? ` · acompte ${eur(q.deposit_amount)} en attente` : ''}
          </Text>
        )}
        {q.status === 'sent' && <Text style={s.muted}>{q.viewed_at ? `Consulté par le client le ${dateFr(q.viewed_at)}` : 'Pas encore ouvert par le client'}</Text>}
      </Card>

      {(q.status === 'draft' || q.status === 'sent') && (
        <View style={{ gap: 8 }}>
          <Button title={q.status === 'draft' ? 'Envoyer par email' : 'Renvoyer par email'} onPress={sendEmail} loading={busy === 'email'}
            disabled={!q.client?.email} icon={<Icon ios="paperplane.fill" android="send" color="#fff" />} />
          <Button variant="secondary" title="Partager (WhatsApp, SMS…)" onPress={shareLink} loading={busy === 'share'} icon={<Icon ios="square.and.arrow.up" android="share" />} />
          {q.status === 'sent' && (
            <View style={s.row}>
              <Button variant="secondary" title="Relancer" onPress={remind} loading={busy === 'remind'} style={{ flex: 1 }} />
              <Button variant="secondary" title="Accepté" onPress={markAccepted} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      )}

      {q.status === 'accepted' && !q.work_completed_at && (
        <Button title="Prestation terminée" onPress={() => Alert.alert('Prestation terminée ?', 'Une demande d’avis Google partira automatiquement vers le client si l’option est activée.', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Confirmer', onPress: () => run('done', async () => { await supabase.from('quotes').update({ work_completed_at: new Date().toISOString() }).eq('id', q.id) }) },
        ])} loading={busy === 'done'} icon={<Icon ios="checkmark.seal.fill" android="verified" color="#fff" />} />
      )}
      {q.work_completed_at && <Text style={[s.muted, { textAlign: 'center' }]}>Prestation terminée le {dateFr(q.work_completed_at)}</Text>}

      <SectionTitle>Détail</SectionTitle>
      <Card style={{ padding: 0 }}>
        {items.map((it, i) => (
          <View key={it.id} style={{ padding: 12, borderTopWidth: i ? 1 : 0, borderColor: C.border }}>
            {it.kind === 'item' ? (
              <View style={[s.row, { alignItems: 'flex-start' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text }}>{it.description}</Text>
                  <Text style={[s.muted, { fontSize: 12 }]}>{unitLabel(Number(it.quantity), it.unit)} × {eur(it.unit_price)}</Text>
                </View>
                <Text style={{ color: C.text, fontWeight: '600' }}>{eur(it.total_ht)}</Text>
              </View>
            ) : <Text style={{ color: it.kind === 'section' ? C.brand : C.muted, fontWeight: it.kind === 'section' ? '700' : '400', fontStyle: it.kind === 'note' ? 'italic' : 'normal' }}>{it.description}</Text>}
          </View>
        ))}
        <View style={{ padding: 12, borderTopWidth: 1, borderColor: C.border, gap: 2 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.muted}>Total HT</Text><Text>{eur(q.total_ht)}</Text></View>
          {q.vat_breakdown.map((v) => <View key={v.rate} style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.muted}>TVA {String(v.rate).replace('.', ',')} %</Text><Text>{eur(v.amount)}</Text></View>)}
        </View>
      </Card>

      {q.status !== 'draft' && (
        <View style={s.row}>
          <Button variant="secondary" title="Page client" onPress={() => Linking.openURL(link)} style={{ flex: 1 }} />
          <Button variant="secondary" title="Copier le lien" onPress={async () => { await Clipboard.setStringAsync(link); Alert.alert('Lien copié') }} style={{ flex: 1 }} />
        </View>
      )}
      {q.client?.phone && <Button variant="secondary" title={`Appeler ${q.client.name}`} onPress={() => Linking.openURL(`tel:${q.client!.phone}`)} icon={<Icon ios="phone.fill" android="call" color={C.green} />} />}
    </ScrollView>
  )
}
