import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Eye, FileText, Lock, Mail, Receipt } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { Field, PageHeader, Spinner } from '../../components/ui'
import { useUsage } from '../../lib/billing'
import { dateFr, dbError, eur } from '../../lib/format'
// Même module que l'Edge Function : l'aperçu est exactement l'email envoyé
import { PLACEHOLDERS, renderReminder, type ReminderVars } from '../../../supabase/functions/_shared/reminders'

interface Settings {
  quote_reminders_enabled: boolean
  quote_reminder_days: number[]
  invoice_reminders_enabled: boolean
  invoice_reminder_days: number[]
  timezone: string
  quote_reminder_template: string | null
  invoice_reminder_template: string | null
  name: string
  late_penalty_text: string | null
}

interface Upcoming { type: 'quote' | 'invoice'; id: string; number: string; client: string; amount: number; date: Date; rank: number; paused: boolean }
interface LogRow { id: string; kind: string; to_email: string; subject: string | null; created_at: string; quote_id: string | null; invoice_id: string | null }

const TIMEZONES: Array<[string, string]> = [
  ['Europe/Paris', 'Métropole (Paris)'], ['America/Cayenne', 'Guyane'], ['America/Martinique', 'Martinique'],
  ['America/Guadeloupe', 'Guadeloupe, Saint-Martin, Saint-Barthélemy'], ['Indian/Reunion', 'La Réunion'], ['Indian/Mayotte', 'Mayotte'],
  ['America/Miquelon', 'Saint-Pierre-et-Miquelon'], ['Pacific/Noumea', 'Nouvelle-Calédonie'], ['Pacific/Tahiti', 'Polynésie française'],
]

const parseDays = (s: string) => [...new Set(s.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 90))].sort((a, b) => a - b)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

