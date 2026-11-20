import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

export interface Company {
  id: string
  name: string
  brand_color: string
  vat_regime: 'assujetti' | 'franchise' | 'non_applicable_dom'
  default_vat_rate: number
  timezone: string
  deposit_percent: number
  quote_validity_days: number
}

interface AuthState {
  loading: boolean
  session: Session | null
  fullName: string | null
  isAdminRole: boolean
  company: Company | null
  companies: Company[]
  switchCompany: (id: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)
const COMPANY_FIELDS = 'id, name, brand_color, vat_regime, default_vat_rate, timezone, deposit_percent, quote_validity_days'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [fullName, setFullName] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Array<Company & { role: string }>>([])
  const [currentId, setCurrentId] = useState<string | null>(null)

  const load = useCallback(async (userId?: string) => {
    if (!userId) { setCompanies([]); setCurrentId(null); return }
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from('profiles').select('full_name, current_company_id').eq('id', userId).single(),
      supabase.from('company_members').select(`role, company:companies(${COMPANY_FIELDS})`).eq('user_id', userId),
    ])
    setFullName(p?.full_name ?? null)
    const list = ((m ?? []) as unknown as Array<{ role: string; company: Company }>).filter((x) => x.company).map((x) => ({ ...x.company, role: x.role }))
    setCompanies(list)
    setCurrentId(p?.current_company_id ?? list[0]?.id ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await load(data.session?.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => load(s?.user.id), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const current = companies.find((c) => c.id === currentId) ?? companies[0] ?? null
  const value: AuthState = {
    loading, session, fullName,
    company: current, companies,
    isAdminRole: current ? ['owner', 'admin'].includes(current.role) : false,
    switchCompany: async (id) => {
      setCurrentId(id)
      if (session) await supabase.from('profiles').update({ current_company_id: id }).eq('id', session.user.id)
    },
    signOut: async () => { await supabase.auth.signOut() },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth hors de AuthProvider')
  return c
}
