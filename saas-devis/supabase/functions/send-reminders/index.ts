// Relances automatiques des devis sans réponse et des factures impayées.
//
// 1. Planifiée (toutes les heures, pg_cron) : en-tête x-cron-secret = CRON_SECRET → envoie toutes les relances dues
//    (heures ouvrées locales de chaque entreprise, offre avec « auto_reminders »).
// 2. Manuelle (bouton « Relancer maintenant ») : JWT de l'utilisateur, corps { type, id }.
//
// Secrets : CRON_SECRET, RESEND_API_KEY, EMAIL_FROM, APP_URL
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, SUPABASE_URL, userClient } from '../_shared/supabase.ts'
import { emailLayout, sendEmail } from '../_shared/email.ts'
import { renderReminder, type ReminderVars } from '../_shared/reminders.ts'
import { renderReviewRequest } from '../_shared/reviews.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
const CRON_SECRET = Deno.env.get('CRON_SECRET')
const MAX_RANK = { quote: 2, invoice: 3 } as const

type Admin = ReturnType<typeof adminClient>

interface Due {
  doc_type: 'quote' | 'invoice'
  doc_id: string
  company_id: string
  rank: number
  to_email: string
  client_name: string | null
  number: string
  total_ttc: number
  amount_due: number
  sent_at: string | null
  valid_until: string | null
  due_date: string | null
  public_token: string
  pdf_path: string | null
  viewed_at: string | null
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n)).replace(/ /g, ' ')
const frDate = (d: string | null, tz: string) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('fr-FR', { timeZone: tz }) : null)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)
  const admin = adminClient()

  try {
    // ---------------------------------------------------------- mode planifié
    const cronHeader = req.headers.get('x-cron-secret')
    if (cronHeader !== null) {
      if (!CRON_SECRET || cronHeader !== CRON_SECRET) return json({ error: 'Accès refusé' }, 401)
      const { data: expired } = await admin.rpc('expire_quotes')
      const { data: due, error } = await admin.rpc('due_reminders', { p_ignore_hours: false, p_limit: 200 })
      if (error) throw error
      const results = { sent: 0, skipped: 0, failed: 0, expired_quotes: expired ?? 0 }
      for (const d of (due ?? []) as Due[]) {
        const r = await sendOne(admin, d, `${d.doc_type}_reminder_${d.rank}`)
        results[r]++
      }
      // Demandes d'avis Google (même planification horaire)
      const { data: reviews } = await admin.rpc('due_review_requests', { p_ignore_hours: false })
      const reviewResults = { sent: 0, failed: 0 }
      for (const r of (reviews ?? []) as ReviewDue[]) reviewResults[(await sendReview(admin, r)) ? 'sent' : 'failed']++
      console.log('Relances', results, 'Avis', reviewResults)
      return json({ ...results, reviews: reviewResults })
    }

    // ---------------------------------------------------------- mode manuel
    const { type, id, review_id: reviewId } = await req.json()
    if (typeof reviewId === 'string') {
      // Demande d'avis créée depuis l'application (request_review) : envoi immédiat
      const user = userClient(req)
      const { data: r } = await user.from('review_requests').select('id, company_id, email, first_name, token, status').eq('id', reviewId).single()
      if (!r || r.status !== 'scheduled') return json({ error: 'Demande d’avis introuvable ou déjà envoyée.' }, 404)
      const ok = await sendReview(admin, { id: r.id, company_id: r.company_id, email: r.email, first_name: r.first_name, token: r.token, is_followup: false })
      return ok ? json({ ok: true }) : json({ error: 'L’envoi a échoué. Vérifiez la configuration des emails.' }, 502)
    }
    if (!['quote', 'invoice'].includes(type) || typeof id !== 'string') return json({ error: 'Requête invalide' }, 400)
    const user = userClient(req)
    const table = type === 'quote' ? 'quotes' : 'invoices'
    const { data: doc } = await user.from(table).select('id, status, reminder_count, company_id').eq('id', id).single()
    if (!doc) return json({ error: 'Document introuvable' }, 404)
    if ((type === 'quote' && doc.status !== 'sent') || (type === 'invoice' && doc.status !== 'issued')) {
      return json({ error: type === 'quote' ? 'Seul un devis envoyé, sans réponse, peut être relancé.' : 'Seule une facture émise et impayée peut être relancée.' }, 400)
    }
    const { data: active } = await admin.rpc('is_subscription_active', { p_company_id: doc.company_id })
    if (!active) return json({ error: 'Votre abonnement est inactif.' }, 402)

    // Mêmes données que la relance automatique, sans condition de délai ni d'offre
    const d = await loadDue(admin, type, id)
    if (!d) return json({ error: 'Le client n’a pas d’adresse email.' }, 400)
    const r = await sendOne(admin, { ...d, rank: Math.min(doc.reminder_count + 1, MAX_RANK[type as 'quote' | 'invoice']) },
      `${type}_manual_reminder`)
    if (r === 'failed') return json({ error: 'L’envoi a échoué. Vérifiez la configuration des emails.' }, 502)
    return json({ ok: true })
  } catch (e) {
    console.error(e)
    return json({ error: (e as Error).message }, 500)
  }
})

