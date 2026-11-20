export const VAT_RATES = [0, 2.1, 5.5, 8.5, 10, 20]

export interface ProposalLine {
  kind: 'item' | 'section' | 'note'
  description: string
  product_id: string | null
  quantity: number
  unit: string
  unit_price: number
  vat_rate: number
  is_estimate: boolean
}

export interface Proposal {
  title: string
  intro: string
  lines: ProposalLine[]
  assumptions: string[]
  questions: string[]
}

interface CatalogProduct { id: string; unit: string; unit_price: number | string; vat_rate: number | string }
interface CompanyVat { vat_regime: string; default_vat_rate: number | string }

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

/**
 * Normalise la réponse du modèle : le catalogue fait foi (prix, unité, TVA), les identifiants
 * inconnus sont ignorés, les nombres sont bornés et la TVA respecte le régime de l'entreprise.
 */
export function sanitizeProposal(raw: unknown, catalog: CatalogProduct[], company: CompanyVat): Proposal {
  const r = (raw ?? {}) as Record<string, unknown>
  const byId = new Map(catalog.map((p) => [p.id, p]))
  const vatApplies = company.vat_regime === 'assujetti'
  const fallbackVat = vatApplies ? Number(company.default_vat_rate) : 0
  const rawLines = Array.isArray(r.lines) ? (r.lines as Array<Record<string, unknown>>) : []

  const lines = rawLines.slice(0, 80).flatMap<ProposalLine>((l) => {
    const kind = (['item', 'section', 'note'] as const).find((k) => k === l.kind) ?? 'item'
    const description = String(l.description ?? '').trim().slice(0, 2000)
    if (!description) return []
    if (kind !== 'item') {
      return [{ kind, description, product_id: null, quantity: 1, unit: 'unité', unit_price: 0, vat_rate: 0, is_estimate: false }]
    }
    const product = typeof l.product_id === 'string' ? byId.get(l.product_id) : undefined
    const vat = vatApplies ? Number(product?.vat_rate ?? l.vat_rate) : 0
    const qty = Number(l.quantity)
    return [{
      kind,
      description,
      product_id: product?.id ?? null,
      quantity: Number.isFinite(qty) && qty > 0 ? clamp(Math.round(qty * 1000) / 1000, 0, 100_000) : 1,
      unit: String(product?.unit ?? l.unit ?? 'unité').trim().slice(0, 30) || 'unité',
      unit_price: Math.round(clamp(Number(product?.unit_price ?? l.unit_price) || 0, 0, 10_000_000) * 100) / 100,
      vat_rate: VAT_RATES.includes(vat) ? vat : fallbackVat,
      is_estimate: !product,
    }]
  })

  const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [])
  return {
    title: String(r.title ?? '').trim().slice(0, 200),
    intro: String(r.intro ?? '').trim().slice(0, 1000),
    lines,
    assumptions: strings(r.assumptions, 8),
    questions: strings(r.questions, 4),
  }
}
