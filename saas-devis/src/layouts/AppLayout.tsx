import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  BookOpen, Building2, CalendarDays, ChevronsUpDown, CreditCard, FileText, Inbox, LayoutDashboard,
  LogOut, Menu, Package, Receipt, Shield, Users, X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { APP_NAME, supabase } from '../lib/supabase'
import { logoUrl } from '../lib/format'

const NAV = [
  { section: null, items: [{ to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true }] },
  {
    section: 'Ventes',
    items: [
      { to: '/devis', label: 'Devis', icon: FileText },
      { to: '/factures', label: 'Factures', icon: Receipt },
      { to: '/clients', label: 'Clients', icon: Users },
      { to: '/catalogue', label: 'Catalogue', icon: Package },
    ],
  },
  {
    section: 'Assistant IA',
    items: [
      { to: '/boite-de-reception', label: 'Boîte de réception', icon: Inbox },
      { to: '/assistant', label: 'Configuration', icon: BookOpen },
      { to: '/rendez-vous', label: 'Rendez-vous', icon: CalendarDays },
    ],
  },
  {
    section: 'Réglages',
    items: [
      { to: '/entreprise', label: 'Entreprise', icon: Building2 },
      { to: '/abonnement', label: 'Abonnement', icon: CreditCard },
    ],
  },
]

/** Nombre de conversations non lues (rafraîchi toutes les 30 s et en temps réel). */
function useUnreadCount() {
  const { company } = useAuth()
  const [count, setCount] = useState(0)
  const companyId = company?.id
  useEffect(() => {
    if (!companyId) return
    const load = () => supabase.from('conversations').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('unread', true).eq('status', 'open')
      .then(({ count: c }) => setCount(c ?? 0))
    load()
    const t = setInterval(load, 30_000)
    const channel = supabase.channel(`unread-${companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `company_id=eq.${companyId}` }, load)
      .subscribe()
    return () => { clearInterval(t); supabase.removeChannel(channel) }
  }, [companyId])
  return count
}

export function AppLayout() {
  const [open, setOpen] = useState(false)
  const unread = useUnreadCount()
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Barre mobile */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Ouvrir le menu">
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-semibold text-slate-900">{APP_NAME}</span>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <span className="flex items-center gap-2 font-bold text-slate-900">
            <img src="/favicon.svg" alt="" className="h-7 w-7" /> {APP_NAME}
          </span>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-500 lg:hidden" aria-label="Fermer le menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <CompanySwitcher />
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" onClick={() => setOpen(false)}>
          {NAV.map((group) => (
            <div key={group.section ?? 'main'}>
              {group.section && (
                <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{group.section}</p>
              )}
              {group.items.map(({ to, label, icon: Icon, ...rest }) => (
                <NavLink key={to} to={to} end={'end' in rest}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                  <Icon className="h-4 w-4" /> <span className="flex-1">{label}</span>
                  {to === '/boite-de-reception' && unread > 0 && (
                    <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{unread}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
          <AdminLink />
        </nav>
        <UserFooter />
      </aside>

      <main className="lg:pl-64">
        <TrialBanner />
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function CompanySwitcher() {
  const { company, memberships, switchCompany } = useAuth()
  if (!company) return null
  return (
    <div className="border-y border-slate-100 px-3 py-3">
      <label className="relative flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
        {company.logo_path ? (
          <img src={logoUrl(company.logo_path)!} alt="" className="h-8 w-8 shrink-0 rounded-md border border-slate-100 object-contain" />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
            style={{ backgroundColor: company.brand_color }}>
            {company.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{company.name}</span>
        {memberships.length > 1 && (
          <>
            <ChevronsUpDown className="h-4 w-4 text-slate-400" />
            <select aria-label="Changer d’entreprise" className="absolute inset-0 cursor-pointer opacity-0"
              value={company.id} onChange={(e) => switchCompany(e.target.value)}>
              {memberships.map((m) => <option key={m.company.id} value={m.company.id}>{m.company.name}</option>)}
            </select>
          </>
        )}
      </label>
    </div>
  )
}

function AdminLink() {
  const { profile } = useAuth()
  if (!profile?.is_platform_admin) return null
  return (
    <NavLink to="/admin" className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
      <Shield className="h-4 w-4" /> Super-admin
    </NavLink>
  )
}

function UserFooter() {
  const { profile, signOut } = useAuth()
  return (
    <div className="flex items-center gap-2 border-t border-slate-100 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{profile?.full_name ?? 'Mon compte'}</p>
        <p className="truncate text-xs text-slate-500">{profile?.email}</p>
      </div>
      <button onClick={signOut} title="Se déconnecter" aria-label="Se déconnecter"
        className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  )
}

function TrialBanner() {
  // Branché sur current_usage() à l'étape « Stripe et abonnements »
  return null
}
