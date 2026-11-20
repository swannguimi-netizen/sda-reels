import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { DocumentBundle, Invoice, Quote } from '../lib/documents'
import { lineTotal } from '../lib/documents'
import { VAT_REGIME_LABELS } from '../lib/types'

// Les polices standard PDF (WinAnsi) ne contiennent pas les espaces fines de Intl fr-FR
const clean = (s: string) => s.replace(/[  ]/g, ' ')
const eur = (n: number) => clean(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0))
const num = (n: number) => clean(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(Number(n) || 0))
const date = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')

export function DocumentPdf({ bundle, logoSrc }: { bundle: DocumentBundle; logoSrc?: string | null }) {
  const { type, doc, items, client, company } = bundle
  const color = company.brand_color || '#4f46e5'
  const quote = type === 'quote' ? (doc as Quote) : null
  const invoice = type === 'invoice' ? (doc as Invoice) : null
  const vatApplies = company.vat_regime === 'assujetti'
  const mention = VAT_REGIME_LABELS[company.vat_regime].mention
  const isPro = client?.type === 'professionnel'

  const s = StyleSheet.create({
    page: { padding: 36, paddingBottom: 70, fontSize: 9, fontFamily: 'Helvetica', color: '#1e293b', lineHeight: 1.35 },
    row: { flexDirection: 'row' },
    h1: { fontSize: 20, lineHeight: 1.2, fontFamily: 'Helvetica-Bold', color, marginBottom: 4 },
    muted: { color: '#64748b' },
    bold: { fontFamily: 'Helvetica-Bold' },
    th: { backgroundColor: color, color: '#fff', fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4, fontSize: 8 },
    td: { paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
    footer: { position: 'absolute', bottom: 30, left: 36, right: 36, fontSize: 7, color: '#94a3b8', textAlign: 'center',
      borderTopWidth: 0.5, borderTopColor: '#e2e8f0', paddingTop: 6 },
  })
  const cols = vatApplies
    ? { desc: '46%', qty: '10%', pu: '14%', vat: '10%', tot: '20%' }
    : { desc: '56%', qty: '10%', pu: '14%', vat: '0%', tot: '20%' }

  const title = type === 'quote' ? 'DEVIS' : invoice?.kind === 'deposit' ? 'FACTURE D’ACOMPTE' : 'FACTURE'
  const legalLine = [
    company.name,
    company.legal_form,
    company.share_capital && `au capital de ${company.share_capital}`,
    company.siret && `SIRET ${company.siret.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, '$1 $2 $3 $4')}`,
    company.rcs_rm,
    vatApplies && company.vat_number && `TVA ${company.vat_number}`,
  ].filter(Boolean).join(' · ')

  return (
    <Document title={`${title} ${doc.number ?? ''}`} author={company.name} creator={company.name}>
      <Page size="A4" style={s.page}>
        {/* En-tête */}
        <View style={[s.row, { justifyContent: 'space-between', marginBottom: 24 }]}>
          <View style={{ width: '55%' }}>
            {logoSrc
              ? <Image src={logoSrc} style={{ maxHeight: 56, maxWidth: 170, objectFit: 'contain', marginBottom: 6 }} />
              : <Text style={[s.bold, { fontSize: 14, color, marginBottom: 4 }]}>{company.name}</Text>}
            {logoSrc && <Text style={s.bold}>{company.name}</Text>}
            {company.address_line1 && <Text>{company.address_line1}</Text>}
            {company.address_line2 && <Text>{company.address_line2}</Text>}
            {(company.postal_code || company.city) && <Text>{[company.postal_code, company.city].filter(Boolean).join(' ')}</Text>}
            {company.phone && <Text>Tél. {company.phone}</Text>}
            {company.email && <Text>{company.email}</Text>}
            {company.website && <Text>{company.website}</Text>}
          </View>
          <View style={{ width: '45%', alignItems: 'flex-end' }}>
            <Text style={s.h1}>{title}</Text>
            <Text style={s.bold}>N° {doc.number ?? 'BROUILLON'}</Text>
            {quote && <Text>Date : {date(quote.issue_date)}</Text>}
            {quote?.valid_until && <Text>Valable jusqu’au : {date(quote.valid_until)}</Text>}
            {invoice && <Text>Date d’émission : {date(invoice.issue_date) || '—'}</Text>}
            {invoice?.due_date && <Text>Échéance : {date(invoice.due_date)}</Text>}
            {bundle.quoteNumber && <Text style={s.muted}>Réf. devis {bundle.quoteNumber}</Text>}
          </View>
        </View>

        {/* Client */}
        <View style={[s.row, { justifyContent: 'flex-end', marginBottom: 18 }]}>
          <View style={{ width: '48%', borderWidth: 0.5, borderColor: '#cbd5e1', borderRadius: 4, padding: 8 }}>
            <Text style={[s.muted, { fontSize: 7, marginBottom: 2 }]}>{type === 'quote' ? 'DESTINATAIRE' : 'FACTURÉ À'}</Text>
            {client?.company_name && <Text style={s.bold}>{client.company_name}</Text>}
            <Text style={client?.company_name ? {} : s.bold}>{client?.name ?? '—'}</Text>
            {client?.address_line1 && <Text>{client.address_line1}</Text>}
            {client?.address_line2 && <Text>{client.address_line2}</Text>}
            {(client?.postal_code || client?.city) && <Text>{[client.postal_code, client.city].filter(Boolean).join(' ')}</Text>}
            {client?.siret && <Text style={s.muted}>SIRET {client.siret}</Text>}
          </View>
        </View>

        {doc.title && <Text style={[s.bold, { fontSize: 11, marginBottom: 4 }]}>{doc.title}</Text>}
        {quote?.intro && <Text style={{ marginBottom: 10 }}>{quote.intro}</Text>}

        {/* Lignes */}
        <View style={s.row} fixed>
          <Text style={[s.th, { width: cols.desc }]}>Désignation</Text>
          <Text style={[s.th, { width: cols.qty, textAlign: 'right' }]}>Qté</Text>
          <Text style={[s.th, { width: cols.pu, textAlign: 'right' }]}>PU HT</Text>
          {vatApplies && <Text style={[s.th, { width: cols.vat, textAlign: 'right' }]}>TVA</Text>}
          <Text style={[s.th, { width: cols.tot, textAlign: 'right' }]}>Total HT</Text>
        </View>
        {items.map((l, i) => {
          if (l.kind === 'section') {
            return <Text key={i} wrap={false} style={[s.td, s.bold, { backgroundColor: '#f8fafc', color }]}>{l.description}</Text>
          }
          if (l.kind === 'note') {
            return <Text key={i} style={[s.td, s.muted, { fontFamily: 'Helvetica-Oblique' }]}>{l.description}</Text>
          }
          return (
            <View key={i} style={s.row} wrap={false}>
              <View style={[s.td, { width: cols.desc }]}>
                <Text>{l.description}</Text>
                {l.discount_percent > 0 && <Text style={s.muted}>Remise {num(l.discount_percent)} %</Text>}
              </View>
              <Text style={[s.td, { width: cols.qty, textAlign: 'right' }]}>{num(l.quantity)} {l.unit !== 'unité' ? l.unit : ''}</Text>
              <Text style={[s.td, { width: cols.pu, textAlign: 'right' }]}>{eur(l.unit_price)}</Text>
              {vatApplies && <Text style={[s.td, { width: cols.vat, textAlign: 'right' }]}>{num(l.vat_rate)} %</Text>}
              <Text style={[s.td, { width: cols.tot, textAlign: 'right' }]}>{eur(lineTotal(l))}</Text>
            </View>
          )
        })}

        {/* Totaux */}
        <View style={[s.row, { justifyContent: 'flex-end', marginTop: 12 }]} wrap={false}>
          <View style={{ width: '45%' }}>
            {doc.discount_percent > 0 && (
              <>
                <TotalRow label="Sous-total HT" value={eur(doc.subtotal_ht)} />
                <TotalRow label={`Remise ${num(doc.discount_percent)} %`} value={`- ${eur(doc.discount_amount)}`} />
              </>
            )}
            <TotalRow label="Total HT" value={eur(doc.total_ht)} />
            {vatApplies && doc.vat_breakdown.map((v) => (
              <TotalRow key={v.rate} label={`TVA ${num(v.rate)} % (base ${eur(v.base)})`} value={eur(v.amount)} />
            ))}
            <View style={[s.row, { justifyContent: 'space-between', backgroundColor: color, color: '#fff', padding: 6, borderRadius: 3, marginTop: 3 }]}>
              <Text style={s.bold}>{vatApplies ? 'Total TTC' : 'Total à payer'}</Text>
              <Text style={s.bold}>{eur(doc.total_ttc)}</Text>
            </View>
            {quote && quote.deposit_percent > 0 && (
              <TotalRow label={`Acompte à la signature (${num(quote.deposit_percent)} %)`} value={eur(quote.deposit_amount)} />
            )}
            {invoice && invoice.amount_paid > 0 && (
              <>
                <TotalRow label="Déjà réglé" value={`- ${eur(invoice.amount_paid)}`} />
                <TotalRow label="Reste à payer" value={eur(Math.max(0, invoice.total_ttc - invoice.amount_paid))} bold />
              </>
            )}
          </View>
        </View>
        {mention && <Text style={[s.bold, { marginTop: 8 }]}>{mention}</Text>}

        {/* Conditions */}
        <View style={{ marginTop: 18 }} wrap={false}>
          {doc.notes && <><Text style={s.bold}>Conditions particulières</Text><Text style={{ marginBottom: 6 }}>{doc.notes}</Text></>}
          {company.payment_terms && <Text><Text style={s.bold}>Paiement : </Text>{company.payment_terms}</Text>}
          {invoice && company.iban && <Text><Text style={s.bold}>IBAN : </Text>{company.iban.replace(/(.{4})/g, '$1 ').trim()}</Text>}
          {invoice && company.late_penalty_text && <Text style={s.muted}>{company.late_penalty_text}</Text>}
          {invoice && isPro && !company.late_penalty_text && (
            <Text style={s.muted}>Indemnité forfaitaire pour frais de recouvrement en cas de retard : 40 €.</Text>
          )}
          {company.legal_mentions && <Text style={[s.muted, { marginTop: 4 }]}>{company.legal_mentions}</Text>}
        </View>

        {/* Bon pour accord */}
        {quote && (
          <View style={[s.row, { marginTop: 20, justifyContent: 'flex-end' }]} wrap={false}>
            <View style={{ width: '48%', borderWidth: 0.5, borderColor: '#cbd5e1', borderRadius: 4, padding: 8, minHeight: 90 }}>
              <Text style={s.bold}>Bon pour accord</Text>
              <Text style={[s.muted, { fontSize: 7 }]}>Date, nom et signature du client précédés de la mention « Bon pour accord »</Text>
              {quote.signed_by_name && (
                <>
                  <Text style={{ marginTop: 4 }}>Signé électroniquement par {quote.signed_by_name} le {date(quote.accepted_at)}</Text>
                  {quote.signature_data && <Image src={quote.signature_data} style={{ height: 45, width: 140, objectFit: 'contain' }} />}
                </>
              )}
            </View>
          </View>
        )}

        {/* Pied de page légal répété sur chaque page. NB : les Text dynamiques (render) de react-pdf
            ne s'affichent pas dans cette version, d'où l'absence de numérotation. */}
        <Text style={s.footer} fixed>{legalLine}</Text>
      </Page>
    </Document>
  )
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 6 }}>
      <Text style={bold ? { fontFamily: 'Helvetica-Bold' } : { color: '#475569' }}>{label}</Text>
      <Text style={bold ? { fontFamily: 'Helvetica-Bold' } : {}}>{value}</Text>
    </View>
  )
}
