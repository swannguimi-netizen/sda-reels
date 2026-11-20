import { supabase } from './supabase'
import type { CompanyDetails, Product } from './types'

export type KnowledgeCategory = 'horaires' | 'services' | 'tarifs' | 'zone' | 'faq' | 'autre'

export interface KnowledgeEntry {
  id: string
  company_id: string
  category: KnowledgeCategory
  title: string
  content: string
  position: number
  is_active: boolean
}

export interface AssistantSettings {
  company_id: string
  is_enabled: boolean
  assistant_name: string
  welcome_message: string
  tone: string
  instructions: string | null
  primary_color: string | null
  position: 'left' | 'right'
  collect_contact: boolean
  can_create_quote_requests: boolean
  allowed_domains: string[]
  notify_email: string | null
}

export const CATEGORIES: Record<KnowledgeCategory, { label: string; hint: string; emoji: string }> = {
  horaires: { label: 'Horaires', hint: 'Jours et heures d’ouverture, astreintes, congés', emoji: '🕘' },
  services: { label: 'Services', hint: 'Ce que vous faites (et ne faites pas)', emoji: '🛠️' },
  tarifs: { label: 'Tarifs', hint: 'Prix indicatifs, déplacement, devis gratuit…', emoji: '💶' },
  zone: { label: 'Zone d’intervention', hint: 'Communes desservies, frais de déplacement', emoji: '📍' },
  faq: { label: 'Questions fréquentes', hint: 'Délais, garanties, paiement, aides…', emoji: '💬' },
  autre: { label: 'Autres informations', hint: 'Tout ce qui peut aider l’assistant', emoji: '📎' },
}

export const widgetApiUrl = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/widget-chat`

export function embedSnippet(key: string) {
  return `<script src="${window.location.origin}/widget.js" charset="utf-8" data-key="${key}" data-api="${widgetApiUrl()}" async></script>`
}

export const publicChatUrl = (key: string) => `${window.location.origin}/chat/${key}`

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)

/**
 * Propose des fiches de départ à partir du profil, des disponibilités et du catalogue
 * (sans IA : instantané et gratuit). Le dirigeant relit et complète ensuite.
 */
export async function buildStarterEntries(company: CompanyDetails): Promise<Array<Pick<KnowledgeEntry, 'category' | 'title' | 'content'>>> {
  const [{ data: rules }, { data: products }] = await Promise.all([
    supabase.from('availability_rules').select('weekday, start_time, end_time').eq('company_id', company.id).order('weekday').order('start_time'),
    supabase.from('products').select('*').eq('company_id', company.id).eq('is_active', true).order('category').order('name'),
  ])
  const out: Array<Pick<KnowledgeEntry, 'category' | 'title' | 'content'>> = []

  if (rules?.length) {
    const byDay = new Map<number, string[]>()
    for (const r of rules) byDay.set(r.weekday, [...(byDay.get(r.weekday) ?? []), `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`])
    const lines = [1, 2, 3, 4, 5, 6, 0].map((d) => `${DAYS[d]} : ${byDay.get(d)?.join(', ') ?? 'fermé'}`)
    out.push({ category: 'horaires', title: 'Horaires d’ouverture', content: lines.join('\n') })
  }

  const prods = (products ?? []) as Product[]
  if (prods.length) {
    const cats = new Map<string, string[]>()
    for (const p of prods) cats.set(p.category ?? 'Prestations', [...(cats.get(p.category ?? 'Prestations') ?? []), p.name])
    out.push({
      category: 'services', title: 'Nos prestations',
      content: [...cats.entries()].map(([c, names]) => `${c} : ${names.slice(0, 12).join(', ')}`).join('\n'),
    })
    const vat = company.vat_regime === 'assujetti'
    out.push({
      category: 'tarifs', title: 'Tarifs indicatifs',
      content: prods.slice(0, 25).map((p) => `${p.name} : ${eur(Number(p.unit_price) * (vat ? 1 + Number(p.vat_rate) / 100 : 1))} ${vat ? 'TTC' : ''} / ${p.unit}`.replace(/\s+\//, ' /')).join('\n')
        + '\nCes prix sont indicatifs : chaque chantier fait l’objet d’un devis personnalisé.',
    })
  }

  if (company.city) {
    out.push({ category: 'zone', title: 'Zone d’intervention', content: `Nous intervenons à ${company.city} et dans les communes alentour. Précisez votre commune pour confirmer.` })
  }

  out.push(
    { category: 'faq', title: 'Le devis est-il gratuit ?', content: 'Oui, nos devis sont gratuits et sans engagement.' },
    { category: 'faq', title: 'Comment accepter un devis ?', content: 'Vous recevez votre devis par email avec un lien : vous pouvez le consulter et le signer en ligne en quelques secondes.' },
  )
  if (Number(company.deposit_percent) > 0) {
    out.push({ category: 'faq', title: 'Faut-il verser un acompte ?', content: `Un acompte de ${company.deposit_percent} % est demandé à la signature du devis, le solde à la fin de la prestation.` })
  }
  return out
}