async function loadDue(admin: Admin, type: 'quote' | 'invoice', id: string): Promise<Due | null> {
  const table = type === 'quote' ? 'quotes' : 'invoices'
  const { data: doc } = await admin.from(table).select('*, client:clients(name, email)').eq('id', id).single()
  if (!doc) return null
  const email = doc.client_snapshot?.email ?? doc.client?.email
  if (!email) return null
  return {
    doc_type: type, doc_id: doc.id, company_id: doc.company_id, rank: 1, to_email: email,
    client_name: doc.client_snapshot?.name ?? doc.client?.name ?? null, number: doc.number, total_ttc: doc.total_ttc,
    amount_due: type === 'invoice' ? doc.total_ttc - doc.amount_paid : doc.total_ttc, sent_at: doc.sent_at,
    valid_until: doc.valid_until ?? null, due_date: doc.due_date ?? null, public_token: doc.public_token,
    pdf_path: doc.pdf_path, viewed_at: doc.viewed_at ?? null,
  }
}

const companyCache = new Map<string, Record<string, string | null>>()

async function sendOne(admin: Admin, d: Due, kind: string): Promise<'sent' | 'skipped' | 'failed'> {
  // Réservation : l'index unique (document, rang) empêche tout double envoi, même en cas d'exécutions concurrentes
  const { data: log, error: reserveErr } = await admin.from('email_logs').insert({
    company_id: d.company_id, kind, to_email: d.to_email, status: 'sending',
    quote_id: d.doc_type === 'quote' ? d.doc_id : null, invoice_id: d.doc_type === 'invoice' ? d.doc_id : null,
  }).select('id').single()
  if (reserveErr) return reserveErr.code === '23505' ? 'skipped' : 'failed'

  try {
    let company = companyCache.get(d.company_id)
    if (!company) {
      const { data } = await admin.from('companies').select('*').eq('id', d.company_id).single()
      company = data as Record<string, string | null>
      companyCache.set(d.company_id, company)
    }
    const tz = company.timezone ?? 'Europe/Paris'
    const vars: ReminderVars = {
      client: d.client_name, numero: d.number, montant: eur(d.total_ttc), reste: eur(d.amount_due),
      entreprise: company.name!, date_envoi: frDate(d.sent_at, tz), validite: frDate(d.valid_until, tz),
      echeance: frDate(d.due_date, tz),
      jours_retard: d.due_date ? Math.max(0, Math.floor((Date.now() - new Date(`${d.due_date}T00:00:00Z`).getTime()) / 86_400_000)) : 0,
      penalites: company.late_penalty_text,
    }
    const msg = renderReminder({
      type: d.doc_type, rank: d.rank, viewed: !!d.viewed_at, vars,
      custom: d.doc_type === 'quote' ? company.quote_reminder_template : company.invoice_reminder_template,
    })

    const attachments: Array<{ filename: string; content: string }> = []
    if (d.pdf_path) {
      const { data: file } = await admin.storage.from('documents').download(d.pdf_path)
      if (file) attachments.push({ filename: `${d.doc_type === 'quote' ? 'Devis' : 'Facture'}-${d.number}.pdf`, content: encodeBase64(new Uint8Array(await file.arrayBuffer())) })
    }

    const link = `${APP_URL}/${d.doc_type === 'quote' ? 'd' : 'f'}/${d.public_token}`
    const sent = await sendEmail({
      fromName: company.name!, to: d.to_email, replyTo: company.email, subject: msg.subject, attachments,
      html: emailLayout({
        companyName: company.name!, color: company.brand_color ?? '#4f46e5',
        logoUrl: company.logo_path ? `${SUPABASE_URL}/storage/v1/object/public/logos/${company.logo_path}` : null,
        bodyText: msg.body, button: { label: msg.button, url: link },
        footer: [company.name, company.address_line1, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      }),
    })
    await admin.from('email_logs').update({ status: 'sent', subject: msg.subject, provider_id: sent.id }).eq('id', log.id)
    await admin.rpc('record_reminder', { p_doc_type: d.doc_type, p_doc_id: d.doc_id })
    await admin.rpc('increment_email_usage', { p_company_id: d.company_id })
    return 'sent'
  } catch (e) {
    console.error('Relance non envoyée', d.doc_type, d.number, (e as Error).message)
    // On libère la réservation : la relance sera retentée à la prochaine exécution
    await admin.from('email_logs').delete().eq('id', log.id)
    return 'failed'
  }
}

interface ReviewDue { id: string; company_id: string; email: string; first_name: string | null; token: string; is_followup: boolean }

async function sendReview(admin: Admin, r: ReviewDue): Promise<boolean> {
  try {
    let company = companyCache.get(r.company_id)
    if (!company) {
      const { data } = await admin.from('companies').select('*').eq('id', r.company_id).single()
      company = data as Record<string, string | null>
      companyCache.set(r.company_id, company)
    }
    const msg = renderReviewRequest({ firstName: r.first_name, company: company.name!, followup: r.is_followup, custom: company.review_message })
    const sent = await sendEmail({
      fromName: company.name!, to: r.email, replyTo: company.email, subject: msg.subject,
      html: emailLayout({
        companyName: company.name!, color: company.brand_color ?? '#4f46e5',
        logoUrl: company.logo_path ? `${SUPABASE_URL}/storage/v1/object/public/logos/${company.logo_path}` : null,
        bodyText: msg.body, button: { label: msg.button, url: `${APP_URL}/avis/${r.token}` },
        footer: [company.name, company.city].filter(Boolean).join(' · '),
      }),
    })
    await admin.rpc('mark_review_sent', { p_id: r.id, p_followup: r.is_followup })
    await admin.from('email_logs').insert({ company_id: r.company_id, kind: r.is_followup ? 'review_followup' : 'review_request', to_email: r.email, subject: msg.subject, provider_id: sent.id })
    await admin.rpc('increment_email_usage', { p_company_id: r.company_id })
    return true
  } catch (e) {
    console.error('Demande d’avis non envoyée', r.id, (e as Error).message)
    return false
  }
}
