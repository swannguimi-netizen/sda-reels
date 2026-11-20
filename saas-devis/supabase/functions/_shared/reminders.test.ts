import { assert, assertEquals } from 'jsr:@std/assert@1'
import { fillTemplate, renderReminder, type ReminderVars } from './reminders.ts'

const vars: ReminderVars = {
  client: 'Mme Dupont', numero: 'DEV-2026-041', montant: '6 840,00 €', reste: '6 840,00 €', entreprise: 'Plomberie Martin',
  date_envoi: '15/11/2026', validite: '15/12/2026', echeance: '10/11/2026', jours_retard: 9,
  penalites: 'Pénalités de retard : 3 fois le taux d’intérêt légal.',
}

Deno.test('devis : 1re relance différente si le client a ouvert le devis', () => {
  const notViewed = renderReminder({ type: 'quote', rank: 1, viewed: false, vars })
  const viewed = renderReminder({ type: 'quote', rank: 1, viewed: true, vars })
  assert(notViewed.body.includes('Avez-vous pu en prendre connaissance ?'))
  assert(viewed.body.includes('Avez-vous des questions'))
  assertEquals(notViewed.subject, 'Votre devis DEV-2026-041 – Plomberie Martin')
  assert(notViewed.body.startsWith('Bonjour Mme Dupont,'))
})

Deno.test('devis : 2e relance mentionne la validité', () => {
  const r = renderReminder({ type: 'quote', rank: 2, viewed: false, vars })
  assertEquals(r.subject, 'Rappel : votre devis DEV-2026-041 est valable jusqu’au 15/12/2026')
})

Deno.test('factures : ton progressif, pénalités au 3e rappel', () => {
  const r1 = renderReminder({ type: 'invoice', rank: 1, viewed: false, vars })
  const r2 = renderReminder({ type: 'invoice', rank: 2, viewed: false, vars })
  const r3 = renderReminder({ type: 'invoice', rank: 3, viewed: false, vars })
  assert(r1.body.includes('simple oubli') && !r1.body.includes('recouvrement'))
  assert(r2.body.includes('échue depuis 9 jours'))
  assert(r3.body.includes('recouvrement') && r3.body.includes('3 fois le taux'))
  assert(r3.subject.startsWith('Dernier rappel'))
})

Deno.test('modèle personnalisé : variables remplacées, inconnues conservées', () => {
  assertEquals(fillTemplate('Bonjour {client}, devis {numero} ({montant}) {inconnu}', vars), 'Bonjour Mme Dupont, devis DEV-2026-041 (6 840,00 €) {inconnu}')
  const r = renderReminder({ type: 'quote', rank: 2, viewed: true, vars, custom: 'Coucou {client} !' })
  assertEquals(r.body, 'Coucou Mme Dupont !')
})

Deno.test('client sans nom', () => {
  assert(renderReminder({ type: 'invoice', rank: 1, viewed: false, vars: { ...vars, client: null } }).body.startsWith('Bonjour,'))
})
