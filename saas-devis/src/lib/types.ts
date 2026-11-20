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
