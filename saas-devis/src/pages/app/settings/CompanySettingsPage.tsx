import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Building2, FileText, ImageUp, Landmark, MapPin, Percent, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { Alert, Field, PageHeader, Spinner } from '../../../components/ui'
import { VAT_REGIME_LABELS, VAT_RATES, type CompanyDetails, type VatRegime } from '../../../lib/types'
import { dbError, logoUrl } from '../../../lib/format'
import { formatSiret, isValidEmail, isValidIban, isValidSiret } from '../../../lib/validation'

/** Colonnes modifiables (cf. GRANT UPDATE de la migration 01). */
const EDITABLE = [
  'name', 'legal_form', 'siret', 'vat_number', 'rcs_rm', 'share_capital', 'address_line1', 'address_line2',
  'postal_code', 'city', 'country', 'email', 'phone', 'website', 'brand_color', 'vat_regime', 'default_vat_rate',
  'legal_mentions', 'payment_terms', 'late_penalty_text', 'iban', 'quote_validity_days', 'invoice_due_days',
  'deposit_percent', 'google_review_url',
] as const

const LEGAL_FORMS = ['Micro-entreprise', 'EI', 'EURL', 'SARL', 'SASU', 'SAS', 'SA', 'SCI', 'Association']
const COLORS = ['#4f46e5', '#2563eb', '#0891b2', '#059669', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#0f172a']

const SECTIONS = [
  { id: 'identite', label: 'Identité', icon: Building2 },
  { id: 'coordonnees', label: 'Coordonnées', icon: MapPin },
  { id: 'image', label: 'Logo et couleur', icon: ImageUp },
  { id: 'tva', label: 'TVA et mentions', icon: Landmark },
  { id: 'documents', label: 'Devis et factures', icon: Percent },
]

type Form = Record<(typeof EDITABLE)[number], string>

function toForm(c: CompanyDetails): Form {
  const f = {} as Form
  for (const k of EDITABLE) f[k] = c[k as keyof CompanyDetails] == null ? '' : String(c[k as keyof CompanyDetails])
  f.siret = formatSiret(c.siret)
  return f
}

export default function CompanySettingsPage() {
  const { company, role, refresh } = useAuth()
  const toast = useToast()
  const canEdit = role === 'owner' || role === 'admin'
  const [details, setDetails] = useState<CompanyDetails | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Dépend de l'id seulement : refresh() (après envoi du logo) ne doit pas écraser la saisie en cours
  const companyId = company?.id
  useEffect(() => {
    if (!companyId) return
    supabase.from('companies').select('*').eq('id', companyId).single().then(({ data }) => {
      if (!data) return
      setDetails(data as CompanyDetails)
      setForm(toForm(data as CompanyDetails))
    })
  }, [companyId])

  if (!form || !details) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value })
    if (errors[k]) setErrors({ ...errors, [k]: undefined })
  }
  const input = (k: keyof Form, props: Record<string, unknown> = {}) => (
    <input id={k} className={`input ${errors[k] ? 'border-red-400' : ''}`} value={form[k]} onChange={set(k)} disabled={!canEdit} {...props} />
  )

  function validate(): boolean {
    const e: typeof errors = {}
    if (!form!.name.trim()) e.name = 'Le nom est obligatoire.'
    if (form!.siret.trim() && !isValidSiret(form!.siret)) e.siret = 'SIRET invalide (14 chiffres, clé de contrôle).'
    if (form!.email.trim() && !isValidEmail(form!.email)) e.email = 'Email invalide.'
    if (form!.iban.trim() && !isValidIban(form!.iban)) e.iban = 'IBAN invalide.'
    if (!/^#[0-9a-fA-F]{6}$/.test(form!.brand_color)) e.brand_color = 'Couleur au format #RRGGBB.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return toast('error', 'Certains champs sont à corriger.')
    setSaving(true)
    const payload: Record<string, unknown> = {}
    for (const k of EDITABLE) {
      const v = form![k].trim()
      payload[k] = v === '' ? null : v
    }
    payload.siret = form!.siret.replace(/\s/g, '') || null
    payload.iban = form!.iban.replace(/\s/g, '').toUpperCase() || null
    payload.country = form!.country.trim() || 'France'
    for (const k of ['default_vat_rate', 'quote_validity_days', 'invoice_due_days', 'deposit_percent'] as const) {
      payload[k] = Number(String(form![k]).replace(',', '.')) || 0
    }
    if (payload.vat_regime !== 'assujetti') payload.default_vat_rate = 0
    if (payload.quote_validity_days === 0) payload.quote_validity_days = 30

    const { data, error } = await supabase.from('companies').update(payload).eq('id', details!.id).select().single()
    setSaving(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    setDetails(data as CompanyDetails)
    setForm(toForm(data as CompanyDetails))
    toast('success', 'Profil enregistré')
    refresh()
  }

  async function onLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) return toast('error', 'Logo trop lourd (2 Mo maximum).')
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      return toast('error', 'Format accepté : PNG, JPG, WebP ou SVG.')
    }
    setUploading(true)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    // Nom unique : évite le cache CDN lors d'un remplacement
    const path = `${details!.id}/logo-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('logos').upload(path, file, { contentType: file.type })
    if (upErr) {
      setUploading(false)
      return toast('error', upErr.message)
    }
    const old = details!.logo_path
    const { error } = await supabase.from('companies').update({ logo_path: path }).eq('id', details!.id)
    setUploading(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    if (old) supabase.storage.from('logos').remove([old])
    setDetails({ ...details!, logo_path: path })
    toast('success', 'Logo mis à jour')
    refresh()
  }

  async function removeLogo() {
    const old = details!.logo_path
    const { error } = await supabase.from('companies').update({ logo_path: null }).eq('id', details!.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    if (old) supabase.storage.from('logos').remove([old])
    setDetails({ ...details!, logo_path: null })
    refresh()
  }

  const regime = form.vat_regime as VatRegime

  return (
    <>
      <PageHeader title="Profil entreprise" description="Ces informations apparaissent sur vos devis et factures." />
      {!canEdit && <div className="mb-4"><Alert kind="info">Seuls le propriétaire et les administrateurs peuvent modifier le profil.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[180px_1fr_300px]">
        <nav className="hidden lg:block">
          <ul className="sticky top-6 space-y-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a href={`#${id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-white hover:text-slate-900">
                  <Icon className="h-4 w-4" /> {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <Section id="identite" title="Identité">
            <Field label="Raison sociale / nom commercial" htmlFor="name" className="sm:col-span-2" hint={errors.name && <Err>{errors.name}</Err>}>
              {input('name', { required: true })}
            </Field>
            <Field label="Forme juridique" htmlFor="legal_form">
              <input id="legal_form" list="legal-forms" className="input" value={form.legal_form} onChange={set('legal_form')} disabled={!canEdit} />
              <datalist id="legal-forms">{LEGAL_FORMS.map((f) => <option key={f} value={f} />)}</datalist>
            </Field>
            <Field label="SIRET" htmlFor="siret" hint={errors.siret ? <Err>{errors.siret}</Err> : '14 chiffres'}>
              {input('siret', { inputMode: 'numeric', placeholder: '123 456 789 00012' })}
            </Field>
            <Field label="Immatriculation RCS / RM" htmlFor="rcs_rm" hint="Ex. RCS Cayenne 123 456 789">
              {input('rcs_rm')}
            </Field>
            <Field label="Capital social" htmlFor="share_capital" hint="Sociétés uniquement">
              {input('share_capital', { placeholder: '1 000 €' })}
            </Field>
          </Section>

          <Section id="coordonnees" title="Coordonnées">
            <Field label="Adresse" htmlFor="address_line1" className="sm:col-span-2">{input('address_line1')}</Field>
            <Field label="Complément d’adresse" htmlFor="address_line2" className="sm:col-span-2">{input('address_line2')}</Field>
            <Field label="Code postal" htmlFor="postal_code">{input('postal_code', { inputMode: 'numeric' })}</Field>
            <Field label="Ville" htmlFor="city">{input('city')}</Field>
            <Field label="Pays" htmlFor="country">{input('country')}</Field>
            <Field label="Téléphone" htmlFor="phone">{input('phone', { type: 'tel' })}</Field>
            <Field label="Email de contact" htmlFor="email" hint={errors.email && <Err>{errors.email}</Err>}>
              {input('email', { type: 'email' })}
            </Field>
            <Field label="Site web" htmlFor="website">{input('website', { placeholder: 'https://' })}</Field>
          </Section>

          <Section id="image" title="Logo et couleur">
            <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
                {details.logo_path
                  ? <img src={logoUrl(details.logo_path)!} alt="Logo" className="max-h-full max-w-full object-contain" />
                  : <ImageUp className="h-6 w-6 text-slate-400" />}
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); e.target.value = '' }} />
                  <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? <Spinner className="h-4 w-4" /> : <ImageUp className="h-4 w-4" />}
                    {details.logo_path ? 'Remplacer' : 'Importer un logo'}
                  </button>
                  {details.logo_path && (
                    <button type="button" className="btn-secondary" onClick={removeLogo} aria-label="Supprimer le logo">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
              <p className="w-full text-xs text-slate-500">PNG, JPG, WebP ou SVG, 2 Mo maximum. Fond transparent conseillé.</p>
            </div>
            <Field label="Couleur des documents" className="sm:col-span-2" hint={errors.brand_color && <Err>{errors.brand_color}</Err>}>
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" disabled={!canEdit} onClick={() => setForm({ ...form, brand_color: c })}
                    aria-label={`Couleur ${c}`}
                    className={`h-8 w-8 rounded-full ring-offset-2 transition ${form.brand_color.toLowerCase() === c ? 'ring-2 ring-slate-900' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.brand_color) ? form.brand_color : '#4f46e5'}
                  onChange={set('brand_color')} disabled={!canEdit} aria-label="Couleur personnalisée"
                  className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white" />
                <input className="input w-28 font-mono" value={form.brand_color} onChange={set('brand_color')} disabled={!canEdit} aria-label="Code couleur" />
              </div>
            </Field>
          </Section>

          <Section id="tva" title="TVA et mentions légales">
            <fieldset className="sm:col-span-2">
              <legend className="label">Régime de TVA</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(VAT_REGIME_LABELS) as VatRegime[]).map((key) => (
                  <label key={key} className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm ${
                    regime === key ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      <input type="radio" name="vat_regime" checked={regime === key} disabled={!canEdit}
                        onChange={() => setForm({ ...form, vat_regime: key, default_vat_rate: key === 'assujetti' ? (form.default_vat_rate === '0' ? '20' : form.default_vat_rate) : '0' })} />
                      {VAT_REGIME_LABELS[key].label}
                    </span>
                    {VAT_REGIME_LABELS[key].mention && <span className="mt-1 text-xs text-slate-500">« {VAT_REGIME_LABELS[key].mention} »</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            {regime === 'assujetti' ? (
              <>
                <Field label="N° de TVA intracommunautaire" htmlFor="vat_number">{input('vat_number', { placeholder: 'FR12345678901' })}</Field>
                <Field label="Taux de TVA par défaut" htmlFor="default_vat_rate">
                  <select id="default_vat_rate" className="input" value={Number(form.default_vat_rate)} onChange={set('default_vat_rate')} disabled={!canEdit}>
                    {VAT_RATES.map((r) => <option key={r} value={r}>{r.toLocaleString('fr-FR')} %</option>)}
                  </select>
                </Field>
              </>
            ) : (
              <div className="sm:col-span-2">
                <Alert kind="info">La mention « {VAT_REGIME_LABELS[regime].mention} » sera ajoutée automatiquement à vos devis et factures, sans TVA.</Alert>
              </div>
            )}
            <Field label="Mentions complémentaires (pied de page)" htmlFor="legal_mentions" className="sm:col-span-2"
              hint="Ex. assurance décennale (assureur, n° de contrat, zone couverte), qualification RGE…">
              <textarea id="legal_mentions" rows={3} className="input" value={form.legal_mentions} onChange={set('legal_mentions')} disabled={!canEdit} />
            </Field>
          </Section>

          <Section id="documents" title="Devis et factures">
            <Field label="Validité des devis (jours)" htmlFor="quote_validity_days">
              {input('quote_validity_days', { type: 'number', min: 1, max: 365 })}
            </Field>
            <Field label="Acompte demandé à la signature (%)" htmlFor="deposit_percent" hint="0 pour ne pas demander d’acompte">
              {input('deposit_percent', { type: 'number', min: 0, max: 100, step: 5 })}
            </Field>
            <Field label="Délai de paiement des factures (jours)" htmlFor="invoice_due_days">
              {input('invoice_due_days', { type: 'number', min: 0, max: 60 })}
            </Field>
            <Field label="IBAN (affiché sur les factures)" htmlFor="iban" hint={errors.iban && <Err>{errors.iban}</Err>}>
              {input('iban', { placeholder: 'FR76 …' })}
            </Field>
            <Field label="Conditions de paiement" htmlFor="payment_terms" className="sm:col-span-2">
              <textarea id="payment_terms" rows={2} className="input" value={form.payment_terms} onChange={set('payment_terms')} disabled={!canEdit} />
            </Field>
            <Field label="Pénalités de retard" htmlFor="late_penalty_text" className="sm:col-span-2" hint="Mention obligatoire entre professionnels.">
              <textarea id="late_penalty_text" rows={2} className="input" value={form.late_penalty_text} onChange={set('late_penalty_text')} disabled={!canEdit} />
            </Field>
            <Field label="Lien vers votre fiche Google (avis)" htmlFor="google_review_url" className="sm:col-span-2"
              hint="Utilisé plus tard pour les demandes d’avis automatiques.">
              {input('google_review_url', { placeholder: 'https://g.page/r/…/review' })}
            </Field>
          </Section>

          {canEdit && (
            <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving && <Spinner className="h-4 w-4" />} Enregistrer
              </button>
            </div>
          )}
        </form>

        <aside className="hidden lg:block">
          <div className="sticky top-6">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <FileText className="h-3.5 w-3.5" /> Aperçu
            </p>
            <DocumentPreview form={form} logoPath={details.logo_path} />
          </div>
        </aside>
      </div>
    </>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6 p-5">
      <h2 className="mb-4 font-semibold text-slate-900">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

const Err = ({ children }: { children: ReactNode }) => <span className="text-red-600">{children}</span>

/** Miniature de l'en-tête d'un devis, mise à jour en direct. */
function DocumentPreview({ form, logoPath }: { form: Form; logoPath: string | null }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(form.brand_color) ? form.brand_color : '#4f46e5'
  const mention = VAT_REGIME_LABELS[form.vat_regime as VatRegime]?.mention
  return (
    <div className="aspect-[1/1.414] overflow-hidden rounded-lg border border-slate-200 bg-white p-4 text-[7px] leading-tight text-slate-600 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {logoPath
            ? <img src={logoUrl(logoPath)!} alt="" className="mb-1 max-h-8 max-w-[90px] object-contain" />
            : <p className="text-[10px] font-bold" style={{ color }}>{form.name || 'Votre entreprise'}</p>}
          <p>{form.address_line1}</p>
          <p>{[form.postal_code, form.city].filter(Boolean).join(' ')}</p>
          <p>{form.phone}</p>
          <p>{form.email}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold" style={{ color }}>DEVIS</p>
          <p>N° DEV-{new Date().getFullYear()}-001</p>
          <p>{new Date().toLocaleDateString('fr-FR')}</p>
        </div>
      </div>
      <div className="mt-3 ml-auto w-1/2 rounded border border-slate-200 p-1.5">
        <p className="font-semibold text-slate-800">Client</p>
        <p>Mme Dupont</p>
        <p>97300 Cayenne</p>
      </div>
      <div className="mt-3 rounded-t px-1.5 py-1 font-semibold text-white" style={{ backgroundColor: color }}>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2"><span>Désignation</span><span>Qté</span><span>Total HT</span></div>
      </div>
      {['Prestation', 'Fournitures', 'Déplacement'].map((l, i) => (
        <div key={l} className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-slate-100 px-1.5 py-1">
          <span>{l}</span><span>{i + 1}</span><span>{(i + 1) * 120},00 €</span>
        </div>
      ))}
      <div className="mt-2 ml-auto w-1/2 space-y-0.5">
        <div className="flex justify-between"><span>Total HT</span><span>720,00 €</span></div>
        {!mention && <div className="flex justify-between"><span>TVA {form.default_vat_rate} %</span><span>{(720 * Number(form.default_vat_rate) / 100).toFixed(2).replace('.', ',')} €</span></div>}
        <div className="flex justify-between rounded px-1 py-0.5 font-bold text-white" style={{ backgroundColor: color }}>
          <span>Total TTC</span><span>{(720 * (1 + (mention ? 0 : Number(form.default_vat_rate)) / 100)).toFixed(2).replace('.', ',')} €</span>
        </div>
      </div>
      {mention && <p className="mt-2 italic">{mention}</p>}
      <div className="mt-auto border-t border-slate-100 pt-1 text-center text-[6px] text-slate-400" style={{ marginTop: '18%' }}>
        {form.name}{form.legal_form && ` · ${form.legal_form}`}{form.share_capital && ` au capital de ${form.share_capital}`}
        {form.siret && ` · SIRET ${form.siret}`}{form.rcs_rm && ` · ${form.rcs_rm}`}
        {form.vat_number && form.vat_regime === 'assujetti' && ` · TVA ${form.vat_number}`}
      </div>
    </div>
  )
}
