import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Code2, Copy, Download, Eye, EyeOff, Link2, Pencil, Plus, QrCode, RefreshCw, Settings2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { Modal } from '../../../components/Modal'
import { RowMenu } from '../../../components/RowMenu'
import { Alert, Field, PageHeader, Spinner } from '../../../components/ui'
import {
  type AssistantSettings, buildStarterEntries, CATEGORIES, embedSnippet, type KnowledgeCategory, type KnowledgeEntry,
  publicChatUrl, widgetApiUrl,
} from '../../../lib/assistant'
import { loadCompany } from '../../../lib/documentsApi'
import { dbError } from '../../../lib/format'

type Tab = 'connaissances' | 'reglages' | 'installation'

const TONES = ['professionnel et chaleureux', 'décontracté et amical', 'sobre et concis', 'très pédagogue']

export default function AssistantPage() {
  const { company, role } = useAuth()
  const toast = useToast()
  const canAdmin = role === 'owner' || role === 'admin'
  const [tab, setTab] = useState<Tab>('connaissances')
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null)
  const [settings, setSettings] = useState<AssistantSettings | null>(null)
  const [draft, setDraft] = useState<Partial<KnowledgeEntry> | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [prefilling, setPrefilling] = useState(false)
  const companyId = company?.id

  const load = useCallback(async () => {
    if (!companyId) return
    const [{ data: kb }, { data: s }] = await Promise.all([
      supabase.from('knowledge_entries').select('*').eq('company_id', companyId).order('category').order('position').order('created_at'),
      supabase.from('assistant_settings').select('*').eq('company_id', companyId).single(),
    ])
    setEntries((kb as KnowledgeEntry[]) ?? [])
    setSettings(s as AssistantSettings)
  }, [companyId])

  useEffect(() => { load() }, [load])

  const refreshPreview = () => setPreviewKey((k) => k + 1)

  async function prefill() {
    if (!company) return
    setPrefilling(true)
    try {
      const details = await loadCompany(company.id)
      const existing = new Set((entries ?? []).map((e) => `${e.category}|${e.title.toLowerCase()}`))
      const rows = (await buildStarterEntries(details))
        .filter((e) => !existing.has(`${e.category}|${e.title.toLowerCase()}`))
        .map((e, i) => ({ ...e, company_id: company.id, position: i }))
      if (!rows.length) toast('success', 'Votre base contient déjà ces informations')
      else {
        const { error } = await supabase.from('knowledge_entries').insert(rows)
        if (error) throw error
        toast('success', `${rows.length} fiche${rows.length > 1 ? 's' : ''} ajoutée${rows.length > 1 ? 's' : ''} : relisez-les et complétez`)
        await load()
        refreshPreview()
      }
    } catch (e) {
      toast('error', dbError(e as { message: string }) ?? 'Erreur')
    }
    setPrefilling(false)
  }

  async function toggleEntry(e: KnowledgeEntry) {
    const { error } = await supabase.from('knowledge_entries').update({ is_active: !e.is_active }).eq('id', e.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    await load()
    refreshPreview()
  }

  async function removeEntry(e: KnowledgeEntry) {
    if (!confirm(`Supprimer la fiche « ${e.title} » ?`)) return
    const { error } = await supabase.from('knowledge_entries').delete().eq('id', e.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    await load()
    refreshPreview()
  }

  const grouped = useMemo(() => {
    const g = new Map<KnowledgeCategory, KnowledgeEntry[]>()
    for (const e of entries ?? []) g.set(e.category, [...(g.get(e.category) ?? []), e])
    return g
  }, [entries])

  const coverage = (Object.keys(CATEGORIES) as KnowledgeCategory[]).filter((c) => c !== 'autre' && grouped.get(c)?.some((e) => e.is_active)).length

  if (!entries || !settings || !company) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  return (
    <>
      <PageHeader title="Assistant IA"
        description="Il répond à vos clients 24 h/24 sur votre site, collecte leurs coordonnées et leurs demandes de devis."
        actions={
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${settings.is_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            <span className={`h-2 w-2 rounded-full ${settings.is_enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {settings.is_enabled ? 'En ligne' : 'Désactivé'}
          </span>
        } />

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {([
          ['connaissances', 'Base de connaissances', Sparkles],
          ['reglages', 'Personnalisation', Settings2],
          ['installation', 'Installation', Code2],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          {tab === 'connaissances' && (
            <div className="space-y-4">
              <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Ce que sait votre assistant</p>
                  <p className="text-sm text-slate-500">
                    Il ne répond qu’à partir de ces fiches. Plus elles sont précises, moins il renvoie vers vous.
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(coverage / 5) * 100}%` }} />
                    </div>
                    <span className="text-xs font-medium text-slate-600">{coverage}/5 thèmes couverts</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={prefill} disabled={prefilling}>
                    {prefilling ? <Spinner className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} Pré-remplir depuis mon entreprise
                  </button>
                  <button className="btn-primary" onClick={() => setDraft({ category: 'faq', title: '', content: '' })}><Plus className="h-4 w-4" /> Fiche</button>
                </div>
              </div>

              {(Object.keys(CATEGORIES) as KnowledgeCategory[]).map((cat) => {
                const list = grouped.get(cat) ?? []
                const meta = CATEGORIES[cat]
                return (
                  <section key={cat} className="card p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold text-slate-900"><span className="mr-1.5" aria-hidden>{meta.emoji}</span>{meta.label}</h2>
                        <p className="text-xs text-slate-500">{meta.hint}</p>
                      </div>
                      <button className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setDraft({ category: cat, title: '', content: '' })}>
                        <Plus className="mr-0.5 inline h-3.5 w-3.5" /> Ajouter
                      </button>
                    </div>
                    {list.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400">Aucune fiche : l’assistant renverra ces questions vers vous.</p>
                    ) : (
                      <ul className="space-y-2">
                        {list.map((e) => (
                          <li key={e.id} className={`group rounded-lg border border-slate-200 p-3 ${e.is_active ? '' : 'bg-slate-50 opacity-60'}`}>
                            <div className="flex items-start gap-2">
                              <button className="min-w-0 flex-1 text-left" onClick={() => setDraft(e)}>
                                <p className="text-sm font-medium text-slate-900">{e.title}</p>
                                <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-slate-600">{e.content}</p>
                              </button>
                              <RowMenu items={[
                                { label: 'Modifier', icon: Pencil, onClick: () => setDraft(e) },
                                e.is_active ? { label: 'Désactiver', icon: EyeOff, onClick: () => toggleEntry(e) } : { label: 'Activer', icon: Eye, onClick: () => toggleEntry(e) },
                                { label: 'Supprimer', icon: Trash2, onClick: () => removeEntry(e), danger: true },
                              ]} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          )}

          {tab === 'reglages' && (
            <SettingsForm settings={settings} brandColor={company.brand_color} canEdit={canAdmin}
              onSaved={(s) => { setSettings(s); refreshPreview() }} />
          )}

          {tab === 'installation' && <Installation widgetKey={company.widget_public_key} />}
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Aperçu en direct</p>
            <button className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" onClick={refreshPreview}>
              <RefreshCw className="h-3.5 w-3.5" /> Recharger
            </button>
          </div>
          <WidgetPreview key={previewKey} widgetKey={company.widget_public_key} />
          <p className="mt-2 text-xs text-slate-500">Les conversations de test apparaissent dans votre boîte de réception et comptent dans votre quota.</p>
        </aside>
      </div>

      {draft && (
        <EntryModal draft={draft} companyId={company.id} onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); load(); refreshPreview() }} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------
function EntryModal({ draft, companyId, onClose, onSaved }: {
  draft: Partial<KnowledgeEntry>; companyId: string; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!d.title?.trim() || !d.content?.trim()) return
    setBusy(true)
    const row = { company_id: companyId, category: d.category, title: d.title.trim(), content: d.content.trim() }
    const { error } = d.id
      ? await supabase.from('knowledge_entries').update(row).eq('id', d.id)
      : await supabase.from('knowledge_entries').insert(row)
    setBusy(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Fiche enregistrée')
    onSaved()
  }

  return (
    <Modal open size="lg" title={d.id ? 'Modifier la fiche' : 'Nouvelle fiche'} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" form="kb-form" disabled={busy || !d.title?.trim() || !d.content?.trim()}>{busy && <Spinner className="h-4 w-4" />} Enregistrer</button></>}>
      <form id="kb-form" onSubmit={submit} className="space-y-4">
        <Field label="Thème" htmlFor="kb-cat">
          <select id="kb-cat" className="input" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as KnowledgeCategory })}>
            {(Object.keys(CATEGORIES) as KnowledgeCategory[]).map((c) => <option key={c} value={c}>{CATEGORIES[c].label}</option>)}
          </select>
        </Field>
        <Field label="Question ou titre" htmlFor="kb-title">
          <input id="kb-title" className="input" autoFocus value={d.title ?? ''} onChange={(e) => setD({ ...d, title: e.target.value })}
            placeholder="Ex. Intervenez-vous le week-end ?" />
        </Field>
        <Field label="Réponse" htmlFor="kb-content" hint="Écrivez comme vous répondriez au téléphone. L’assistant reformulera.">
          <textarea id="kb-content" rows={6} className="input" value={d.content ?? ''} onChange={(e) => setD({ ...d, content: e.target.value })}
            placeholder="Ex. Oui, le samedi matin sur rendez-vous. Pas d’intervention le dimanche, sauf urgence fuite d’eau (majoration de 50 %)." />
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------
function SettingsForm({ settings, brandColor, canEdit, onSaved }: {
  settings: AssistantSettings; brandColor: string; canEdit: boolean; onSaved: (s: AssistantSettings) => void
}) {
  const toast = useToast()
  const [s, setS] = useState(settings)
  const [domains, setDomains] = useState(settings.allowed_domains.join(', '))
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof AssistantSettings>(k: K, v: AssistantSettings[K]) => setS({ ...s, [k]: v })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const payload = {
      is_enabled: s.is_enabled, assistant_name: s.assistant_name.trim() || 'Assistant', welcome_message: s.welcome_message.trim(),
      tone: s.tone, instructions: s.instructions?.trim() || null, primary_color: s.primary_color || null, position: s.position,
      collect_contact: s.collect_contact, can_create_quote_requests: s.can_create_quote_requests,
      allowed_domains: domains.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean),
      notify_email: s.notify_email?.trim() || null,
    }
    const { data, error } = await supabase.from('assistant_settings').update(payload).eq('company_id', s.company_id).select().single()
    setBusy(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', 'Assistant mis à jour')
    onSaved(data as AssistantSettings)
  }

  const Toggle = ({ k, label, hint }: { k: 'is_enabled' | 'collect_contact' | 'can_create_quote_requests'; label: string; hint: string }) => (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
      <span><span className="block text-sm font-medium text-slate-900">{label}</span><span className="text-xs text-slate-500">{hint}</span></span>
      <input type="checkbox" className="mt-1 h-4 w-4" checked={s[k]} disabled={!canEdit} onChange={(e) => set(k, e.target.checked)} />
    </label>
  )

  return (
    <form onSubmit={submit} className="card space-y-5 p-5">
      {!canEdit && <Alert kind="info">Seuls le propriétaire et les administrateurs peuvent modifier l’assistant.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom de l’assistant" htmlFor="as-name"><input id="as-name" className="input" disabled={!canEdit} value={s.assistant_name} onChange={(e) => set('assistant_name', e.target.value)} placeholder="Ex. Léa" /></Field>
        <Field label="Ton" htmlFor="as-tone">
          <select id="as-tone" className="input" disabled={!canEdit} value={s.tone} onChange={(e) => set('tone', e.target.value)}>
            {[...new Set([...TONES, s.tone])].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Message d’accueil" htmlFor="as-welcome" className="sm:col-span-2">
          <input id="as-welcome" className="input" disabled={!canEdit} value={s.welcome_message} onChange={(e) => set('welcome_message', e.target.value)} />
        </Field>
        <Field label="Consignes particulières" htmlFor="as-instr" className="sm:col-span-2"
          hint="Ex. « Toujours proposer un rendez-vous de diagnostic », « Ne jamais annoncer de délai sous 48 h ».">
          <textarea id="as-instr" rows={3} className="input" disabled={!canEdit} value={s.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        <Toggle k="is_enabled" label="Assistant en ligne" hint="Désactivé, le widget disparaît de votre site." />
        <Toggle k="collect_contact" label="Collecter les coordonnées" hint="L’assistant propose de laisser un nom, un email ou un téléphone." />
        <Toggle k="can_create_quote_requests" label="Prendre les demandes de devis" hint="Il précise le besoin puis vous transmet la demande, prête à chiffrer." />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Couleur du widget" htmlFor="as-color" hint="Par défaut, celle de vos documents.">
          <div className="flex items-center gap-2">
            <input id="as-color" type="color" className="h-9 w-12 cursor-pointer rounded border border-slate-300" disabled={!canEdit}
              value={s.primary_color ?? brandColor} onChange={(e) => set('primary_color', e.target.value)} />
            {s.primary_color && canEdit && <button type="button" className="text-xs text-slate-500 underline" onClick={() => set('primary_color', null)}>Réinitialiser</button>}
          </div>
        </Field>
        <Field label="Position" htmlFor="as-pos">
          <select id="as-pos" className="input" disabled={!canEdit} value={s.position} onChange={(e) => set('position', e.target.value as 'left' | 'right')}>
            <option value="right">En bas à droite</option><option value="left">En bas à gauche</option>
          </select>
        </Field>
        <Field label="Email de notification" htmlFor="as-notify" hint="Prévenu à chaque demande de devis ou demande de rappel.">
          <input id="as-notify" type="email" className="input" disabled={!canEdit} value={s.notify_email ?? ''} onChange={(e) => set('notify_email', e.target.value)} />
        </Field>
        <Field label="Sites autorisés" htmlFor="as-domains" hint="Vide = partout. Ex. plomberie-martin.fr (sous-domaines inclus).">
          <input id="as-domains" className="input" disabled={!canEdit} value={domains} onChange={(e) => setDomains(e.target.value)} />
        </Field>
      </div>
      {canEdit && <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Enregistrer</button></div>}
    </form>
  )
}

// ---------------------------------------------------------------------
function Installation({ widgetKey }: { widgetKey: string }) {
  const toast = useToast()
  const snippet = embedSnippet(widgetKey)
  const link = publicChatUrl(widgetKey)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    QRCode.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null))
  }, [link])

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(what)
    toast('success', 'Copié')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Code2 className="h-4 w-4 text-brand-600" /> Sur votre site web</h2>
        <p className="mt-1 text-sm text-slate-500">Collez cette ligne juste avant la balise <code className="rounded bg-slate-100 px-1">&lt;/body&gt;</code> de votre site.</p>
        <div className="relative mt-3">
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 pr-24 text-xs leading-relaxed text-emerald-300"><code>{snippet}</code></pre>
          <button className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20" onClick={() => copy(snippet, 'snippet')}>
            {copied === 'snippet' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copier
          </button>
        </div>
        <details className="mt-4 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-800">Où coller ce code ? (WordPress, Wix, Shopify…)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong>WordPress</strong> : extension « WPCode » (ou « Insert Headers and Footers ») → Pied de page → collez → Enregistrer.</li>
            <li><strong>Wix</strong> : Paramètres → Code personnalisé → Ajouter du code → « Body - fin », toutes les pages.</li>
            <li><strong>Shopify</strong> : Boutique en ligne → Thèmes → Modifier le code → <code>theme.liquid</code>, avant <code>&lt;/body&gt;</code>.</li>
            <li><strong>Squarespace</strong> : Paramètres → Avancé → Injection de code → Pied de page.</li>
            <li><strong>Site fait par un prestataire</strong> : envoyez-lui simplement cette ligne.</li>
          </ul>
        </details>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><QrCode className="h-4 w-4 text-brand-600" /> Pas de site ? Votre page de discussion</h2>
        <p className="mt-1 text-sm text-slate-500">
          Un lien à mettre dans votre bio Instagram ou Facebook, votre signature email, votre fiche Google, et un QR code pour vos cartes de visite, votre camion ou votre vitrine.
        </p>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
          {qr && <img src={qr} alt="QR code vers votre page de discussion" className="h-40 w-40 rounded-lg border border-slate-200" />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate text-sm text-slate-700">{link}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => copy(link, 'link')}>{copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copier le lien</button>
              {qr && <a className="btn-secondary" href={qr} download="qr-code-assistant.png"><Download className="h-4 w-4" /> Télécharger le QR code</a>}
              <a className="btn-secondary" href={link} target="_blank" rel="noreferrer"><Eye className="h-4 w-4" /> Ouvrir</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------
/** Charge le vrai widget en mode intégré (même code que sur le site du client). */
function WidgetPreview({ widgetKey }: { widgetKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useMemo(() => `widget-preview-${Math.random().toString(36).slice(2)}`, [])
  useEffect(() => {
    const s = document.createElement('script')
    s.src = `/widget.js?v=${Date.now()}`
    s.async = true
    s.dataset.key = widgetKey
    s.dataset.api = widgetApiUrl()
    s.dataset.inline = `#${id}`
    s.dataset.preview = 'true'
    document.body.appendChild(s)
    const container = ref.current
    return () => { s.remove(); if (container) container.innerHTML = '' }
  }, [widgetKey, id])
  return <div id={id} ref={ref} className="h-[560px]" />
}
