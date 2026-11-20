import type React from 'react'
import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Heading, Package, Plus, StickyNote, Trash2 } from 'lucide-react'
import type { LineItem } from '../lib/documents'
import { lineTotal, newLine } from '../lib/documents'
import type { Product } from '../lib/types'
import { UNITS, VAT_RATES } from '../lib/types'
import { eur } from '../lib/format'
import { NumberInput } from './NumberInput'

export function LineItemsEditor({ lines, onChange, products, vatApplies, defaultVat, readOnly }: {
  lines: LineItem[]
  onChange: (lines: LineItem[]) => void
  products: Product[]
  vatApplies: boolean
  defaultVat: number
  readOnly?: boolean
}) {
  const [picker, setPicker] = useState(false)
  const update = (key: string, patch: Partial<LineItem>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= lines.length) return
    const next = [...lines]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const add = (l: Partial<LineItem>) => onChange([...lines, newLine({ vat_rate: vatApplies ? defaultVat : 0, ...l })])
  const addProduct = (p: Product) => {
    add({
      product_id: p.id,
      description: p.description ? `${p.name}\n${p.description}` : p.name,
      unit: p.unit, unit_price: Number(p.unit_price), vat_rate: vatApplies ? Number(p.vat_rate) : 0,
    })
    setPicker(false)
  }

  return (
    <div>
      {lines.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">Aucune ligne. Ajoutez une prestation depuis le catalogue ou une ligne libre.</p>
      )}

      <ul className="divide-y divide-slate-100">
        {lines.map((l, i) => (
          <li key={l.key} className="group py-3">
            {l.kind === 'item' ? (
              <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-[84px_100px_120px_96px_84px_1fr_auto] sm:items-end">
                <AutoTextarea className="input col-span-2 sm:col-span-7" placeholder="Désignation de la prestation" value={l.description}
                  disabled={readOnly} onChange={(v) => update(l.key, { description: v })} />
                <Labeled label="Quantité"><NumberInput className="input text-right" min={0} value={l.quantity} disabled={readOnly} aria-label="Quantité" onChange={(n) => update(l.key, { quantity: n })} /></Labeled>
                <Labeled label="Unité">
                  <input className="input" list="units-list" value={l.unit} disabled={readOnly} aria-label="Unité" onChange={(e) => update(l.key, { unit: e.target.value })} />
                </Labeled>
                <Labeled label="Prix unitaire HT"><NumberInput className="input text-right" min={0} value={l.unit_price} disabled={readOnly} aria-label="Prix unitaire HT" onChange={(n) => update(l.key, { unit_price: n })} /></Labeled>
                {vatApplies ? (
                  <Labeled label="TVA">
                    <select className="input px-1 text-right" value={l.vat_rate} disabled={readOnly} aria-label="TVA" onChange={(e) => update(l.key, { vat_rate: Number(e.target.value) })}>
                      {[...new Set([...VAT_RATES, l.vat_rate])].map((r) => <option key={r} value={r}>{r.toLocaleString('fr-FR')} %</option>)}
                    </select>
                  </Labeled>
                ) : <span className="hidden sm:block" />}
                <Labeled label="Remise %"><NumberInput className="input text-right" min={0} max={100} value={l.discount_percent} disabled={readOnly} aria-label="Remise %" onChange={(n) => update(l.key, { discount_percent: n })} /></Labeled>
                <p className="flex items-center justify-end py-2 text-base font-semibold text-slate-900 sm:block sm:text-right">{eur(lineTotal(l))}</p>
                <RowActions readOnly={readOnly} onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => remove(l.key)} />
              </div>
            ) : (
              <div className="flex items-start gap-2">
                {l.kind === 'section' ? <Heading className="mt-2.5 h-4 w-4 shrink-0 text-brand-600" /> : <StickyNote className="mt-2.5 h-4 w-4 shrink-0 text-amber-500" />}
                <AutoTextarea
                  className={`input flex-1 ${l.kind === 'section' ? 'font-semibold' : 'italic text-slate-600'}`}
                  placeholder={l.kind === 'section' ? 'Titre de section (ex. Salle de bain)' : 'Note (ex. Délai d’intervention : 2 semaines)'}
                  value={l.description} disabled={readOnly} onChange={(v) => update(l.key, { description: v })} />
                <RowActions readOnly={readOnly} onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => remove(l.key)} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <datalist id="units-list">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>

      {!readOnly && (
        <div className="relative mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPicker(!picker)} disabled={products.length === 0}
            title={products.length === 0 ? 'Votre catalogue est vide' : undefined}>
            <Package className="h-4 w-4" /> Depuis le catalogue
          </button>
          <button type="button" className="btn-secondary" onClick={() => add({})}><Plus className="h-4 w-4" /> Ligne libre</button>
          <button type="button" className="btn-secondary" onClick={() => add({ kind: 'section', vat_rate: 0 })}><Heading className="h-4 w-4" /> Section</button>
          <button type="button" className="btn-secondary" onClick={() => add({ kind: 'note', vat_rate: 0 })}><StickyNote className="h-4 w-4" /> Note</button>
          {picker && <ProductPicker products={products} onPick={addProduct} onClose={() => setPicker(false)} />}
        </div>
      )}
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function RowActions({ onUp, onDown, onRemove, readOnly }: { onUp: () => void; onDown: () => void; onRemove: () => void; readOnly?: boolean }) {
  if (readOnly) return <span />
  return (
    <div className="col-span-2 flex justify-end gap-0.5 sm:col-span-1">
      <div className="flex flex-col sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button type="button" onClick={onUp} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Monter"><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={onDown} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Descendre"><ArrowDown className="h-3.5 w-3.5" /></button>
      </div>
      <button type="button" onClick={onRemove} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Supprimer la ligne">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function AutoTextarea({ value, onChange, className, ...rest }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const rows = Math.min(8, Math.max(1, value.split('\n').length))
  return <textarea ref={ref} rows={rows} className={`${className} resize-none`} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
}

function ProductPicker({ products, onPick, onClose }: { products: Product[]; onPick: (p: Product) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter((p) => p.is_active && (!s || p.name.toLowerCase().includes(s) || p.category?.toLowerCase().includes(s))).slice(0, 50)
  }, [products, q])
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      <input autoFocus className="input" placeholder="Rechercher dans le catalogue…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && list[0]) { e.preventDefault(); onPick(list[0]) } }} />
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-brand-50">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{p.name}</span>
                {p.category && <span className="text-xs text-slate-500">{p.category}</span>}
              </span>
              <span className="shrink-0 text-slate-600">{eur(p.unit_price)} <span className="text-xs text-slate-400">/ {p.unit}</span></span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-2 py-4 text-center text-sm text-slate-500">Aucun résultat</li>}
      </ul>
    </div>
  )
}
