import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Client agissant au nom de l'utilisateur (RLS appliquées). */
export function userClient(req: Request): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
}

/** Client service : contourne les RLS, à n'utiliser qu'après vérification des droits. */
export const adminClient = () => createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
