import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, CreditCard, Download, FileX2, Loader2, Lock, PenLine, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Alert, Spinner } from '../../components/ui'
import { SignaturePad, type SignaturePadHandle } from '../../components/SignaturePad'
import { lineTotal, type DocType, type DocumentBundle, type Invoice, type Quote } from '../../lib/documents'
import { VAT_REGIME_LABELS, type Client, type CompanyDetails } from '../../lib/types'
import { dateFr, eur, logoUrl } from '../../lib/format'
import { invokeFunction } from '../../lib/functions'

interface Payload {
  quote?: Quote
  invoice?: Invoice
  items: DocumentBundle['items']
  client: Partial<Client> | null
  company: CompanyDetails
  expired?: boolean
  online_signature?: boolean
  online_deposit?: boolean
  quote_number?: string | null
}

export default function PublicDocumentPage({ type }: { type: DocType }) {
  const { token } = useParams()
  const [data, setData] = useState<Payload | null | undefined>(undefined)

  // Stable : sert aussi au rafraîchissement après signature et paiement
  const load = useCallback(() => {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return setData(null)
    supabase.rpc(type === 'quote' ? 'get_public_quote' : 'get_public_invoice', { p_token: token })
      .then(({ data }) => setData((data as Payload) ?? null))
  }, [token, type])
  useEffect(load, [load])

  if (data === undefined) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-8 w-8 text-slate-400" /></div>
  if (data === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <div>
          <FileX2 className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Document introuvable</h1>
          <p className="mt-1 text-sm text-slate-500">Ce lien n’est plus valide. Contactez l’entreprise qui vous l’a envoyé.</p>
        </div>
      </div>
    )
  }

  const doc = (data.quote ?? data.invoice)!
  const { company, client, items } = data
  const color = company.brand_color
  const vatApplies = company.vat_regime === 'assujetti'
  const quote = data.quote
  const logo = logoUrl(company.logo_path)

  async function download() {
    const { renderDocumentPdf, downloadBlob, pdfFilename } = await import('../../pdf/generate')
    const bundle: DocumentBundle = { type, doc: doc as Quote | Invoice, items, client, company, quoteNumber: data!.quote_number }
    downloadBlob(await renderDocumentPdf(bundle), pdfFilename(bundle))
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-2" style={{ backgroundColor: color }} />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <header className="mb-6 flex items-center justify-between gap-4">
          {logo ? <img src={logo} alt={company.name} className="max-h-14 max-w-[180px] object-contain" />
            : <p className="text-xl font-bold" style={{ color }}>{company.name}</p>}
          <DownloadButton onClick={download} />
        </header>

        <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 border-b border-slate-100 p-6 sm:flex-row sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider" style={{ color }}>{type === 'quote' ? 'Devis' : 'Facture'}</p>
              <h1 className="text-2xl font-bold text-slate-900">{doc.number}</h1>
              {doc.title && <p className="mt-1 text-slate-600">{doc.title}</p>}
            </div>
            <div className="text-sm text-slate-600 sm:text-right">
              <p>{company.name}</p>
              {quote ? <p>Émis le {dateFr(quote.issue_date)}</p> : <p>Émise le {dateFr((doc as Invoice).issue_date)}</p>}
              {quote?.valid_until && <p>Valable jusqu’au {dateFr(quote.valid_until)}</p>}
              {data.invoice?.due_date && <p className="font-medium text-slate-900">Échéance : {dateFr(data.invoice.due_date)}</p>}
              {client?.name && <p className="mt-2 text-slate-900">Pour : {client.company_name ?? client.name}</p>}
            </div>
          </div>

          {quote?.intro && <p className="px-6 pt-5 text-sm text-slate-600">{quote.intro}</p>}

          <ul className="divide-y divide-slate-100 px-6 py-2">
            {items.map((l, i) => l.kind === 'section' ? (
              <li key={i} className="pt-4 pb-1 text-sm font-semibold" style={{ color }}>{l.description}</li>
            ) : l.kind === 'note' ? (
              <li key={i} className="py-2 text-sm italic text-slate-500">{l.description}</li>
            ) : (
              <li key={i} className="flex justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="whitespace-pre-line text-slate-900">{l.description}</p>
                  <p className="text-xs text-slate-500">
                    {Number(l.quantity).toLocaleString('fr-FR')} {l.unit} × {eur(l.unit_price)} HT
                    {l.discount_percent > 0 && ` · remise ${l.discount_percent} %`}
                    {vatApplies && ` · TVA ${Number(l.vat_rate).toLocaleString('fr-FR')} %`}
                  </p>
                </div>
                <p className="shrink-0 font-medium text-slate-900">{eur(lineTotal(l))}</p>
              </li>
            ))}
          </ul>

          <div className="border-t border-slate-100 bg-slate-50 px-6 py-4">
            <dl className="ml-auto max-w-xs space-y-1 text-sm">
              {doc.discount_percent > 0 && <TRow label={`Remise ${doc.discount_percent} %`} value={`- ${eur(doc.discount_amount)}`} />}
              <TRow label="Total HT" value={eur(doc.total_ht)} />
              {vatApplies && doc.vat_breakdown.map((v) => <TRow key={v.rate} label={`TVA ${v.rate.toLocaleString('fr-FR')} %`} value={eur(v.amount)} />)}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                <dt>{vatApplies ? 'Total TTC' : 'Total'}</dt><dd>{eur(doc.total_ttc)}</dd>
              </div>
              {quote && quote.deposit_percent > 0 && <TRow label={`Acompte à la signature (${quote.deposit_percent} %)`} value={eur(quote.deposit_amount)} />}
              {data.invoice && data.invoice.amount_paid > 0 && <TRow label="Reste à payer" value={eur(Math.max(0, data.invoice.total_ttc - data.invoice.amount_paid))} />}
            </dl>
            {!vatApplies && <p className="mt-2 text-right text-xs italic text-slate-500">{VAT_REGIME_LABELS[company.vat_regime].mention}</p>}
          </div>

          {(doc.notes || company.payment_terms) && (
            <div className="space-y-1 border-t border-slate-100 px-6 py-4 text-xs text-slate-500">
              {doc.notes && <p className="whitespace-pre-line">{doc.notes}</p>}
              {company.payment_terms && <p>Paiement : {company.payment_terms}</p>}
              {data.invoice && company.iban && <p>IBAN : {company.iban.replace(/(.{4})/g, '$1 ').trim()}</p>}
            </div>
          )}
        </article>

        {quote && <SignatureSection data={data} quote={quote} token={token!} color={color} onDone={load} />}
        {data.invoice?.status === 'paid' && (
          <div className="mt-6"><Alert kind="success">Cette facture a été réglée. Merci !</Alert></div>
        )}

        <footer className="mt-8 text-center text-xs text-slate-400">
          {[company.name, company.address_line1, [company.postal_code, company.city].filter(Boolean).join(' '), company.siret && `SIRET ${company.siret}`].filter(Boolean).join(' · ')}
        </footer>
      </div>
    </div>
  )
}

function TRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-slate-600"><dt>{label}</dt><dd className="text-slate-900">{value}</dd></div>
}

function DownloadButton({ onClick }: { onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className="btn-secondary" disabled={busy} onClick={async () => { setBusy(true); await onClick().catch(() => {}); setBusy(false) }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
    </button>
  )
}

function SignatureSection({ data, quote, token, color, onDone }: {
  data: Payload; quote: Quote; token: string; color: string; onDone: () => void
}) {
  const pad = useRef<SignaturePadHandle>(null)
  const [name, setName] = useState(data.client?.name ?? '')
  const [agree, setAgree] = useState(false)
  const [padEmpty, setPadEmpty] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusing, setRefusing] = useState(false)
  const [reason, setReason] = useState('')

  if (quote.status === 'accepted') {
    return <AcceptedSection data={data} quote={quote} token={token} color={color} onDone={onDone} />
  }
  if (quote.status === 'refused') return <div className="mt-6"><Alert>Vous avez décliné ce devis le {dateFr(quote.refused_at)}.</Alert></div>
  if (quote.status === 'expired' || data.expired) {
    return <div className="mt-6"><Alert>Ce devis a expiré le {dateFr(quote.valid_until)}. Contactez {data.company.name} pour une nouvelle proposition.</Alert></div>
  }
  if (!data.online_signature) {
    return <div className="mt-6"><Alert kind="info">Pour accepter ce devis, renvoyez-le signé avec la mention « Bon pour accord » à {data.company.name}{data.company.email ? ` (${data.company.email})` : ''}.</Alert></div>
  }

  async function sign() {
    if (name.trim().length < 2) return setError('Indiquez vos nom et prénom.')
    if (!agree) return setError('Cochez la case « Bon pour accord ».')
    if (pad.current?.isEmpty()) return setError('Tracez votre signature.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('sign_quote', { p_token: token, p_signer_name: name.trim(), p_signature: pad.current!.toDataURL() })
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  async function refuse() {
    setBusy(true)
    const { error } = await supabase.rpc('refuse_quote', { p_token: token, p_reason: reason.trim() || null })
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><PenLine className="h-5 w-5" style={{ color }} /> Accepter et signer</h2>
      <p className="mt-1 text-sm text-slate-500">Signature électronique : votre nom, la date et l’heure sont enregistrés avec votre signature.</p>
      <div className="mt-5 space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="signer">Nom et prénom du signataire</label>
          <input id="signer" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <span className="label">Signature</span>
          <SignaturePad ref={pad} onChange={setPadEmpty} />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>Bon pour accord. J’accepte le devis {quote.number} d’un montant de <strong>{eur(quote.total_ttc)}</strong>{quote.deposit_percent > 0 ? `, avec un acompte de ${eur(quote.deposit_amount)}` : ''}, et les conditions qui y figurent.</span>
        </label>
        <button className="btn w-full py-3 text-base text-white disabled:opacity-60" style={{ backgroundColor: color }} onClick={sign} disabled={busy || padEmpty || !agree}>
          {busy ? <Spinner className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />} Signer le devis
        </button>

        {!refusing ? (
          <button className="w-full text-center text-sm text-slate-500 hover:text-slate-800 hover:underline" onClick={() => setRefusing(true)}>Je ne souhaite pas donner suite</button>
        ) : (
          <div className="rounded-lg border border-slate-200 p-4">
            <label className="label" htmlFor="reason">Pouvez-vous nous en dire plus ? (facultatif)</label>
            <textarea id="reason" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Prix, délai, autre prestataire…" />
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRefusing(false)}>Annuler</button>
              <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={refuse} disabled={busy}><XCircle className="h-4 w-4" /> Décliner le devis</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Devis accepté : paiement de l'acompte en ligne (si proposé) ou modalités. */
function AcceptedSection({ data, quote, token, color, onDone }: { data: Payload; quote: Quote; token: string; color: string; onDone: () => void }) {
  const [params] = useSearchParams()
  const returned = params.get('acompte')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const depositDue = quote.deposit_percent > 0 && !quote.deposit_paid_at

  // Retour de Stripe : la confirmation (webhook) arrive en quelques secondes
  useEffect(() => {
    if (returned !== 'ok' || !depositDue) return
    let n = 0
    const t = setInterval(() => { if (++n > 10) clearInterval(t); onDone() }, 2500)
    return () => clearInterval(t)
  }, [returned, depositDue, onDone])

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await invokeFunction<{ url: string }>('deposit-checkout', { token }, 'Le paiement est momentanément indisponible.')
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl bg-emerald-50 p-6 text-center ring-1 ring-emerald-200">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <p className="mt-3 font-semibold text-emerald-900">Devis accepté{quote.signed_by_name ? ` et signé par ${quote.signed_by_name}` : ''} le {dateFr(quote.accepted_at)}</p>
        {quote.deposit_paid_at
          ? <p className="mt-2 text-sm text-emerald-800">Acompte de <strong>{eur(quote.deposit_amount)}</strong> reçu le {dateFr(quote.deposit_paid_at)}. Votre facture d’acompte vous sera transmise par {data.company.name}.</p>
          : !depositDue && <p className="mt-2 text-sm text-emerald-700">Merci pour votre confiance !</p>}
      </div>

      {depositDue && data.online_deposit && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          {returned === 'ok' ? (
            <p className="flex items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Paiement reçu, confirmation en cours…</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-slate-900">Régler l’acompte</h2>
              <p className="mt-1 text-sm text-slate-500">
                Acompte de {Number(quote.deposit_percent).toLocaleString('fr-FR')} % pour lancer votre projet. Paiement sécurisé par carte, versé directement à {data.company.name}.
              </p>
              {returned === 'annule' && <div className="mt-3"><Alert kind="info">Paiement annulé : rien n’a été débité. Vous pouvez réessayer quand vous le souhaitez.</Alert></div>}
              {error && <div className="mt-3"><Alert>{error}</Alert></div>}
              <button className="btn mt-4 w-full py-3 text-base text-white disabled:opacity-60" style={{ backgroundColor: color }} onClick={pay} disabled={busy}>
                {busy ? <Spinner className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />} Payer l’acompte de {eur(quote.deposit_amount)}
              </button>
              <p className="mt-2 flex items-center justify-center gap-1 text-xs text-slate-400"><Lock className="h-3 w-3" /> Paiement sécurisé par Stripe · 3-D Secure</p>
            </>
          )}
        </section>
      )}
      {depositDue && !data.online_deposit && (
        <p className="text-center text-sm text-slate-600">Un acompte de <strong>{eur(quote.deposit_amount)}</strong> est demandé. {data.company.name} vous communiquera les modalités de règlement.</p>
      )}
    </div>
  )
}
