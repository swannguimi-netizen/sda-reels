import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Company, Membership, MemberRole, Profile } from '../lib/types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  memberships: Membership[]
  company: Company | null
  role: MemberRole | null
  refresh: () => Promise<void>
  switchCompany: (companyId: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)

  const loadAccount = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null)
      setMemberships([])
      return
    }
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase
        .from('company_members')
        .select('role, company:companies(id, name, siret, vat_regime, default_vat_rate, logo_path, brand_color, city, widget_public_key)')
        .eq('user_id', userId)
        .order('created_at'),
    ])
    setProfile((p as Profile) ?? null)
    setMemberships(((m ?? []) as unknown as Membership[]).filter((x) => x.company))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadAccount(data.session?.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Différé : ne pas appeler Supabase dans le callback (verrou interne)
        setTimeout(() => loadAccount(newSession?.user.id), 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadAccount])

  const current = useMemo(
    () => memberships.find((m) => m.company.id === profile?.current_company_id) ?? memberships[0] ?? null,
    [memberships, profile?.current_company_id],
  )

  const value: AuthState = {
    loading,
    session,
    profile,
    memberships,
    company: current?.company ?? null,
    role: current?.role ?? null,
    refresh: () => loadAccount(session?.user.id),
    switchCompany: async (companyId) => {
      if (!session) return
      await supabase.from('profiles').update({ current_company_id: companyId }).eq('id', session.user.id)
      await loadAccount(session.user.id)
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  return ctx
}
