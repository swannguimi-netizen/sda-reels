// Calcul des créneaux libres (pur, testé). Aucune dépendance : fuseaux via Intl.

export interface Rule { weekday: number; start_time: string; end_time: string; slot_minutes: number } // weekday : 0 = dimanche
export interface Interval { start: Date; end: Date }
export interface Slot { start: Date; end: Date }

const partsFmt = new Map<string, Intl.DateTimeFormat>()
function fmt(timeZone: string) {
  let f = partsFmt.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })
    partsFmt.set(timeZone, f)
  }
  return f
}

/** Date et heure « murales » d'un instant dans un fuseau. */
export function localParts(date: Date, timeZone: string) {
  const p = Object.fromEntries(fmt(timeZone).formatToParts(date).map((x) => [x.type, x.value]))
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: weekdays.indexOf(p.weekday) }
}

function offsetMs(date: Date, timeZone: string) {
  const p = localParts(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000
}

/** Heure locale (dans le fuseau) → instant UTC, changements d'heure compris. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const o1 = offsetMs(new Date(guess), timeZone)
  let result = guess - o1
  const o2 = offsetMs(new Date(result), timeZone)
  if (o2 !== o1) result = guess - o2
  return new Date(result)
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end

export function generateSlots(p: {
  rules: Rule[]
  timeZone: string
  now: Date
  horizonDays: number
  minNoticeHours: number
  busy: Interval[]
  from?: Date        // début de la recherche (défaut : maintenant)
  to?: Date          // fin de la recherche (défaut : horizon)
  max?: number
}): Slot[] {
  const earliest = new Date(Math.max(p.now.getTime() + p.minNoticeHours * 3_600_000, (p.from ?? p.now).getTime()))
  const horizon = new Date(p.now.getTime() + p.horizonDays * 86_400_000)
  const latest = p.to && p.to < horizon ? p.to : horizon
  const out: Slot[] = []
  const today = localParts(p.now, p.timeZone)

  for (let i = 0; i <= p.horizonDays; i++) {
    // Jour local i (midi UTC du jour civil pour éviter les effets de bord)
    const civil = new Date(Date.UTC(today.year, today.month - 1, today.day + i, 12))
    const y = civil.getUTCFullYear(), m = civil.getUTCMonth() + 1, d = civil.getUTCDate(), wd = civil.getUTCDay()
    for (const r of p.rules.filter((x) => x.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time))) {
      const [sh, sm] = r.start_time.split(':').map(Number)
      const [eh, em] = r.end_time.split(':').map(Number)
      for (let t = sh * 60 + sm; t + r.slot_minutes <= eh * 60 + em; t += r.slot_minutes) {
        const start = zonedToUtc(y, m, d, Math.floor(t / 60), t % 60, p.timeZone)
        const end = new Date(start.getTime() + r.slot_minutes * 60_000)
        if (start < earliest || end > latest) continue
        if (p.busy.some((b) => overlaps({ start, end }, b))) continue
        out.push({ start, end })
        if (p.max && out.length >= p.max) return out
      }
    }
  }
  return out
}

/** « jeudi 26 novembre à 09:00 » dans le fuseau de l'entreprise. */
export function slotLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    .format(date)
}

export function nowLabel(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(now)
}
