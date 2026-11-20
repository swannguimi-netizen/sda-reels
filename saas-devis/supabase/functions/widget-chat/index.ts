// API publique du widget de chat (aucune authentification : la clé publique du widget identifie l'entreprise).
// Actions : config | message | poll
//
// Secrets : ANTHROPIC_API_KEY (CLAUDE_MODEL facultatif), RESEND_API_KEY / EMAIL_FROM / APP_URL (notifications)
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, SUPABASE_URL } from '../_shared/supabase.ts'
import { Anthropic, CLAUDE_MODEL, claude } from '../_shared/claude.ts'
import { emailLayout, sendEmail } from '../_shared/email.ts'
import { book, availableSlots, loadContext } from '../_shared/appointments.ts'
import { localParts, nowLabel, slotLabel, zonedToUtc } from '../_shared/slots.ts'
import {
  type AssistantSettings, assistantTools, buildSystemPrompt, isOriginAllowed, isValidEmail, type KnowledgeEntry,
  normalizePhone, type StoredMessage, suggestions, toHistory,
} from './assistant.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
const MAX_MESSAGE_LENGTH = 1000
const MAX_VISITOR_MESSAGES_10_MIN = 15
const MAX_TOOL_ROUNDS = 4
const OFFLINE_REPLY = 'Merci pour votre message ! Un membre de l’équipe va vous répondre ici même dès que possible. '
  + 'Pour être sûr de vous recontacter, pouvez-vous nous laisser votre email ou votre téléphone ?'

type Admin = ReturnType<typeof adminClient>

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const visitorRe = /^[A-Za-z0-9_-]{8,64}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const { action, key } = body
    if (typeof key !== 'string' || !uuidRe.test(key)) return json({ error: 'Clé de widget invalide' }, 400)

    const admin = adminClient()
    const { data: company } = await admin.from('companies')
      .select('id, name, city, phone, email, website, address_line1, postal_code, logo_path, brand_color')
      .eq('widget_public_key', key).single()
    if (!company) return json({ error: 'Widget inconnu' }, 404)

    const { data: settings } = await admin.from('assistant_settings').select('*').eq('company_id', company.id).single()
    if (!settings?.is_enabled) return json({ error: 'Assistant désactivé', disabled: true }, 403)
    if (!isOriginAllowed(req.headers.get('origin'), settings.allowed_domains ?? [])) {
      return json({ error: 'Ce site n’est pas autorisé à utiliser ce widget.' }, 403)
    }

    if (action === 'config') return json(await config(admin, company, settings))

    const visitorId = body.visitor_id
    if (typeof visitorId !== 'string' || !visitorRe.test(visitorId)) return json({ error: 'Visiteur invalide' }, 400)

    if (action === 'poll') return json(await poll(admin, company.id, visitorId, body.conversation_id, body.after))
    if (action === 'message') {
      const text = typeof body.message === 'string' ? body.message.trim() : ''
      if (!text) return json({ error: 'Message vide' }, 400)
      if (text.length > MAX_MESSAGE_LENGTH) return json({ error: `Message trop long (${MAX_MESSAGE_LENGTH} caractères maximum).` }, 400)
      return json(await handleMessage(admin, company, settings, visitorId, body.conversation_id, text,
        typeof body.page_url === 'string' ? body.page_url.slice(0, 500) : null))
    }
    return json({ error: 'Action inconnue' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Le service est momentanément indisponible.' }, 500)
  }
})

// ---------------------------------------------------------------------
async function config(admin: Admin, company: Record<string, string | null>, settings: AssistantSettings & Record<string, unknown>) {
  const { data: kb } = await admin.from('knowledge_entries').select('category, title, content')
    .eq('company_id', company.id).eq('is_active', true)
  return {
    company_name: company.name,
    logo_url: company.logo_path ? `${SUPABASE_URL}/storage/v1/object/public/logos/${company.logo_path}` : null,
    assistant_name: settings.assistant_name,
    welcome_message: settings.welcome_message,
    color: (settings.primary_color as string | null) ?? company.brand_color ?? '#4f46e5',
    position: settings.position,
    suggestions: suggestions((kb ?? []) as KnowledgeEntry[], settings),
  }
}

