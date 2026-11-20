import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Plan {
  id: string
  name: string
  price_cents: number
  max_users: number
  ai_messages_per_month: number
  features: string[]
  description: string | null
  highlighted: boolean
  sort_order: number
}

export interface Usage {
  plan: string
  plan_name: string
  price_cents: number
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid'
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  has_stripe: boolean
  active: boolean
  ai_used: number
  ai_limit: number
  users: number
  max_users: number
  features: string[]
  online_signature: boolean
}

/** Mention affichée à côté des prix (les prix Stripe sont créés hors taxes). */
export const PRICE_SUFFIX = 'HT / mois'

export const BASE_FEATURES = [
  'Devis et factures illimités',
  'PDF à vos couleurs, envoi par email',
  'Génération de devis par IA',
  'Assistant IA sur votre site + QR code',
  'Boîte de réception et prospects',
]

export const FEATURE_LABELS: Record<string, string> = {
  online_signature: 'Signature électronique des devis',
  auto_reminders: 'Relances automatiques (devis et impayés)',
  online_deposit: 'Acompte payé en ligne à la signature',
  appointments: 'Prise de rendez-vous synchronisée Google Agenda',
  review_requests: 'Demandes d’avis Google automatiques',
}

export const euros = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)

export function daysLeft(iso: string | null) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  useEffect(() => {
    supabase.from('plans').select('*').order('sort_order').then(({ data }) => setPlans((data as Plan[]) ?? []))
  }, [])
  return plans
}

export function useUsage(companyId: string | undefined) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const refresh = useCallback(async () => {
    if (!companyId) return null
    const { data } = await supabase.rpc('current_usage', { p_company_id: companyId })
    setUsage(data as Usage)
    return data as Usage
  }, [companyId])
  useEffect(() => { refresh() }, [refresh])
  return { usage, refresh }
}
