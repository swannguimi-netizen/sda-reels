import { supabase } from './supabase'
import type { DocType, DocumentBundle, Invoice, LineItem, Quote } from './documents'
import { newLine } from './documents'
import type { Client, CompanyDetails } from './types'

export const TABLE = { quote: 'quotes', invoice: 'invoices' } as const
export const ITEMS = { quote: 'quote_items', invoice: 'invoice_items' } as const

export function publicLink(type: DocType, token: string) {
  return `${window.location.origin}/${type === 'quote' ? 'd' : 'f'}/${token}`
}

export async function loadDocument(type: DocType, id: string) {
  const [{ data: doc, error }, { data: items }] = await Promise.all([
    supabase.from(TABLE[type]).select('*').eq('id', id).single(),
    supabase.from(ITEMS[type]).select('*').eq(type === 'quote' ? 'quote_id' : 'invoice_id', id).order('position'),
  ])
  if (error) throw error
  const lines: LineItem[] = (items ?? []).map((i) => newLine({
    product_id: i.product_id, kind: i.kind, description: i.description, quantity: Number(i.quantity),
    unit: i.unit, unit_price: Number(i.unit_price), vat_rate: Number(i.vat_rate), discount_percent: Number(i.discount_percent),
  }))
  return { doc: doc as Quote | Invoice, lines }
}

export async function loadCompany(companyId: string) {
  const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).single()
  if (error) throw error
  return data as CompanyDetails
}

/** Rassemble tout ce qu'il faut pour le PDF à partir de l'état enregistré en base. */
export async function loadBundle(type: DocType, id: string): Promise<DocumentBundle> {
  const { doc, lines } = await loadDocument(type, id)
  const company = await loadCompany(doc.company_id)
  let client: Partial<Client> | null = doc.client_snapshot
  if (!client && doc.client_id) {
    const { data } = await supabase.from('clients').select('*').eq('id', doc.client_id).single()
    client = data as Client
  }
  let quoteNumber: string | null = null
  if (type === 'invoice' && (doc as Invoice).quote_id) {
    const { data } = await supabase.from('quotes').select('number').eq('id', (doc as Invoice).quote_id!).single()
    quoteNumber = data?.number ?? null
  }
  return { type, doc, items: lines.map(({ key: _k, ...l }) => l), client, company, quoteNumber }
}

/** Génère le PDF, le range dans Storage (documents/<entreprise>/<type>/<numéro>.pdf) et renvoie le blob. */
export async function buildAndStorePdf(type: DocType, id: string) {
  const bundle = await loadBundle(type, id)
  const { renderDocumentPdf } = await import('../pdf/generate')
  const blob = await renderDocumentPdf(bundle)
  if (bundle.doc.number) {
    const path = `${bundle.company.id}/${type}/${bundle.doc.number}.pdf`
    const { error } = await supabase.storage.from('documents').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
    if (!error && bundle.doc.pdf_path !== path) {
      await supabase.from(TABLE[type]).update({ pdf_path: path }).eq('id', id)
    }
  }
  return { blob, bundle }
}

export async function sendByEmail(params: { type: DocType; id: string; to: string; subject: string; message: string }) {
  const { data, error } = await supabase.functions.invoke('send-document', { body: params })
  if (error) {
    // Message renvoyé par la fonction, s'il existe
    const ctx = (error as { context?: Response }).context
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(detail?.error ?? 'L’envoi de l’email a échoué. Vérifiez la configuration Resend.')
  }
  return data
}
