// Offres de la plateforme côté Stripe : produits, prix mensuels TTC (retrouvés par lookup_key) et portail client.
// Sans risque à relancer. À garder aligné avec la table public.plans (migration 08).
import { priceLookupKey, type Stripe } from './stripe.ts'

export const PLANS = [
  { id: 'starter', name: 'Starter', amount: 7000, description: '1 utilisateur · 200 messages IA par mois' },
  { id: 'pro', name: 'Pro', amount: 9900, description: '3 utilisateurs · 1 000 messages IA · signature en ligne · relances' },
  { id: 'business', name: 'Business', amount: 11900, description: '5 utilisateurs · 2 000 messages IA · acompte en ligne' },
  { id: 'premium', name: 'Premium', amount: 14900, description: '10 utilisateurs · 5 000 messages IA · agenda et avis Google' },
]

export async function setupStripe(stripe: Stripe, appUrl: string | null): Promise<string[]> {
  const log: string[] = []
  const productIds: string[] = []
  for (const plan of PLANS) {
    const lookupKey = priceLookupKey(plan.id)
    const found = await stripe.prices.list({ lookup_keys: [lookupKey], expand: ['data.product'], limit: 1 })
    const current = found.data[0]
    let productId = current ? (current.product as Stripe.Product).id : null

    if (!productId) {
      const product = await stripe.products.create({ name: plan.name, description: plan.description, metadata: { plan_id: plan.id } })
      productId = product.id
    } else {
      await stripe.products.update(productId, { name: plan.name, description: plan.description })
    }
    productIds.push(productId)

    if (current && current.unit_amount === plan.amount && current.active) {
      log.push(`${plan.name} : ${plan.amount / 100} €/mois (inchangé)`)
      continue
    }
    // Nouveau prix : la clé de recherche est transférée, l'ancien prix reste valable pour les abonnés existants
    await stripe.prices.create({
      product: productId,
      currency: 'eur',
      unit_amount: plan.amount,
      recurring: { interval: 'month' },
      tax_behavior: 'inclusive', // prix TTC : la TVA est comprise dans le montant
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      metadata: { plan_id: plan.id },
    })
    log.push(`${plan.name} : ${plan.amount / 100} €/mois ${current ? '(nouveau prix)' : '(créé)'}`)
  }

  // Portail client : carte, factures, changement d'offre au prorata, résiliation en fin de période.
  // La configuration par défaut est celle qu'utilisent les sessions du portail : on la met à jour (ou on la crée).
  const prices = await stripe.prices.list({ lookup_keys: PLANS.map((p) => priceLookupKey(p.id)), limit: 10 })
  const params = {
    business_profile: { headline: 'Gérez votre abonnement' },
    default_return_url: appUrl ? `${appUrl}/abonnement` : undefined,
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id', 'name'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true, mode: 'at_period_end',
        cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'unused', 'switched_service', 'other'] },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: productIds.map((product) => ({ product, prices: prices.data.filter((p) => p.product === product).map((p) => p.id) })),
      },
    },
  } satisfies Stripe.BillingPortal.ConfigurationCreateParams
  const existing = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })
  if (existing.data[0]) await stripe.billingPortal.configurations.update(existing.data[0].id, params)
  else await stripe.billingPortal.configurations.create(params)
  log.push('Portail client configuré')
  return log
}
