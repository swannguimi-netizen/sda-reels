import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bot, CalendarCheck, CalendarDays, Check, Clock, Lock, Mail, Phone, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { Modal } from '../../components/Modal'
import { Alert, Field, PageHeader, Spinner } from '../../components/ui'
import { useUsage } from '../../lib/billing'
import { invokeFunction } from '../../lib/functions'
import { dbError } from '../../lib/format'
import { localParts, zonedToUtc } from '../../../supabase/functions/_shared/slots'

interface Appointment {
  id: string
  title: string
  description: string | null
  location: string | null
  starts_at: string
  ends_at: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'done'
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  source: 'manual' | 'assistant'
  google_event_id: string | null
  google_sync_error: string | null
  conversation_id: string | null
}
interface Rule { weekday: number; start_time: string; end_time: string; slot_minutes: number }

/** Nouvelle plage : 8 h–12 h, ou à la suite de la dernière plage du jour (sans chevauchement). */
function nextRange(list: Array<[string, string]>): [string, string] {
  if (!list.length) return ['08:00', '12:00']
  const last = [...list].sort((a, b) => a[1].localeCompare(b[1])).at(-1)![1]
  const [h, m] = last.split(':').map(Number)
  const start = Math.min(h * 60 + m + 120, 22 * 60) // pause de 2 h (déjeuner)
  const end = Math.min(start + 4 * 60, 23 * 60 + 59)
  const t = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
  return [t(start), t(end)]
}

const DAYS = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']] as const

