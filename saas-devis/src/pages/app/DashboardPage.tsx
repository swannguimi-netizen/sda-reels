import type React from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, Building2, CheckCircle2, Circle, Clock, FileText, Hand,
  MessageSquareText, Package, Send, Sparkles,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Spinner } from '../../components/ui'
import { QuoteBadge } from '../../components/StatusBadge'
import { BarChart, monthlyData } from '../../components/charts/BarChart'
import type { Quote } from '../../lib/documents'
import { type Conversation, relativeTime, visitorLabel } from '../../lib/inbox'
import { dateFr, eur } from '../../lib/format'

interface Stats {
  quotes_this_month: number
  quotes_sent_this_month: number
  signed_revenue_ht_this_month: number
  pending_quotes_amount_ht: number
  acceptance_rate: number | null
  unpaid_invoices_amount: number
  overdue_invoices_count: number
  new_leads_this_month: number
  open_conversations: number
  unread_conversations: number
  monthly_revenue: Array<{ month: string; amount: number }>
}

type Todo = { key: string; icon: React.ComponentType<{ className?: string }>; tone: string; title: string; detail: string; to: string }
type QuoteRow = Quote & { client: { name: string; company_name: string | null } | null }

const eur0 = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

export default function DashboardPage() {
  const { company, profile } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [todos, setTodos] = useState<Todo[] | null>(null)
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [setup, setSetup] = useState<Array<{ done: boolean; label: string; hint: string; to: string; icon: React.ComponentType<{ className?: string }> }> | null>(null)
  const companyId = company?.id

  useEffect(() => {
    if (!companyId) return
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const today = new Date().toLocaleDateString('sv-SE')
    const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0)

    Promise.all([
      supabase.rpc('dashboard_stats', { p_company_id: companyId }),
      supabase.from('quotes').select('id, number, title, total_ttc, sent_at, viewed_at, client:clients(name, company_name)')
        .eq('company_id', companyId).eq('status', 'sent').lt('sent_at', threeDaysAgo).order('sent_at').limit(4),
      supabase.from('invoices').select('id, number, total_ttc, amount_paid, due_date, client:clients(name, company_name)')
        .eq('company_id', companyId).eq('status', 'issued').lt('due_date', today).order('due_date').limit(4),
      supabase.from('leads').select('id, name, need, urgency, conversation_id, created_at')
        .eq('company_id', companyId).eq('is_quote_request', true).eq('status', 'new').order('created_at', { ascending: false }).limit(4),
      supabase.from('conversations').select('*').eq('company_id', companyId).order('last_message_at', { ascending: false }).limit(5),
      supabase.from('quotes').select('*, client:clients(name, company_name)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(5),
      supabase.from('companies').select('siret, address_line1, logo_path').eq('id', companyId).single(),
      count(supabase.from('products').select('id', { count: 'exact', head: true }).eq('company_id', companyId)),
      count(supabase.from('knowledge_entries').select('id', { count: 'exact', head: true }).eq('company_id', companyId)),
      count(supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('company_id', companyId).neq('status', 'draft')),
      count(supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('company_id', companyId).not('page_url', 'like', '%/assistant%')),
      count(supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('mode', 'human').eq('status', 'open')),
    ]).then(([s, follow, overdue, requests, convs, recent, comp, nProducts, nKb, nSent, nWidget, nHuman]) => {
      setStats(s.data as Stats)
      setConversations((convs.data as Conversation[]) ?? [])
      setQuotes((recent.data as unknown as QuoteRow[]) ?? [])

      const t: Todo[] = []
      for (const l of requests.data ?? []) {
        t.push({ key: `l${l.id}`, icon: Sparkles, tone: l.urgency === 'urgente' ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50',
          title: `Demande de devis${l.name ? ` de ${l.name}` : ''}`, detail: l.need ?? 'Via l’assistant', to: `/boite-de-reception?c=${l.conversation_id}` })
      }
      if (nHuman > 0) {
        t.push({ key: 'human', icon: Hand, tone: 'text-red-600 bg-red-50', title: `${nHuman} conversation${nHuman > 1 ? 's' : ''} à traiter`,
          detail: 'Un visiteur attend une réponse de votre part', to: '/boite-de-reception' })
      }
      for (const inv of (overdue.data ?? []) as unknown as Array<{ id: string; number: string; total_ttc: number; amount_paid: number; due_date: string; client: { name: string } | null }>) {
        t.push({ key: `i${inv.id}`, icon: AlertTriangle, tone: 'text-red-600 bg-red-50', title: `Facture ${inv.number} impayée`,
          detail: `${eur(inv.total_ttc - inv.amount_paid)} · échue depuis ${daysAgo(inv.due_date)} j${inv.client ? ` · ${inv.client.name}` : ''}`, to: `/factures/${inv.id}` })
      }
      for (const q of (follow.data ?? []) as unknown as QuoteRow[]) {
        t.push({ key: `q${q.id}`, icon: Clock, tone: 'text-sky-600 bg-sky-50', title: `Relancer ${q.client?.company_name ?? q.client?.name ?? 'le client'}`,
          detail: `${q.number} · ${eur(q.total_ttc)} · envoyé il y a ${daysAgo(q.sent_at!)} j${q.viewed_at ? ', consulté' : ', jamais ouvert'}`, to: `/devis/${q.id}` })
      }
      setTodos(t)

      const c = comp.data
      setSetup([
        { done: !!(c?.siret && c?.address_line1 && c?.logo_path), label: 'Compléter le profil', hint: 'Logo, SIRET, adresse', to: '/entreprise', icon: Building2 },
        { done: nProducts > 0, label: 'Créer le catalogue', hint: 'Vos prestations et prix', to: '/catalogue', icon: Package },
        { done: nSent > 0, label: 'Envoyer un premier devis', hint: 'Avec l’IA en une phrase', to: '/devis/nouveau', icon: Send },
        { done: nKb > 0, label: 'Former l’assistant', hint: 'Horaires, tarifs, FAQ', to: '/assistant', icon: BookOpen },
        { done: nWidget > 0, label: 'Installer l’assistant', hint: 'Sur votre site ou via le QR code', to: '/assistant', icon: MessageSquareText },
      ])
    })
  }, [companyId])

  if (!stats || !todos || !setup) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  const months = stats.monthly_revenue
  const prev = Number(months[months.length - 2]?.amount ?? 0)
  const cur = Number(stats.signed_revenue_ht_this_month)
  const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null
  const setupDone = setup.filter((s) => s.done).length
  const hour = new Date().getHours()

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{hour < 18 ? 'Bonjour' : 'Bonsoir'} {profile?.full_name?.split(' ')[0] ?? ''}</h1>
          <p className="mt-1 text-sm text-slate-500">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · {company?.name}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/boite-de-reception" className="btn-secondary"><MessageSquareText className="h-4 w-4" /> Messages
            {stats.unread_conversations > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{stats.unread_conversations}</span>}</Link>
          <Link to="/devis/nouveau" className="btn-primary"><Sparkles className="h-4 w-4" /> Nouveau devis</Link>
        </div>
      </div>

      {setupDone < setup.length && (
        <section className="card mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Pour bien démarrer</h2>
            <span className="text-sm text-slate-500">{setupDone}/{setup.length} étapes</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {setup.map(({ done, label, hint, to, icon: Icon }) => (
              <Link key={label} to={to} className={`flex items-start gap-3 rounded-lg border p-3 transition ${done ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/40'}`}>
                {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
                <span>
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}><Icon className="h-3.5 w-3.5" />{label}</span>
                  <span className="text-xs text-slate-500">{hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Indicateurs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile label="CA signé ce mois (HT)" value={eur0(cur)}
          delta={delta !== null ? <Delta value={delta} /> : <span className="text-slate-400">{stats.quotes_sent_this_month} devis envoyés ce mois</span>} />
        <Tile label="Devis en attente (HT)" value={eur0(Number(stats.pending_quotes_amount_ht))} delta={<span className="text-slate-500">à transformer</span>} />
        <Tile label="Taux d’acceptation" value={stats.acceptance_rate === null ? '—' : `${Number(stats.acceptance_rate).toLocaleString('fr-FR')} %`}
          delta={<span className="text-slate-500">sur 90 jours</span>} />
        <Tile label="Factures impayées (TTC)" value={eur0(Number(stats.unpaid_invoices_amount))}
          delta={stats.overdue_invoices_count > 0
            ? <span className="inline-flex items-center gap-1 font-medium text-red-600"><AlertTriangle className="h-3.5 w-3.5" />{stats.overdue_invoices_count} en retard</span>
            : <span className="text-slate-500">aucune en retard</span>} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card min-w-0 p-5">
          <h2 className="font-semibold text-slate-900">Chiffre d’affaires signé</h2>
          <p className="mb-5 text-sm text-slate-500">Devis acceptés, montant HT, 6 derniers mois</p>
          <BarChart title="Chiffre d’affaires signé HT par mois" format={eur0}
            data={monthlyData(months.map((m) => ({ month: m.month, value: Number(m.amount) })))} />
        </section>

        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">À faire</h2>
            {todos.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{todos.length}</span>}
          </div>
          {todos.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />Tout est à jour.</div>
          ) : (
            <ul className="space-y-1">
              {todos.slice(0, 7).map(({ key, icon: Icon, tone, title, detail, to }) => (
                <li key={key}>
                  <Link to={to} className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{title}</span>
                      <span className="block truncate text-xs text-slate-500">{detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Dernières conversations</h2>
            <Link to="/boite-de-reception" className="text-sm font-medium text-brand-600 hover:underline">Tout voir</Link>
          </div>
          {conversations.length === 0 ? <Empty text="L’assistant n’a pas encore échangé avec vos visiteurs." to="/assistant" cta="Configurer l’assistant" /> : (
            <ul className="divide-y divide-slate-100">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link to={`/boite-de-reception?c=${c.id}`} className="flex items-center gap-3 py-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${c.unread ? 'bg-brand-600' : 'bg-transparent'}`} aria-label={c.unread ? 'Non lu' : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${c.unread ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{visitorLabel(c)}</span>
                      <span className="block truncate text-xs text-slate-500">{c.last_message_preview}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{relativeTime(c.last_message_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Derniers devis</h2>
            <Link to="/devis" className="text-sm font-medium text-brand-600 hover:underline">Tout voir</Link>
          </div>
          {quotes.length === 0 ? <Empty text="Aucun devis pour l’instant." to="/devis/nouveau" cta="Créer un devis" /> : (
            <ul className="divide-y divide-slate-100">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link to={`/devis/${q.id}`} className="flex items-center gap-3 py-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{q.number} · {q.client?.company_name ?? q.client?.name ?? 'Sans client'}</span>
                      <span className="block truncate text-xs text-slate-500">{q.title ?? '—'} · {dateFr(q.issue_date)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-slate-900">{eur(q.total_ttc)}</span>
                      <QuoteBadge quote={q} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

function Tile({ label, value, delta }: { label: string; value: string; delta: React.ReactNode }) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs">{delta}</p>
    </div>
  )
}

function Delta({ value }: { value: number }) {
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{up ? '+' : ''}{value} % <span className="font-normal text-slate-500">vs mois dernier</span>
    </span>
  )
}

function Empty({ text, to, cta }: { text: string; to: string; cta: string }) {
  return (
    <div className="py-6 text-center text-sm text-slate-500">
      <p>{text}</p>
      <Link to={to} className="mt-2 inline-block font-medium text-brand-600 hover:underline">{cta}</Link>
    </div>
  )
}
