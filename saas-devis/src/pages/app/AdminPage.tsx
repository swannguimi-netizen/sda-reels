import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarPlus, Check, Download, Mail, Shield } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/Toast'
import { RowMenu } from '../../components/RowMenu'
import { PageHeader, SearchInput, Spinner } from '../../components/ui'
import { BarChart, monthlyData } from '../../components/charts/BarChart'
import { daysLeft, euros } from '../../lib/billing'
import { dateFr, dbError } from '../../lib/format'
import { relativeTime } from '../../lib/inbox'

interface Row {
  company_id: string
  name: string
  siret: string | null
  city: string | null
  postal_code: string | null
  created_at: string
  owner_email: string | null
  members: number
  plan: string
  plan_price_cents: number
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid'
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  has_stripe: boolean
  ai_used_this_month: number
  ai_limit: number
  quotes_total: number
  quotes_this_month: number
  signed_revenue_ht: number
  conversations_this_month: number
  leads_total: number
  widget_active: boolean
  last_activity_at: string | null
}

interface PlatformStats {
  companies: number
  signups_this_month: number
  trialing: number
  trials_ending_7d: number
  active: number
  past_due: number
  canceled: number
  mrr_cents: number
  mrr_by_plan: Record<string, number>
  ai_messages_this_month: number
  ai_tokens_this_month: { input: number; output: number }
  quotes_this_month: number
  signups_by_month: Array<{ month: string; count: number }>
}

type Segment = 'all' | 'trial' | 'ending' | 'paying' | 'past_due' | 'inactive'

/** Statut commercial lisible, calculé à partir de l'abonnement. */
function segmentOf(r: Row): Exclude<Segment, 'all' | 'ending'> {
  if (r.status === 'past_due' || r.status === 'unpaid') return 'past_due'
  if (r.status === 'active' || (r.status === 'trialing' && r.has_stripe)) return 'paying'
  if (r.status === 'trialing' && r.trial_ends_at && new Date(r.trial_ends_at) > new Date()) return 'trial'
  return 'inactive'
}

const SEGMENT_LABEL: Record<Exclude<Segment, 'all' | 'ending'>, { label: string; cls: string }> = {
  paying: { label: 'Payant', cls: 'bg-emerald-100 text-emerald-700' },
  trial: { label: 'Essai', cls: 'bg-sky-100 text-sky-700' },
  past_due: { label: 'Impayé', cls: 'bg-red-100 text-red-700' },
  inactive: { label: 'Inactif', cls: 'bg-slate-100 text-slate-500' },
}

// Tarif public Claude Opus 5.5 (USD par million de jetons) pour l'estimation du coût IA
const USD_PER_M_INPUT = 4
const USD_PER_M_OUTPUT = 20

