import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileText, MessageSquareText, Sparkles } from 'lucide-react'
import { APP_NAME } from '../lib/supabase'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-500 p-12 text-white lg:flex">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold">
          <img src="/favicon.svg" alt="" className="h-8 w-8 rounded-lg ring-2 ring-white/30" />
          {APP_NAME}
        </Link>
        <div className="space-y-8">
          <h2 className="max-w-md text-4xl font-bold leading-tight">
            Vos devis en 2 minutes, vos clients servis jour et nuit.
          </h2>
          <ul className="space-y-4 text-brand-100">
            {[
              { icon: FileText, text: 'Devis et factures conformes, à vos couleurs, signés en ligne' },
              { icon: Sparkles, text: 'Décrivez le besoin en une phrase, l’IA rédige les lignes' },
              { icon: MessageSquareText, text: 'Un assistant sur votre site qui répond et collecte les demandes' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-white" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-brand-100">14 jours d’essai gratuit · sans carte bancaire</p>
      </aside>

      <main className="flex items-center justify-center bg-slate-50 px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center gap-2 font-bold text-slate-900 lg:hidden">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            {APP_NAME}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  )
}
