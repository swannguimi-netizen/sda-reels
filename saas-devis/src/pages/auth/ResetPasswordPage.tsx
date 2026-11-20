import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { frenchAuthError, supabase } from '../../lib/supabase'
import { Alert, Spinner } from '../../components/ui'

/** Atteinte via le lien de réinitialisation (session de récupération active). */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(frenchAuthError(error.message))
    else navigate('/', { replace: true })
  }

  return (
    <AuthLayout title="Nouveau mot de passe">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="password">Nouveau mot de passe</label>
          <input id="password" type="password" required minLength={8} autoComplete="new-password" className="input"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy && <Spinner className="h-4 w-4" />} Enregistrer
        </button>
      </form>
    </AuthLayout>
  )
}
