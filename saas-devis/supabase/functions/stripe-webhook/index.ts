// Webhook Stripe : tient la table subscriptions à jour (souscription, changement d'offre, impayé, résiliation).
// Secrets : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Événements à activer : checkout.session.completed, customer.subscription.created/updated/deleted
import { adminClient } from '../_shared/supabase.ts'
import { cryptoProvider, Stripe, stripe } from '../_shared/stripe.ts'
import { subscriptionPatch } from './sync.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 })
  const signature = req.headers.get('stripe-signature')
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!signature || !secret) return new Response('Signature manquante', { status: 400 })

  let event: Stripe.Event
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), signature, secret, undefined, cryptoProvider)
  } catch (e) {
    console.warn('Signature invalide', (e as Error).message)
    return new Response('Signature invalide', { status: 400 })
  }

  const admin = adminClient()
  // Idempotence : Stripe peut renvoyer un événement plusieurs fois
  const { error: dup } = await admin.from('stripe_events').insert({ id: event.id, type: event.type })
  if (dup?.code === '23505') return new Response('déjà traité', { status: 200 })

  try {
    let sub: Stripe.Subscription | null = null
    let companyId: string | null = null

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      companyId = session.client_reference_id
      if (session.subscription) {
        sub = await stripe().subscriptions.retrieve(typeof session.subscription === 'string' ? session.subscription : session.subscription.id)
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      sub = event.data.object as Stripe.Subscription
    }

    if (sub) {
      companyId ??= sub.metadata?.company_id ?? null
      const patch = subscriptionPatch(sub)
      const query = admin.from('subscriptions').update(patch, { count: 'exact' })
      const { error, count } = await (companyId
        ? query.eq('company_id', companyId)
        : query.eq('stripe_customer_id', patch.stripe_customer_id))
      if (error) throw error
      if (!count) console.warn('Abonnement Stripe sans entreprise correspondante', sub.id)
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error(e)
    // L'événement sera renvoyé par Stripe : on retire la marque « traité »
    await admin.from('stripe_events').delete().eq('id', event.id)
    return new Response('Erreur de traitement', { status: 500 })
  }
})
