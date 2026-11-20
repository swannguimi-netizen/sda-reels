import { assert, assertEquals } from 'jsr:@std/assert@1'
import { renderReviewRequest } from './reviews.ts'

Deno.test('demande d’avis : prénom, entreprise, relance', () => {
  const first = renderReviewRequest({ firstName: 'Lucie', company: 'Avis Couverture', followup: false })
  assert(first.body.startsWith('Bonjour Lucie,'))
  assert(first.subject.includes('Avis Couverture'))
  const again = renderReviewRequest({ firstName: null, company: 'Avis Couverture', followup: true })
  assert(again.body.startsWith('Bonjour,'))
  assertEquals(again.subject, 'Un petit mot pour Avis Couverture ?')
})

Deno.test('message personnalisé : variables {prenom} et {entreprise}', () => {
  const r = renderReviewRequest({ firstName: 'Marc', company: 'Toitures 973', followup: false, custom: 'Salut {prenom} ! Merci de noter {entreprise}.' })
  assertEquals(r.body, 'Salut Marc ! Merci de noter Toitures 973.')
  assertEquals(renderReviewRequest({ firstName: null, company: 'X', followup: false, custom: 'Bonjour {prenom}, merci.' }).body, 'Bonjour, merci.')
})
