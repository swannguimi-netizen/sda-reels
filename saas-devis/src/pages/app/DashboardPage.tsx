import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, MessageSquareText, Package, Sparkles, TrendingUp, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { PageHeader, Spinner } from '../../components/ui'

interface Stats {
  quotes_this_month: number
  signed_revenue_ht_this_month: number
  acceptance_rate: number | null
  new_leads_this_month: number
  unread_conversations: number
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

export default function DashboardPage() {
  const { company, profile } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)

  const companyId = company?.id
  useEffect(() => {
    if (!companyId) return
    supabase.rpc('dashboard_stats', { p_company_id: companyId }).then(({ data }) => setStats(data as Stats))
  }, [companyId])

  const cards = [
    { label: 'Devis du mois', value: stats?.quotes_this_month, icon: FileText },
    { label: 'CA signé (HT)', value: stats && eur.format(stats.signed_revenue_ht_this_month), icon: TrendingUp },
    { label: 'Taux d’acceptation', value: stats && (stats.acceptance_rate == null ? '—' : `${stats.acceptance_rate} %`), icon: Sparkles },
    { label: 'Nouveaux prospects', value: stats?.new_leads_this_month, icon: Users },
  ]

  return (
    <>
      <PageHeader
        title={`Bonjour ${profile?.full_name?.split(' ')[0] ?? ''} 👋`}
        description={`Voici l’activité de ${company?.name} ce mois-ci.`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-5">
            <div className="flex items-center justify-between text-sm text-slate-500">
              {label} <Icon className="h-4 w-4 text-brand-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{stats ? value : <Spinner className="h-5 w-5 text-slate-300" />}</p>
          </div>
        ))}
      </div>

      <div className="card mt-6 p-6">
        <h2 className="font-semibold text-slate-900">Pour bien démarrer</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { to: '/entreprise', icon: FileText, title: 'Compléter le profil', text: 'Logo, adresse, mentions légales' },
            { to: '/catalogue', icon: Package, title: 'Créer le catalogue', text: 'Vos produits et prestations' },
            { to: '/assistant', icon: MessageSquareText, title: 'Former l’assistant', text: 'Horaires, tarifs, FAQ' },
          ].map(({ to, icon: Icon, title, text }) => (
            <Link key={to} to={to} className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50/40">
              <Icon className="mt-0.5 h-5 w-5 text-brand-600" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{title}</span>
                <span className="text-xs text-slate-500">{text}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
