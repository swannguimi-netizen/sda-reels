import { assert, assertEquals } from 'jsr:@std/assert@1'
import { assistantTools, buildSystemPrompt, isOriginAllowed, normalizePhone, suggestions, toHistory } from './assistant.ts'

const settings = {
  assistant_name: 'Léa', welcome_message: 'Bonjour', tone: 'chaleureux', instructions: 'Ne jamais promettre une intervention le dimanche.',
  collect_contact: true, can_create_quote_requests: true, allowed_domains: [],
}
const company = { name: 'Plomberie Martin', city: 'Cayenne', phone: '0594 00 00 00', email: null, website: null, address_line1: null, postal_code: null }

Deno.test('prompt : base de connaissances groupée, consignes du dirigeant, coordonnées', () => {
  const p = buildSystemPrompt(company, settings, [
    { category: 'horaires', title: 'Ouverture', content: 'Lun-ven 8h-17h' },
    { category: 'tarifs', title: 'Déplacement', content: '45 € à Cayenne' },
  ])
  assert(p.includes('Léa') && p.includes('« Plomberie Martin »'))
  assert(p.includes('## Horaires\n### Ouverture\nLun-ven 8h-17h'))
  assert(p.includes('## Tarifs'))
  assert(p.includes('Ne jamais promettre une intervention le dimanche.'))
  assert(p.includes('téléphone 0594 00 00 00'))
  assert(p.includes('create_quote_request'))
})

Deno.test('outils : demande de devis désactivable, schémas stricts', () => {
  assertEquals(assistantTools(settings).map((t) => t.name), ['save_contact', 'create_quote_request', 'request_human'])
  assertEquals(assistantTools({ ...settings, can_create_quote_requests: false }).map((t) => t.name), ['save_contact', 'request_human'])
  assert(assistantTools(settings).every((t) => t.strict === true))
})

Deno.test('historique : alternance, fusion, réponses de l’équipe, premier message utilisateur', () => {
  const h = toHistory([
    { role: 'assistant', content: 'Bonjour !' },
    { role: 'visitor', content: 'Bonjour' },
    { role: 'visitor', content: 'Vous faites les climatiseurs ?' },
    { role: 'assistant', content: 'Oui.' },
    { role: 'agent', content: 'Je vous appelle demain.' },
    { role: 'system', content: 'interne' },
    { role: 'visitor', content: 'Merci' },
  ])
  assertEquals(h.map((m) => m.role), ['user', 'assistant', 'user'])
  assertEquals(h[0].content, 'Bonjour\n\nVous faites les climatiseurs ?')
  assertEquals(h[1].content, 'Oui.\n\n[Réponse d’un membre de l’équipe] Je vous appelle demain.')
})

Deno.test('domaines autorisés : sous-domaines, liste vide, origine absente ou invalide', () => {
  assert(isOriginAllowed('https://www.plomberie-martin.fr', ['plomberie-martin.fr']))
  assert(isOriginAllowed('https://plomberie-martin.fr', ['https://plomberie-martin.fr/']))
  assert(!isOriginAllowed('https://plomberie-martin.fr.pirate.com', ['plomberie-martin.fr']))
  assert(!isOriginAllowed('https://evilplomberie-martin.fr', ['plomberie-martin.fr']))
  assert(isOriginAllowed(null, []))
  assert(!isOriginAllowed(null, ['plomberie-martin.fr']))
  assert(!isOriginAllowed('pas une url', ['plomberie-martin.fr']))
})

Deno.test('suggestions et téléphone', () => {
  assertEquals(suggestions([{ category: 'horaires', title: '', content: '' }, { category: 'zone', title: '', content: '' }], settings),
    ['Je voudrais un devis', 'Quels sont vos horaires ?', 'Intervenez-vous près de chez moi ?'])
  assertEquals(normalizePhone('06 94 12 34 56'), '0694123456')
  assertEquals(normalizePhone('+594 694 12 34 56'), '+594694123456')
  assertEquals(normalizePhone('12'), null)
})

Deno.test('rendez-vous : outils et consignes seulement si activés', () => {
  assertEquals(assistantTools(settings, { appointments: true }).map((t) => t.name),
    ['save_contact', 'create_quote_request', 'request_human', 'find_slots', 'book_appointment'])
  assert(!assistantTools(settings).some((t) => t.name === 'book_appointment'))
  assert(buildSystemPrompt(company, settings, [], { appointments: true }).includes('find_slots'))
  assert(!buildSystemPrompt(company, settings, []).includes('find_slots'))
})
