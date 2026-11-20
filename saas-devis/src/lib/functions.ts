import { supabase } from './supabase'

/** Appelle une Edge Function et remonte le message d'erreur qu'elle renvoie. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>, fallbackError: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(detail?.error ?? fallbackError)
  }
  return data as T
}
