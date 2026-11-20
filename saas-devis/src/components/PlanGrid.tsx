import type React from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { BASE_FEATURES, euros, FEATURE_LABELS, type Plan, PRICE_SUFFIX } from '../lib/billing'

/** Grille des offres : chaque offre reprend la précédente et ajoute ses fonctionnalités. */
export function PlanGrid({ plans, currentPlan, busyPlan, ctaLabel, onChoose }: {
  plans: Plan[]
  currentPlan?: string | null
  busyPlan?: string | null
  ctaLabel?: (p: Plan) => string
  onChoose: (p: Plan) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((p, i) => {
        const prev = plans[i - 1]
        const added = p.features.filter((f) => !prev?.features.includes(f))
        const current = p.id === currentPlan
        return (
          <div key={p.id} className={`relative flex flex-col rounded-2xl border bg-white p-5 ${
            p.highlighted ? 'border-brand-500 shadow-lg ring-1 ring-brand-500' : 'border-slate-200 shadow-sm'}`}>
            {p.highlighted && (
              <span className="absolute -top-3 left-5 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                <Sparkles className="h-3 w-3" /> Le plus choisi
              </span>
            )}
            <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
            <p className="min-h-[2.5rem] text-sm text-slate-500">{p.description}</p>
            <p className="mt-3">
              <span className="text-3xl font-bold tracking-tight text-slate-900">{euros(p.price_cents)}</span>
              <span className="ml-1 text-sm text-slate-500">{PRICE_SUFFIX}</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              <Feature strong>{p.max_users} utilisateur{p.max_users > 1 ? 's' : ''}</Feature>
              <Feature strong>{p.ai_messages_per_month.toLocaleString('fr-FR')} messages IA / mois</Feature>
              {i === 0 ? BASE_FEATURES.map((f) => <Feature key={f}>{f}</Feature>) : <Feature>Tout {prev.name}, plus :</Feature>}
              {added.map((f) => <Feature key={f} accent>{FEATURE_LABELS[f] ?? f}</Feature>)}
            </ul>
            <div className="mt-auto pt-5">
              <button onClick={() => onChoose(p)} disabled={current || !!busyPlan}
                className={`w-full ${p.highlighted ? 'btn-primary' : 'btn-secondary'} ${current ? 'cursor-default' : ''}`}>
                {busyPlan === p.id && <Loader2 className="h-4 w-4 animate-spin" />}
                {current ? 'Offre actuelle' : ctaLabel ? ctaLabel(p) : `Choisir ${p.name}`}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Feature({ children, strong, accent }: { children: React.ReactNode; strong?: boolean; accent?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${accent ? 'text-brand-600' : 'text-emerald-500'}`} />
      <span className={strong ? 'font-semibold text-slate-900' : accent ? 'font-medium text-slate-900' : ''}>{children}</span>
    </li>
  )
}
