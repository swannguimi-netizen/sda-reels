import { supabase } from './supabase'

const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
export const eur = (n: number | null | undefined) => eurFmt.format(Number(n ?? 0))

export const pct = (n: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)} %`

export const dateFr = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/** URL publique du logo (bucket public `logos`). */
export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from('logos').getPublicUrl(path).data.publicUrl
}

/** Parse un nombre saisi à la française (« 1 234,50 »). */
export function parseNumber(v: string): number {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Messages d'erreur Postgres → français lisible. */
export function dbError(err: { message: string; code?: string } | null): string | null {
  if (!err) return null
  if (err.code === '23503') return 'Cet élément est utilisé ailleurs (devis, facture…) et ne peut pas être supprimé.'
  if (err.code === '23505') return 'Cet élément existe déjà.'
  if (err.code === '23514') return 'Une valeur saisie est invalide.'
  if (err.code === '42501' && /row-level security/.test(err.message) && /quotes|invoices/.test(err.message)) {
    return 'Création impossible : votre essai est terminé ou votre abonnement est inactif (menu Abonnement).'
  }
  if (err.code === '42501') return 'Vous n’avez pas les droits pour cette action.'
  return err.message
}
