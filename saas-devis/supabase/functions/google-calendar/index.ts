// Google Agenda de l'entreprise.
// GET  ?code&state       : retour OAuth de Google (enregistre la connexion puis redirige vers l'app)
// POST { action, ... }   : auth_url | disconnect | sync (appointment_id) | slots (from, to)  — JWT de l'utilisateur
// Secrets : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_STATE_SECRET, APP_URL
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, userClient } from '../_shared/supabase.ts'
import { accessToken, authUrl, exchangeCode, googleConfigured, revoke, signState, verifyState } from '../_shared/google.ts'
import { availableSlots, syncGoogle } from '../_shared/appointments.ts'

const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const admin = adminClient()

  // ------------------------------------------------------------ retour OAuth
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const back = (status: string) => Response.redirect(`${APP_URL}/rendez-vous?google=${status}`, 302)
    if (url.searchParams.get('error')) return back('refuse')
    const state = await verifyState(url.searchParams.get('state') ?? '').catch(() => null)
    const code = url.searchParams.get('code')
    if (!state || !code) return back('erreur')
    try {
      const t = await exchangeCode(code)
      if (!t.refresh_token) return back('erreur')
      await admin.rpc('google_token_set', {
        p_company_id: state.company_id, p_refresh_token: t.refresh_token, p_access_token: t.access_token,
        p_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      })
      await admin.from('calendar_integrations').upsert({
        company_id: state.company_id, provider: 'google', account_email: t.email, calendar_id: 'primary',
        connected_by: state.user_id, connected_at: new Date().toISOString(),
      })
      return back('ok')
    } catch (e) {
      console.error(e)
      return back('erreur')
    }
  }
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  try {
    const body = await req.json()
    const companyId = body.company_id
    const user = userClient(req)
    const { data: auth } = await user.auth.getUser()
    if (!auth?.user || typeof companyId !== 'string') return json({ error: 'Authentification requise' }, 401)
    const { data: member } = await user.from('company_members').select('role').eq('company_id', companyId).eq('user_id', auth.user.id).single()
    if (!member) return json({ error: 'Accès refusé' }, 403)
    const isAdmin = ['owner', 'admin'].includes(member.role)

    switch (body.action) {
      case 'auth_url': {
        if (!isAdmin) return json({ error: 'Réservé au propriétaire et aux administrateurs.' }, 403)
        if (!googleConfigured()) return json({ error: 'Connexion Google non configurée sur la plateforme.' }, 503)
        const { data: ok } = await admin.rpc('company_has_feature', { p_company_id: companyId, p_feature: 'appointments' })
        if (!ok) return json({ error: 'La synchronisation Google Agenda est incluse dans l’offre Premium.' }, 402)
        return json({ url: authUrl(await signState({ company_id: companyId, user_id: auth.user.id })) })
      }
      case 'disconnect': {
        if (!isAdmin) return json({ error: 'Réservé au propriétaire et aux administrateurs.' }, 403)
        const token = await accessToken(admin, companyId).catch(() => null)
        if (token) await revoke(token)
        await admin.rpc('google_token_delete', { p_company_id: companyId })
        return json({ ok: true })
      }
      case 'sync': {
        const { data: appt } = await user.from('appointments').select('id').eq('id', body.appointment_id).single()
        if (!appt) return json({ error: 'Rendez-vous introuvable' }, 404)
        await syncGoogle(admin, appt.id)
        const { data } = await admin.from('appointments').select('google_event_id, google_sync_error').eq('id', appt.id).single()
        return json(data)
      }
      case 'slots': {
        const { slots, ctx } = await availableSlots(admin, companyId, {
          from: body.from ? new Date(body.from) : undefined, to: body.to ? new Date(body.to) : undefined, max: 60,
        })
        return json({ timezone: ctx.timeZone, slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) })
      }
      default:
        return json({ error: 'Action inconnue' }, 400)
    }
  } catch (e) {
    console.error(e)
    return json({ error: (e as Error).message }, 500)
  }
})
