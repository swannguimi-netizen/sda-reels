import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { GuestOnly, RequireCompany, RequirePlatformAdmin, RequireSession } from './components/Guards'
import { AppLayout } from './layouts/AppLayout'
import LoginPage from './pages/auth/LoginPage'
import SignupPage from './pages/auth/SignupPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'
import OnboardingPage from './pages/auth/OnboardingPage'
import DashboardPage from './pages/app/DashboardPage'
import ComingSoonPage from './pages/app/ComingSoonPage'
import { isSupabaseConfigured } from './lib/supabase'

const UPCOMING: Array<[string, string, string]> = [
  ['/entreprise', 'Profil entreprise', '2 · Profil entreprise et catalogue'],
  ['/catalogue', 'Catalogue', '2 · Profil entreprise et catalogue'],
  ['/clients', 'Clients', '2 · Profil entreprise et catalogue'],
  ['/devis', 'Devis', '3 · Devis + PDF'],
  ['/factures', 'Factures', '3 · Devis + PDF'],
  ['/boite-de-reception', 'Boîte de réception', '5 · Assistant IA et widget'],
  ['/connaissances', 'Base de connaissances', '5 · Assistant IA et widget'],
  ['/rendez-vous', 'Rendez-vous', 'Fonctionnalités avancées'],
  ['/abonnement', 'Abonnement', '6 · Stripe et abonnements'],
]

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="card max-w-lg p-6 text-sm text-slate-600">
          <h1 className="text-lg font-bold text-slate-900">Configuration requise</h1>
          <p className="mt-2">
            Copiez <code>.env.example</code> en <code>.env</code> et renseignez <code>VITE_SUPABASE_URL</code> et{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, puis relancez <code>npm run dev</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/connexion" element={<LoginPage />} />
            <Route path="/inscription" element={<SignupPage />} />
            <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          </Route>
          <Route path="/nouveau-mot-de-passe" element={<ResetPasswordPage />} />
          <Route element={<RequireSession />}>
            <Route path="/bienvenue" element={<OnboardingPage />} />
          </Route>
          <Route element={<RequireCompany />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              {UPCOMING.map(([path, title, step]) => (
                <Route key={path} path={path} element={<ComingSoonPage title={title} step={step} />} />
              ))}
              <Route element={<RequirePlatformAdmin />}>
                <Route path="/admin" element={<ComingSoonPage title="Super-admin" step="7 · Tableau de bord et admin" />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
