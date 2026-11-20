import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { VAT_REGIME_LABELS, type VatRegime } from '../../lib/types'
import { Alert, Spinner } from '../../components/ui'

export default function OnboardingPage() {
  const { company, refresh, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [siret, setSiret] = useState('')
  const [vatRegime, setVatRegime] = useState<VatRegime>('assujetti')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (company) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const cleanSiret = siret.replace(/\s/g, '')
    if (cleanSiret && !/^\d{14}$/.test(cleanSiret)) return setError('Le SIRET doit comporter 14 chiffres.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('create_company', {
      p_name: name.trim(),
      p_vat_regime: vatRegime,
      p_siret: cleanSiret || null,
    })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    await refresh()
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout
      title={`Bienvenue${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''} !`}
      subtitle="Présentez votre entreprise. Vous compléterez logo, adresse et mentions légales ensuite."
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="name">Nom de l’entreprise</label>
          <input id="name" required className="input" placeholder="Ex. Plomberie Martin"
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="siret">SIRET <span className="font-normal text-slate-400">(facultatif)</span></label>
          <input id="siret" inputMode="numeric" className="input" placeholder="123 456 789 00012"
            value={siret} onChange={(e) => setSiret(e.target.value)} />
        </div>
        <fieldset>
          <legend className="label">Régime de TVA</legend>
          <div className="space-y-2">
            {(Object.keys(VAT_REGIME_LABELS) as VatRegime[]).map((key) => (
              <label key={key}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
                  vatRegime === key ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <input type="radio" name="vat" value={key} checked={vatRegime === key}
                  onChange={() => setVatRegime(key)} className="mt-0.5 text-brand-600" />
                <span>
                  <span className="font-medium text-slate-900">{VAT_REGIME_LABELS[key].label}</span>
                  {VAT_REGIME_LABELS[key].mention && (
                    <span className="block text-xs text-slate-500">Mention : « {VAT_REGIME_LABELS[key].mention} »</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy && <Spinner className="h-4 w-4" />} Créer mon espace
        </button>
        <button type="button" onClick={signOut} className="w-full text-center text-sm text-slate-500 hover:underline">
          Se déconnecter
        </button>
      </form>
    </AuthLayout>
  )
}
