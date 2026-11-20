// Rédaction des relances (pure, testée). Ton progressif selon le rang de la relance.

export interface ReminderVars {
  client: string | null
  numero: string
  montant: string          // montant TTC du document
  reste: string            // reste à payer (factures)
  entreprise: string
  date_envoi: string | null
  validite: string | null  // date de fin de validité (devis)
  echeance: string | null  // date d'échéance (factures)
  jours_retard: number
  penalites: string | null
}

export const PLACEHOLDERS = ['client', 'numero', 'montant', 'reste', 'entreprise', 'date_envoi', 'validite', 'echeance', 'jours_retard'] as const

export function fillTemplate(template: string, v: ReminderVars): string {
  const map: Record<string, string> = {
    client: v.client ?? '', numero: v.numero, montant: v.montant, reste: v.reste, entreprise: v.entreprise,
    date_envoi: v.date_envoi ?? '', validite: v.validite ?? '', echeance: v.echeance ?? '', jours_retard: String(v.jours_retard),
  }
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? map[k] : m))
}

const hello = (v: ReminderVars) => `Bonjour${v.client ? ` ${v.client}` : ''},`

/** Objet et corps d'une relance. `custom` remplace le texte par défaut (même modèle pour tous les rangs). */
export function renderReminder(p: {
  type: 'quote' | 'invoice'
  rank: number
  viewed: boolean
  vars: ReminderVars
  custom?: string | null
}): { subject: string; body: string; button: string } {
  const v = p.vars
  if (p.type === 'quote') {
    const subject = p.rank === 1
      ? `Votre devis ${v.numero} – ${v.entreprise}`
      : `Rappel : votre devis ${v.numero}${v.validite ? ` est valable jusqu’au ${v.validite}` : ''}`
    const body = p.custom ? fillTemplate(p.custom, v) : p.rank === 1
      ? `${hello(v)}\n\nJe me permets de revenir vers vous au sujet du devis ${v.numero} d’un montant de ${v.montant}${v.date_envoi ? `, envoyé le ${v.date_envoi}` : ''}. `
        + (p.viewed ? 'Avez-vous des questions ou souhaitez-vous que nous l’ajustions ensemble ?' : 'Avez-vous pu en prendre connaissance ?')
        + `\n\nVous pouvez le consulter et le signer en ligne en un clic grâce au bouton ci-dessous.\n\nBien cordialement,\n${v.entreprise}`
      : `${hello(v)}\n\nPetit rappel concernant notre devis ${v.numero} (${v.montant})`
        + (v.validite ? `, valable jusqu’au ${v.validite}` : '') + '. '
        + 'Si le projet est toujours d’actualité, il suffit de le signer en ligne pour que nous planifiions l’intervention. '
        + `S’il ne correspond pas à vos attentes, un simple retour de votre part nous aidera à vous proposer mieux.\n\nBien cordialement,\n${v.entreprise}`
    return { subject, body, button: 'Consulter et signer le devis' }
  }

  const subject = p.rank === 1 ? `Facture ${v.numero} : échéance dépassée`
    : p.rank === 2 ? `Deuxième rappel : facture ${v.numero} impayée`
    : `Dernier rappel avant relance formelle : facture ${v.numero}`
  const body = p.custom ? fillTemplate(p.custom, v) : p.rank === 1
    ? `${hello(v)}\n\nSauf erreur de notre part, la facture ${v.numero} arrivée à échéance le ${v.echeance} n’a pas encore été réglée (reste à payer : ${v.reste}). `
      + `Il s’agit peut-être d’un simple oubli : vous trouverez la facture et les informations de paiement via le bouton ci-dessous.\n\nSi le règlement a été effectué entre-temps, merci de ne pas tenir compte de ce message.\n\nBien cordialement,\n${v.entreprise}`
    : p.rank === 2
    ? `${hello(v)}\n\nNous revenons vers vous concernant la facture ${v.numero}, échue depuis ${v.jours_retard} jours, qui reste impayée (${v.reste}). `
      + `Merci de procéder au règlement dans les meilleurs délais, ou de nous indiquer si vous rencontrez une difficulté : nous pouvons en discuter.\n\nBien cordialement,\n${v.entreprise}`
    : `${hello(v)}\n\nMalgré nos précédents rappels, la facture ${v.numero} (${v.reste}, échue le ${v.echeance}) reste impayée. `
      + `Sans règlement sous 8 jours, nous serons contraints d’engager une procédure de recouvrement.`
      + (v.penalites ? `\n\nPour rappel : ${v.penalites}` : '')
      + `\n\nBien cordialement,\n${v.entreprise}`
  return { subject, body, button: 'Consulter et régler la facture' }
}
