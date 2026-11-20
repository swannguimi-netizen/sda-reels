import type React from 'react'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { supabase } from '@/lib/supabase'
import { C, Icon, Loading, s } from '@/components/ui'

interface Msg { id: string; role: 'visitor' | 'assistant' | 'agent' | 'system'; content: string; created_at: string }
interface Conv { id: string; company_id: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; visitor_id: string; mode: 'ai' | 'human'; unread: boolean; lead: { need: string | null; details: string | null } | null }

export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [conv, setConv] = useState<Conv | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<FlatList<Msg>>(null)

  const load = useCallback(async () => {
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from('conversations').select('*, lead:leads!conversations_lead_id_company_id_fkey(need, details)').eq('id', id).single(),
      supabase.from('messages').select('id, role, content, created_at').eq('conversation_id', id).order('created_at'),
    ])
    setConv(c as unknown as Conv)
    setMsgs((m as Msg[]) ?? [])
    if ((c as Conv | null)?.unread) await supabase.from('conversations').update({ unread: false }).eq('id', id)
  }, [id])

  useEffect(() => {
    load()
    const ch = supabase.channel(`m-msg-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => {
        setMsgs((m) => (m.some((x) => x.id === p.new.id) ? m : [...m, p.new as Msg]))
        supabase.from('conversations').update({ unread: false }).eq('id', id)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, load])

  if (!conv) return <Loading />
  const name = conv.contact_name || conv.contact_email || `Visiteur #${conv.visitor_id.slice(-4)}`

  async function send() {
    const content = text.trim()
    if (!content) return
    setSending(true)
    const { data, error } = await supabase.from('messages').insert({ conversation_id: conv!.id, company_id: conv!.company_id, role: 'agent', content }).select('id, role, content, created_at').single()
    setSending(false)
    if (error) return Alert.alert('Erreur', error.message)
    setText('')
    setMsgs((m) => (m.some((x) => x.id === data.id) ? m : [...m, data as Msg]))
    setConv({ ...conv!, mode: 'human' })
  }

  async function toggleMode() {
    const mode = conv!.mode === 'ai' ? 'human' : 'ai'
    await supabase.from('conversations').update({ mode }).eq('id', conv!.id)
    setConv({ ...conv!, mode })
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: name, headerRight: () => (
        <Pressable onPress={toggleMode} style={{ paddingHorizontal: 8 }} accessibilityRole="button">
          <Text style={{ color: C.brand, fontWeight: '600' }}>{conv.mode === 'ai' ? 'Reprendre' : 'Rendre à l’IA'}</Text>
        </Pressable>
      ) }} />
      {(conv.contact_phone || conv.contact_email || conv.lead?.need) && (
        <View style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.border, padding: 12, gap: 8 }}>
          {conv.lead?.need && <Text style={{ color: C.amber, fontWeight: '600' }}>Demande : {conv.lead.need}</Text>}
          <View style={s.row}>
            {conv.contact_phone && <QuickAction label="Appeler" onPress={() => Linking.openURL(`tel:${conv.contact_phone}`)} icon={<Icon ios="phone.fill" android="call" color={C.green} size={18} />} />}
            {conv.contact_phone && <QuickAction label="SMS" onPress={() => Linking.openURL(`sms:${conv.contact_phone}`)} icon={<Icon ios="message.fill" android="sms" color={C.sky} size={18} />} />}
            {conv.contact_email && <QuickAction label="Email" onPress={() => Linking.openURL(`mailto:${conv.contact_email}`)} icon={<Icon ios="envelope.fill" android="mail" color={C.brand} size={18} />} />}
          </View>
        </View>
      )}
      <FlatList ref={list} data={msgs} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item: m }) => {
          const mine = m.role !== 'visitor'
          return (
            <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <Text style={{ fontSize: 11, color: C.faint, marginBottom: 2 }}>
                {m.role === 'assistant' ? 'Assistant · ' : m.role === 'agent' ? 'Vous · ' : ''}{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
              <View style={{ maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18,
                backgroundColor: m.role === 'visitor' ? '#fff' : m.role === 'agent' ? C.brand : C.brandSoft,
                borderWidth: m.role === 'visitor' ? 1 : 0, borderColor: C.border }}>
                <Text style={{ color: m.role === 'agent' ? '#fff' : C.text, fontSize: 15, lineHeight: 21 }}>{m.content}</Text>
              </View>
            </View>
          )
        }} />
      <View style={{ padding: 10, borderTopWidth: 1, borderColor: C.border, backgroundColor: '#fff', gap: 6 }}>
        {conv.mode === 'ai' && <Text style={[s.muted, { fontSize: 12 }]}>En répondant, vous prenez la main : l’assistant n’interviendra plus ici.</Text>}
        <View style={s.row}>
          <TextInput value={text} onChangeText={setText} placeholder="Votre réponse…" placeholderTextColor={C.faint} multiline style={[s.input, { flex: 1, maxHeight: 120 }]} />
          <Pressable onPress={send} disabled={sending || !text.trim()} accessibilityLabel="Envoyer"
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', opacity: sending || !text.trim() ? 0.5 : 1 }}>
            <Icon ios="paperplane.fill" android="send" color="#fff" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

function QuickAction({ label, onPress, icon }: { label: string; onPress: () => void; icon: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border }}>
      {icon}<Text style={{ color: C.text, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  )
}
