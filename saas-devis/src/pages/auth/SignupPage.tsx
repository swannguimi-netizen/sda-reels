import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { frenchAuthError, supabase } from '../../lib/supabase'
import { Alert, Spinner } from '../../components/ui'

export default function SignupPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accept, setAccept] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.')
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/bienvenue`,
      },
    })
    setBusy(false)
    if (error) return setError(frenchAuthError(error.message))
    // Confirmation d'email activée : pas de session immédiate
    if (!data.session) setSentTo(email.trim())
  }

  if (sentTo) {
    return (
      <AuthLayout title="Vérifiez votre boîte mail">
        <Alert kind="success">
          Un lien de confirmation a été envoyé à <strong>{sentTo}</strong>. Cliquez dessus pour activer votre compte
          et créer votre entreprise.
        </Alert>
        <p className="mt-6 text-sm text-slate-500">
          Rien reçu ? Vérifiez les spams ou <button className="font-semibold text-brand-600 hover:underline"
            onClick={() => setSentTo(null)}>recommencez</button>.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Créer votre compte"
      subtitle={<>Déjà inscrit ? <Link to="/connexion" className="font-semibold text-brand-600 hover:underline">Se connecter</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="name">Nom et prénom</label>
          <input id="name" required autoComplete="name" className="input"
            value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="email">Email professionnel</label>
          <input id="email" type="email" required autoComplete="email" className="input"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Mot de passe</label>
          <input id="password" type="password" required minLength={8} autoComplete="new-password" className="input"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">8 caractères minimum.</p>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" required checked={accept} onChange={(e) => setAccept(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-brand-600" />
          <span>J’accepte les conditions générales d’utilisation et la politique de confidentialité.</span>
        </label>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy && <Spinner className="h-4 w-4" />} Démarrer mon essai gratuit
        </button>
        <p className="text-center text-xs text-slate-500">14 jours offerts, sans carte bancaire.</p>
      </form>
    </AuthLayout>
  )
}
