// Envoie les notifications en attente vers l'application mobile (service Expo Push).
// Appelée chaque minute par pg_cron (en-tête x-cron-secret = CRON_SECRET).
// Secrets : CRON_SECRET ; EXPO_ACCESS_TOKEN si la « sécurité des notifications » est activée sur Expo.
import { json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/supabase.ts'

const CRON_SECRET = Deno.env.get('CRON_SECRET')
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

interface Pending { id: string; title: string; body: string; url: string | null; tokens: string[] }
interface Ticket { status: 'ok' | 'error'; message?: string; details?: { error?: string } }

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'Accès refusé' }, 401)
  const admin = adminClient()
  const { data, error } = await admin.rpc('pending_notifications', { p_limit: 100 })
  if (error) return json({ error: error.message }, 500)
  const pending = (data ?? []) as Pending[]
  if (!pending.length) return json({ sent: 0 })

  // Un message par (événement, jeton), envoyés par lots de 100
  const messages = pending.flatMap((e) => e.tokens.map((to) => ({
    to, title: e.title, body: e.body, sound: 'default', channelId: 'default', priority: 'high',
    data: { url: e.url, eventId: e.id },
  })))
  const invalid = new Set<string>()
  let sent = 0
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100)
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch),
    })
    if (!res.ok) {
      console.error('Expo Push', res.status, await res.text())
      return json({ error: 'Service de notifications indisponible, nouvel essai à la prochaine minute.' }, 502)
    }
    const tickets = ((await res.json()).data ?? []) as Ticket[]
    tickets.forEach((t, j) => {
      if (t.status === 'ok') sent++
      else if (t.details?.error === 'DeviceNotRegistered') invalid.add(batch[j].to)
      else console.warn('Notification refusée', t.message)
    })
  }

  // Application désinstallée : le jeton est supprimé
  if (invalid.size) await admin.from('push_tokens').delete().in('token', [...invalid])
  await admin.from('notification_events').update({ dispatched_at: new Date().toISOString() }).in('id', pending.map((e) => e.id))
  return json({ events: pending.length, sent, removed_tokens: invalid.size })
})
