// Rédaction des demandes d'avis (pure, testée).
export function renderReviewRequest(p: { firstName: string | null; company: string; followup: boolean; custom?: string | null }) {
  const hello = `Bonjour${p.firstName ? ` ${p.firstName}` : ''},`
  const custom = p.custom?.trim()
    ? p.custom.replace(/\{prenom\}/g, p.firstName ?? '').replace(/\{entreprise\}/g, p.company).replace(/ ,/g, ',')
    : null
  if (p.followup) {
    return {
      subject: `Un petit mot pour ${p.company} ?`,
      body: `${hello}\n\nNous nous permettons de revenir vers vous : si vous avez une minute, votre avis sur Google aiderait beaucoup notre entreprise à se faire connaître.\n\nMerci d’avance,\n${p.company}`,
      button: 'Laisser un avis sur Google',
    }
  }
  return {
    subject: `Merci pour votre confiance – votre avis compte pour ${p.company}`,
    body: custom ?? `${hello}\n\nMerci d’avoir fait appel à ${p.company}. Nous espérons que notre intervention vous a donné entière satisfaction.\n\nVotre avis sur Google nous aide énormément : il ne prend qu’une minute et permet à d’autres clients de nous trouver.\n\nMerci beaucoup,\n${p.company}`,
    button: 'Laisser un avis sur Google',
  }
}
