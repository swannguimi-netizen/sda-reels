import type { Stripe } from '../_shared/stripe.ts'
import { planFromLookupKey } from '../_shared/stripe.ts'

export type AppStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid'

const STATUS: Record<Stripe.Subscription.Status, AppStatus> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'unpaid',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  paused: 'canceled',
}

const iso = (ts: number | null | undefined) => (ts ? new Date(ts * 1000).toISOString() : null)

/** Traduit un abonnement Stripe en ligne de la table subscriptions. */
export function subscriptionPatch(sub: Stripe.Subscription) {
  const item = sub.items.data[0]
  const planId = planFromLookupKey(item?.price?.lookup_key) ?? sub.metadata?.plan_id ?? null
  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status: STATUS[sub.status] ?? 'incomplete',
    ...(planId ? { plan_id: planId } : {}),
    trial_ends_at: sub.status === 'trialing' ? iso(sub.trial_end) : null,
    current_period_end: iso(item?.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end || !!sub.cancel_at,
  }
}
