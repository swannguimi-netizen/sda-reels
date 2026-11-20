import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, HelpCircle, Lightbulb, RotateCcw, Sparkles, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { invokeFunction } from '../lib/functions'
import { eur } from '../lib/format'
import { lineTotal } from '../lib/documents'
import { Alert, Spinner } from './ui'

export interface ProposalLine {
  kind: 'item' | 'section' | 'note'
  description: string
  product_id: string | null
  quantity: number
  unit: string
  unit_price: number
  vat_rate: number
  is_estimate: boolean
}

export interface Proposal {
  title: string
  intro: string
  lines: ProposalLine[]
  assumptions: string[]
  questions: string[]
}

const EXAMPLES = [
  'Remplacement d’un chauffe-eau électrique 200 L dans une maison à Kourou, accès facile, évacuation de l’ancien',
  'Peinture d’un salon de 25 m² : murs et plafond, deux couches, protection du sol',
  'Création d’un site vitrine de 5 pages avec formulaire de contact et référencement de base',
]

const LOADING_STEPS = ['Lecture de votre catalogue…', 'Chiffrage des prestations…', 'Vérification des quantités et de la TVA…']

export function AiQuotePanel({ companyId, clientId, vatApplies, onInsert, onClose, initialDescription = '' }: {
  companyId: string
  clientId: string | null
  vatApplies: boolean
  onInsert: (p: Proposal) => void
  onClose: () => void
  initialDescription?: string
}) {
  const [description, setDescription] = useState(initialDescription)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [selected, setSelected] = useState<boolean[]>([])
  const [usage, setUsage] = useState<{ ai_used: number; ai_limit: number } | null>(null)

  useEffect(() => {
    supabase.rpc('current_usage', { p_company_id: companyId }).then(({ data }) => data && setUsage(data))
  }, [companyId, proposal])

  useEffect(() => {
    if (!busy) return
    setStep(0)
    const t = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 4000)
    return () => clearInterval(t)
  }, [busy])

  const total = useMemo(
    () => (proposal?.lines ?? []).reduce((s, l, i) => s + (selected[i] ? lineTotal(l) : 0), 0),
    [proposal, selected],
  )

  async function generate() {
    if (description.trim().length < 10) return setError('Décrivez le besoin en une phrase au moins.')
    setBusy(true)
    setError(null)
    try {
      const p = await invokeFunction<Proposal>('generate-quote',
        { company_id: companyId, client_id: clientId, description: description.trim() },
        'La génération a échoué. Réessayez dans un instant.')
      if (!p.lines.length) throw new Error('Aucune ligne proposée : précisez votre demande.')
      setProposal(p)
      setSelected(p.lines.map(() => true))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  const quotaReached = usage ? usage.ai_used >= usage.ai_limit : false

  return (
    <section className="card overflow-hidden border-brand-200 ring-1 ring-brand-100">
      <div className="flex items-center justify-between bg-gradient-to-r from-brand-600 to-indigo-500 px-5 py-3 text-white">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4" /> Générer avec l’IA</h2>
        <div className="flex items-center gap-3">
          {usage && <span className="text-xs text-brand-100">{usage.ai_used} / {usage.ai_limit} ce mois-ci</span>}
          <button onClick={onClose} className="rounded p-0.5 text-brand-100 hover:text-white" aria-label="Fermer le panneau IA"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {!proposal ? (
          <>
            <label className="block">
              <span className="label">Décrivez le besoin du client, comme vous le diriez à un collègue</span>
              <textarea rows={3} className="input" value={description} disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
                placeholder="Ex. Rénovation d’une salle de bain de 6 m² : dépose, douche à l’italienne, carrelage mural, meuble vasque" />
            </label>
            {!description && (
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => setDescription(ex)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-left text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50">
                    {ex.length > 60 ? `${ex.slice(0, 58)}…` : ex}
                  </button>
                ))}
              </div>
            )}
            {error && <Alert>{error}</Alert>}
            {quotaReached && <Alert kind="info">Quota IA du mois atteint. Passez à l’offre Pro pour continuer à générer des devis.</Alert>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">L’IA s’appuie sur votre catalogue et vos prix. Vous relisez tout avant insertion.</p>
              <button className="btn-primary" onClick={generate} disabled={busy || quotaReached || description.trim().length < 10}>
                {busy ? <><Spinner className="h-4 w-4" /> {LOADING_STEPS[step]}</> : <><Sparkles className="h-4 w-4" /> Proposer les lignes</>}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Proposition</p>
              <p className="font-semibold text-slate-900">{proposal.title || 'Devis'}</p>
              {proposal.intro && <p className="text-sm text-slate-500">{proposal.intro}</p>}
            </div>

            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {proposal.lines.map((l, i) => (
                <li key={i} className={`flex items-start gap-3 px-3 py-2 text-sm ${selected[i] ? '' : 'opacity-50'}`}>
                  <input type="checkbox" className="mt-1" checked={selected[i]} aria-label={`Garder : ${l.description}`}
                    onChange={(e) => setSelected(selected.map((v, j) => (j === i ? e.target.checked : v)))} />
                  {l.kind === 'section' ? (
                    <p className="font-semibold text-brand-700">{l.description}</p>
                  ) : l.kind === 'note' ? (
                    <p className="italic text-slate-500">{l.description}</p>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-line text-slate-900">{l.description}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          {l.quantity.toLocaleString('fr-FR')} {l.unit} × {eur(l.unit_price)} HT{vatApplies && ` · TVA ${l.vat_rate.toLocaleString('fr-FR')} %`}
                          {l.is_estimate
                            ? <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700"><AlertTriangle className="h-3 w-3" />Prix estimé</span>
                            : <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700"><Check className="h-3 w-3" />Catalogue</span>}
                        </p>
                      </div>
                      <p className="shrink-0 font-medium text-slate-900">{eur(lineTotal(l))}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {(proposal.assumptions.length > 0 || proposal.questions.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {proposal.assumptions.length > 0 && (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="mb-1 flex items-center gap-1.5 font-medium text-slate-700"><Lightbulb className="h-4 w-4 text-amber-500" /> Hypothèses retenues</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-slate-600">{proposal.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                )}
                {proposal.questions.length > 0 && (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="mb-1 flex items-center gap-1.5 font-medium text-slate-700"><HelpCircle className="h-4 w-4 text-brand-500" /> À vérifier avec le client</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-slate-600">{proposal.questions.map((q) => <li key={q}>{q}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">Sélection : <strong className="text-slate-900">{eur(total)} HT</strong></p>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => { setProposal(null); setError(null) }}><RotateCcw className="h-4 w-4" /> Recommencer</button>
                <button className="btn-primary" disabled={!selected.some(Boolean)}
                  onClick={() => onInsert({ ...proposal, lines: proposal.lines.filter((_, i) => selected[i]) })}>
                  <Check className="h-4 w-4" /> Insérer dans le devis
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
