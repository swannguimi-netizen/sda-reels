import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Ban, Check, CheckCircle2, Copy, Download, Eye, FileCheck2, Hammer, Link2, Mail, Plus, Receipt,
  Save, Send, Trash2, Wallet, XCircle,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { Modal } from '../../../components/Modal'
import { RowMenu } from '../../../components/RowMenu'
import { NumberInput } from '../../../components/NumberInput'
import { LineItemsEditor } from '../../../components/LineItemsEditor'
import { InvoiceBadge, QuoteBadge } from '../../../components/StatusBadge'
import { Alert, Field, Spinner } from '../../../components/ui'
import { ClientModal, emptyClientDraft } from '../ClientsPage'
import {
  computeTotals, invoiceDisplayStatus, newLine, toPayload, today,
  type DocType, type Invoice, type LineItem, type Quote,
} from '../../../lib/documents'
import { TABLE, buildAndStorePdf, loadCompany, loadDocument, publicLink, sendByEmail } from '../../../lib/documentsApi'
import type { Client, CompanyDetails, Product } from '../../../lib/types'
import { VAT_REGIME_LABELS } from '../../../lib/types'
import { dateFr, dbError, eur } from '../../../lib/format'
import { isValidEmail } from '../../../lib/validation'

interface FormState {
  client_id: string
  title: string
  intro: string
  notes: string
  issue_date: string
  valid_until: string
  due_date: string
  discount_percent: number
  deposit_percent: number
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('sv-SE')
}

