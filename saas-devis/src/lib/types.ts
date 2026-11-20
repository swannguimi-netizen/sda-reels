export type MemberRole = 'owner' | 'admin' | 'member'
export type VatRegime = 'assujetti' | 'franchise' | 'non_applicable_dom'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  current_company_id: string | null
  is_platform_admin: boolean
}

export interface Company {
  id: string
  name: string
  siret: string | null
  vat_regime: VatRegime
  default_vat_rate: number
  logo_path: string | null
  brand_color: string
  city: string | null
  widget_public_key: string
}

export interface Membership {
  role: MemberRole
  company: Company
}

export const VAT_REGIME_LABELS: Record<VatRegime, { label: string; mention: string | null }> = {
  assujetti: { label: 'Assujetti à la TVA', mention: null },
  franchise: {
    label: 'Franchise en base (micro-entreprise)',
    mention: 'TVA non applicable, art. 293 B du CGI',
  },
  non_applicable_dom: {
    label: 'Guyane / Mayotte (TVA non applicable)',
    mention: 'TVA non applicable, art. 294-1 du CGI',
  },
}

export interface CompanyDetails extends Company {
  legal_form: string | null
  vat_number: string | null
  rcs_rm: string | null
  share_capital: string | null
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  country: string
  email: string | null
  phone: string | null
  website: string | null
  legal_mentions: string | null
  payment_terms: string | null
  late_penalty_text: string | null
  iban: string | null
  quote_validity_days: number
  invoice_due_days: number
  deposit_percent: number
  google_review_url: string | null
  quote_reminders_enabled: boolean
  quote_reminder_days: number[]
  invoice_reminders_enabled: boolean
  invoice_reminder_days: number[]
  timezone: string
}

export interface Product {
  id: string
  company_id: string
  name: string
  description: string | null
  unit: string
  unit_price: number
  vat_rate: number
  category: string | null
  is_active: boolean
  created_at: string
}

export interface Client {
  id: string
  company_id: string
  type: 'particulier' | 'professionnel'
  name: string
  company_name: string | null
  siret: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  notes: string | null
  source: 'manual' | 'widget' | 'import' | 'mobile'
  created_at: string
}

export const UNITS = ['unité', 'heure', 'jour', 'forfait', 'm²', 'm³', 'ml', 'kg', 'lot', 'mois']
export const VAT_RATES = [20, 10, 8.5, 5.5, 2.1, 0]
