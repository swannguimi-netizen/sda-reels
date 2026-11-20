import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { AppState, Platform } from 'react-native'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key'
export const APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
export const isConfigured = !!(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,          // session conservée sur le téléphone
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Rafraîchit la session seulement quand l'application est au premier plan
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh()
    else supabase.auth.stopAutoRefresh()
  })
}

/** Appelle une Edge Function et remonte son message d'erreur. */
export async function invoke<T>(name: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(detail?.error ?? fallback)
  }
  return data as T
}

export const publicQuoteUrl = (token: string) => `${APP_URL}/d/${token}`

export function frenchAuthError(message: string) {
  if (message === 'Invalid login credentials') return 'Email ou mot de passe incorrect.'
  if (message === 'Email not confirmed') return 'Confirmez d’abord votre adresse email (lien reçu à l’inscription).'
  if (/rate limit/i.test(message)) return 'Trop de tentatives, réessayez dans quelques minutes.'
  return message
}
