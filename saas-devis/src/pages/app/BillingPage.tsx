import type React from 'react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, CreditCard, ExternalLink, MessageSquareText, Users } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { PlanGrid } from '../../components/PlanGrid'
import { Alert, PageHeader, Spinner } from '../../components/ui'
import { daysLeft, euros, type Plan, PRICE_SUFFIX, usePlans, useUsage } from '../../lib/billing'
import { invokeFunction } from '../../lib/functions'
import { dateFr } from '../../lib/format'

export default function BillingPage() {
  const { company, role } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const plans = usePlans()
  const { usage, refresh } = useUsage(company?.id)
  const [busy, setBusy] = useState<string | null>(null)
  const canManage = role === 'owner' || role === 'admin'
  const payment = params.get('paiement')

  // Retour de Stripe : le webhook peut arriver quelques secondes après
  useEffect(() => {
    if (payment !== 'ok') return
    let n = 0
    const t = setInterval(async () => {
      const u = await refresh()
      if ((u && u.status === 'active') || ++n >= 10) clearInterval(t)
    }, 2000)
    return () => clearInterval(t)
  }, [payment, refresh])

  async function go(action: 'checkout' | 'portal', plan?: Plan) {
    if (!company) return
    setBusy(plan?.id ?? 'portal')
    try {
      const { url } = await invokeFunction<{ url: string }>('billing', { action, company_id: company.id, plan_id: plan?.id },
        'Le service de paiement est indisponible. Réessayez dans un instant.')
      window.location.href = url
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(null)
    }
  }

  if (!usage || !plans) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  const trialing = usage.status === 'trialing'
  const left = daysLeft(usage.trial_ends_at)
  const subscribed = usage.has_stripe && ['active', 'past_due', 'unpaid'].includes(usage.status)

  return (
    <>
      <PageHeader title="Abonnement" description="Votre offre, votre consommation et vos factures."
        actions={usage.has_stripe && canManage ? (
          <button className="btn-secondary" onClick={() => go('portal')} disabled={!!busy}>
            {busy === 'portal' ? <Spinner className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />} Carte et factures <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ) : undefined} />

      {payment === 'ok' && (
        <div className="mb-6"><Alert kind="success">
          {usage.status === 'active' || (trialing && usage.has_stripe)
            ? <>Merci ! Votre abonnement <strong>{usage.plan_name}</strong> est actif.</>
            : <>Paiement reçu, activation de votre abonnement en cours…</>}
        </Alert></div>
      )}
      {payment === 'annule' && <div className="mb-6"><Alert kind="info">Paiement annulé : rien n’a été prélevé. <button className="underline" onClick={() => setParams({})}>Fermer</button></Alert></div>}

      {/* Situation actuelle */}
      <section className="card mb-8 grid gap-6 p-5 lg:grid-cols-[1fr_1fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Offre</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{usage.plan_name}</p>
          <p className="text-sm text-slate-500">{euros(usage.price_cents)} {PRICE_SUFFIX}</p>
          <StatusLine />
        </div>
        <Meter icon={MessageSquareText} label="Messages IA ce mois-ci" used={usage.ai_used} limit={usage.ai_limit} />
        <Meter icon={Users} label="Utilisateurs" used={usage.users} limit={usage.max_users} />
      </section>

      <h2 className="mb-1 text-lg font-semibold text-slate-900">{subscribed ? 'Changer d’offre' : 'Choisir votre offre'}</h2>
      <p className="mb-5 text-sm text-slate-500">
        {trialing && !usage.has_stripe
          ? `Vous profitez de toutes les fonctionnalités pendant l’essai. Abonnez-vous maintenant : le premier prélèvement aura lieu à la fin de l’essai${left > 2 ? `, dans ${left} jours` : ''}.`
          : 'Sans engagement, résiliable à tout moment depuis le portail. Changement d’offre au prorata.'}
      </p>
      {!canManage && <div className="mb-4"><Alert kind="info">Seuls le propriétaire et les administrateurs peuvent modifier l’abonnement.</Alert></div>}
      <PlanGrid plans={plans} currentPlan={subscribed || (trialing && usage.has_stripe) ? usage.plan : null} busyPlan={busy}
        ctaLabel={(p) => (subscribed ? `Passer à ${p.name}` : `Choisir ${p.name}`)}
        onChoose={(p) => canManage && go('checkout', p)} />
      <p className="mt-4 text-center text-xs text-slate-400">Paiement sécurisé par Stripe. Factures disponibles dans « Carte et factures ».</p>
    </>
  )

  function StatusLine() {
    const u = usage!
    if (u.status === 'trialing' && !u.has_stripe) {
      return <p className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${left <= 3 ? 'text-red-600' : 'text-amber-600'}`}>
        <CalendarClock className="h-4 w-4" /> Essai gratuit : {left} jour{left > 1 ? 's' : ''} restant{left > 1 ? 's' : ''}</p>
    }
    if (u.status === 'trialing' || u.status === 'active') {
      return <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" />
        {u.cancel_at_period_end ? `Résilié, actif jusqu’au ${dateFr(u.current_period_end)}`
          : u.status === 'trialing' ? `Abonné · premier prélèvement le ${dateFr(u.trial_ends_at)}`
          : `Actif · renouvellement le ${dateFr(u.current_period_end)}`}</p>
    }
    if (u.status === 'past_due' || u.status === 'unpaid') {
      return <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-red-600"><AlertTriangle className="h-4 w-4" /> Paiement en échec : mettez à jour votre carte</p>
    }
    return <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-red-600"><AlertTriangle className="h-4 w-4" /> Abonnement inactif</p>
  }
}

function Meter({ icon: Icon, label, used, limit }: { icon: React.ComponentType<{ className?: string }>; label: string; used: number; limit: number }) {
  const ratio = limit ? Math.min(1, used / limit) : 0
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{used.toLocaleString('fr-FR')} <span className="text-base font-normal text-slate-400">/ {limit.toLocaleString('fr-FR')}</span></p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${ratio >= 0.9 ? 'bg-red-500' : ratio >= 0.7 ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}
