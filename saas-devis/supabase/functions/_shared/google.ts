// Google Agenda : OAuth (hors ligne), créneaux occupés (freeBusy), événements.
// Secrets : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_STATE_SECRET ; redirection = <projet>/functions/v1/google-calendar
import type { adminClient } from './supabase.ts'
import { SUPABASE_URL } from './supabase.ts'

type Admin = ReturnType<typeof adminClient>
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const STATE_SECRET = Deno.env.get('GOOGLE_STATE_SECRET') ?? ''
export const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar`
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy']

export const googleConfigured = () => !!(CLIENT_ID && CLIENT_SECRET && STATE_SECRET)

// ---------------------------------------------------------------- état signé (anti-CSRF)
const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
async function hmac(data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}
export async function signState(payload: { company_id: string; user_id: string }) {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, exp: Date.now() + 15 * 60_000 })))
  return `${body}.${await hmac(body)}`
}
export async function verifyState(state: string): Promise<{ company_id: string; user_id: string } | null> {
  const [body, sig] = state.split('.')
  if (!body || !sig || (await hmac(body)) !== sig) return null
  const data = JSON.parse(new TextDecoder().decode(unb64url(body)))
  return data.exp > Date.now() ? data : null
}

export function authUrl(state: string) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.search = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  }).toString()
  return u.toString()
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Google : ${data.error_description ?? data.error ?? res.status}`)
  return data as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string }
}

export async function exchangeCode(code: string) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
  const email = t.id_token ? JSON.parse(new TextDecoder().decode(unb64url(t.id_token.split('.')[1]))).email ?? null : null
  return { ...t, email: email as string | null }
}

/** Jeton d'accès valide pour l'entreprise (rafraîchi si besoin), ou null si Google n'est pas connecté. */
export async function accessToken(admin: Admin, companyId: string): Promise<string | null> {
  const { data } = await admin.rpc('google_token_get', { p_company_id: companyId })
  const tok = (data as Array<{ refresh_token: string; access_token: string | null; expires_at: string | null }> | null)?.[0]
  if (!tok) return null
  if (tok.access_token && tok.expires_at && new Date(tok.expires_at).getTime() > Date.now() + 60_000) return tok.access_token
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token })
  await admin.rpc('google_token_set', {
    p_company_id: companyId, p_refresh_token: null, p_access_token: t.access_token,
    p_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  })
  return t.access_token
}

async function gapi(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok && !(init.method === 'DELETE' && res.status === 410)) throw new Error(`Google Agenda : ${data.error?.message ?? res.status}`)
  return data
}

export async function freeBusy(token: string, calendarId: string, timeMin: Date, timeMax: Date) {
  const data = await gapi(token, '/freeBusy', {
    method: 'POST', body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] }),
  })
  return ((data?.calendars?.[calendarId]?.busy ?? []) as Array<{ start: string; end: string }>).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
}

export async function insertEvent(token: string, calendarId: string, ev: { summary: string; description: string; location?: string | null; start: Date; end: Date; timeZone: string }) {
  const data = await gapi(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary: ev.summary, description: ev.description, location: ev.location ?? undefined,
      start: { dateTime: ev.start.toISOString(), timeZone: ev.timeZone }, end: { dateTime: ev.end.toISOString(), timeZone: ev.timeZone },
      reminders: { useDefault: true },
    }),
  })
  return data.id as string
}

export async function deleteEvent(token: string, calendarId: string, eventId: string) {
  await gapi(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' })
}

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}