export default function AppointmentsPage() {
  const { company, role } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const { usage } = useUsage(company?.id)
  const [tz, setTz] = useState('Europe/Paris')
  const [appts, setAppts] = useState<Appointment[] | null>(null)
  const [google, setGoogle] = useState<{ account_email: string | null } | null | undefined>(undefined)
  const [assistantOn, setAssistantOn] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const companyId = company?.id
  const isAdmin = role === 'owner' || role === 'admin'
  const premium = usage?.features.includes('appointments') ?? true
  const googleParam = params.get('google')

  const load = useCallback(async () => {
    if (!companyId) return
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const [{ data: c }, { data: a }, { data: g }, { data: s }] = await Promise.all([
      supabase.from('companies').select('timezone').eq('id', companyId).single(),
      supabase.from('appointments').select('*').eq('company_id', companyId).gte('ends_at', since).order('starts_at').limit(200),
      supabase.from('calendar_integrations').select('account_email').eq('company_id', companyId).maybeSingle(),
      supabase.from('assistant_settings').select('can_book_appointments').eq('company_id', companyId).single(),
    ])
    setTz(c?.timezone ?? 'Europe/Paris')
    setAppts((a as Appointment[]) ?? [])
    setGoogle(g ?? null)
    setAssistantOn(!!s?.can_book_appointments)
  }, [companyId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!googleParam) return
    if (googleParam === 'ok') toast('success', 'Google Agenda connecté')
    else toast('error', googleParam === 'refuse' ? 'Connexion Google annulée' : 'La connexion à Google a échoué')
    setParams({}, { replace: true })
  }, [googleParam, setParams, toast])

  const fmtTime = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  const dayKey = (iso: string) => new Intl.DateTimeFormat('fr-CA', { timeZone: tz }).format(new Date(iso))
  const dayLabel = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))

  const grouped = useMemo(() => {
    const g = new Map<string, Appointment[]>()
    for (const a of (appts ?? []).filter((x) => x.status !== 'cancelled')) g.set(dayKey(a.starts_at), [...(g.get(dayKey(a.starts_at)) ?? []), a])
    return [...g.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appts, tz])

  async function setStatus(a: Appointment, status: Appointment['status']) {
    if (status === 'cancelled' && !confirm(`Annuler le rendez-vous « ${a.title} » ?${a.google_event_id ? ' Il sera aussi retiré de Google Agenda.' : ''}`)) return
    const { error } = await supabase.from('appointments').update({ status }).eq('id', a.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    if (status === 'cancelled' && a.google_event_id) await invokeFunction('google-calendar', { action: 'sync', company_id: companyId, appointment_id: a.id }, '').catch(() => {})
    toast('success', status === 'done' ? 'Rendez-vous terminé' : 'Rendez-vous annulé')
    load()
  }

  async function connectGoogle() {
    setBusy('google')
    try {
      const { url } = await invokeFunction<{ url: string }>('google-calendar', { action: 'auth_url', company_id: companyId }, 'Connexion à Google impossible.')
      window.location.href = url
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(null)
    }
  }

  async function disconnectGoogle() {
    if (!confirm('Déconnecter Google Agenda ? Les rendez-vous déjà créés restent dans votre agenda.')) return
    try {
      await invokeFunction('google-calendar', { action: 'disconnect', company_id: companyId }, 'Déconnexion impossible.')
      toast('success', 'Google Agenda déconnecté')
      load()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  async function toggleAssistant(v: boolean) {
    setAssistantOn(v)
    const { error } = await supabase.from('assistant_settings').update({ can_book_appointments: v }).eq('company_id', companyId)
    if (error) { setAssistantOn(!v); return toast('error', dbError(error) ?? 'Erreur') }
    toast('success', v ? 'L’assistant propose désormais des rendez-vous' : 'L’assistant ne propose plus de rendez-vous')
  }

  if (!appts || google === undefined || !usage) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  return (
    <>
      <PageHeader title="Rendez-vous" description="Votre planning, alimenté par vous et par l’assistant IA, synchronisé avec Google Agenda."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau rendez-vous</button>} />

      {!premium && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-brand-900"><Lock className="h-4 w-4" /> La prise de rendez-vous par l’assistant et la synchronisation Google Agenda sont incluses dans l’offre Premium. Votre planning manuel reste disponible.</p>
          <a href="/abonnement" className="btn-primary shrink-0">Voir les offres</a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Planning */}
        <section className="card min-w-0 p-5">
          {grouped.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              <CalendarDays className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              Aucun rendez-vous à venir.{assistantOn && premium ? ' L’assistant en prendra dès qu’un visiteur le demandera.' : ''}
            </div>
          ) : (
            <ol className="space-y-6">
              {grouped.map(([key, list]) => (
                <li key={key}>
                  <h2 className="mb-2 text-sm font-semibold text-slate-900 first-letter:uppercase">{dayLabel(list[0].starts_at)}</h2>
                  <ul className="space-y-2">
                    {list.map((a) => (
                      <li key={a.id} className={`flex gap-4 rounded-xl border p-3 ${a.status === 'done' ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-200'}`}>
                        <div className="w-16 shrink-0 text-sm">
                          <p className="font-semibold tabular-nums text-slate-900">{fmtTime(a.starts_at)}</p>
                          <p className="tabular-nums text-slate-400">{fmtTime(a.ends_at)}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                            {a.title}
                            {a.source === 'assistant' && <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"><Bot className="h-3 w-3" />Assistant</span>}
                            {a.status === 'done' && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">Terminé</span>}
                          </p>
                          {a.contact_name && <p className="text-sm text-slate-600">{a.contact_name}</p>}
                          <p className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                            {a.contact_phone && <a href={`tel:${a.contact_phone}`} className="inline-flex items-center gap-1 hover:text-brand-600"><Phone className="h-3 w-3" />{a.contact_phone}</a>}
                            {a.contact_email && <a href={`mailto:${a.contact_email}`} className="inline-flex items-center gap-1 hover:text-brand-600"><Mail className="h-3 w-3" />{a.contact_email}</a>}
                            {a.location && <span>{a.location}</span>}
                          </p>
                          {google && (a.google_sync_error
                            ? <p className="mt-1 text-xs text-red-600">Non synchronisé avec Google : {a.google_sync_error}</p>
                            : a.google_event_id && <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400"><CalendarCheck className="h-3 w-3" />Dans Google Agenda</p>)}
                        </div>
                        {a.status !== 'done' && (
                          <div className="flex shrink-0 items-start gap-1">
                            <button className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Marquer terminé" aria-label="Marquer terminé" onClick={() => setStatus(a, 'done')}><Check className="h-4 w-4" /></button>
                            <button className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Annuler" aria-label="Annuler le rendez-vous" onClick={() => setStatus(a, 'cancelled')}><X className="h-4 w-4" /></button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <section className="card p-5">
            <h2 className="mb-1 font-semibold text-slate-900">Google Agenda</h2>
            {google ? (
              <>
                <p className="text-sm text-slate-600">Connecté à <strong>{google.account_email ?? 'votre compte Google'}</strong>. Vos rendez-vous y sont ajoutés, et vos créneaux déjà occupés ne sont jamais proposés.</p>
                {isAdmin && <button className="mt-3 text-sm text-slate-500 underline hover:text-slate-800" onClick={disconnectGoogle}>Déconnecter</button>}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600">Connectez votre agenda : l’assistant ne proposera que vos créneaux réellement libres, et chaque rendez-vous y apparaîtra automatiquement.</p>
                <button className="btn-secondary mt-3" onClick={connectGoogle} disabled={!premium || !isAdmin || !!busy}>
                  {busy === 'google' ? <Spinner className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />} Connecter Google Agenda
                </button>
              </>
            )}
          </section>

          <section className="card p-5">
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span>
                <span className="flex items-center gap-1.5 font-semibold text-slate-900"><Bot className="h-4 w-4 text-brand-600" /> Rendez-vous par l’assistant</span>
                <span className="text-sm text-slate-500">L’assistant de votre site propose vos créneaux libres et réserve pour le visiteur.</span>
              </span>
              <input type="checkbox" className="mt-1 h-4 w-4" checked={assistantOn} disabled={!premium || !isAdmin} onChange={(e) => toggleAssistant(e.target.checked)} />
            </label>
          </section>

          <AvailabilityEditor companyId={companyId!} canEdit={isAdmin} />
        </aside>
      </div>

      {creating && <NewAppointmentModal companyId={companyId!} tz={tz} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}
    </>
  )
}

// ---------------------------------------------------------------------
function AvailabilityEditor({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const toast = useToast()
  const [ranges, setRanges] = useState<Record<number, Array<[string, string]>> | null>(null)
  const [slot, setSlot] = useState(60)
  const [notice, setNotice] = useState(4)
  const [horizon, setHorizon] = useState(21)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('availability_rules').select('weekday, start_time, end_time, slot_minutes').eq('company_id', companyId).order('start_time'),
      supabase.from('companies').select('appointment_min_notice_hours, appointment_horizon_days').eq('id', companyId).single(),
    ]).then(([{ data: rules }, { data: c }]) => {
      const r: Record<number, Array<[string, string]>> = {}
      for (const x of (rules ?? []) as Rule[]) r[x.weekday] = [...(r[x.weekday] ?? []), [x.start_time.slice(0, 5), x.end_time.slice(0, 5)]]
      setRanges(r)
      setSlot((rules?.[0] as Rule | undefined)?.slot_minutes ?? 60)
      setNotice(c?.appointment_min_notice_hours ?? 4)
      setHorizon(c?.appointment_horizon_days ?? 21)
    })
  }, [companyId])

  if (!ranges) return null
  const update = (wd: number, list: Array<[string, string]>) => { setRanges({ ...ranges, [wd]: list }); setDirty(true) }

  async function save() {
    const rows = Object.entries(ranges!).flatMap(([wd, list]) => list.map(([s, e]) => ({ company_id: companyId, weekday: Number(wd), start_time: s, end_time: e, slot_minutes: slot })))
    if (rows.some((r) => r.end_time <= r.start_time)) return toast('error', 'Chaque plage doit finir après son début.')
    for (const [wd, list] of Object.entries(ranges!)) {
      const sorted = [...list].sort()
      if (sorted.some((r, i) => i > 0 && r[0] < sorted[i - 1][1])) return toast('error', `Plages qui se chevauchent le ${DAYS.find(([d]) => d === Number(wd))![1].toLowerCase()}.`)
    }
    setBusy(true)
    const del = await supabase.from('availability_rules').delete().eq('company_id', companyId)
    const ins = del.error ? del : rows.length ? await supabase.from('availability_rules').insert(rows) : { error: null }
    const upd = await supabase.from('companies').update({ appointment_min_notice_hours: notice, appointment_horizon_days: horizon }).eq('id', companyId)
    setBusy(false)
    const error = del.error ?? ins.error ?? upd.error
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    setDirty(false)
    toast('success', 'Disponibilités enregistrées')
  }

  return (
    <section className="card p-5">
      <h2 className="mb-3 flex items-center gap-1.5 font-semibold text-slate-900"><Clock className="h-4 w-4 text-slate-400" /> Disponibilités</h2>
      <ul className="space-y-2">
        {DAYS.map(([wd, label]) => {
          const list = ranges[wd] ?? []
          return (
            <li key={wd} className="flex items-start gap-2 text-sm">
              <span className="w-20 shrink-0 pt-1.5 text-slate-600">{label}</span>
              <div className="flex-1 space-y-1">
                {list.length === 0 && <p className="pt-1.5 text-slate-400">Fermé</p>}
                {list.map(([s, e], i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input type="time" className="input w-[7.5rem] px-2 py-1" value={s} disabled={!canEdit} aria-label={`${label} début`} onChange={(ev) => update(wd, list.map((r, j) => (j === i ? [ev.target.value, r[1]] : r)))} />
                    <span className="text-slate-400">–</span>
                    <input type="time" className="input w-[7.5rem] px-2 py-1" value={e} disabled={!canEdit} aria-label={`${label} fin`} onChange={(ev) => update(wd, list.map((r, j) => (j === i ? [r[0], ev.target.value] : r)))} />
                    {canEdit && <button className="p-1 text-slate-400 hover:text-red-600" aria-label="Supprimer la plage" onClick={() => update(wd, list.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                ))}
              </div>
              {canEdit && <button className="shrink-0 whitespace-nowrap pt-1.5 text-xs font-medium text-brand-600 hover:underline" onClick={() => update(wd, [...list, nextRange(list)])}>+ plage</button>}
            </li>
          )
        })}
      </ul>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Field label="Durée" htmlFor="slot">
          <select id="slot" className="input px-2" value={slot} disabled={!canEdit} onChange={(e) => { setSlot(Number(e.target.value)); setDirty(true) }}>
            {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`.replace('.5', ' h 30').replace(' h h', ' h')}</option>)}
          </select>
        </Field>
        <Field label="Prévenance" htmlFor="notice">
          <select id="notice" className="input px-2" value={notice} disabled={!canEdit} onChange={(e) => { setNotice(Number(e.target.value)); setDirty(true) }}>
            {[0, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h === 0 ? 'aucune' : `${h} h`}</option>)}
          </select>
        </Field>
        <Field label="Jusqu’à" htmlFor="horizon">
          <select id="horizon" className="input px-2" value={horizon} disabled={!canEdit} onChange={(e) => { setHorizon(Number(e.target.value)); setDirty(true) }}>
            {[7, 14, 21, 30, 60].map((d) => <option key={d} value={d}>{d} jours</option>)}
          </select>
        </Field>
      </div>
      {canEdit && dirty && <button className="btn-primary mt-4 w-full" onClick={save} disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Enregistrer</button>}
    </section>
  )
}

// ---------------------------------------------------------------------
function NewAppointmentModal({ companyId, tz, onClose, onSaved }: { companyId: string; tz: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [suggestions, setSuggestions] = useState<Array<{ start: string; end: string }> | null>(null)
  const [f, setF] = useState({ title: '', date: '', time: '', duration: 60, contact_name: '', contact_phone: '', contact_email: '', location: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'duration' ? Number(e.target.value) : e.target.value })

  const loadSlots = useCallback(async () => {
    setSuggestions(null)
    try {
      const r = await invokeFunction<{ slots: Array<{ start: string; end: string }> }>('google-calendar', { action: 'slots', company_id: companyId }, '')
      setSuggestions(r.slots.slice(0, 12))
    } catch {
      setSuggestions([])
    }
  }, [companyId])
  useEffect(() => { loadSlots() }, [loadSlots])

  const pick = (iso: string, end: string) => {
    const p = localParts(new Date(iso), tz)
    setF({ ...f, date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
      duration: Math.round((new Date(end).getTime() - new Date(iso).getTime()) / 60_000) })
  }

  async function submit() {
    if (!f.title.trim() || !f.date || !f.time) return toast('error', 'Objet, date et heure sont nécessaires.')
    const [y, m, d] = f.date.split('-').map(Number)
    const [h, mi] = f.time.split(':').map(Number)
    const start = zonedToUtc(y, m, d, h, mi, tz) // heure saisie = heure locale de l'entreprise
    setBusy(true)
    const { data, error } = await supabase.from('appointments').insert({
      company_id: companyId, title: f.title.trim(), starts_at: start.toISOString(), ends_at: new Date(start.getTime() + f.duration * 60_000).toISOString(),
      contact_name: f.contact_name.trim() || null, contact_phone: f.contact_phone.trim() || null, contact_email: f.contact_email.trim() || null,
      location: f.location.trim() || null, status: 'confirmed', source: 'manual',
    }).select('id').single()
    if (error) {
      setBusy(false)
      return toast('error', error.code === '23P01' ? 'Vous avez déjà un rendez-vous sur ce créneau.' : dbError(error) ?? 'Erreur')
    }
    await invokeFunction('google-calendar', { action: 'sync', company_id: companyId, appointment_id: data.id }, '').catch(() => {})
    setBusy(false)
    toast('success', 'Rendez-vous ajouté')
    onSaved()
  }

  const chip = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  return (
    <Modal open size="lg" title="Nouveau rendez-vous" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={submit} disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Ajouter</button></>}>
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Créneaux libres</span>
            <button className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" onClick={loadSlots}><RefreshCw className="h-3 w-3" />Actualiser</button>
          </div>
          {suggestions === null ? <Spinner className="h-4 w-4 text-slate-400" /> : suggestions.length === 0
            ? <Alert kind="info">Aucun créneau libre trouvé selon vos disponibilités : saisissez la date et l’heure.</Alert>
            : <div className="flex flex-wrap gap-1.5">{suggestions.map((s) => (
              <button key={s.start} onClick={() => pick(s.start, s.end)}
                className="rounded-full border border-slate-300 px-2.5 py-1 text-xs capitalize text-slate-700 hover:border-brand-500 hover:bg-brand-50">{chip(s.start)}</button>
            ))}</div>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Objet" htmlFor="ap-title" className="sm:col-span-3"><input id="ap-title" className="input" value={f.title} onChange={set('title')} placeholder="Ex. Visite pour devis salle de bain" /></Field>
          <Field label="Date" htmlFor="ap-date"><input id="ap-date" type="date" className="input" value={f.date} onChange={set('date')} /></Field>
          <Field label={`Heure (${tz.split('/')[1]?.replace('_', ' ') ?? tz})`} htmlFor="ap-time"><input id="ap-time" type="time" className="input" value={f.time} onChange={set('time')} /></Field>
          <Field label="Durée" htmlFor="ap-dur"><select id="ap-dur" className="input" value={f.duration} onChange={set('duration')}>{[30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m} min</option>)}</select></Field>
          <Field label="Contact" htmlFor="ap-name"><input id="ap-name" className="input" value={f.contact_name} onChange={set('contact_name')} /></Field>
          <Field label="Téléphone" htmlFor="ap-phone"><input id="ap-phone" type="tel" className="input" value={f.contact_phone} onChange={set('contact_phone')} /></Field>
          <Field label="Email" htmlFor="ap-mail"><input id="ap-mail" type="email" className="input" value={f.contact_email} onChange={set('contact_email')} /></Field>
          <Field label="Adresse" htmlFor="ap-loc" className="sm:col-span-3"><input id="ap-loc" className="input" value={f.location} onChange={set('location')} /></Field>
        </div>
      </div>
    </Modal>
  )
}

