import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building, Mail, MessageSquareText, Pencil, Phone, Plus, Trash2, User, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { Modal } from '../../components/Modal'
import { RowMenu } from '../../components/RowMenu'
import { EmptyState, Field, PageHeader, SearchInput, Spinner } from '../../components/ui'
import type { Client } from '../../lib/types'
import { dateFr, dbError } from '../../lib/format'
import { isValidEmail, isValidSiret } from '../../lib/validation'

const FIELDS = ['type', 'name', 'company_name', 'siret', 'email', 'phone', 'address_line1', 'address_line2',
  'postal_code', 'city', 'country', 'notes'] as const
type Draft = { id?: string } & Record<(typeof FIELDS)[number], string>

const emptyDraft = (): Draft => ({
  type: 'particulier', name: '', company_name: '', siret: '', email: '', phone: '',
  address_line1: '', address_line2: '', postal_code: '', city: '', country: 'France', notes: '',
})

export default function ClientsPage() {
  const { company } = useAuth()
  const toast = useToast()
  const [clients, setClients] = useState<Client[] | null>(null)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)

  const load = useCallback(async () => {
    if (!company) return
    const { data, error } = await supabase.from('clients').select('*').eq('company_id', company.id).order('name')
    if (error) toast('error', dbError(error) ?? 'Erreur')
    setClients((data as Client[]) ?? [])
  }, [company, toast])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients ?? []
    return (clients ?? []).filter((c) =>
      [c.name, c.company_name, c.email, c.phone, c.city].some((v) => v?.toLowerCase().includes(q)))
  }, [clients, search])

  const openEdit = (c: Client) => {
    const d = { id: c.id } as Draft
    for (const k of FIELDS) d[k] = (c[k] as string | null) ?? ''
    setDraft(d)
  }

  async function remove(c: Client) {
    if (!confirm(`Supprimer le client « ${c.name} » ?`)) return
    const { error } = await supabase.from('clients').delete().eq('id', c.id)
    if (error) {
      return toast('error', error.code === '23503'
        ? 'Ce client a des devis ou factures : il ne peut pas être supprimé.'
        : dbError(error) ?? 'Erreur')
    }
    toast('success', 'Client supprimé')
    load()
  }

  return (
    <>
      <PageHeader title="Clients" description="Votre fichier clients, partagé avec l’assistant IA et les devis."
        actions={<button className="btn-primary" onClick={() => setDraft(emptyDraft())}><Plus className="h-4 w-4" /> Nouveau client</button>} />

      {clients === null ? (
        <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>
      ) : clients.length === 0 ? (
        <EmptyState icon={Users} title="Aucun client pour l’instant"
          text="Ajoutez vos clients ici. Les prospects collectés par l’assistant IA viendront aussi s’y ajouter."
          action={<button className="btn-primary" onClick={() => setDraft(emptyDraft())}><Plus className="h-4 w-4" /> Ajouter un client</button>} />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Nom, email, téléphone, ville…" />
            <span className="hidden text-sm text-slate-500 sm:block">{clients.length} client{clients.length > 1 ? 's' : ''}</span>
          </div>
          {visible.length === 0 ? (
            <p className="card px-6 py-10 text-center text-sm text-slate-500">Aucun client ne correspond.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((c) => (
                <li key={c.id} className="card flex flex-col p-4 transition hover:border-brand-200">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      c.type === 'professionnel' ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-600'}`}>
                      {c.type === 'professionnel' ? <Building className="h-5 w-5" /> : <User className="h-5 w-5" />}
                    </span>
                    <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(c)}>
                      <p className="truncate font-semibold text-slate-900">{c.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {[c.company_name, c.city].filter(Boolean).join(' · ') || (c.type === 'professionnel' ? 'Professionnel' : 'Particulier')}
                      </p>
                    </button>
                    <RowMenu items={[
                      { label: 'Modifier', icon: Pencil, onClick: () => openEdit(c) },
                      { label: 'Supprimer', icon: Trash2, onClick: () => remove(c), danger: true },
                    ]} />
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 truncate text-slate-600 hover:text-brand-600"><Mail className="h-3.5 w-3.5 shrink-0" />{c.email}</a>}
                    {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-600"><Phone className="h-3.5 w-3.5 shrink-0" />{c.phone}</a>}
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-3 text-xs text-slate-400">
                    <span>Ajouté le {dateFr(c.created_at)}</span>
                    {c.source === 'widget' && <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700"><MessageSquareText className="h-3 w-3" />Assistant IA</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {draft && <ClientModal draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); load() }} />}
    </>
  )
}

export function ClientModal({ draft, onClose, onSaved }: {
  draft: Draft
  onClose: () => void
  onSaved: (client: Client) => void
}) {
  const { company } = useAuth()
  const toast = useToast()
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })
  const pro = d.type === 'professionnel'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!d.name.trim()) errs.name = 'Nom obligatoire.'
    if (d.email.trim() && !isValidEmail(d.email)) errs.email = 'Email invalide.'
    if (pro && d.siret.trim() && !isValidSiret(d.siret)) errs.siret = 'SIRET invalide.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setBusy(true)
    const row: Record<string, string | null> = { company_id: company!.id }
    for (const k of FIELDS) row[k] = d[k].trim() || null
    row.type = d.type
    row.siret = pro ? d.siret.replace(/\s/g, '') || null : null
    row.company_name = pro ? row.company_name : null
    row.email = row.email?.toLowerCase() ?? null
    const { data, error } = d.id
      ? await supabase.from('clients').update(row).eq('id', d.id).select().single()
      : await supabase.from('clients').insert(row).select().single()
    setBusy(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', d.id ? 'Client modifié' : 'Client ajouté')
    onSaved(data as Client)
  }

  const err = (k: keyof Draft) => errors[k] && <span className="text-red-600">{errors[k]}</span>

  return (
    <Modal open size="lg" onClose={onClose} title={d.id ? 'Modifier le client' : 'Nouveau client'}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" form="client-form" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Enregistrer</button>
      </>}>
      <form id="client-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
          {(['particulier', 'professionnel'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setD({ ...d, type: t })}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium capitalize transition ${d.type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {t}
            </button>
          ))}
        </div>
        <Field label={pro ? 'Nom du contact' : 'Nom et prénom'} htmlFor="c-name" hint={err('name')}>
          <input id="c-name" className="input" autoFocus value={d.name} onChange={set('name')} />
        </Field>
        {pro ? (
          <Field label="Société" htmlFor="c-company"><input id="c-company" className="input" value={d.company_name} onChange={set('company_name')} /></Field>
        ) : <div className="hidden sm:block" />}
        <Field label="Email" htmlFor="c-email" hint={err('email')}>
          <input id="c-email" type="email" className="input" value={d.email} onChange={set('email')} />
        </Field>
        <Field label="Téléphone" htmlFor="c-phone"><input id="c-phone" type="tel" className="input" value={d.phone} onChange={set('phone')} /></Field>
        {pro && (
          <Field label="SIRET" htmlFor="c-siret" className="sm:col-span-2" hint={err('siret')}>
            <input id="c-siret" inputMode="numeric" className="input" value={d.siret} onChange={set('siret')} />
          </Field>
        )}
        <Field label="Adresse" htmlFor="c-addr" className="sm:col-span-2"><input id="c-addr" className="input" value={d.address_line1} onChange={set('address_line1')} /></Field>
        <Field label="Complément" htmlFor="c-addr2" className="sm:col-span-2"><input id="c-addr2" className="input" value={d.address_line2} onChange={set('address_line2')} /></Field>
        <Field label="Code postal" htmlFor="c-cp"><input id="c-cp" className="input" inputMode="numeric" value={d.postal_code} onChange={set('postal_code')} /></Field>
        <Field label="Ville" htmlFor="c-city"><input id="c-city" className="input" value={d.city} onChange={set('city')} /></Field>
        <Field label="Notes internes" htmlFor="c-notes" className="sm:col-span-2" hint="Non visibles par le client.">
          <textarea id="c-notes" rows={2} className="input" value={d.notes} onChange={set('notes')} />
        </Field>
      </form>
    </Modal>
  )
}
