// Disponibilités et réservation (serveur) : règles + rendez-vous existants + Google Agenda.
import type { adminClient } from './supabase.ts'
import { accessToken, deleteEvent, freeBusy, insertEvent } from './google.ts'
import { generateSlots, type Interval, type Slot } from './slots.ts'

type Admin = ReturnType<typeof adminClient>

export interface Context {
  timeZone: string
  minNoticeHours: number
  horizonDays: number
  companyName: string
}

export async function loadContext(admin: Admin, companyId: string): Promise<Context> {
  const { data: c } = await admin.from('companies').select('name, timezone, appointment_min_notice_hours, appointment_horizon_days').eq('id', companyId).single()
  return { timeZone: c!.timezone, minNoticeHours: c!.appointment_min_notice_hours, horizonDays: c!.appointment_horizon_days, companyName: c!.name }
}

export async function availableSlots(admin: Admin, companyId: string, opts: { from?: Date; to?: Date; max?: number } = {}): Promise<{ slots: Slot[]; ctx: Context }> {
  const ctx = await loadContext(admin, companyId)
  const now = new Date()
  const until = new Date(now.getTime() + ctx.horizonDays * 86_400_000)
  const [{ data: rules }, { data: appts }, { data: cal }] = await Promise.all([
    admin.from('availability_rules').select('weekday, start_time, end_time, slot_minutes').eq('company_id', companyId),
    admin.from('appointments').select('starts_at, ends_at').eq('company_id', companyId).in('status', ['pending', 'confirmed'])
      .lt('starts_at', until.toISOString()).gt('ends_at', now.toISOString()),
    admin.from('calendar_integrations').select('calendar_id').eq('company_id', companyId).maybeSingle(),
  ])
  const busy: Interval[] = (appts ?? []).map((a) => ({ start: new Date(a.starts_at), end: new Date(a.ends_at) }))
  if (cal) {
    try {
      const token = await accessToken(admin, companyId)
      if (token) busy.push(...await freeBusy(token, cal.calendar_id, now, until))
    } catch (e) {
      console.warn('Google Agenda indisponible, créneaux calculés sans lui', (e as Error).message)
    }
  }
  const slots = generateSlots({
    rules: rules ?? [], timeZone: ctx.timeZone, now, horizonDays: ctx.horizonDays, minNoticeHours: ctx.minNoticeHours,
    busy, from: opts.from, to: opts.to, max: opts.max,
  })
  return { slots, ctx }
}

/** Crée ou supprime l'événement Google correspondant au rendez-vous (au mieux). */
export async function syncGoogle(admin: Admin, appointmentId: string) {
  const { data: a } = await admin.from('appointments').select('*').eq('id', appointmentId).single()
  if (!a) return
  const { data: cal } = await admin.from('calendar_integrations').select('calendar_id').eq('company_id', a.company_id).maybeSingle()
  if (!cal) return
  try {
    const token = await accessToken(admin, a.company_id)
    if (!token) return
    const active = ['pending', 'confirmed'].includes(a.status)
    if (active && !a.google_event_id) {
      const { timeZone } = await loadContext(admin, a.company_id)
      const contact = [a.contact_name, a.contact_phone, a.contact_email].filter(Boolean).join(' · ')
      const id = await insertEvent(token, cal.calendar_id, {
        summary: `${a.title}${a.contact_name ? ` – ${a.contact_name}` : ''}`,
        description: [a.description, contact && `Contact : ${contact}`, a.source === 'assistant' ? 'Réservé par l’assistant IA.' : null].filter(Boolean).join('\n\n'),
        location: a.location, start: new Date(a.starts_at), end: new Date(a.ends_at), timeZone,
      })
      await admin.from('appointments').update({ google_event_id: id, google_sync_error: null }).eq('id', a.id)
    } else if (!active && a.google_event_id) {
      await deleteEvent(token, cal.calendar_id, a.google_event_id)
      await admin.from('appointments').update({ google_event_id: null, google_sync_error: null }).eq('id', a.id)
    }
  } catch (e) {
    await admin.from('appointments').update({ google_sync_error: (e as Error).message.slice(0, 300) }).eq('id', a.id)
  }
}

export async function book(admin: Admin, companyId: string, p: {
  start: Date; title: string; description: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null
  conversationId?: string | null; leadId?: string | null; clientId?: string | null; source: 'assistant' | 'manual'
}): Promise<{ ok: true; id: string; start: Date; end: Date } | { ok: false; reason: string }> {
  // Le créneau doit toujours être libre (règles, prévenance, agenda) au moment de réserver
  const { slots } = await availableSlots(admin, companyId, { from: new Date(p.start.getTime() - 60_000), to: new Date(p.start.getTime() + 8 * 3_600_000) })
  const slot = slots.find((s) => s.start.getTime() === p.start.getTime())
  if (!slot) return { ok: false, reason: 'Ce créneau n’est plus disponible.' }
  const { data, error } = await admin.from('appointments').insert({
    company_id: companyId, title: p.title.slice(0, 200), description: p.description, starts_at: slot.start.toISOString(), ends_at: slot.end.toISOString(),
    status: 'confirmed', contact_name: p.contactName, contact_email: p.contactEmail, contact_phone: p.contactPhone,
    conversation_id: p.conversationId ?? null, lead_id: p.leadId ?? null, client_id: p.clientId ?? null, source: p.source,
  }).select('id').single()
  if (error) return { ok: false, reason: error.code === '23P01' ? 'Ce créneau vient d’être réservé.' : error.message }
  await syncGoogle(admin, data.id)
  return { ok: true, id: data.id, start: slot.start, end: slot.end }
}
