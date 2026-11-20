import type { Client, CompanyDetails, VatRegime } from './types'

export type DocType = 'quote' | 'invoice'
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused' | 'expired'
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled'
export type LineKind = 'item' | 'section' | 'note'

export interface LineItem {
  key: string                 // identifiant local (React)
  product_id: string | null
  kind: LineKind
  description: string
  quantity: number
  unit: string
  unit_price: number
  vat_rate: number
  discount_percent: number
}

interface DocBase {
  id: string
  company_id: string
  client_id: string | null
  number: string | null
  title: string | null
  notes: string | null
  discount_percent: number
  subtotal_ht: number
  discount_amount: number
  total_ht: number
  total_vat: number
  total_ttc: number
  vat_breakdown: VatLine[]
  public_token: string
  client_snapshot: Partial<Client> | null
  sent_at: string | null
  pdf_path: string | null
  created_at: string
  reminder_count: number
  last_reminder_at: string | null
  reminders_paused: boolean
}

export interface Quote extends DocBase {
  status: QuoteStatus
  intro: string | null
  issue_date: string
  valid_until: string | null
  deposit_percent: number
  deposit_amount: number
  deposit_paid_at: string | null
  viewed_at: string | null
  accepted_at: string | null
  refused_at: string | null
  refusal_reason: string | null
  signed_by_name: string | null
  signature_data?: string | null
  work_completed_at: string | null
  ai_generated: boolean
}

export interface Invoice extends DocBase {
  status: InvoiceStatus
  quote_id: string | null
  kind: 'standard' | 'deposit' | 'balance'
  issue_date: string | null
  due_date: string | null
  amount_paid: number
  paid_at: string | null
}

export type AnyDoc = (Quote & { doc: 'quote' }) | (Invoice & { doc: 'invoice' })

export interface VatLine { rate: number; base: number; amount: number }

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; cls: string }> = {
  draft: { label: 'Brouillon', cls: 'bg-slate-100 text-slate-700' },
  sent: { label: 'Envoyé', cls: 'bg-sky-100 text-sky-700' },
  accepted: { label: 'Accepté', cls: 'bg-emerald-100 text-emerald-700' },
  refused: { label: 'Refusé', cls: 'bg-red-100 text-red-700' },
  expired: { label: 'Expiré', cls: 'bg-amber-100 text-amber-700' },
}

export const INVOICE_STATUS: Record<InvoiceStatus | 'overdue', { label: string; cls: string }> = {
  draft: { label: 'Brouillon', cls: 'bg-slate-100 text-slate-700' },
  issued: { label: 'À payer', cls: 'bg-sky-100 text-sky-700' },
  overdue: { label: 'En retard', cls: 'bg-red-100 text-red-700' },
  paid: { label: 'Payée', cls: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Annulée', cls: 'bg-slate-100 text-slate-500 line-through' },
}

/** Statut affiché : un devis envoyé dont la validité est dépassée est « expiré ». */
export function quoteDisplayStatus(q: Pick<Quote, 'status' | 'valid_until'>): QuoteStatus {
  if (q.status === 'sent' && q.valid_until && q.valid_until < today()) return 'expired'
  return q.status
}

export function invoiceDisplayStatus(i: Pick<Invoice, 'status' | 'due_date'>): InvoiceStatus | 'overdue' {
  if (i.status === 'issued' && i.due_date && i.due_date < today()) return 'overdue'
  return i.status
}

export const today = () => new Date().toLocaleDateString('sv-SE') // AAAA-MM-JJ local

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const lineTotal = (l: Pick<LineItem, 'kind' | 'quantity' | 'unit_price'> & { discount_percent?: number }) =>
  l.kind === 'item' ? r2(l.quantity * l.unit_price * (1 - (l.discount_percent ?? 0) / 100)) : 0

/** Même algorithme que private.compute_totals() (migration 02). */
export function computeTotals(lines: LineItem[], discountPercent: number, regime: VatRegime) {
  const items = lines.filter((l) => l.kind === 'item')
  const factor = 1 - discountPercent / 100
  const subtotal_ht = r2(items.reduce((s, l) => s + lineTotal(l), 0))
  const discount_amount = r2(subtotal_ht * (1 - factor))
  const total_ht = r2(subtotal_ht - discount_amount)
  let vat_breakdown: VatLine[] = []
  if (regime === 'assujetti') {
    const byRate = new Map<number, number>()
    for (const l of items) byRate.set(Number(l.vat_rate), (byRate.get(Number(l.vat_rate)) ?? 0) + lineTotal(l))
    vat_breakdown = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, sum]) => ({
      rate, base: r2(sum * factor), amount: r2(sum * factor * rate / 100),
    }))
  }
  const total_vat = r2(vat_breakdown.reduce((s, v) => s + v.amount, 0))
  return { subtotal_ht, discount_amount, total_ht, total_vat, total_ttc: r2(total_ht + total_vat), vat_breakdown }
}

export const newLine = (partial: Partial<LineItem> = {}): LineItem => ({
  key: Math.random().toString(36).slice(2),
  product_id: null, kind: 'item', description: '', quantity: 1, unit: 'unité', unit_price: 0, vat_rate: 20, discount_percent: 0,
  ...partial,
})

export function toPayload(lines: LineItem[]) {
  return lines
    .filter((l) => l.kind !== 'item' || l.description.trim() || l.unit_price)
    .map(({ key: _k, ...l }) => ({ ...l, description: l.description.trim() }))
}

/** Données nécessaires au rendu PDF et à la page publique. */
export interface DocumentBundle {
  type: DocType
  doc: Quote | Invoice
  items: Array<Omit<LineItem, 'key'> & { total_ht?: number }>
  client: Partial<Client> | null
  company: CompanyDetails
  quoteNumber?: string | null
}
