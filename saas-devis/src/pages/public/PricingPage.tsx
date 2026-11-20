import { Link, useNavigate } from 'react-router-dom'
import { PlanGrid } from '../../components/PlanGrid'
import { Spinner } from '../../components/ui'
import { usePlans } from '../../lib/billing'
import { APP_NAME } from '../../lib/supabase'

const FAQ = [
  ['Faut-il une carte bancaire pour l’essai ?', 'Non. Vous profitez de toutes les fonctionnalités pendant 14 jours, puis vous choisissez votre offre.'],
  ['Puis-je changer d’offre ?', 'À tout moment, depuis votre espace. Le changement est calculé au prorata.'],
  ['Y a-t-il un engagement ?', 'Aucun. L’abonnement est mensuel et résiliable en un clic.'],
  ['Que se passe-t-il si je dépasse mes messages IA ?', 'L’assistant de votre site passe la main à votre équipe et vous prévient : vos clients ne restent jamais sans réponse.'],
  ['Fonctionne-t-il en Guyane et dans les DOM ?', 'Oui : la TVA non applicable (art. 294 du CGI) et les taux des DOM sont gérés sur vos devis et factures.'],
]

export default function PricingPage() {
  const plans = usePlans()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Link to="/" className="flex items-center gap-2 font-bold text-slate-900"><img src="/favicon.svg" alt="" className="h-8 w-8" />{APP_NAME}</Link>
        <div className="flex gap-2">
          <Link to="/connexion" className="btn-secondary">Connexion</Link>
          <Link to="/inscription" className="btn-primary">Essai gratuit</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16">
        <div className="mx-auto max-w-2xl py-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Des devis en 2 minutes, des clients servis 24 h/24</h1>
          <p className="mt-3 text-slate-600">14 jours d’essai gratuit avec toutes les fonctionnalités, sans carte bancaire. Sans engagement.</p>
        </div>
        {plans ? <PlanGrid plans={plans} ctaLabel={() => 'Commencer l’essai'} onChoose={() => navigate('/inscription')} />
          : <div className="flex justify-center py-10"><Spinner className="h-7 w-7 text-brand-600" /></div>}
        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Questions fréquentes</h2>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="cursor-pointer list-none font-medium text-slate-900">{q}</summary>
                <p className="mt-2 text-sm text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