export default function AdminPage() {
  const toast = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [segment, setSegment] = useState<Segment>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const [{ data: r, error }, { data: s }] = await Promise.all([
      supabase.rpc('admin_companies_overview'),
      supabase.rpc('admin_platform_stats'),
    ])
    if (error) toast('error', dbError(error) ?? 'Erreur')
    setRows((r as Row[]) ?? [])
    setStats(s as PlatformStats)
  }, [toast])

  useEffect(() => { load() }, [load])

  const isEnding = (r: Row) => segmentOf(r) === 'trial' && daysLeft(r.trial_ends_at) <= 7
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter((r) =>
      (segment === 'all' || (segment === 'ending' ? isEnding(r) : segmentOf(r) === segment))
      && (!q || [r.name, r.owner_email, r.city, r.siret].some((v) => v?.toLowerCase().includes(q))))
  }, [rows, segment, search])

  async function extendTrial(r: Row, days: number) {
    const { data, error } = await supabase.rpc('admin_extend_trial', { p_company_id: r.company_id, p_days: days })
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', `Essai de ${r.name} prolongé jusqu’au ${dateFr(data as string)}`)
    load()
  }

  function exportCsv() {
    const cols: Array<[string, (r: Row) => string | number]> = [
      ['Entreprise', (r) => r.name], ['SIRET', (r) => r.siret ?? ''], ['Ville', (r) => r.city ?? ''], ['Email', (r) => r.owner_email ?? ''],
      ['Statut', (r) => SEGMENT_LABEL[segmentOf(r)].label], ['Offre', (r) => r.plan], ['Prix HT', (r) => r.plan_price_cents / 100],
      ['Fin d’essai', (r) => r.trial_ends_at?.slice(0, 10) ?? ''], ['Utilisateurs', (r) => r.members],
      ['Messages IA (mois)', (r) => r.ai_used_this_month], ['Devis (total)', (r) => r.quotes_total],
      ['CA signé HT', (r) => Number(r.signed_revenue_ht)], ['Assistant installé', (r) => (r.widget_active ? 'oui' : 'non')],
      ['Inscription', (r) => r.created_at.slice(0, 10)], ['Dernière activité', (r) => r.last_activity_at?.slice(0, 10) ?? ''],
    ]
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const csv = [cols.map(([h]) => esc(h)).join(';'), ...visible.map((r) => cols.map(([, f]) => esc(f(r))).join(';'))].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })) // BOM : accents corrects dans Excel
    const a = document.createElement('a')
    a.href = url
    a.download = `entreprises-${new Date().toLocaleDateString('sv-SE')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!rows || !stats) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  const aiCostUsd = (stats.ai_tokens_this_month.input * USD_PER_M_INPUT + stats.ai_tokens_this_month.output * USD_PER_M_OUTPUT) / 1_000_000
  const counts: Record<Segment, number> = {
    all: rows.length, trial: 0, ending: rows.filter(isEnding).length, paying: 0, past_due: 0, inactive: 0,
  }
  rows.forEach((r) => { counts[segmentOf(r)]++ })

  return (
    <>
      <PageHeader title="Super-admin" description="Toutes les entreprises de la plateforme, leurs abonnements et leur usage."
        actions={<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700"><Shield className="h-4 w-4" />Accès plateforme</span>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="card p-5">
          <p className="text-sm text-slate-500">Revenu mensuel récurrent (HT)</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight text-slate-900">{euros(stats.mrr_cents)}</p>
          <p className="mt-1 text-sm text-slate-500">soit {euros(stats.mrr_cents * 12)} par an · {stats.active} client{stats.active > 1 ? 's' : ''} payant{stats.active > 1 ? 's' : ''}</p>
          <dl className="mt-5 space-y-2">
            {['starter', 'pro', 'business', 'premium'].map((p) => {
              const cents = stats.mrr_by_plan[p] ?? 0
              const share = stats.mrr_cents ? cents / stats.mrr_cents : 0
              return (
                <div key={p} className="grid grid-cols-[80px_1fr_80px] items-center gap-3 text-sm">
                  <dt className="capitalize text-slate-600">{p}</dt>
                  <dd className="h-2 overflow-hidden rounded-full bg-brand-50" aria-hidden><div className="h-full rounded-full bg-brand-600" style={{ width: `${share * 100}%` }} /></dd>
                  <dd className="text-right tabular-nums text-slate-900">{euros(cents)}</dd>
                </div>
              )
            })}
          </dl>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">Inscriptions</h2>
          <p className="mb-4 text-sm text-slate-500">{stats.signups_this_month} ce mois-ci · {stats.companies} au total</p>
          <BarChart title="Nouvelles entreprises par mois" height={140} format={(v) => `${v} inscription${v > 1 ? 's' : ''}`}
            data={monthlyData(stats.signups_by_month.map((m) => ({ month: m.month, value: m.count })))} />
        </section>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Essais en cours" value={stats.trialing} hint={stats.trials_ending_7d ? `${stats.trials_ending_7d} se terminent sous 7 jours` : 'aucun ne se termine cette semaine'} />
        <Kpi label="Paiements en échec" value={stats.past_due} hint={stats.past_due ? 'à relancer' : 'tout est à jour'} alert={stats.past_due > 0} />
        <Kpi label="Messages IA ce mois" value={stats.ai_messages_this_month.toLocaleString('fr-FR')} hint={`coût estimé ≈ ${aiCostUsd.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $`} />
        <Kpi label="Devis créés ce mois" value={stats.quotes_this_month.toLocaleString('fr-FR')} hint={`${stats.canceled} entreprise${stats.canceled > 1 ? 's' : ''} inactive${stats.canceled > 1 ? 's' : ''}`} />
      </div>

      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {([['all', 'Toutes'], ['paying', 'Payants'], ['trial', 'En essai'], ['ending', 'Fin d’essai < 7 j'], ['past_due', 'Impayés'], ['inactive', 'Inactifs']] as Array<[Segment, string]>).map(([s, label]) => (
              <button key={s} onClick={() => setSegment(s)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${segment === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {label} · {counts[s]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Nom, email, ville, SIRET…" />
            <button className="btn-secondary shrink-0" onClick={exportCsv}><Download className="h-4 w-4" /> CSV</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Entreprise</th>
                <th className="px-4 py-3">Abonnement</th>
                <th className="px-4 py-3">Messages IA</th>
                <th className="px-4 py-3 text-right">Devis</th>
                <th className="px-4 py-3 text-right">CA signé HT</th>
                <th className="px-4 py-3">Assistant</th>
                <th className="px-4 py-3">Activité</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => {
                const seg = SEGMENT_LABEL[segmentOf(r)]
                const ratio = r.ai_limit ? Math.min(1, r.ai_used_this_month / r.ai_limit) : 0
                return (
                  <tr key={r.company_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{r.name}</p>
                      <p className="text-xs text-slate-500">{[r.city, r.owner_email].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${seg.cls}`}>{seg.label}</span>
                        <span className="capitalize text-slate-700">{r.plan}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {segmentOf(r) === 'trial' ? <span className={isEnding(r) ? 'font-medium text-amber-700' : ''}>fin d’essai dans {daysLeft(r.trial_ends_at)} j</span>
                          : segmentOf(r) === 'paying' ? `${euros(r.plan_price_cents)} · ${r.cancel_at_period_end ? 'résilié au ' : 'renouv. '}${dateFr(r.current_period_end)}`
                          : segmentOf(r) === 'past_due' ? <span className="inline-flex items-center gap-1 text-red-600"><AlertTriangle className="h-3 w-3" />paiement en échec</span>
                          : `depuis le ${dateFr(r.trial_ends_at ?? r.current_period_end)}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="tabular-nums text-slate-700">{r.ai_used_this_month.toLocaleString('fr-FR')} <span className="text-slate-400">/ {r.ai_limit.toLocaleString('fr-FR')}</span></p>
                      <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-brand-50" aria-hidden>
                        <div className={`h-full rounded-full ${ratio >= 0.9 ? 'bg-red-500' : ratio >= 0.7 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${ratio * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.quotes_total}<span className="block text-xs text-slate-400">{r.quotes_this_month} ce mois</span></td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">{euros(Number(r.signed_revenue_ht) * 100)}</td>
                    <td className="px-4 py-3">
                      {r.widget_active
                        ? <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-4 w-4" />Installé</span>
                        : <span className="text-slate-400">Non installé</span>}
                      <span className="block text-xs text-slate-400">{r.conversations_this_month} conv. · {r.leads_total} prospects</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.last_activity_at ? relativeTime(r.last_activity_at) : '—'}
                      <span className="block">inscrit le {dateFr(r.created_at)}</span>
                    </td>
                    <td className="px-2 py-3">
                      <RowMenu items={[
                        ...(r.owner_email ? [{ label: 'Écrire', icon: Mail, onClick: () => { window.location.href = `mailto:${r.owner_email}` } }] : []),
                        ...(!r.has_stripe ? [
                          { label: 'Essai + 7 jours', icon: CalendarPlus, onClick: () => extendTrial(r, 7) },
                          { label: 'Essai + 30 jours', icon: CalendarPlus, onClick: () => extendTrial(r, 30) },
                        ] : []),
                      ]} />
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Aucune entreprise.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Kpi({ label, value, hint, alert }: { label: string; value: React.ReactNode; hint: string; alert?: boolean }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className={`mt-1 inline-flex items-center gap-1 text-xs ${alert ? 'font-medium text-red-600' : 'text-slate-500'}`}>
        {alert && <AlertTriangle className="h-3.5 w-3.5" />}{hint}
      </p>
    </div>
  )
}
