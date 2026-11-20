import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { frenchAuthError, supabase } from '../../lib/supabase'
import { Alert, Spinner } from '../../components/ui'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/nouveau-mot-de-passe`,
    })
    setBusy(false)
    if (error) setError(frenchAuthError(error.message))
    else setDone(true)
  }

  return (
    <AuthLayout title="Mot de passe oublié" subtitle="Recevez un lien pour choisir un nouveau mot de passe.">
      {done ? (
        <Alert kind="success">Si un compte existe pour {email}, un email vient de vous être envoyé.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy && <Spinner className="h-4 w-4" />} Envoyer le lien
          </button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/connexion" className="text-brand-600 hover:underline">← Retour à la connexion</Link></p>
    </AuthLayout>
  )
}
