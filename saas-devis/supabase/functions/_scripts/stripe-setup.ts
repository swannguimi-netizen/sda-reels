// Crée (ou met à jour) les produits et prix Stripe des offres, et configure le portail client.
// Même opération que le bouton « Configurer Stripe » de l'espace super-admin.
//
//   STRIPE_SECRET_KEY=sk_test_... APP_URL=https://... deno run -A supabase/functions/_scripts/stripe-setup.ts
import Stripe from 'npm:stripe@23.1.0'
import { setupStripe } from '../_shared/stripe-plans.ts'

const key = Deno.env.get('STRIPE_SECRET_KEY')
if (!key) throw new Error('STRIPE_SECRET_KEY manquante')
console.log(key.startsWith('sk_live') ? '⚠️  Mode PRODUCTION' : 'Mode test')
for (const line of await setupStripe(new Stripe(key), Deno.env.get('APP_URL') ?? null)) console.log(`✓ ${line}`)
console.log('\nDernière étape : dans Stripe → Développeurs → Webhooks, ajoutez l’URL')
console.log('  https://<projet>.supabase.co/functions/v1/stripe-webhook')
console.log('avec les événements checkout.session.completed et customer.subscription.*, puis :')
console.log('  supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...')
