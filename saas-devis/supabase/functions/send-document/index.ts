// Envoie un devis ou une facture par email (Resend) avec le PDF en pièce jointe
// et un lien vers la page publique (consultation / signature).
//
// Secrets : RESEND_API_KEY, EMAIL_FROM, APP_URL
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, SUPABASE_URL, userClient } from '../_shared/supabase.ts'
import { emailLayout, sendEmail } from '../_shared/email.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
const MAX_EMAILS_PER_HOUR = 60

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  try {
    const { type, id, to, subject, message } = await req.json()
    if (!['quote', 'invoice'].includes(type) || typeof id !== 'string') return json({ error: 'Requête invalide' }, 400)
    if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) return json({ error: 'Adresse email invalide' }, 400)
    if (typeof subject !== 'string' || subject.length > 200 || typeof message !== 'string' || message.length > 5000) {
      return json({ error: 'Objet ou message invalide' }, 400)
    }

    // 1. Droits : le document doit être visible par l'utilisateur (RLS)
    const user = userClient(req)
    const table = type === 'quote' ? 'quotes' : 'invoices'
    const { data: doc, error } = await user.from(table).select('*').eq('id', id).single()
    if (error || !doc) return json({ error: 'Document introuvable' }, 404)
    if (type === 'invoice' && doc.status === 'draft') return json({ error: 'Émettez la facture avant de l’envoyer.' }, 400)
    if (type === 'quote' && !['draft', 'sent'].includes(doc.status)) return json({ error: 'Ce devis ne peut plus être envoyé.' }, 400)

    const admin = adminClient()
    const { data: company } = await admin.from('companies').select('*').eq('id', doc.company_id).single()

    // 2. Garde-fous : abonnement actif et limite d'envoi
    const { data: active } = await admin.rpc('is_subscription_active', { p_company_id: doc.company_id })
    if (!active) return json({ error: 'Votre abonnement est inactif. Réactivez-le pour envoyer des documents.' }, 402)

    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await admin.from('email_logs').select('id', { count: 'exact', head: true })
      .eq('company_id', doc.company_id).gte('created_at', since)
    if ((count ?? 0) >= MAX_EMAILS_PER_HOUR) return json({ error: 'Trop d’envois en une heure, réessayez plus tard.' }, 429)

    // 3. PDF (généré et déposé par l'application juste avant l'appel)
    const attachments: Array<{ filename: string; content: string }> = []
    if (doc.pdf_path) {
      const { data: file } = await admin.storage.from('documents').download(doc.pdf_path)
      if (file) attachments.push({ filename: `${type === 'quote' ? 'Devis' : 'Facture'}-${doc.number}.pdf`, content: encodeBase64(new Uint8Array(await file.arrayBuffer())) })
    }

    const origin = APP_URL || req.headers.get('origin') || ''
    const link = `${origin}/${type === 'quote' ? 'd' : 'f'}/${doc.public_token}`
    const logoUrl = company.logo_path ? `${SUPABASE_URL}/storage/v1/object/public/logos/${company.logo_path}` : null

    const sent = await sendEmail({
      fromName: company.name,
      to: to.trim(),
      replyTo: company.email,
      subject,
      html: emailLayout({
        companyName: company.name,
        color: company.brand_color,
        logoUrl,
        bodyText: message,
        button: { label: type === 'quote' ? 'Consulter et signer le devis' : 'Consulter la facture', url: link },
        footer: [company.name, company.address_line1, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      }),
      attachments,
    })

    // 4. Statut + journal
    const now = new Date().toISOString()
    if (type === 'quote') {
      await admin.from('quotes').update({ status: 'sent', sent_at: doc.sent_at ?? now }).eq('id', id)
    } else {
      await admin.from('invoices').update({ sent_at: now }).eq('id', id)
    }
    await admin.from('email_logs').insert({
      company_id: doc.company_id, kind: type === 'quote' ? 'quote_sent' : 'invoice_sent',
      quote_id: type === 'quote' ? id : null, invoice_id: type === 'invoice' ? id : null,
      to_email: to.trim(), subject, provider_id: sent.id,
    })
    await admin.rpc('increment_email_usage', { p_company_id: doc.company_id })

    return json({ ok: true, id: sent.id })
  } catch (e) {
    console.error(e)
    return json({ error: (e as Error).message }, 500)
  }
})
