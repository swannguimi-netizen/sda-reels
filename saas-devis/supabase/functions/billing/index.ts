// Abonnement de l'entreprise : paiement (Stripe Checkout) et portail client (carte, factures, changement d'offre).
// Secrets : STRIPE_SECRET_KEY, APP_URL ; STRIPE_AUTOMATIC_TAX=true pour la TVA automatique (Stripe Tax)
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, userClient } from '../_shared/supabase.ts'
import { priceLookupKey, Stripe, stripe } from '../_shared/stripe.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  try {
    const { action, company_id: companyId, plan_id: planId } = await req.json()
    if (typeof companyId !== 'string') return json({ error: 'Entreprise manquante' }, 400)

    // Droits : propriétaire ou administrateur de l'entreprise
    const user = userClient(req)
    const { data: auth } = await user.auth.getUser()
    if (!auth?.user) return json({ error: 'Authentification requise' }, 401)
    const { data: member } = await user.from('company_members').select('role')
      .eq('company_id', companyId).eq('user_id', auth.user.id).single()
    if (!member || !['owner', 'admin'].includes(member.role)) {
      return json({ error: 'Seuls le propriétaire et les administrateurs gèrent l’abonnement.' }, 403)
    }

    const admin = adminClient()
    const [{ data: company }, { data: sub }] = await Promise.all([
      admin.from('companies').select('id, name, email, siret').eq('id', companyId).single(),
      admin.from('subscriptions').select('*').eq('company_id', companyId).single(),
    ])
    if (!company || !sub) return json({ error: 'Entreprise introuvable' }, 404)

    const origin = APP_URL || req.headers.get('origin') || ''
    const s = stripe()

    // Client Stripe (créé une fois, mémorisé)
    let customerId: string = sub.stripe_customer_id
    if (!customerId) {
      const customer = await s.customers.create({
        name: company.name,
        email: company.email ?? auth.user.email,
        metadata: { company_id: company.id, siret: company.siret ?? '' },
        preferred_locales: ['fr'],
      })
      customerId = customer.id
      await admin.from('subscriptions').update({ stripe_customer_id: customerId }).eq('company_id', companyId)
    }

    if (action === 'portal') {
      const session = await s.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/abonnement`, locale: 'fr' })
      return json({ url: session.url })
    }

    if (action !== 'checkout') return json({ error: 'Action inconnue' }, 400)
    const { data: plan } = await admin.from('plans').select('id, name').eq('id', planId).single()
    if (!plan) return json({ error: 'Offre inconnue' }, 400)

    // Déjà abonné : le changement d'offre passe par le portail (prorata géré par Stripe)
    if (sub.stripe_subscription_id && LIVE_STATUSES.includes(sub.status) && sub.status !== 'trialing') {
      const session = await s.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/abonnement`,
        locale: 'fr',
        flow_data: { type: 'subscription_update', subscription_update: { subscription: sub.stripe_subscription_id } },
      })
      return json({ url: session.url })
    }

    const prices = await s.prices.list({ lookup_keys: [priceLookupKey(plan.id)], active: true, limit: 1 })
    const price = prices.data[0]
    if (!price) return json({ error: `Prix Stripe introuvable pour l’offre ${plan.name} (lancez le script stripe-setup).` }, 500)

    // Les jours d'essai restants sont conservés : le premier prélèvement a lieu à la fin de l'essai
    const trialEnd = sub.status === 'trialing' && sub.trial_ends_at ? Math.floor(new Date(sub.trial_ends_at).getTime() / 1000) : null
    const keepTrial = trialEnd !== null && trialEnd > Date.now() / 1000 + 48 * 3600

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: company.id,
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: {
        metadata: { company_id: company.id, plan_id: plan.id },
        ...(keepTrial ? { trial_end: trialEnd! } : {}),
      },
      success_url: `${origin}/abonnement?paiement=ok`,
      cancel_url: `${origin}/abonnement?paiement=annule`,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      locale: 'fr',
      automatic_tax: { enabled: Deno.env.get('STRIPE_AUTOMATIC_TAX') === 'true' },
    }
    const session = await s.checkout.sessions.create(params)
    return json({ url: session.url })
  } catch (e) {
    console.error(e)
    if (e instanceof Stripe.errors.StripeError) return json({ error: `Stripe : ${e.message}` }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
