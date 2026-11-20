import Stripe from 'npm:stripe@23.1.0'

let client: Stripe | null = null
export function stripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('Paiement non configuré (STRIPE_SECRET_KEY manquante).')
  client ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })
  return client
}

export const cryptoProvider = Stripe.createSubtleCryptoProvider()

/** Les prix Stripe sont retrouvés par clé de recherche : aucun identifiant à recopier dans la base. */
export const priceLookupKey = (planId: string) => `plan_${planId}_monthly`
export const planFromLookupKey = (key: string | null | undefined) => key?.match(/^plan_([a-z0-9_]+)_monthly$/)?.[1] ?? null

export { Stripe }
