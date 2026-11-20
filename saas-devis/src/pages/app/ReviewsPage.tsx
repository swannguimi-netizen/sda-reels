import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Eye, Lock, MessageSquareQuote, MousePointerClick, Send, ShieldCheck, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { Alert, Field, PageHeader, Spinner } from '../../components/ui'
import { useUsage } from '../../lib/billing'
import { invokeFunction } from '../../lib/functions'
import { dateFr, dbError } from '../../lib/format'
// Même module que l'Edge Function : l'aperçu est l'email réellement envoyé
import { renderReviewRequest } from '../../../supabase/functions/_shared/reviews'

interface Settings { name: string; google_review_url: string | null; review_requests_enabled: boolean; review_delay_days: number; review_message: string | null; review_followup_enabled: boolean }
interface Req { id: string; email: string; first_name: string | null; status: 'scheduled' | 'sent' | 'clicked' | 'cancelled'; scheduled_at: string; sent_at: string | null; clicked_at: string | null; private_feedback: string | null; source: string; client: { name: string } | null }
interface Stats { sent: number; clicked: number; scheduled: number; feedback: number }

const STATUS: Record<Req['status'], [string, string]> = {
  scheduled: ['Programmée', 'bg-slate-100 text-slate-600'], sent: ['Envoyée', 'bg-sky-100 text-sky-700'],
  clicked: ['A cliqué', 'bg-emerald-100 text-emerald-700'], cancelled: ['Annulée', 'bg-slate-100 text-slate-400'],
}

/** Liens acceptés : lien court de la fiche (g.page/r/…), lien « writereview » ou lien Maps de la fiche. */
const isGoogleReviewUrl = (u: string) => /^https:\/\/(g\.page\/r\/|search\.google\.com\/local\/writereview\?placeid=|(www\.)?google\.[a-z.]+\/maps|maps\.app\.goo\.gl\/|g\.co\/kgs\/)/.test(u.trim())

