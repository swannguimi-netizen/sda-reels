const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
export const eur = (n: number | null | undefined) => eurFmt.format(Number(n ?? 0)).replace(/ /g, ' ')
export const dateFr = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—')
export const parseNumber = (v: string) => { const n = Number(v.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
export function relative(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

/** « 3 heures », « 1 forfait » ; unités invariables (m², kg…) laissées telles quelles. */
export function unitLabel(qty: number, unit: string) {
  const n = String(qty).replace('.', ',')
  const plural = qty >= 2 && /^[a-zàâçéèêëîïôûùüÿœ]+$/i.test(unit) && !/[sxz]$/.test(unit) && unit !== 'unité' ? `${unit}s` : unit
  return unit === 'unité' ? n : `${n} ${plural}`
}