async function findConversation(admin: Admin, companyId: string, visitorId: string, conversationId: unknown) {
  if (typeof conversationId !== 'string' || !uuidRe.test(conversationId)) return null
  const { data } = await admin.from('conversations').select('*')
    .eq('id', conversationId).eq('company_id', companyId).eq('visitor_id', visitorId).single()
  return data
}

async function poll(admin: Admin, companyId: string, visitorId: string, conversationId: unknown, after: unknown) {
  const conv = await findConversation(admin, companyId, visitorId, conversationId)
  if (!conv) return { messages: [] }
  let q = admin.from('messages').select('id, role, content, created_at')
    .eq('conversation_id', conv.id).in('role', ['assistant', 'agent']).order('created_at').limit(50)
  if (typeof after === 'string' && !Number.isNaN(Date.parse(after))) q = q.gt('created_at', after)
  const { data } = await q
  return { messages: data ?? [], mode: conv.mode }
}

// ---------------------------------------------------------------------
async function handleMessage(
  admin: Admin, company: Record<string, string | null>, settings: AssistantSettings & Record<string, unknown>,
  visitorId: string, conversationId: unknown, text: string, pageUrl: string | null,
) {
  const companyId = company.id as string

  // Anti-abus : nombre de messages du visiteur sur 10 minutes
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: recentConvs } = await admin.from('conversations').select('id').eq('company_id', companyId).eq('visitor_id', visitorId)
  if (recentConvs?.length) {
    const { count } = await admin.from('messages').select('id', { count: 'exact', head: true })
      .in('conversation_id', recentConvs.map((c) => c.id)).eq('role', 'visitor').gte('created_at', since)
    if ((count ?? 0) >= MAX_VISITOR_MESSAGES_10_MIN) {
      return { error: 'Vous avez envoyé beaucoup de messages. Patientez quelques minutes.', rate_limited: true }
    }
  }

  let conv = await findConversation(admin, companyId, visitorId, conversationId)
  if (!conv) {
    const { data, error } = await admin.from('conversations')
      .insert({ company_id: companyId, visitor_id: visitorId, channel: 'widget', page_url: pageUrl })
      .select('*').single()
    if (error) throw error
    conv = data
  }

  await admin.from('messages').insert({ conversation_id: conv.id, company_id: companyId, role: 'visitor', content: text })

  // Conversation reprise par un humain : l'IA se tait
  if (conv.mode === 'human') return { conversation_id: conv.id, reply: null, mode: 'human' }

  const reply = async (content: string, usage?: { input: number; output: number }) => {
    const { data } = await admin.from('messages').insert({
      conversation_id: conv.id, company_id: companyId, role: 'assistant', content,
      input_tokens: usage?.input ?? null, output_tokens: usage?.output ?? null,
    }).select('id, role, content, created_at').single()
    const { data: c } = await admin.from('conversations').select('mode').eq('id', conv.id).single()
    return { conversation_id: conv.id, reply: data, mode: c?.mode ?? 'ai' }
  }

  // Quota mensuel : au-delà, réponse d'attente et l'équipe prend le relais
  const { data: allowed } = await admin.rpc('consume_ai_message', { p_company_id: companyId, p_kind: 'message' })
  if (!allowed) {
    await admin.from('conversations').update({ mode: 'human' }).eq('id', conv.id)
    return reply(OFFLINE_REPLY)
  }

  const [{ data: kb }, { data: history }] = await Promise.all([
    admin.from('knowledge_entries').select('category, title, content').eq('company_id', companyId).eq('is_active', true).order('position'),
    admin.from('messages').select('role, content').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(30),
  ])

  const { data: hasAppointments } = settings.can_book_appointments
    ? await admin.rpc('company_has_feature', { p_company_id: companyId, p_feature: 'appointments' })
    : { data: false }
  const appointments = !!hasAppointments
  const ctx = await loadContext(admin, companyId)
  const system = buildSystemPrompt(company as never, settings, (kb ?? []) as KnowledgeEntry[], { appointments })
  const tools = assistantTools(settings, { appointments })
  const today = `Nous sommes le ${nowLabel(new Date(), ctx.timeZone)} (heure locale de l’entreprise).`
  const messages = toHistory(((history ?? []) as StoredMessage[]).reverse())
  let usage = { input: 0, output: 0 }

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await claude().beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' }, // conversation : réponses rapides
        // Prompt système stable par entreprise : mis en cache
        // Bloc stable mis en cache, puis la date du jour (variable) après le point de cache
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }, { type: 'text', text: today }],
        tools,
        messages,
      })
      usage = { input: usage.input + response.usage.input_tokens, output: usage.output + response.usage.output_tokens }

      if (response.stop_reason === 'refusal') return reply(OFFLINE_REPLY, usage)

      if (response.stop_reason === 'tool_use') {
        // Le contenu de l'assistant est renvoyé tel quel (blocs de réflexion compris)
        messages.push({ role: 'assistant', content: response.content })
        const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          const r = await runTool(admin, company, settings, conv, block.name, block.input as Record<string, unknown>, pageUrl)
          results.push({ type: 'tool_result', tool_use_id: block.id, content: r.content, is_error: r.isError })
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      const textOut = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim()
      return reply(textOut || OFFLINE_REPLY, usage)
    }
    return reply('Je transmets votre demande à l’équipe, qui vous répondra rapidement.', usage)
  } catch (e) {
    console.error('Claude', e)
    if (e instanceof Anthropic.APIError) return reply(OFFLINE_REPLY, usage)
    throw e
  }
}