export default function ReviewsPage() {
  const { company, role } = useAuth()
  const toast = useToast()
  const { usage } = useUsage(company?.id)
  const [s, setS] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [reqs, setReqs] = useState<Req[]>([])
  const [clients, setClients] = useState<Array<{ id: string; name: string; email: string | null }>>([])
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const canEdit = role === 'owner' || role === 'admin'
  const companyId = company?.id
  const premium = usage?.features.includes('review_requests') ?? true

  const load = useCallback(async () => {
    if (!companyId) return
    const [{ data: c }, { data: st }, { data: r }, { data: cl }] = await Promise.all([
      supabase.from('companies').select('name, google_review_url, review_requests_enabled, review_delay_days, review_message, review_followup_enabled').eq('id', companyId).single(),
      supabase.rpc('review_stats', { p_company_id: companyId }),
      supabase.from('review_requests').select('id, email, first_name, status, scheduled_at, sent_at, clicked_at, private_feedback, source, client:clients(name)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(30),
      supabase.from('clients').select('id, name, email').eq('company_id', companyId).not('email', 'is', null).order('name'),
    ])
    setS(c as Settings)
    setStats(st as Stats)
    setReqs((r as unknown as Req[]) ?? [])
    setClients(cl ?? [])
  }, [companyId])
  useEffect(() => { load() }, [load])

  if (!s || !stats || !usage) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })
  const urlOk = !s.google_review_url || isGoogleReviewUrl(s.google_review_url)
  const preview = renderReviewRequest({ firstName: 'Lucie', company: s.name, followup: false, custom: s.review_message })
  const rate = stats.sent ? Math.round((stats.clicked / stats.sent) * 100) : null

  async function save() {
    if (s!.review_requests_enabled && !s!.google_review_url) return toast('error', 'Renseignez le lien de votre fiche Google.')
    if (!urlOk) return toast('error', 'Ce lien ne ressemble pas à un lien d’avis Google.')
    setBusy('save')
    const { error } = await supabase.from('companies').update({
      google_review_url: s!.google_review_url?.trim() || null, review_requests_enabled: s!.review_requests_enabled,
      review_delay_days: s!.review_delay_days, review_message: s!.review_message?.trim() || null, review_followup_enabled: s!.review_followup_enabled,
    }).eq('id', companyId)
    setBusy(null)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Demandes d’avis enregistrées')
  }

  async function requestNow() {
    if (!clientId) return
    setBusy('request')
    try {
      const { data: id, error } = await supabase.rpc('request_review', { p_client_id: clientId })
      if (error) throw new Error(error.message)
      await invokeFunction('send-reminders', { review_id: id }, 'Demande créée, mais l’email n’a pas pu partir : il sera renvoyé automatiquement.')
      toast('success', 'Demande d’avis envoyée')
      setClientId('')
    } catch (e) {
      toast('error', (e as Error).message)
    }
    setBusy(null)
    load()
  }

  return (
    <>
      <PageHeader title="Avis Google" description="Après chaque prestation, vos clients sont invités à laisser un avis sur votre fiche Google." />
      {!premium && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-brand-900"><Lock className="h-4 w-4" /> Les demandes d’avis automatiques sont incluses dans l’offre Premium.</p>
          <Link to="/abonnement" className="btn-primary shrink-0">Voir les offres</Link>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Send} label="Demandes envoyées" value={stats.sent} />
        <Tile icon={MousePointerClick} label="Clients ayant cliqué" value={stats.clicked} hint={rate !== null ? `${rate} % des demandes` : undefined} />
        <Tile icon={Star} label="Programmées" value={stats.scheduled} />
        <Tile icon={MessageSquareQuote} label="Remarques privées" value={stats.feedback} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <section className="card space-y-5 p-5">
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span><span className="block font-semibold text-slate-900">Demander un avis automatiquement</span>
                <span className="text-sm text-slate-500">Quand vous marquez une prestation terminée ou qu’une facture est payée (une seule fois par client tous les 6 mois).</span></span>
              <input type="checkbox" className="mt-1 h-4 w-4" checked={s.review_requests_enabled} disabled={!canEdit || !premium} onChange={(e) => set('review_requests_enabled', e.target.checked)} />
            </label>
            <Field label="Lien de votre fiche Google" htmlFor="gurl" hint={!urlOk ? <span className="text-red-600">Ce lien ne ressemble pas à un lien d’avis Google.</span> : undefined}>
              <input id="gurl" className="input" placeholder="https://g.page/r/…/review" value={s.google_review_url ?? ''} disabled={!canEdit} onChange={(e) => set('google_review_url', e.target.value)} />
            </Field>
            <details className="text-sm text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-800">Où trouver ce lien ?</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Cherchez le nom de votre entreprise sur Google, connecté au compte qui gère la fiche.</li>
                <li>Dans le panneau de gestion de votre fiche, cliquez sur « Demander des avis ».</li>
                <li>Copiez le lien proposé (il commence souvent par https://g.page/r/) et collez-le ici.</li>
              </ol>
            </details>
            {s.google_review_url && urlOk && (
              <a href={s.google_review_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">Tester le lien <ExternalLink className="h-3.5 w-3.5" /></a>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Envoyer" htmlFor="delay">
                <select id="delay" className="input" value={s.review_delay_days} disabled={!canEdit} onChange={(e) => set('review_delay_days', Number(e.target.value))}>
                  <option value={0}>Le jour même</option><option value={1}>Le lendemain</option><option value={2}>2 jours après</option><option value={3}>3 jours après</option><option value={7}>Une semaine après</option>
                </select>
              </Field>
              <label className="flex cursor-pointer items-center gap-2 pt-6 text-sm text-slate-700">
                <input type="checkbox" checked={s.review_followup_enabled} disabled={!canEdit} onChange={(e) => set('review_followup_enabled', e.target.checked)} />
                Une relance 5 jours plus tard si le client n’a pas cliqué
              </label>
            </div>
            <Field label="Message personnalisé (facultatif)" htmlFor="rmsg" hint="Variables : {prenom}, {entreprise}. Laissé vide, un message chaleureux par défaut est utilisé.">
              <textarea id="rmsg" rows={4} className="input" value={s.review_message ?? ''} disabled={!canEdit} onChange={(e) => set('review_message', e.target.value)} />
            </Field>
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Conforme aux règles de Google : tous vos clients reçoivent le même lien vers votre fiche, sans tri préalable des avis positifs. Ils peuvent aussi vous envoyer une remarque privée.
            </p>
            {canEdit && <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' && <Spinner className="h-4 w-4" />} Enregistrer</button></div>}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold text-slate-900">Demandes récentes</h2>
            {reqs.length === 0 ? <p className="py-4 text-sm text-slate-500">Aucune demande pour l’instant. Marquez une prestation terminée sur un devis accepté pour déclencher la première.</p> : (
              <ul className="divide-y divide-slate-100">
                {reqs.map((r) => (
                  <li key={r.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{r.client?.name ?? r.first_name ?? r.email}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {r.email} · {r.status === 'scheduled' ? `envoi prévu le ${dateFr(r.scheduled_at)}` : `envoyée le ${dateFr(r.sent_at)}`}
                      {r.clicked_at && ` · cliqué le ${dateFr(r.clicked_at)}`}{r.source === 'manual' ? ' · manuelle' : ''}
                    </p>
                    {r.private_feedback && <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-slate-700">« {r.private_feedback} »</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section className="card overflow-hidden">
            <p className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900"><Eye className="h-4 w-4 text-slate-400" /> Aperçu de l’email</p>
            <div className="space-y-3 p-4 text-sm">
              <p><span className="text-slate-400">Objet : </span><span className="font-medium text-slate-900">{preview.subject}</span></p>
              <p className="whitespace-pre-line text-slate-700">{preview.body}</p>
              <span className="inline-block rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white">{preview.button}</span>
            </div>
          </section>
          <section className="card p-5">
            <h2 className="mb-1 font-semibold text-slate-900">Demander un avis maintenant</h2>
            <p className="mb-3 text-sm text-slate-500">À un client satisfait, par exemple juste après un chantier réussi.</p>
            <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
              <option value="">— Choisir un client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}
            </select>
            <button className="btn-primary mt-3 w-full" onClick={requestNow} disabled={!clientId || !premium || !!busy}>
              {busy === 'request' ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Envoyer la demande
            </button>
            {!s.google_review_url && <div className="mt-3"><Alert kind="info">Renseignez d’abord le lien de votre fiche Google.</Alert></div>}
          </section>
        </aside>
      </div>
    </>
  )
}

function Tile({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="flex items-center gap-1.5 text-xs text-slate-500 sm:text-sm"><Icon className="h-4 w-4 text-brand-500" /> {label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

