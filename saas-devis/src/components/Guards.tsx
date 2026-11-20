import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { FullPageSpinner } from './ui'

/** Pages réservées aux utilisateurs connectés possédant une entreprise. */
export function RequireCompany() {
  const { loading, session, company } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />
  if (!company) return <Navigate to="/bienvenue" replace />
  return <Outlet />
}

/** Utilisateur connecté (entreprise facultative) : onboarding. */
export function RequireSession() {
  const { loading, session } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/connexion" replace />
  return <Outlet />
}

/** Pages d'authentification : redirige si déjà connecté. */
export function GuestOnly() {
  const { loading, session } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/'} replace />
  }
  return <Outlet />
}

export function RequirePlatformAdmin() {
  const { loading, profile } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!profile?.is_platform_admin) return <Navigate to="/" replace />
  return <Outlet />
}
