// Webhook Stripe : tient la table subscriptions à jour (souscription, changement d'offre, impayé, résiliation).
// Secrets : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Événements à activer : checkout.session.completed, customer.subscription.created/updated/deleted
// Endpoint Connect (événements des comptes des entreprises), secret STRIPE_CONNECT_WEBHOOK_SECRET :
//   checkout.session.completed, checkout.session.async_payment_succeeded, account.updated
import { adminClient } from '../_shared/supabase.ts'
import { cryptoProvider, Stripe, stripe } from '../_shared/stripe.ts'
import { subscriptionPatch } from './sync.ts'
import { emailLayout, sendEmail } from '../_shared/email.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 })
  const signature = req.headers.get('stripe-signature')
  // Deux endpoints possibles (plateforme et Connect) : chacun a son secret
  const secrets = [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')].filter(Boolean) as string[]
  if (!signature || !secrets.length) return new Response('Signature manquante', { status: 400 })

  const payload = await req.text()
  let event: Stripe.Event | null = null
  for (const secret of secrets) {
    try {
      event = await stripe().webhooks.constructEventAsync(payload, signature, secret, undefined, cryptoProvider)
      break
    } catch { /* secret suivant */ }
  }
  if (!event) return new Response('Signature invalide', { status: 400 })

  const admin = adminClient()
  // Idempotence : Stripe peut renvoyer un événement plusieurs fois
  const { error: dup } = await admin.from('stripe_events').insert({ id: event.id, type: event.type })
  if (dup?.code === '23505') return new Response('déjà traité', { status: 200 })

  try {
    // Événements des comptes Stripe des entreprises (Connect)
    if (event.account) {
      await handleConnectEvent(admin, event)
      return new Response('ok', { status: 200 })
    }

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

type Admin = ReturnType<typeof adminClient>

async function handleConnectEvent(admin: Admin, event: Stripe.Event) {
  if (event.type === 'account.updated') {
    const account = event.data.object
    await admin.from('companies')
      .update({ stripe_charges_enabled: !!account.charges_enabled, stripe_details_submitted: !!account.details_submitted })
      .eq('stripe_account_id', account.id)
    return
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return
  const session = event.data.object
  if (session.metadata?.kind !== 'deposit' || session.payment_status !== 'paid') return

  // Le devis doit appartenir à l'entreprise propriétaire du compte Stripe qui a encaissé
  const { data: q } = await admin.from('quotes').select('id, number, company_id, companies!inner(stripe_account_id, name, email, brand_color)')
    .eq('id', session.metadata.quote_id).single()
  const company = (q as unknown as { companies: { stripe_account_id: string; name: string; email: string | null; brand_color: string } } | null)?.companies
  if (!q || !company || company.stripe_account_id !== event.account) {
    console.warn('Acompte : devis et compte Stripe ne correspondent pas', session.id)
    return
  }
  const amount = (session.amount_total ?? 0) / 100
  const { data: invoiceId, error } = await admin.rpc('create_deposit_invoice', { p_quote_id: q.id, p_amount_paid: amount, p_reference: session.id })
  if (error) throw error

  // Notification à l'entreprise (au mieux)
  if (company.email) {
    try {
      await sendEmail({
        fromName: 'Paiements', to: company.email,
        subject: `Acompte reçu : ${amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} sur le devis ${q.number}`,
        html: emailLayout({
          companyName: company.name, color: company.brand_color,
          bodyText: `Bonne nouvelle : votre client a réglé en ligne l’acompte du devis ${q.number}.\n\nLa facture d’acompte a été créée automatiquement et marquée comme payée. Les fonds sont versés sur votre compte Stripe.`,
          button: APP_URL ? { label: 'Voir la facture d’acompte', url: `${APP_URL}/factures/${invoiceId}` } : undefined,
        }),
      })
    } catch (e) {
      console.warn('Notification acompte non envoyée', (e as Error).message)
    }
  }
}
