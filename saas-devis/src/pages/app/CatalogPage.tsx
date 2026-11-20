import type React from 'react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Archive, ArchiveRestore, Copy, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { Modal } from '../../components/Modal'
import { RowMenu } from '../../components/RowMenu'
import { EmptyState, Field, PageHeader, SearchInput, Spinner } from '../../components/ui'
import { UNITS, VAT_RATES, type Product } from '../../lib/types'
import { dbError, eur, parseNumber } from '../../lib/format'

type Draft = { id?: string; name: string; description: string; unit: string; unit_price: string; vat_rate: string; category: string }

export default function CatalogPage() {
  const { company } = useAuth()
  const toast = useToast()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  const vatApplies = company?.vat_regime === 'assujetti'
  const defaultVat = vatApplies ? String(company?.default_vat_rate ?? 20) : '0'

  const load = useCallback(async () => {
    if (!company) return
    const { data, error } = await supabase.from('products').select('*').eq('company_id', company.id).order('name')
    if (error) toast('error', dbError(error) ?? 'Erreur')
    setProducts((data as Product[]) ?? [])
  }, [company, toast])

  useEffect(() => { load() }, [load])

  const categories = useMemo(
    () => [...new Set((products ?? []).map((p) => p.category).filter((c): c is string => !!c))].sort(),
    [products],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (products ?? []).filter((p) =>
      (showArchived ? !p.is_active : p.is_active)
      && (!category || p.category === category)
      && (!q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)))
  }, [products, search, category, showArchived])

  const archivedCount = (products ?? []).filter((p) => !p.is_active).length

  const openNew = () => setDraft({ name: '', description: '', unit: 'unité', unit_price: '', vat_rate: defaultVat, category: category ?? '' })
  const openEdit = (p: Product, copy = false) => setDraft({
    id: copy ? undefined : p.id,
    name: copy ? `${p.name} (copie)` : p.name,
    description: p.description ?? '',
    unit: p.unit,
    unit_price: String(p.unit_price).replace('.', ','),
    vat_rate: String(p.vat_rate),
    category: p.category ?? '',
  })

  async function setActive(p: Product, is_active: boolean) {
    const { error } = await supabase.from('products').update({ is_active }).eq('id', p.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', is_active ? 'Produit réactivé' : 'Produit archivé')
    load()
  }

  async function remove(p: Product) {
    if (!confirm(`Supprimer « ${p.name} » ? Les devis existants conservent leurs lignes.`)) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Produit supprimé')
    load()
  }

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Vos produits et prestations, réutilisables dans tous vos devis."
        actions={<button className="btn-primary" onClick={openNew}><Plus className="h-4 w-4" /> Nouveau</button>}
      />

      {products === null ? (
        <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="Votre catalogue est vide"
          text="Ajoutez vos prestations courantes (main d’œuvre, déplacement, fournitures…) pour composer vos devis en quelques clics."
          action={<button className="btn-primary" onClick={openNew}><Plus className="h-4 w-4" /> Ajouter un produit</button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un produit…" />
            <div className="flex flex-wrap items-center gap-2">
              {categories.length > 0 && (
                <>
                  <Chip active={!category} onClick={() => setCategory(null)}>Tout</Chip>
                  {categories.map((c) => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
                </>
              )}
              {archivedCount > 0 && (
                <Chip active={showArchived} onClick={() => setShowArchived(!showArchived)}>
                  <Archive className="h-3.5 w-3.5" /> Archivés ({archivedCount})
                </Chip>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="card px-6 py-10 text-center text-sm text-slate-500">Aucun produit ne correspond.</p>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="hidden bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-header-group">
                  <tr>
                    <th className="px-4 py-3">Produit / prestation</th>
                    <th className="px-4 py-3">Unité</th>
                    <th className="px-4 py-3 text-right">Prix HT</th>
                    {vatApplies && <th className="px-4 py-3 text-right">TVA</th>}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((p) => (
                    <tr key={p.id} className="group flex flex-wrap items-center gap-x-3 px-4 py-3 hover:bg-slate-50 sm:table-row sm:p-0">
                      <td className="w-full cursor-pointer sm:w-auto sm:px-4 sm:py-3" onClick={() => openEdit(p)}>
                        <p className="font-medium text-slate-900">{p.name}</p>
                        {p.description && <p className="line-clamp-1 text-xs text-slate-500">{p.description}</p>}
                        {p.category && <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{p.category}</span>}
                      </td>
                      <td className="text-slate-500 sm:px-4 sm:py-3">{p.unit}</td>
                      <td className="font-semibold text-slate-900 sm:px-4 sm:py-3 sm:text-right">{eur(p.unit_price)}</td>
                      {vatApplies && <td className="text-slate-500 sm:px-4 sm:py-3 sm:text-right">{Number(p.vat_rate).toLocaleString('fr-FR')} %</td>}
                      <td className="ml-auto sm:px-2 sm:py-3">
                        <RowMenu items={[
                          { label: 'Modifier', icon: Pencil, onClick: () => openEdit(p) },
                          { label: 'Dupliquer', icon: Copy, onClick: () => openEdit(p, true) },
                          p.is_active
                            ? { label: 'Archiver', icon: Archive, onClick: () => setActive(p, false) }
                            : { label: 'Réactiver', icon: ArchiveRestore, onClick: () => setActive(p, true) },
                          { label: 'Supprimer', icon: Trash2, onClick: () => remove(p), danger: true },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {draft && (
        <ProductModal draft={draft} vatApplies={vatApplies} categories={categories}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); load() }} />
      )}
    </>
  )
}

function ProductModal({ draft, vatApplies, categories, onClose, onSaved }: {
  draft: Draft; vatApplies: boolean; categories: string[]; onClose: () => void; onSaved: () => void
}) {
  const { company } = useAuth()
  const toast = useToast()
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })

  const price = parseNumber(d.unit_price)
  const vat = vatApplies ? Number(d.vat_rate) : 0

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!d.name.trim()) return
    if (price < 0) return toast('error', 'Le prix ne peut pas être négatif.')
    setBusy(true)
    const row = {
      company_id: company!.id,
      name: d.name.trim(),
      description: d.description.trim() || null,
      unit: d.unit.trim() || 'unité',
      unit_price: Math.round(price * 100) / 100,
      vat_rate: vat,
      category: d.category.trim() || null,
    }
    const { error } = d.id
      ? await supabase.from('products').update(row).eq('id', d.id)
      : await supabase.from('products').insert(row)
    setBusy(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', d.id ? 'Produit modifié' : 'Produit ajouté')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={d.id ? 'Modifier le produit' : 'Nouveau produit'}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" form="product-form" disabled={busy || !d.name.trim()}>
          {busy && <Spinner className="h-4 w-4" />} Enregistrer
        </button>
      </>}>
      <form id="product-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" htmlFor="p-name" className="sm:col-span-2">
          <input id="p-name" className="input" required autoFocus value={d.name} onChange={set('name')}
            placeholder="Ex. Pose de carrelage" />
        </Field>
        <Field label="Description" htmlFor="p-desc" className="sm:col-span-2" hint="Reprise telle quelle sur le devis.">
          <textarea id="p-desc" rows={3} className="input" value={d.description} onChange={set('description')} />
        </Field>
        <Field label="Prix unitaire HT (€)" htmlFor="p-price"
          hint={vatApplies && price > 0 ? `soit ${eur(price * (1 + vat / 100))} TTC` : undefined}>
          <input id="p-price" className="input" inputMode="decimal" required value={d.unit_price} onChange={set('unit_price')} placeholder="0,00" />
        </Field>
        <Field label="Unité" htmlFor="p-unit">
          <input id="p-unit" list="units" className="input" value={d.unit} onChange={set('unit')} />
          <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </Field>
        {vatApplies && (
          <Field label="TVA" htmlFor="p-vat">
            <select id="p-vat" className="input" value={Number(d.vat_rate)} onChange={set('vat_rate')}>
              {VAT_RATES.map((r) => <option key={r} value={r}>{r.toLocaleString('fr-FR')} %</option>)}
            </select>
          </Field>
        )}
        <Field label="Catégorie" htmlFor="p-cat" hint="Facultatif, pour filtrer le catalogue.">
          <input id="p-cat" list="cats" className="input" value={d.category} onChange={set('category')} placeholder="Ex. Main d’œuvre" />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
      </form>
    </Modal>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
      {children}
    </button>
  )
}
