import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { frenchAuthError, supabase } from '../../lib/supabase'
import { Alert, Spinner } from '../../components/ui'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(frenchAuthError(error.message))
    setBusy(false)
  }

  return (
    <AuthLayout
      title="Connexion"
      subtitle={<>Pas encore de compte ? <Link to="/inscription" className="font-semibold text-brand-600 hover:underline">Essayer gratuitement</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required className="input"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">Mot de passe</label>
            <Link to="/mot-de-passe-oublie" className="mb-1 text-sm text-brand-600 hover:underline">Oublié ?</Link>
          </div>
          <input id="password" type="password" autoComplete="current-password" required className="input"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy && <Spinner className="h-4 w-4" />} Se connecter
        </button>
      </form>
    </AuthLayout>
  )
}