export default function DocumentEditorPage({ type }: { type: DocType }) {
  const { id: routeId } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { company } = useAuth()
  const toast = useToast()
  const isQuote = type === 'quote'
  const base = isQuote ? '/devis' : '/factures'
  const id = routeId && routeId !== 'nouveau' ? routeId : null

  const [details, setDetails] = useState<CompanyDetails | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [doc, setDoc] = useState<Quote | Invoice | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [lines, setLines] = useState<LineItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [modal, setModal] = useState<null | 'send' | 'client' | 'payment' | 'refuse'>(null)
  const [linkedInvoiceId, setLinkedInvoiceId] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const companyId = company?.id

  const load = useCallback(async () => {
    if (!companyId) return
    const [c, { data: cl }, { data: pr }] = await Promise.all([
      loadCompany(companyId),
      supabase.from('clients').select('*').eq('company_id', companyId).order('name'),
      supabase.from('products').select('*').eq('company_id', companyId).eq('is_active', true).order('name'),
    ])
    setDetails(c)
    setClients((cl as Client[]) ?? [])
    setProducts((pr as Product[]) ?? [])

    if (!id) {
      const issue = today()
      setDoc(null)
      setForm({
        client_id: search.get('client') ?? '', title: '', intro: '', notes: '',
        issue_date: issue, valid_until: addDays(issue, c.quote_validity_days), due_date: '',
        discount_percent: 0, deposit_percent: Number(c.deposit_percent),
      })
      setLines([newLine({ vat_rate: c.vat_regime === 'assujetti' ? Number(c.default_vat_rate) : 0 })])
      setDirty(false)
      return
    }
    try {
      const { doc: d, lines: l } = await loadDocument(type, id)
      setDoc(d)
      setLines(l)
      setForm({
        client_id: d.client_id ?? '', title: d.title ?? '', intro: (d as Quote).intro ?? '', notes: d.notes ?? '',
        issue_date: d.issue_date ?? '', valid_until: (d as Quote).valid_until ?? '', due_date: (d as Invoice).due_date ?? '',
        discount_percent: Number(d.discount_percent), deposit_percent: Number((d as Quote).deposit_percent ?? 0),
      })
      setDirty(false)
      if (isQuote) {
        const { data: inv } = await supabase.from('invoices').select('id').eq('quote_id', id).limit(1)
        setLinkedInvoiceId(inv?.[0]?.id ?? null)
      }
    } catch {
      setNotFound(true)
    }
  }, [companyId, id, type, isQuote, search])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const regime = details?.vat_regime ?? 'assujetti'
  const vatApplies = regime === 'assujetti'
  // Calcul en direct pendant la saisie ; une fois enregistré, la base (arrondis Postgres) fait foi
  const liveTotals = useMemo(() => computeTotals(lines, form?.discount_percent ?? 0, regime), [lines, form?.discount_percent, regime])
  const totals = doc && !dirty
    ? { subtotal_ht: Number(doc.subtotal_ht), discount_amount: Number(doc.discount_amount), total_ht: Number(doc.total_ht),
        total_vat: Number(doc.total_vat), total_ttc: Number(doc.total_ttc),
        vat_breakdown: doc.vat_breakdown.map((v) => ({ rate: Number(v.rate), base: Number(v.base), amount: Number(v.amount) })) }
    : liveTotals
  const client = clients.find((c) => c.id === form?.client_id) ?? null

  const quote = isQuote ? (doc as Quote | null) : null
  const invoice = !isQuote ? (doc as Invoice | null) : null
  const editable = !doc || (isQuote ? ['draft', 'sent'].includes(doc.status) : doc.status === 'draft')

  if (notFound) {
    return <Alert>Document introuvable. <Link to={base} className="font-semibold underline">Retour à la liste</Link></Alert>
  }
  if (!form || !details) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setForm({ ...form, [k]: v }); setDirty(true) }
  const setL = (l: LineItem[]) => { setLines(l); setDirty(true) }

  // ---------------------------------------------------------------------
  async function save(): Promise<string | null> {
    if (!editable) return doc?.id ?? null
    const payload = toPayload(lines)
    if (payload.some((l) => l.kind === 'item' && !l.description)) {
      toast('error', 'Chaque ligne doit avoir une désignation.')
      return null
    }
    setBusy('save')
    const fields: Record<string, unknown> = {
      client_id: form!.client_id || null,
      title: form!.title.trim() || null,
      notes: form!.notes.trim() || null,
      discount_percent: form!.discount_percent,
    }
    if (isQuote) {
      Object.assign(fields, {
        intro: form!.intro.trim() || null,
        issue_date: form!.issue_date || today(),
        valid_until: form!.valid_until || null,
        deposit_percent: form!.deposit_percent,
      })
    } else {
      fields.due_date = form!.due_date || null
    }

    let docId = doc?.id ?? null
    if (!docId) {
      const { data, error } = await supabase.from(TABLE[type]).insert({ ...fields, company_id: companyId }).select('id').single()
      if (error) { setBusy(null); toast('error', dbError(error) ?? 'Erreur'); return null }
      docId = data.id
    } else {
      const { error } = await supabase.from(TABLE[type]).update(fields).eq('id', docId)
      if (error) { setBusy(null); toast('error', dbError(error) ?? 'Erreur'); return null }
    }
    const { error } = await supabase.rpc('save_document_items', { p_doc_type: type, p_doc_id: docId, p_items: payload })
    setBusy(null)
    if (error) { toast('error', dbError(error) ?? 'Erreur'); return null }
    setDirty(false)
    if (!doc) {
      navigate(`${base}/${docId}`, { replace: true })
    } else {
      await load()
    }
    toast('success', 'Enregistré')
    return docId
  }

  async function ensureSaved(): Promise<string | null> {
    if (dirty || !doc) return save()
    return doc.id
  }

  async function downloadPdf() {
    const docId = await ensureSaved()
    if (!docId) return
    setBusy('pdf')
    try {
      const { blob, bundle } = await buildAndStorePdf(type, docId)
      const { downloadBlob, pdfFilename } = await import('../../../pdf/generate')
      downloadBlob(blob, pdfFilename(bundle))
    } catch (e) {
      toast('error', `PDF impossible : ${(e as Error).message}`)
    }
    setBusy(null)
  }

  async function previewPdf() {
    const docId = await ensureSaved()
    if (!docId) return
    setBusy('preview')
    const win = window.open('', '_blank')
    try {
      const { blob } = await buildAndStorePdf(type, docId)
      const url = URL.createObjectURL(blob)
      if (win) win.location.href = url
      else window.location.href = url
    } catch (e) {
      win?.close()
      toast('error', `PDF impossible : ${(e as Error).message}`)
    }
    setBusy(null)
  }

  async function updateStatus(patch: Record<string, unknown>, msg: string) {
    setBusy('status')
    const { error } = await supabase.from(TABLE[type]).update(patch).eq('id', doc!.id)
    setBusy(null)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', msg)
    load()
  }

  async function copyLink() {
    await navigator.clipboard.writeText(publicLink(type, doc!.public_token))
    toast('success', 'Lien copié')
  }

  async function convertToInvoice() {
    setBusy('convert')
    const { data, error } = await supabase.rpc('convert_quote_to_invoice', { p_quote_id: doc!.id })
    setBusy(null)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Facture créée en brouillon')
    navigate(`/factures/${data}`)
  }

  async function duplicate() {
    const { data, error } = await supabase.rpc('duplicate_quote', { p_quote_id: doc!.id })
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Devis dupliqué')
    navigate(`/devis/${data}`)
  }

  async function removeDraft() {
    if (!confirm('Supprimer ce brouillon ?')) return
    const { error } = await supabase.from(TABLE[type]).delete().eq('id', doc!.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Brouillon supprimé')
    navigate(base)
  }

  async function issueInvoice() {
    const docId = await ensureSaved()
    if (!docId) return
    if (!form!.client_id) return toast('error', 'Choisissez un client avant d’émettre la facture.')
    if (!confirm('Émettre la facture ? Elle recevra un numéro définitif et ne pourra plus être modifiée.')) return
    updateStatus({ status: 'issued' }, 'Facture émise')
  }

  // ---------------------------------------------------------------------
  const status = doc
    ? (isQuote ? <QuoteBadge quote={doc as Quote} /> : <InvoiceBadge invoice={doc as Invoice} />)
    : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Nouveau</span>

  const menu = doc ? [
    { label: 'Aperçu PDF', icon: Eye, onClick: previewPdf },
    ...(doc.status !== 'draft' ? [{ label: 'Copier le lien client', icon: Link2, onClick: copyLink }] : []),
    ...(isQuote ? [{ label: 'Dupliquer', icon: Copy, onClick: duplicate }] : []),
    ...(quote?.status === 'sent' ? [
      { label: 'Marquer accepté', icon: Check, onClick: () => updateStatus({ status: 'accepted' }, 'Devis marqué accepté') },
      { label: 'Marquer refusé', icon: XCircle, onClick: () => setModal('refuse') },
    ] : []),
    ...(doc.status === 'draft' ? [{ label: 'Supprimer', icon: Trash2, onClick: removeDraft, danger: true }] : []),
  ] : []

  return (
    <div className="pb-24 lg:pb-0">
      {/* En-tête */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link to={base} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Retour"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
                {doc?.number ?? (isQuote ? 'Nouveau devis' : 'Facture brouillon')}
              </h1>
              {status}
            </div>
            {dirty && <p className="text-xs text-amber-600">Modifications non enregistrées</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <button className="btn-secondary" onClick={save} disabled={!!busy || (!dirty && !!doc)}>
              {busy === 'save' ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Enregistrer
            </button>
          )}
          <button className="btn-secondary" onClick={downloadPdf} disabled={!!busy}>
            {busy === 'pdf' ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />} PDF
          </button>
          {primaryAction()}
          {menu.length > 0 && <RowMenu items={menu} />}
        </div>
      </div>

      {stateBanner()}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Client */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Client</h2>
              {editable && <button className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setModal('client')}><Plus className="mr-1 inline h-3.5 w-3.5" />Nouveau client</button>}
            </div>
            <select className="input" value={form.client_id} disabled={!editable} onChange={(e) => set('client_id', e.target.value)} aria-label="Client">
              <option value="">— Choisir un client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name ? `${c.company_name} (${c.name})` : c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
            </select>
            {client && (
              <p className="mt-2 text-sm text-slate-500">
                {[client.email, client.phone, [client.address_line1, client.postal_code, client.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                {!client.email && <span className="text-amber-600"> · pas d’email : l’envoi en ligne sera impossible</span>}
              </p>
            )}
          </section>

          {/* Informations */}
          <section className="card grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Objet" htmlFor="title" className="sm:col-span-2">
              <input id="title" className="input" disabled={!editable} placeholder={isQuote ? 'Ex. Rénovation salle de bain' : 'Ex. Travaux de plomberie'}
                value={form.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            {isQuote ? (
              <>
                <Field label="Date du devis" htmlFor="issue_date">
                  <input id="issue_date" type="date" className="input" disabled={!editable} value={form.issue_date}
                    onChange={(e) => { setForm({ ...form, issue_date: e.target.value, valid_until: addDays(e.target.value, details.quote_validity_days) }); setDirty(true) }} />
                </Field>
                <Field label="Valable jusqu’au" htmlFor="valid_until">
                  <input id="valid_until" type="date" className="input" disabled={!editable} value={form.valid_until} onChange={(e) => set('valid_until', e.target.value)} />
                </Field>
                <Field label="Introduction" htmlFor="intro" className="sm:col-span-2" hint="Facultatif, affichée avant les lignes.">
                  <textarea id="intro" rows={2} className="input" disabled={!editable} value={form.intro} onChange={(e) => set('intro', e.target.value)}
                    placeholder="Suite à notre visite du…, veuillez trouver ci-dessous notre proposition." />
                </Field>
              </>
            ) : (
              <>
                <Field label="Date d’émission" htmlFor="issue">
                  <input id="issue" className="input" disabled value={invoice?.issue_date ? dateFr(invoice.issue_date) : 'À l’émission'} />
                </Field>
                <Field label="Échéance" htmlFor="due_date" hint={!form.due_date ? `Par défaut : ${details.invoice_due_days} jours après émission` : undefined}>
                  <input id="due_date" type="date" className="input" disabled={!editable} value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
                </Field>
              </>
            )}
          </section>

          {/* Lignes */}
          <section className="card p-5">
            <h2 className="mb-3 font-semibold text-slate-900">Prestations</h2>
            <LineItemsEditor lines={lines} onChange={setL} products={products} vatApplies={vatApplies}
              defaultVat={Number(details.default_vat_rate)} readOnly={!editable} />
          </section>

          <section className="card p-5">
            <Field label="Conditions particulières" htmlFor="notes" hint="Délais, modalités, validité… Imprimées sous les totaux.">
              <textarea id="notes" rows={3} className="input" disabled={!editable} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </section>
        </div>

        {/* Colonne de droite */}
        <aside className="space-y-6">
          <section className="card p-5 lg:sticky lg:top-6">
            <h2 className="mb-3 font-semibold text-slate-900">Total</h2>
            <dl className="space-y-1.5 text-sm">
              {form.discount_percent > 0 && <Row label="Sous-total HT" value={eur(totals.subtotal_ht)} />}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-600">Remise globale</dt>
                <dd className="flex items-center gap-1">
                  <NumberInput className="input w-20 py-1 text-right" min={0} max={100} disabled={!editable} aria-label="Remise globale %"
                    value={form.discount_percent} onChange={(n) => set('discount_percent', n)} />
                  <span className="text-slate-500">%</span>
                </dd>
              </div>
              {form.discount_percent > 0 && <Row label="Remise" value={`- ${eur(totals.discount_amount)}`} />}
              <Row label="Total HT" value={eur(totals.total_ht)} strong />
              {totals.vat_breakdown.map((v) => <Row key={v.rate} label={`TVA ${v.rate.toLocaleString('fr-FR')} %`} value={eur(v.amount)} />)}
              {!vatApplies && <p className="text-xs italic text-slate-500">{VAT_REGIME_LABELS[regime].mention}</p>}
              <div className="!mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-white" style={{ backgroundColor: details.brand_color }}>
                <dt className="font-semibold">{vatApplies ? 'Total TTC' : 'Total'}</dt>
                <dd className="text-lg font-bold">{eur(totals.total_ttc)}</dd>
              </div>
              {isQuote && (
                <div className="!mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <dt className="text-slate-600">Acompte à la signature</dt>
                  <dd className="flex items-center gap-1">
                    <NumberInput className="input w-20 py-1 text-right" min={0} max={100} disabled={!editable} aria-label="Acompte %"
                      value={form.deposit_percent} onChange={(n) => set('deposit_percent', n)} />
                    <span className="text-slate-500">%</span>
                  </dd>
                </div>
              )}
              {isQuote && form.deposit_percent > 0 && <Row label="Montant de l’acompte" value={eur(Math.round(totals.total_ttc * form.deposit_percent) / 100)} />}
              {invoice && invoice.amount_paid > 0 && (
                <>
                  <Row label="Déjà réglé" value={`- ${eur(invoice.amount_paid)}`} />
                  <Row label="Reste à payer" value={eur(Math.max(0, invoice.total_ttc - invoice.amount_paid))} strong />
                </>
              )}
            </dl>
          </section>

          {doc && timeline()}
        </aside>
      </div>

      {modal === 'client' && (
        <ClientModal draft={emptyClientDraft()} onClose={() => setModal(null)}
          onSaved={(c) => { setClients([...clients, c].sort((a, b) => a.name.localeCompare(b.name))); set('client_id', c.id); setModal(null) }} />
      )}
      {modal === 'send' && doc && (
        <SendModal type={type} doc={doc} client={client} company={details} onClose={() => setModal(null)} onSent={() => { setModal(null); load() }} />
      )}
      {modal === 'payment' && invoice && (
        <PaymentModal invoice={invoice} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />
      )}
      {modal === 'refuse' && quote && (
        <Modal open title="Devis refusé" onClose={() => setModal(null)}
          footer={<><button className="btn-secondary" onClick={() => setModal(null)}>Annuler</button>
            <button className="btn-primary" form="refuse-form">Confirmer</button></>}>
          <form id="refuse-form" onSubmit={(e) => {
            e.preventDefault()
            const reason = new FormData(e.currentTarget).get('reason') as string
            setModal(null)
            updateStatus({ status: 'refused', refusal_reason: reason.trim() || null }, 'Devis marqué refusé')
          }}>
            <Field label="Motif (facultatif, pour vos statistiques)" htmlFor="reason"><textarea id="reason" name="reason" rows={3} className="input" /></Field>
          </form>
        </Modal>
      )}
    </div>
  )

  // ---------------------------------------------------------------------
  function primaryAction() {
    if (!doc) {
      return <button className="btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Créer</button>
    }
    if (isQuote) {
      if (doc.status === 'draft' || doc.status === 'sent') {
        return (
          <button className="btn-primary" disabled={!!busy} onClick={async () => { if (await ensureSaved()) setModal('send') }}>
            <Send className="h-4 w-4" /> {doc.status === 'sent' ? 'Renvoyer' : 'Envoyer'}
          </button>
        )
      }
      if (doc.status === 'accepted') {
        return linkedInvoiceId
          ? <Link to={`/factures/${linkedInvoiceId}`} className="btn-primary"><Receipt className="h-4 w-4" /> Voir la facture</Link>
          : <button className="btn-primary" onClick={convertToInvoice} disabled={!!busy}>{busy === 'convert' ? <Spinner className="h-4 w-4" /> : <Receipt className="h-4 w-4" />} Convertir en facture</button>
      }
      return null
    }
    if (doc.status === 'draft') {
      return <button className="btn-primary" onClick={issueInvoice} disabled={!!busy}><FileCheck2 className="h-4 w-4" /> Émettre</button>
    }
    if (doc.status === 'issued') {
      return (
        <>
          <button className="btn-secondary" onClick={() => setModal('send')}><Mail className="h-4 w-4" /> Envoyer</button>
          <button className="btn-primary" onClick={() => setModal('payment')}><Wallet className="h-4 w-4" /> Encaisser</button>
        </>
      )
    }
    return null
  }

  function stateBanner() {
    if (!doc) return null
    if (quote?.status === 'accepted') {
      return (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            {quote.signed_by_name
              ? <>Signé en ligne par <strong>{quote.signed_by_name}</strong> le {dateFr(quote.accepted_at)}.</>
              : <>Accepté le {dateFr(quote.accepted_at)}.</>}
            {quote.deposit_paid_at && <> Acompte réglé.</>}
          </p>
          {!quote.work_completed_at ? (
            <button className="btn-secondary" onClick={() => updateStatus({ work_completed_at: new Date().toISOString() }, 'Prestation marquée terminée')}>
              <Hammer className="h-4 w-4" /> Prestation terminée
            </button>
          ) : <span className="text-sm text-emerald-700">Prestation terminée le {dateFr(quote.work_completed_at)}</span>}
        </div>
      )
    }
    if (quote?.status === 'refused') {
      return <div className="mb-6"><Alert>Refusé le {dateFr(quote.refused_at)}{quote.refusal_reason ? ` : « ${quote.refusal_reason} »` : '.'} Dupliquez-le pour proposer une nouvelle version.</Alert></div>
    }
    if (quote?.status === 'sent') {
      return <div className="mb-6"><Alert kind="info">En attente de réponse du client. Vous pouvez encore modifier le devis puis le renvoyer.</Alert></div>
    }
    if (invoice && invoiceDisplayStatus(invoice) === 'overdue') {
      return <div className="mb-6"><Alert>Échéance dépassée depuis le {dateFr(invoice.due_date)}.</Alert></div>
    }
    if (invoice?.status === 'issued') {
      return <div className="mb-6"><Alert kind="info">Facture émise : elle n’est plus modifiable. Pour la corriger, il faudra émettre un avoir.</Alert></div>
    }
    if (invoice?.status === 'paid') {
      return <div className="mb-6"><Alert kind="success">Payée le {dateFr(invoice.paid_at)}.</Alert></div>
    }
    return null
  }

  function timeline() {
    const events: Array<[string, string | null | undefined, React.ComponentType<{ className?: string }>]> = isQuote
      ? [
        ['Créé', doc!.created_at, Plus],
        ['Envoyé', doc!.sent_at, Send],
        ['Consulté par le client', quote!.viewed_at, Eye],
        [quote!.signed_by_name ? 'Signé en ligne' : 'Accepté', quote!.accepted_at, Check],
        ['Refusé', quote!.refused_at, Ban],
        ['Acompte réglé', quote!.deposit_paid_at, Wallet],
        ['Prestation terminée', quote!.work_completed_at, Hammer],
      ]
      : [
        ['Créée', doc!.created_at, Plus],
        ['Émise', invoice!.issue_date, FileCheck2],
        ['Envoyée', doc!.sent_at, Send],
        ['Payée', invoice!.paid_at, Wallet],
      ]
    const shown = events.filter(([, d]) => d)
    return (
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-900">Historique</h2>
        <ol className="space-y-3">
          {shown.map(([label, d, Icon]) => (
            <li key={label} className="flex items-center gap-3 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100"><Icon className="h-3.5 w-3.5 text-slate-600" /></span>
              <span className="flex-1 text-slate-700">{label}</span>
              <span className="text-xs text-slate-500">{dateFr(d)}</span>
            </li>
          ))}
        </ol>
        {invoice?.quote_id && <Link to={`/devis/${invoice.quote_id}`} className="mt-4 block text-sm font-medium text-brand-600 hover:underline">Voir le devis d’origine</Link>}
      </section>
    )
  }
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className={strong ? 'font-semibold text-slate-900' : 'text-slate-600'}>{label}</dt>
      <dd className={strong ? 'font-semibold text-slate-900' : 'text-slate-900'}>{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------
function SendModal({ type, doc, client, company, onClose, onSent }: {
  type: DocType; doc: Quote | Invoice; client: Client | null; company: CompanyDetails; onClose: () => void; onSent: () => void
}) {
  const toast = useToast()
  const isQuote = type === 'quote'
  const label = isQuote ? 'devis' : 'facture'
  const [to, setTo] = useState(client?.email ?? '')
  const [subject, setSubject] = useState(`${isQuote ? 'Devis' : 'Facture'} ${doc.number ?? ''} – ${company.name}`)
  const [message, setMessage] = useState(
    `Bonjour${client?.name ? ` ${client.name}` : ''},\n\n`
    + (isQuote
      ? `Veuillez trouver ci-joint notre devis ${doc.number}${doc.title ? ` pour « ${doc.title} »` : ''}, d’un montant de ${eur(doc.total_ttc)}.\nVous pouvez le consulter et le signer en ligne grâce au lien ci-dessous.`
      : `Veuillez trouver ci-joint la facture ${doc.number}, d’un montant de ${eur(doc.total_ttc)}.`)
    + `\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n${company.name}`,
  )
  const [busy, setBusy] = useState<'email' | 'manual' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function sendEmail() {
    if (!isValidEmail(to)) return setError('Adresse email invalide.')
    setBusy('email')
    setError(null)
    try {
      await buildAndStorePdf(type, doc.id)
      await sendByEmail({ type, id: doc.id, to: to.trim(), subject, message })
      toast('success', `${isQuote ? 'Devis envoyé' : 'Facture envoyée'} à ${to}`)
      onSent()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
  }

  async function sendManually() {
    setBusy('manual')
    await navigator.clipboard.writeText(publicLink(type, doc.public_token)).catch(() => {})
    const patch = isQuote ? { status: 'sent' } : { sent_at: new Date().toISOString() }
    const { error } = doc.status === 'draft' || !isQuote
      ? await supabase.from(TABLE[type]).update(patch).eq('id', doc.id)
      : { error: null }
    setBusy(null)
    if (error) return setError(dbError(error))
    toast('success', 'Lien copié : collez-le dans votre message (SMS, WhatsApp…)')
    onSent()
  }

  return (
    <Modal open size="lg" title={`Envoyer le ${label}`} onClose={onClose}
      footer={<>
        <button className="btn-secondary mr-auto" onClick={sendManually} disabled={!!busy}>
          {busy === 'manual' ? <Spinner className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} Copier le lien
        </button>
        <button className="btn-primary" onClick={sendEmail} disabled={!!busy}>
          {busy === 'email' ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Envoyer par email
        </button>
      </>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Destinataire" htmlFor="to"><input id="to" type="email" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Objet" htmlFor="subject"><input id="subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message" htmlFor="message" hint={`Le PDF est joint et un bouton « ${isQuote ? 'Consulter et signer' : 'Consulter la facture'} » est ajouté automatiquement.`}>
          <textarea id="message" rows={9} className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">
          Vous préférez l’envoyer vous-même par SMS ou WhatsApp ? « Copier le lien » marque le {label} comme envoyé et copie son lien de consultation{isQuote ? ' et de signature' : ''}.
        </p>
      </div>
    </Modal>
  )
}

function PaymentModal({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const remaining = Math.max(0, Math.round((invoice.total_ttc - invoice.amount_paid) * 100) / 100)
  const [amount, setAmount] = useState(remaining)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (amount <= 0) return
    setBusy(true)
    const paid = Math.round((Number(invoice.amount_paid) + amount) * 100) / 100
    const { error } = await supabase.from('invoices').update({ amount_paid: paid }).eq('id', invoice.id)
    setBusy(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', paid >= invoice.total_ttc ? 'Facture soldée' : 'Paiement enregistré')
    onSaved()
  }

  return (
    <Modal open title="Enregistrer un paiement" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={submit} disabled={busy || amount <= 0}>{busy && <Spinner className="h-4 w-4" />} Enregistrer</button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Reste à payer : <strong>{eur(remaining)}</strong></p>
        <Field label="Montant reçu (€)" htmlFor="amount">
          <NumberInput id="amount" min={0} max={remaining} value={amount} onChange={setAmount} />
        </Field>
      </div>
    </Modal>
  )
}
