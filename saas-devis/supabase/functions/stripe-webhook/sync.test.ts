import { assertEquals } from 'jsr:@std/assert@1'
import { subscriptionPatch } from './sync.ts'
import type { Stripe } from '../_shared/stripe.ts'

const base = {
  id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, cancel_at: null, trial_end: null,
  metadata: { company_id: 'c1', plan_id: 'pro' },
  items: { data: [{ current_period_end: 1798761600, price: { lookup_key: 'plan_business_monthly' } }] },
} as unknown as Stripe.Subscription

Deno.test('offre déduite de la clé du prix (prioritaire sur les métadonnées)', () => {
  const p = subscriptionPatch(base)
  assertEquals(p.plan_id, 'business')
  assertEquals(p.status, 'active')
  assertEquals(p.current_period_end, new Date(1798761600 * 1000).toISOString())
  assertEquals(p.trial_ends_at, null)
})

Deno.test('statuts Stripe → statuts de l’application', () => {
  const s = (status: string) => subscriptionPatch({ ...base, status } as unknown as Stripe.Subscription).status
  assertEquals([s('past_due'), s('unpaid'), s('canceled'), s('incomplete_expired'), s('paused'), s('incomplete')],
    ['past_due', 'unpaid', 'canceled', 'canceled', 'canceled', 'incomplete'])
})

Deno.test('essai Stripe et résiliation programmée', () => {
  const p = subscriptionPatch({ ...base, status: 'trialing', trial_end: 1798000000, cancel_at: 1799000000 } as unknown as Stripe.Subscription)
  assertEquals(p.status, 'trialing')
  assertEquals(p.trial_ends_at, new Date(1798000000 * 1000).toISOString())
  assertEquals(p.cancel_at_period_end, true)
})

Deno.test('prix sans clé : repli sur les métadonnées', () => {
  const p = subscriptionPatch({ ...base, items: { data: [{ current_period_end: 1, price: { lookup_key: null } }] } } as unknown as Stripe.Subscription)
  assertEquals(p.plan_id, 'pro')
})
