import { assert, assertEquals } from 'jsr:@std/assert@1'
import { generateSlots, localParts, slotLabel, zonedToUtc } from './slots.ts'

const iso = (d: Date) => d.toISOString()
const weekdays = [1, 2, 3, 4, 5].flatMap((wd) => [
  { weekday: wd, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 60 },
  { weekday: wd, start_time: '14:00:00', end_time: '18:00:00', slot_minutes: 60 },
])

Deno.test('fuseaux : Cayenne UTC-3, Paris hiver UTC+1 / été UTC+2, Réunion UTC+4', () => {
  assertEquals(iso(zonedToUtc(2026, 11, 26, 9, 0, 'America/Cayenne')), '2026-11-26T12:00:00.000Z')
  assertEquals(iso(zonedToUtc(2026, 11, 26, 9, 0, 'Europe/Paris')), '2026-11-26T08:00:00.000Z')
  assertEquals(iso(zonedToUtc(2026, 7, 2, 9, 0, 'Europe/Paris')), '2026-07-02T07:00:00.000Z')
  assertEquals(iso(zonedToUtc(2026, 11, 26, 9, 0, 'Indian/Reunion')), '2026-11-26T05:00:00.000Z')
})

Deno.test('passage à l’heure d’été (Paris, 29 mars 2026) : 9 h reste 9 h', () => {
  assertEquals(iso(zonedToUtc(2026, 3, 30, 9, 0, 'Europe/Paris')), '2026-03-30T07:00:00.000Z')
  assertEquals(iso(zonedToUtc(2026, 3, 27, 9, 0, 'Europe/Paris')), '2026-03-27T08:00:00.000Z')
})

Deno.test('créneaux : jours ouvrés, délai de prévenance, horizon', () => {
  // Vendredi 20 novembre 2026, 10:12 à Cayenne
  const now = new Date('2026-11-20T13:12:00Z')
  const slots = generateSlots({ rules: weekdays, timeZone: 'America/Cayenne', now, horizonDays: 4, minNoticeHours: 4, busy: [] })
  const local = slots.map((s) => { const p = localParts(s.start, 'America/Cayenne'); return `${p.day} ${String(p.hour).padStart(2, '0')}h` })
  // vendredi : 10:12 + 4 h = 14:12 → premier créneau 15 h ; week-end exclu ; lundi 23 et mardi 24 complets
  assertEquals(local.slice(0, 4), ['20 15h', '20 16h', '20 17h', '23 08h'])
  assert(!local.some((l) => l.startsWith('21') || l.startsWith('22')))
  assertEquals(local.filter((l) => l.startsWith('23')).length, 8)
  assert(slots.every((s) => s.start.getTime() <= now.getTime() + 4 * 86_400_000))
})

Deno.test('créneaux occupés (Google Agenda ou rendez-vous) exclus, plage de recherche', () => {
  const now = new Date('2026-11-20T13:12:00Z')
  const busy = [{ start: new Date('2026-11-23T11:30:00Z'), end: new Date('2026-11-23T13:30:00Z') }] // 08:30–10:30 à Cayenne
  const slots = generateSlots({
    rules: weekdays, timeZone: 'America/Cayenne', now, horizonDays: 10, minNoticeHours: 0, busy,
    from: new Date('2026-11-23T03:00:00Z'), to: new Date('2026-11-23T16:00:00Z'),
  })
  const hours = slots.map((s) => localParts(s.start, 'America/Cayenne').hour)
  assertEquals(hours, [11]) // 8 h, 9 h et 10 h chevauchent l'occupation (8 h 30 – 10 h 30) ; 13 h = fin de la recherche
})

Deno.test('libellé en français', () => {
  assertEquals(slotLabel(new Date('2026-11-26T12:00:00Z'), 'America/Cayenne'), 'jeudi 26 novembre à 09:00')
})