export default function RemindersPage() {
  const { company, role } = useAuth()
  const toast = useToast()
  const { usage } = useUsage(company?.id)
  const canEdit = role === 'owner' || role === 'admin'
  const [s, setS] = useState<Settings | null>(null)
  const [quoteDays, setQuoteDays] = useState('')
  const [invoiceDays, setInvoiceDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [upcoming, setUpcoming] = useState<Upcoming[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [preview, setPreview] = useState<{ type: 'quote' | 'invoice'; rank: number }>({ type: 'quote', rank: 1 })
  const companyId = company?.id
  const included = usage?.features.includes('auto_reminders') ?? true

  const load = useCallback(async () => {
    if (!companyId) return
    const [{ data: c }, { data: q }, { data: inv }, { data: l }] = await Promise.all([
      supabase.from('companies').select('name, late_penalty_text, quote_reminders_enabled, quote_reminder_days, invoice_reminders_enabled, invoice_reminder_days, timezone, quote_reminder_template, invoice_reminder_template').eq('id', companyId).single(),
      supabase.from('quotes').select('id, number, total_ttc, sent_at, valid_until, reminder_count, reminders_paused, client:clients(name, email, company_name)').eq('company_id', companyId).eq('status', 'sent'),
      supabase.from('invoices').select('id, number, total_ttc, amount_paid, due_date, reminder_count, reminders_paused, client:clients(name, email, company_name)').eq('company_id', companyId).eq('status', 'issued'),
      supabase.from('email_logs').select('id, kind, to_email, subject, created_at, quote_id, invoice_id').eq('company_id', companyId).like('kind', '%reminder%').order('created_at', { ascending: false }).limit(20),
    ])
    const st = c as Settings
    setS(st)
    setQuoteDays(st.quote_reminder_days.join(', '))
    setInvoiceDays(st.invoice_reminder_days.join(', '))
    setLogs((l as LogRow[]) ?? [])

    // Prochaines relances (même règle que due_reminders côté base)
    const next: Upcoming[] = []
    type Cl = { name: string; email: string | null; company_name: string | null } | null
    for (const x of (q ?? []) as unknown as Array<{ id: string; number: string; total_ttc: number; sent_at: string; valid_until: string | null; reminder_count: number; reminders_paused: boolean; client: Cl }>) {
      const day = st.quote_reminder_days[x.reminder_count]
      if (!st.quote_reminders_enabled || day === undefined || !x.client?.email || !x.sent_at) continue
      const date = addDays(new Date(x.sent_at), day)
      if (x.valid_until && date.toLocaleDateString('sv-SE') > x.valid_until) continue
      next.push({ type: 'quote', id: x.id, number: x.number, client: x.client.company_name ?? x.client.name, amount: x.total_ttc, date, rank: x.reminder_count + 1, paused: x.reminders_paused })
    }
    for (const x of (inv ?? []) as unknown as Array<{ id: string; number: string; total_ttc: number; amount_paid: number; due_date: string; reminder_count: number; reminders_paused: boolean; client: Cl }>) {
      const day = st.invoice_reminder_days[x.reminder_count]
      if (!st.invoice_reminders_enabled || day === undefined || !x.client?.email || x.total_ttc <= x.amount_paid) continue
      next.push({ type: 'invoice', id: x.id, number: x.number, client: x.client.company_name ?? x.client.name, amount: x.total_ttc - x.amount_paid,
        date: addDays(new Date(`${x.due_date}T09:00:00`), day), rank: x.reminder_count + 1, paused: x.reminders_paused })
    }
    setUpcoming(next.sort((a, b) => a.date.getTime() - b.date.getTime()))
  }, [companyId])

  useEffect(() => { load() }, [load])

  const sample: ReminderVars = useMemo(() => ({
    client: 'Mme Dupont', numero: preview.type === 'quote' ? 'DEV-2026-041' : 'FAC-2026-018', montant: '1 589,50 €', reste: '1 589,50 €',
    entreprise: s?.name ?? '', date_envoi: '15/11/2026', validite: '15/12/2026', echeance: '10/11/2026', jours_retard: 9, penalites: s?.late_penalty_text ?? null,
  }), [preview.type, s?.name, s?.late_penalty_text])

  if (!s || !usage) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  const rendered = renderReminder({
    type: preview.type, rank: preview.rank, viewed: false, vars: sample,
    custom: preview.type === 'quote' ? s.quote_reminder_template : s.invoice_reminder_template,
  })
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })

  async function save() {
    const qd = parseDays(quoteDays)
    const id = parseDays(invoiceDays)
    if (qd.length > 3 || id.length > 4) return toast('error', '3 relances au plus pour les devis, 4 pour les factures.')
    setBusy(true)
    const { error } = await supabase.from('companies').update({
      quote_reminders_enabled: s!.quote_reminders_enabled, quote_reminder_days: qd,
      invoice_reminders_enabled: s!.invoice_reminders_enabled, invoice_reminder_days: id, timezone: s!.timezone,
      quote_reminder_template: s!.quote_reminder_template?.trim() || null, invoice_reminder_template: s!.invoice_reminder_template?.trim() || null,
    }).eq('id', companyId)
    setBusy(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Relances enregistrées')
    load()
  }

  return (
    <>
      <PageHeader title="Relances automatiques" description="Vos clients sont relancés à votre place, poliment et au bon moment." />
      {!included && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-brand-900"><Lock className="h-4 w-4" /> Les relances automatiques sont incluses à partir de l’offre Pro. Vous pouvez toujours relancer manuellement depuis chaque document.</p>
          <Link to="/abonnement" className="btn-primary shrink-0">Voir les offres</Link>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <section className="card space-y-5 p-5">
            <Toggle checked={s.quote_reminders_enabled} disabled={!canEdit} onChange={(v) => set('quote_reminders_enabled', v)}
              icon={FileText} title="Devis sans réponse" hint="Relance tant que le devis n’est ni signé, ni refusé, ni expiré." />
            <Field label="Relancer après (jours depuis l’envoi)" htmlFor="qd" hint="Ex. 3, 7 — trois relances au plus.">
              <input id="qd" className="input max-w-xs" value={quoteDays} disabled={!canEdit || !s.quote_reminders_enabled} onChange={(e) => setQuoteDays(e.target.value)} />
            </Field>
            <hr className="border-slate-100" />
            <Toggle checked={s.invoice_reminders_enabled} disabled={!canEdit} onChange={(v) => set('invoice_reminders_enabled', v)}
              icon={Receipt} title="Factures impayées" hint="Ton progressif : rappel courtois, puis ferme, puis mention des pénalités." />
            <Field label="Relancer après (jours de retard)" htmlFor="id" hint="Ex. 1, 7, 15 — quatre relances au plus.">
              <input id="id" className="input max-w-xs" value={invoiceDays} disabled={!canEdit || !s.invoice_reminders_enabled} onChange={(e) => setInvoiceDays(e.target.value)} />
            </Field>
            <hr className="border-slate-100" />
            <Field label="Fuseau horaire" htmlFor="tz" hint="Les emails partent du lundi au samedi, entre 9 h et 18 h, heure locale.">
              <select id="tz" className="input max-w-sm" value={s.timezone} disabled={!canEdit} onChange={(e) => set('timezone', e.target.value)}>
                {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </section>

          <section className="card space-y-4 p-5">
            <div>
              <h2 className="font-semibold text-slate-900">Personnaliser les messages <span className="font-normal text-slate-400">(facultatif)</span></h2>
              <p className="text-sm text-slate-500">
                Laissés vides, les textes s’adaptent au rang de la relance et au fait que le client a ouvert ou non le devis. Variables : {PLACEHOLDERS.map((p) => <code key={p} className="mr-1 rounded bg-slate-100 px-1 text-xs">{`{${p}}`}</code>)}
              </p>
            </div>
            <Field label="Message de relance des devis" htmlFor="qt">
              <textarea id="qt" rows={4} className="input" disabled={!canEdit} value={s.quote_reminder_template ?? ''} placeholder="Texte par défaut adapté automatiquement"
                onChange={(e) => set('quote_reminder_template', e.target.value)} onFocus={() => setPreview({ type: 'quote', rank: 1 })} />
            </Field>
            <Field label="Message de relance des factures" htmlFor="it">
              <textarea id="it" rows={4} className="input" disabled={!canEdit} value={s.invoice_reminder_template ?? ''} placeholder="Texte par défaut adapté automatiquement"
                onChange={(e) => set('invoice_reminder_template', e.target.value)} onFocus={() => setPreview({ type: 'invoice', rank: 1 })} />
            </Field>
          </section>
          {canEdit && <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Enregistrer</button></div>}
        </div>

        <aside className="min-w-0 space-y-6">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Eye className="h-4 w-4 text-slate-400" /> Aperçu</p>
              <select className="rounded-md border border-slate-200 px-2 py-1 text-xs" aria-label="Relance à prévisualiser"
                value={`${preview.type}-${preview.rank}`} onChange={(e) => { const [t, r] = e.target.value.split('-'); setPreview({ type: t as 'quote' | 'invoice', rank: Number(r) }) }}>
                <option value="quote-1">Devis · 1re relance</option><option value="quote-2">Devis · 2e relance</option>
                <option value="invoice-1">Facture · 1er rappel</option><option value="invoice-2">Facture · 2e rappel</option><option value="invoice-3">Facture · dernier rappel</option>
              </select>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <p><span className="text-slate-400">Objet : </span><span className="font-medium text-slate-900">{rendered.subject}</span></p>
              <p className="whitespace-pre-line text-slate-700">{rendered.body}</p>
              <span className="inline-block rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white">{rendered.button}</span>
              <p className="text-xs text-slate-400">Le PDF est joint automatiquement.</p>
            </div>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><CalendarClock className="h-4 w-4 text-slate-400" /> Prochaines relances</h2>
            {upcoming.length === 0 ? <p className="py-3 text-sm text-slate-500">Aucune relance prévue.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {upcoming.slice(0, 8).map((u) => (
                  <li key={u.id}>
                    <Link to={`/${u.type === 'quote' ? 'devis' : 'factures'}/${u.id}`} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{u.number} · {u.client}</span>
                        <span className="text-xs text-slate-500">{u.type === 'quote' ? 'Devis' : 'Facture'} · relance {u.rank} · {eur(u.amount)}</span>
                      </span>
                      <span className={`shrink-0 text-xs ${u.paused ? 'text-slate-400 line-through' : u.date < new Date() ? 'font-medium text-amber-700' : 'text-slate-600'}`}>
                        {u.paused ? 'en pause' : u.date < new Date() ? 'prochain créneau' : dateFr(u.date.toISOString())}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Mail className="h-4 w-4 text-slate-400" /> Dernières relances envoyées</h2>
            {logs.length === 0 ? <p className="py-3 text-sm text-slate-500">Aucune pour l’instant.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="py-2">
                    <p className="truncate text-slate-900">{l.subject ?? l.kind}</p>
                    <p className="text-xs text-slate-500">{l.to_email} · {new Date(l.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}{l.kind.includes('manual') ? ' · manuelle' : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

function Toggle({ checked, onChange, disabled, icon: Icon, title, hint }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; icon: React.ComponentType<{ className?: string }>; title: string; hint: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon className="h-4 w-4" /></span>
        <span><span className="block font-medium text-slate-900">{title}</span><span className="text-sm text-slate-500">{hint}</span></span>
      </span>
      <input type="checkbox" className="mt-2 h-4 w-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

