import { assertEquals } from 'jsr:@std/assert@1'
import { sanitizeProposal } from './proposal.ts'

const catalog = [
  { id: 'p1', unit: 'forfait', unit_price: '1200.00', vat_rate: '10.00' },
  { id: 'p2', unit: 'heure', unit_price: 55, vat_rate: 20 },
]
const assujetti = { vat_regime: 'assujetti', default_vat_rate: 20 }

Deno.test('le catalogue fait foi pour le prix, l’unité et la TVA', () => {
  const r = sanitizeProposal({ lines: [{ kind: 'item', description: 'Chauffe-eau', product_id: 'p1', quantity: 1, unit: 'u', unit_price: 999, vat_rate: 20 }] }, catalog, assujetti)
  assertEquals(r.lines[0], { kind: 'item', description: 'Chauffe-eau', product_id: 'p1', quantity: 1, unit: 'forfait', unit_price: 1200, vat_rate: 10, is_estimate: false })
})

Deno.test('un identifiant inventé devient une estimation', () => {
  const r = sanitizeProposal({ lines: [{ kind: 'item', description: 'Joint', product_id: 'inconnu', quantity: 2, unit: 'unité', unit_price: 12.345, vat_rate: 20 }] }, catalog, assujetti)
  assertEquals(r.lines[0].product_id, null)
  assertEquals(r.lines[0].is_estimate, true)
  assertEquals(r.lines[0].unit_price, 12.35)
})

Deno.test('TVA : 0 hors régime assujetti, taux invalide remplacé par le taux par défaut', () => {
  const lines = [{ kind: 'item', description: 'A', product_id: null, quantity: 1, unit: 'u', unit_price: 10, vat_rate: 19.6 }]
  assertEquals(sanitizeProposal({ lines }, [], assujetti).lines[0].vat_rate, 20)
  assertEquals(sanitizeProposal({ lines }, [], { vat_regime: 'non_applicable_dom', default_vat_rate: 0 }).lines[0].vat_rate, 0)
  assertEquals(sanitizeProposal({ lines: [{ ...lines[0], product_id: 'p1' }] }, catalog, { vat_regime: 'franchise', default_vat_rate: 0 }).lines[0].vat_rate, 0)
})

Deno.test('bornes et nettoyage : quantités, prix négatifs, lignes vides, sections', () => {
  const r = sanitizeProposal({
    title: '  Rénovation  ',
    lines: [
      { kind: 'section', description: 'Salle de bain', unit_price: 50 },
      { kind: 'item', description: '   ', unit_price: 10 },
      { kind: 'item', description: 'Négatif', quantity: -3, unit_price: -40, vat_rate: 20 },
      { kind: 'bizarre', description: 'Type inconnu', quantity: 'abc', unit_price: 5, vat_rate: 20 },
    ],
    assumptions: ['Surface 6 m²', ''],
    questions: ['a', 'b', 'c', 'd', 'e'],
  }, catalog, assujetti)
  assertEquals(r.title, 'Rénovation')
  assertEquals(r.lines.length, 3)
  assertEquals(r.lines[0], { kind: 'section', description: 'Salle de bain', product_id: null, quantity: 1, unit: 'unité', unit_price: 0, vat_rate: 0, is_estimate: false })
  assertEquals([r.lines[1].quantity, r.lines[1].unit_price], [1, 0])
  assertEquals([r.lines[2].kind, r.lines[2].quantity], ['item', 1])
  assertEquals(r.assumptions, ['Surface 6 m²'])
  assertEquals(r.questions.length, 4)
})

Deno.test('réponse malformée : résultat vide sans exception', () => {
  assertEquals(sanitizeProposal(null, catalog, assujetti), { title: '', intro: '', lines: [], assumptions: [], questions: [] })
  assertEquals(sanitizeProposal({ lines: 'pas un tableau' }, catalog, assujetti).lines, [])
})
