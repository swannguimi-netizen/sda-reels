import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Plus, Receipt, Sparkles } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { EmptyState, PageHeader, SearchInput, Spinner } from '../../../components/ui'
import { InvoiceBadge, QuoteBadge } from '../../../components/StatusBadge'
import { invoiceDisplayStatus, quoteDisplayStatus, type DocType, type Invoice, type Quote } from '../../../lib/documents'
import { dateFr, eur } from '../../../lib/format'

type Row = (Quote | Invoice) & { client: { name: string; company_name: string | null } | null }

const TABS = {
  quote: [
    { id: 'all', label: 'Tous' }, { id: 'draft', label: 'Brouillons' }, { id: 'sent', label: 'En attente' },
    { id: 'accepted', label: 'Acceptés' }, { id: 'closed', label: 'Refusés / expirés' },
  ],
  invoice: [
    { id: 'all', label: 'Toutes' }, { id: 'draft', label: 'Brouillons' }, { id: 'issued', label: 'À payer' },
    { id: 'overdue', label: 'En retard' }, { id: 'paid', label: 'Payées' },
  ],
}

function tabOf(type: DocType, r: Row): string[] {
  if (type === 'quote') {
    const s = quoteDisplayStatus(r as Quote)
    return ['all', s === 'refused' || s === 'expired' ? 'closed' : s]
  }
  const s = invoiceDisplayStatus(r as Invoice)
  return ['all', s, ...(s === 'overdue' ? ['issued'] : [])]
}

export default function DocumentsListPage({ type }: { type: DocType }) {
  const { company } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const isQuote = type === 'quote'
  const base = isQuote ? '/devis' : '/factures'

  const companyId = company?.id
  useEffect(() => {
    if (!companyId) return
    setRows(null)
    setTab('all')
    supabase.from(isQuote ? 'quotes' : 'invoices')
      .select('*, client:clients(name, company_name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows((data as Row[]) ?? []))
  }, [companyId, isQuote])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows ?? []) for (const t of tabOf(type, r)) c[t] = (c[t] ?? 0) + 1
    return c
  }, [rows, type])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter((r) => tabOf(type, r).includes(tab)
      && (!q || [r.number, r.title, r.client?.name, r.client?.company_name].some((v) => v?.toLowerCase().includes(q))))
  }, [rows, tab, search, type])

  const total = visible.reduce((s, r) => s + Number(r.total_ttc), 0)

  return (
    <>
      <PageHeader
        title={isQuote ? 'Devis' : 'Factures'}
        description={isQuote ? 'Créez, envoyez et faites signer vos devis en ligne.' : 'Suivez vos factures et vos encaissements.'}
        actions={<Link to={`${base}/nouveau`} className="btn-primary"><Plus className="h-4 w-4" /> {isQuote ? 'Nouveau devis' : 'Nouvelle facture'}</Link>}
      />

      {rows === null ? (
        <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={isQuote ? FileText : Receipt}
          title={isQuote ? 'Aucun devis pour l’instant' : 'Aucune facture pour l’instant'}
          text={isQuote
            ? 'Créez votre premier devis à partir de votre catalogue. Bientôt : décrivez le besoin en une phrase et l’IA le rédige.'
            : 'Convertissez un devis accepté en facture en un clic, ou créez une facture directement.'}
          action={<Link to={`${base}/nouveau`} className="btn-primary">{isQuote ? <Sparkles className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {isQuote ? 'Créer un devis' : 'Créer une facture'}</Link>} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0">
              {TABS[type].map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    tab === t.id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
                  {t.label} <span className="ml-1 text-xs text-slate-400">{counts[t.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <SearchInput value={search} onChange={setSearch} placeholder="N°, client, objet…" />
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="hidden bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 md:table-header-group">
                <tr>
                  <th className="px-4 py-3">Numéro</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Montant TTC</th>
                  <th className="px-4 py-3">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r) => {
                  const dateValue = isQuote ? (r as Quote).issue_date : (r as Invoice).issue_date ?? r.created_at
                  return (
                    <tr key={r.id} onClick={() => navigate(`${base}/${r.id}`)}
                      className="grid cursor-pointer grid-cols-[1fr_auto] gap-x-3 px-4 py-3 hover:bg-slate-50 md:table-row md:p-0">
                      <td className="md:px-4 md:py-3">
                        <p className="font-semibold text-slate-900">{r.number ?? <span className="italic text-slate-400">Brouillon</span>}</p>
                        {r.title && <p className="line-clamp-1 text-xs text-slate-500">{r.title}</p>}
                      </td>
                      <td className="order-3 text-slate-600 md:order-none md:px-4 md:py-3">
                        {r.client ? (r.client.company_name ?? r.client.name) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="order-4 text-right text-xs text-slate-500 md:order-none md:px-4 md:py-3 md:text-left md:text-sm">{dateFr(dateValue)}</td>
                      <td className="text-right font-semibold text-slate-900 md:px-4 md:py-3">{eur(r.total_ttc)}</td>
                      <td className="order-5 col-span-2 md:order-none md:px-4 md:py-3">
                        {isQuote ? <QuoteBadge quote={r as Quote} /> : <InvoiceBadge invoice={r as Invoice} />}
                      </td>
                    </tr>
                  )
                })}
                {visible.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Aucun document ne correspond.</td></tr>}
              </tbody>
              {visible.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50 text-sm">
                  <tr className="flex justify-between px-4 py-3 md:table-row md:p-0">
                    <td className="text-slate-500 md:px-4 md:py-3" colSpan={3}>{visible.length} document{visible.length > 1 ? 's' : ''}</td>
                    <td className="text-right font-semibold text-slate-900 md:px-4 md:py-3">{eur(total)}</td>
                    <td className="hidden md:table-cell" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </>
  )
}
