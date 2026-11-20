import { INVOICE_STATUS, QUOTE_STATUS, invoiceDisplayStatus, quoteDisplayStatus, type Invoice, type Quote } from '../lib/documents'

export function QuoteBadge({ quote }: { quote: Pick<Quote, 'status' | 'valid_until'> }) {
  const s = QUOTE_STATUS[quoteDisplayStatus(quote)]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
}

export function InvoiceBadge({ invoice }: { invoice: Pick<Invoice, 'status' | 'due_date'> }) {
  const s = INVOICE_STATUS[invoiceDisplayStatus(invoice)]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
}
