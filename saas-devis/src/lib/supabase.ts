import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

export const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'Devis & Assistant IA'

/** Traduit les erreurs Supabase Auth les plus courantes. */
export function frenchAuthError(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'Email ou mot de passe incorrect.',
    'Email not confirmed': 'Veuillez confirmer votre adresse email (lien envoyé à l’inscription).',
    'User already registered': 'Un compte existe déjà avec cet email.',
    'Password should be at least 6 characters.': 'Le mot de passe doit contenir au moins 6 caractères.',
    'Unable to validate email address: invalid format': 'Adresse email invalide.',
  }
  if (message.toLowerCase().includes('rate limit')) return 'Trop de tentatives, réessayez dans quelques minutes.'
  return map[message] ?? message
}
