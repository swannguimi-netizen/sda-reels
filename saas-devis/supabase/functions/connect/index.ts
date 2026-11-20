// Stripe Connect : l'entreprise relie SON compte Stripe pour encaisser les acomptes en ligne.
// Compte Standard (tableau de bord Stripe complet, frais et litiges à la charge de l'entreprise).
// Actions : onboard (lien d'inscription Stripe) | status (synchronise l'état) | dashboard (lien vers Stripe)
// Secrets : STRIPE_SECRET_KEY, APP_URL
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, userClient } from '../_shared/supabase.ts'
import { Stripe, stripe } from '../_shared/stripe.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)
  try {
    const { action, company_id: companyId } = await req.json()
    const user = userClient(req)
    const { data: auth } = await user.auth.getUser()
    if (!auth?.user || typeof companyId !== 'string') return json({ error: 'Authentification requise' }, 401)
    const { data: member } = await user.from('company_members').select('role').eq('company_id', companyId).eq('user_id', auth.user.id).single()
    if (!member || !['owner', 'admin'].includes(member.role)) return json({ error: 'Réservé au propriétaire et aux administrateurs.' }, 403)

    const admin = adminClient()
    const { data: company } = await admin.from('companies').select('id, name, email, website, stripe_account_id').eq('id', companyId).single()
    if (!company) return json({ error: 'Entreprise introuvable' }, 404)
    const s = stripe()
    const origin = APP_URL || req.headers.get('origin') || ''

    if (action === 'onboard') {
      const { data: hasFeature } = await admin.rpc('company_has_feature', { p_company_id: companyId, p_feature: 'online_deposit' })
      if (!hasFeature) return json({ error: 'Le paiement d’acompte en ligne est inclus à partir de l’offre Business.' }, 402)
      let accountId: string | null = company.stripe_account_id
      if (!accountId) {
        const account = await s.accounts.create({
          country: 'FR',
          email: company.email ?? auth.user.email,
          business_profile: { name: company.name, url: company.website ?? undefined },
          controller: {
            stripe_dashboard: { type: 'full' },     // compte Standard
            fees: { payer: 'account' },             // frais Stripe payés par l'entreprise
            losses: { payments: 'stripe' },         // litiges : pas à la charge de la plateforme
            requirement_collection: 'stripe',
          },
          metadata: { company_id: companyId },
        })
        accountId = account.id
        await admin.from('companies').update({ stripe_account_id: accountId }).eq('id', companyId)
      }
      const link = await s.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        refresh_url: `${origin}/paiements?connect=reprendre`,
        return_url: `${origin}/paiements?connect=retour`,
      })
      return json({ url: link.url })
    }

    if (action === 'status') {
      if (!company.stripe_account_id) return json({ connected: false })
      const account = await s.accounts.retrieve(company.stripe_account_id)
      const patch = { stripe_charges_enabled: !!account.charges_enabled, stripe_details_submitted: !!account.details_submitted }
      await admin.from('companies').update(patch).eq('id', companyId)
      return json({ connected: true, ...patch, requirements: account.requirements?.currently_due ?? [] })
    }

    if (action === 'dashboard') return json({ url: 'https://dashboard.stripe.com/' })
    return json({ error: 'Action inconnue' }, 400)
  } catch (e) {
    console.error(e)
    if (e instanceof Stripe.errors.StripeError) return json({ error: `Stripe : ${e.message}` }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
