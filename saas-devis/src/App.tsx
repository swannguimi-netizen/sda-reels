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
import CompanySettingsPage from './pages/app/settings/CompanySettingsPage'
import CatalogPage from './pages/app/CatalogPage'
import ClientsPage from './pages/app/ClientsPage'
import { ToastProvider } from './components/Toast'
import DocumentsListPage from './pages/app/documents/DocumentsListPage'
import DocumentEditorPage from './pages/app/documents/DocumentEditorPage'
import PublicDocumentPage from './pages/public/PublicDocumentPage'
import PublicChatPage from './pages/public/PublicChatPage'
import AssistantPage from './pages/app/assistant/AssistantPage'
import InboxPage from './pages/app/inbox/InboxPage'
import BillingPage from './pages/app/BillingPage'
import AdminPage from './pages/app/AdminPage'
import RemindersPage from './pages/app/RemindersPage'
import PaymentsPage from './pages/app/PaymentsPage'
import PricingPage from './pages/public/PricingPage'
import { isSupabaseConfigured } from './lib/supabase'

const UPCOMING: Array<[string, string, string]> = [
  ['/rendez-vous', 'Rendez-vous', 'Fonctionnalités avancées'],
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
        <ToastProvider>
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/connexion" element={<LoginPage />} />
            <Route path="/inscription" element={<SignupPage />} />
            <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          </Route>
          <Route path="/nouveau-mot-de-passe" element={<ResetPasswordPage />} />
          {/* Pages publiques envoyées aux clients */}
          <Route path="/d/:token" element={<PublicDocumentPage type="quote" />} />
          <Route path="/f/:token" element={<PublicDocumentPage type="invoice" />} />
          <Route path="/chat/:key" element={<PublicChatPage />} />
          <Route path="/tarifs" element={<PricingPage />} />
          <Route element={<RequireSession />}>
            <Route path="/bienvenue" element={<OnboardingPage />} />
          </Route>
          <Route element={<RequireCompany />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/entreprise" element={<CompanySettingsPage />} />
              <Route path="/catalogue" element={<CatalogPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/devis" element={<DocumentsListPage key="q" type="quote" />} />
              <Route path="/devis/:id" element={<DocumentEditorPage key="qe" type="quote" />} />
              <Route path="/factures" element={<DocumentsListPage key="i" type="invoice" />} />
              <Route path="/factures/:id" element={<DocumentEditorPage key="ie" type="invoice" />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/connaissances" element={<Navigate to="/assistant" replace />} />
              <Route path="/boite-de-reception" element={<InboxPage />} />
              <Route path="/abonnement" element={<BillingPage />} />
              <Route path="/relances" element={<RemindersPage />} />
              <Route path="/paiements" element={<PaymentsPage />} />
              {UPCOMING.map(([path, title, step]) => (
                <Route key={path} path={path} element={<ComingSoonPage title={title} step={step} />} />
              ))}
              <Route element={<RequirePlatformAdmin />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
