// Page publique du devis : le client paie l'acompte par carte, directement sur le compte Stripe de l'entreprise.
// Public (jeton du devis). Secrets : STRIPE_SECRET_KEY, APP_URL
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/supabase.ts'
import { Stripe, stripe } from '../_shared/stripe.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)
  try {
    const { token } = await req.json()
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'Lien invalide' }, 400)
    const admin = adminClient()
    const { data: q } = await admin.from('quotes')
      .select('id, number, title, status, deposit_amount, deposit_percent, deposit_paid_at, company_id, client_snapshot, public_token')
      .eq('public_token', token).single()
    if (!q || q.status !== 'accepted') return json({ error: 'Signez d’abord le devis.' }, 400)
    if (q.deposit_paid_at) return json({ error: 'L’acompte a déjà été réglé. Merci !' }, 409)
    if (!(Number(q.deposit_amount) > 0)) return json({ error: 'Aucun acompte n’est demandé.' }, 400)

    const { data: available } = await admin.rpc('online_deposit_available_public', { p_company_id: q.company_id })
    if (!available) return json({ error: 'Le paiement en ligne n’est pas proposé par cette entreprise.' }, 403)
    const { data: company } = await admin.from('companies').select('name, stripe_account_id').eq('id', q.company_id).single()

    const origin = APP_URL || req.headers.get('origin') || ''
    const amount = Math.round(Number(q.deposit_amount) * 100)
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      customer_email: q.client_snapshot?.email ?? undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amount,
          product_data: { name: `Acompte de ${Number(q.deposit_percent).toLocaleString('fr-FR')} % – devis ${q.number}`, description: q.title ?? undefined },
        },
      }],
      payment_intent_data: {
        description: `Acompte devis ${q.number}`,
        metadata: { kind: 'deposit', quote_id: q.id, company_id: q.company_id },
      },
      metadata: { kind: 'deposit', quote_id: q.id, company_id: q.company_id },
      success_url: `${origin}/d/${q.public_token}?acompte=ok`,
      cancel_url: `${origin}/d/${q.public_token}?acompte=annule`,
    }, { stripeAccount: company!.stripe_account_id! }) // paiement direct sur le compte de l'entreprise
    return json({ url: session.url })
  } catch (e) {
    console.error(e)
    if (e instanceof Stripe.errors.StripeError) return json({ error: 'Le paiement est momentanément indisponible.' }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