// ---------------------------------------------------------------------
async function upsertLead(admin: Admin, companyId: string, conv: Record<string, unknown>, patch: Record<string, unknown>, pageUrl: string | null) {
  const { data: existing } = await admin.from('leads').select('id').eq('conversation_id', conv.id as string).maybeSingle()
  if (existing) {
    await admin.from('leads').update(patch).eq('id', existing.id)
    return existing.id as string
  }
  const { data } = await admin.from('leads').insert({
    company_id: companyId, conversation_id: conv.id, source: 'widget', page_url: pageUrl,
    name: conv.contact_name, email: conv.contact_email, phone: conv.contact_phone, ...patch,
  }).select('id').single()
  if (data) await admin.from('conversations').update({ lead_id: data.id }).eq('id', conv.id as string)
  return data?.id as string
}

async function runTool(
  admin: Admin, company: Record<string, string | null>, settings: AssistantSettings & Record<string, unknown>,
  conv: Record<string, unknown>, name: string, input: Record<string, unknown>, pageUrl: string | null,
): Promise<{ content: string; isError?: boolean }> {
  const companyId = company.id as string
  const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

  if (name === 'save_contact') {
    const email = str(input.email)
    const phone = str(input.phone) ? normalizePhone(str(input.phone)!) : null
    if (email && !isValidEmail(email)) return { content: 'Adresse email invalide : demande au visiteur de la vérifier.', isError: true }
    const patch: Record<string, string> = {}
    if (str(input.name)) patch.contact_name = str(input.name)!
    if (email) patch.contact_email = email.toLowerCase()
    if (phone) patch.contact_phone = phone
    if (!Object.keys(patch).length) return { content: 'Aucune coordonnée exploitable.', isError: true }
    await admin.from('conversations').update(patch).eq('id', conv.id as string)
    Object.assign(conv, patch)
    await upsertLead(admin, companyId, conv, { name: conv.contact_name, email: conv.contact_email, phone: conv.contact_phone }, pageUrl)
    return { content: 'Coordonnées enregistrées.' }
  }

  if (name === 'create_quote_request') {
    if (!conv.contact_email && !conv.contact_phone) {
      return { content: 'Il manque un email ou un téléphone : demande-le au visiteur puis enregistre-le avec save_contact avant de réessayer.', isError: true }
    }
    const need = str(input.need, 300)
    if (!need) return { content: 'Le besoin doit être décrit.', isError: true }
    const urgency = ['normale', 'rapide', 'urgente'].includes(input.urgency as string) ? input.urgency : 'normale'
    await upsertLead(admin, companyId, conv, { need, details: str(input.details, 2000), urgency, is_quote_request: true }, pageUrl)
    await notify(admin, company, settings, conv, `Nouvelle demande de devis : ${need}`,
      `${conv.contact_name ?? 'Un visiteur'} demande un devis via l’assistant de votre site.\n\nBesoin : ${need}`
      + `${str(input.details, 2000) ? `\nPrécisions : ${str(input.details, 2000)}` : ''}\nUrgence : ${urgency}`
      + `\n\nContact : ${[conv.contact_email, conv.contact_phone].filter(Boolean).join(' · ')}`)
    return { content: 'Demande de devis transmise à l’équipe.' }
  }

  if (name === 'request_human') {
    await admin.from('conversations').update({ mode: 'human' }).eq('id', conv.id as string)
    await notify(admin, company, settings, conv, 'Un visiteur souhaite échanger avec vous',
      `${conv.contact_name ?? 'Un visiteur'} a besoin d’une réponse de votre part dans l’assistant de votre site.\n\nMotif : ${str(input.reason, 500) ?? '—'}`)
    return { content: 'L’équipe est prévenue et répondra dans cette conversation.' }
  }

  if (name === 'find_slots') {
    const { timeZone } = await loadContext(admin, companyId)
    let from: Date | undefined
    let to: Date | undefined
    if (typeof input.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.day)) {
      const [y, m, d] = input.day.split('-').map(Number)
      from = zonedToUtc(y, m, d, 0, 0, timeZone)
      to = zonedToUtc(y, m, d + 1, 0, 0, timeZone)
    }
    const { slots } = await availableSlots(admin, companyId, { from, to, max: 80 })
    const period = input.period
    const filtered = slots.filter((sl) => {
      const h = localParts(sl.start, timeZone).hour
      return period === 'matin' ? h < 12 : period === 'apres-midi' ? h >= 12 : true
    }).slice(0, 6)
    if (!filtered.length) return { content: 'Aucun créneau libre pour cette demande. Propose un autre jour, ou les prochains créneaux disponibles (day = null).' }
    return { content: JSON.stringify(filtered.map((sl) => ({ start: sl.start.toISOString(), libelle: slotLabel(sl.start, timeZone) }))) }
  }

  if (name === 'book_appointment') {
    if (!conv.contact_name || (!conv.contact_email && !conv.contact_phone)) {
      return { content: 'Il manque le nom et un téléphone ou un email : demande-les puis enregistre-les avec save_contact avant de réserver.', isError: true }
    }
    const start = new Date(String(input.start))
    if (Number.isNaN(start.getTime())) return { content: 'Créneau invalide : utilise le champ start renvoyé par find_slots.', isError: true }
    const reason = str(input.reason, 200) ?? 'Rendez-vous'
    const leadId = await upsertLead(admin, companyId, conv, { need: reason }, pageUrl)
    const r = await book(admin, companyId, {
      start, title: reason, description: `Pris via l’assistant du site.`, contactName: conv.contact_name as string,
      contactEmail: (conv.contact_email as string | null) ?? null, contactPhone: (conv.contact_phone as string | null) ?? null,
      conversationId: conv.id as string, leadId, source: 'assistant',
    })
    if (!r.ok) return { content: `${r.reason} Rappelle find_slots et propose d’autres créneaux.`, isError: true }
    const { timeZone } = await loadContext(admin, companyId)
    const label = slotLabel(r.start, timeZone)
    await notify(admin, company, settings, conv, `Nouveau rendez-vous : ${label}`,
      `${conv.contact_name} a pris rendez-vous via l’assistant de votre site.\n\nQuand : ${label}\nObjet : ${reason}\nContact : ${[conv.contact_phone, conv.contact_email].filter(Boolean).join(' · ')}`)
    return { content: `Rendez-vous confirmé le ${label}. Confirme-le au visiteur en reprenant la date et l’heure.` }
  }

  return { content: `Outil inconnu : ${name}`, isError: true }
}

/** Email à l'entreprise (au mieux : un échec d'envoi ne bloque pas la conversation). */
async function notify(admin: Admin, company: Record<string, string | null>, settings: Record<string, unknown>,
  conv: Record<string, unknown>, subject: string, text: string) {
  const to = (settings.notify_email as string | null) ?? company.email
  if (!to) return
  try {
    const sent = await sendEmail({
      fromName: 'Votre assistant',
      to,
      subject,
      html: emailLayout({
        companyName: company.name as string, color: company.brand_color ?? '#4f46e5', bodyText: text,
        button: APP_URL ? { label: 'Ouvrir la conversation', url: `${APP_URL}/boite-de-reception?c=${conv.id}` } : undefined,
      }),
    })
    await admin.from('email_logs').insert({ company_id: company.id, kind: 'assistant_notification', to_email: to, subject, provider_id: sent.id })
  } catch (e) {
    console.warn('Notification non envoyée', (e as Error).message)
  }
}
