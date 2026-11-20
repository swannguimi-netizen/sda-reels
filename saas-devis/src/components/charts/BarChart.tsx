import { useId, useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'

export interface BarDatum { key: string; label: string; fullLabel: string; value: number }

const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })

/** Graduations « rondes » : 0, pas, 2×pas… couvrant le maximum (3 à 5 lignes). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
  const ticks = []
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

/**
 * Histogramme à une série (pas de légende : le titre la nomme).
 * Barres ≤ 24 px, extrémité arrondie, base carrée ; grille discrète ; seule la dernière valeur est étiquetée ;
 * infobulle au survol et au clavier ; vue tableau équivalente.
 */
export function BarChart({ data, format, height = 180, title }: {
  data: BarDatum[]
  format: (v: number) => string
  height?: number
  title: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()
  const ticks = useMemo(() => niceTicks(Math.max(...data.map((d) => d.value), 0)), [data])
  const top = ticks[ticks.length - 1]
  const last = data.length - 1
  const axis = (v: number) => (top >= 10_000 ? compact.format(v) : v.toLocaleString('fr-FR'))

  return (
    <div className="pt-3">
      <div className="flex" style={{ height }}>
        {/* Axe des valeurs */}
        <div className="relative w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-400" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-2 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>{axis(t)}</span>
          ))}
        </div>
        {/* Zone de tracé */}
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div key={t} className={`absolute inset-x-0 h-px ${t === 0 ? 'bg-slate-300' : 'bg-slate-100'}`} style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end justify-around" role="list" aria-label={title}>
            {data.map((d, i) => {
              const h = top ? (d.value / top) * 100 : 0
              const isActive = active === i
              return (
                <div key={d.key} role="listitem" className="relative flex h-full flex-1 items-end justify-center">
                  {/* Cible de survol : toute la colonne, plus large que la barre */}
                  <button type="button" className="absolute inset-0 cursor-default rounded-md focus-visible:outline-2 focus-visible:outline-brand-500"
                    aria-label={`${d.fullLabel} : ${format(d.value)}`}
                    onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
                  {d.value > 0 && (
                    <div className={`pointer-events-none w-full max-w-6 rounded-t transition-colors ${isActive ? 'bg-brand-500' : 'bg-brand-600'}`}
                      style={{ height: `${h}%` }} />
                  )}
                  {/* Étiquette directe : dernière période seulement */}
                  {i === last && !isActive && d.value > 0 && (
                    <span className="pointer-events-none absolute whitespace-nowrap text-xs font-semibold text-slate-900" style={{ bottom: `calc(${h}% + 4px)` }}>
                      {format(d.value)}
                    </span>
                  )}
                  {isActive && (
                    <div role="tooltip" className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
                      style={{ bottom: `calc(${h}% + 8px)` }}>
                      <span className="block text-slate-300">{d.fullLabel}</span>
                      <span className="font-semibold">{format(d.value)}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {/* Libellés de l'axe des périodes */}
      <div className="ml-12 flex justify-around pt-2 text-xs text-slate-500" aria-hidden>
        {data.map((d, i) => <span key={d.key} className={`flex-1 text-center ${i === last ? 'font-semibold text-slate-700' : ''}`}>{d.label}</span>)}
      </div>

      <button type="button" className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
        aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable(!showTable)}>
        <Table2 className="h-3.5 w-3.5" /> {showTable ? 'Masquer le tableau' : 'Voir le tableau'}
      </button>
      <table id={tableId} className={showTable ? 'mt-2 w-full text-sm' : 'sr-only'}>
        <caption className="sr-only">{title}</caption>
        <tbody className="divide-y divide-slate-100">
          {data.map((d) => (
            <tr key={d.key}><th scope="row" className="py-1 text-left font-normal text-slate-600">{d.fullLabel}</th>
              <td className="py-1 text-right tabular-nums text-slate-900">{format(d.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Série mensuelle « AAAA-MM » → libellés courts (« nov. ») et complets (« novembre 2026 »). */
export function monthlyData(rows: Array<{ month: string; value: number }>): BarDatum[] {
  return rows.map(({ month, value }) => {
    const d = new Date(`${month}-01T12:00:00`)
    return {
      key: month,
      label: d.toLocaleDateString('fr-FR', { month: 'short' }),
      fullLabel: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      value: Number(value),
    }
  })
}
