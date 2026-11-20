const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'devis@example.com' // adresse d'un domaine vérifié dans Resend

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Gabarit HTML sobre, compatible avec les principaux clients mail. */
export function emailLayout(opts: { companyName: string; color: string; logoUrl?: string | null; bodyText: string; button?: { label: string; url: string }; footer?: string }) {
  const body = escapeHtml(opts.bodyText).replace(/\n/g, '<br>')
  const color = /^#[0-9a-f]{6}$/i.test(opts.color) ? opts.color : '#4f46e5'
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="height:6px;background:${color}"></td></tr>
<tr><td style="padding:24px 28px 8px">${opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(opts.companyName)}" style="max-height:48px;max-width:180px">`
    : `<strong style="font-size:18px;color:${color}">${escapeHtml(opts.companyName)}</strong>`}</td></tr>
<tr><td style="padding:8px 28px 8px;font-size:15px;line-height:1.6">${body}</td></tr>
${opts.button ? `<tr><td style="padding:16px 28px 28px"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">${escapeHtml(opts.button.label)}</a></td></tr>` : ''}
</table>
${opts.footer ? `<p style="font-size:12px;color:#94a3b8;margin-top:16px">${escapeHtml(opts.footer)}</p>` : ''}
</td></tr></table></body></html>`
}

export async function sendEmail(params: {
  fromName: string
  to: string
  replyTo?: string | null
  subject: string
  html: string
  attachments?: Array<{ filename: string; content: string }>
}): Promise<{ id: string }> {
  if (!RESEND_API_KEY) throw new Error('Envoi d’emails non configuré (RESEND_API_KEY manquante).')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${params.fromName.replace(/[<>"]/g, '')} <${EMAIL_FROM}>`,
      to: [params.to],
      reply_to: params.replyTo || undefined,
      subject: params.subject,
      html: params.html,
      attachments: params.attachments,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? `Resend a refusé l’envoi (${res.status}).`)
  return data
}
