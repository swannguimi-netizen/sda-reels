import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, BadgeCheck, CreditCard, ExternalLink, FileCheck2, Landmark, Lock, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { Alert, PageHeader, Spinner } from '../../components/ui'
import { useUsage } from '../../lib/billing'
import { invokeFunction } from '../../lib/functions'
import { dbError } from '../../lib/format'

interface Connect {
  stripe_account_id: string | null
  stripe_charges_enabled: boolean
  stripe_details_submitted: boolean
  deposit_online_enabled: boolean
  deposit_percent: number
}

export default function PaymentsPage() {
  const { company, role } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const { usage } = useUsage(company?.id)
  const [c, setC] = useState<Connect | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const canEdit = role === 'owner' || role === 'admin'
  const companyId = company?.id
  const back = params.get('connect')

  const load = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('companies')
      .select('stripe_account_id, stripe_charges_enabled, stripe_details_submitted, deposit_online_enabled, deposit_percent').eq('id', companyId).single()
    setC(data as Connect)
  }, [companyId])

  // Retour de l'inscription Stripe : on synchronise l'état du compte
  const sync = useCallback(async () => {
    if (!companyId) return
    try {
      const r = await invokeFunction<{ requirements?: string[] }>('connect', { action: 'status', company_id: companyId }, 'Impossible de vérifier le compte Stripe.')
      setMissing(r.requirements ?? [])
    } catch (e) {
      toast('error', (e as Error).message)
    }
    await load()
  }, [companyId, load, toast])

  useEffect(() => { if (back) sync(); else load() }, [back, sync, load])

  async function onboard() {
    setBusy('onboard')
    try {
      const { url } = await invokeFunction<{ url: string }>('connect', { action: 'onboard', company_id: companyId }, 'Connexion à Stripe impossible.')
      window.location.href = url
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(null)
    }
  }

  async function toggle(v: boolean) {
    setC((prev) => (prev ? { ...prev, deposit_online_enabled: v } : prev)) // affichage immédiat
    const { error } = await supabase.from('companies').update({ deposit_online_enabled: v }).eq('id', companyId)
    if (error) {
      setC((prev) => (prev ? { ...prev, deposit_online_enabled: !v } : prev))
      return toast('error', dbError(error) ?? 'Erreur')
    }
    toast('success', v ? 'Paiement de l’acompte en ligne activé' : 'Paiement de l’acompte en ligne désactivé')
    load()
  }

  if (!c || !usage) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>
  const included = usage.features.includes('online_deposit')
  const state = !c.stripe_account_id ? 'none' : c.stripe_charges_enabled ? 'active' : 'pending'

  return (
    <>
      <PageHeader title="Paiement en ligne des acomptes"
        description="Votre client signe le devis et règle l’acompte par carte dans la foulée. Vous démarrez le chantier l’esprit tranquille." />

      {!included && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-brand-900"><Lock className="h-4 w-4" /> Le paiement d’acompte en ligne est inclus à partir de l’offre Business.</p>
          <Link to="/abonnement" className="btn-primary shrink-0">Voir les offres</Link>
        </div>
      )}
      {back === 'retour' && state === 'active' && <div className="mb-6"><Alert kind="success">Votre compte Stripe est relié : vos clients peuvent désormais payer leur acompte en ligne.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card p-6">
          {state === 'none' && (
            <>
              <h2 className="text-lg font-semibold text-slate-900">Reliez votre compte Stripe</h2>
              <p className="mt-1 text-sm text-slate-600">
                Stripe est la solution de paiement utilisée par des millions d’entreprises. L’inscription prend environ 5 minutes :
                identité, SIRET et IBAN du compte qui recevra les fonds. Vous avez déjà un compte Stripe ? Vous pourrez l’utiliser.
              </p>
              <button className="btn-primary mt-5" onClick={onboard} disabled={!included || !canEdit || !!busy}>
                {busy === 'onboard' ? <Spinner className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />} Connecter mon compte Stripe
              </button>
              {!canEdit && <p className="mt-2 text-xs text-slate-500">Réservé au propriétaire et aux administrateurs.</p>}
            </>
          )}

          {state === 'pending' && (
            <>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><AlertTriangle className="h-5 w-5 text-amber-500" /> Inscription Stripe à terminer</h2>
              <p className="mt-1 text-sm text-slate-600">
                {c.stripe_details_submitted
                  ? 'Stripe vérifie vos informations. Cela prend en général quelques minutes, parfois jusqu’à 48 h.'
                  : 'Il manque encore des informations pour activer les paiements.'}
                {missing.length > 0 && ` (${missing.length} élément${missing.length > 1 ? 's' : ''} demandé${missing.length > 1 ? 's' : ''})`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={onboard} disabled={!canEdit || !!busy}>
                  {busy === 'onboard' ? <Spinner className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />} Reprendre l’inscription
                </button>
                <button className="btn-secondary" onClick={sync}>Actualiser</button>
              </div>
            </>
          )}

          {state === 'active' && (
            <>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><BadgeCheck className="h-5 w-5 text-emerald-500" /> Compte Stripe actif</h2>
              <p className="mt-1 text-sm text-slate-600">Les acomptes sont versés directement sur votre compte Stripe, puis sur votre compte bancaire.</p>
              <label className="mt-5 flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 p-4">
                <span>
                  <span className="block font-medium text-slate-900">Proposer le paiement de l’acompte en ligne</span>
                  <span className="text-sm text-slate-500">Un bouton « Payer l’acompte » apparaît après la signature du devis. Acompte par défaut : {Number(c.deposit_percent)} % (<Link to="/entreprise#documents" className="text-brand-600 underline">modifier</Link>), ajustable sur chaque devis.</span>
                </span>
                <input type="checkbox" className="mt-1 h-4 w-4" checked={c.deposit_online_enabled} disabled={!canEdit || !included} onChange={(e) => toggle(e.target.checked)} />
              </label>
              <a className="btn-secondary mt-4" href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer">
                Ouvrir mon tableau de bord Stripe <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </section>

        <aside className="card space-y-4 p-5 text-sm text-slate-600">
          <h2 className="font-semibold text-slate-900">Comment ça marche</h2>
          {[
            [FileCheck2, 'Le client signe le devis en ligne, puis paie l’acompte par carte (3-D Secure).'],
            [Landmark, 'L’argent arrive directement sur votre compte Stripe : la plateforme ne l’encaisse jamais.'],
            [FileCheck2, 'La facture d’acompte est créée automatiquement, et déduite de la facture finale.'],
            [ShieldCheck, 'Frais de transaction Stripe à vos tarifs Stripe, sans commission de notre part.'],
          ].map(([Icon, text], i) => {
            const I = Icon as React.ComponentType<{ className?: string }>
            return <p key={i} className="flex items-start gap-2.5"><I className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{text as string}</p>
          })}
        </aside>
      </div>
      {back && <button className="sr-only" onClick={() => setParams({})}>Fermer</button>}
    </>
  )
}
