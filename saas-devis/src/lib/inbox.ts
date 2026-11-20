export interface Conversation {
  id: string
  company_id: string
  channel: 'widget' | 'whatsapp' | 'instagram' | 'email'
  visitor_id: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  lead_id: string | null
  mode: 'ai' | 'human'
  status: 'open' | 'closed'
  unread: boolean
  page_url: string | null
  last_message_at: string
  last_message_preview: string | null
  created_at: string
  lead: Lead | null
}

export interface Lead {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  need: string | null
  details: string | null
  urgency: 'normale' | 'rapide' | 'urgente' | null
  status: 'new' | 'contacted' | 'quoted' | 'won' | 'lost'
  is_quote_request: boolean
  client_id: string | null
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'visitor' | 'assistant' | 'agent' | 'system'
  content: string
  author_id: string | null
  created_at: string
}

export const LEAD_STATUS: Record<Lead['status'], { label: string; cls: string }> = {
  new: { label: 'Nouveau', cls: 'bg-sky-100 text-sky-700' },
  contacted: { label: 'Contacté', cls: 'bg-indigo-100 text-indigo-700' },
  quoted: { label: 'Devis envoyé', cls: 'bg-amber-100 text-amber-700' },
  won: { label: 'Gagné', cls: 'bg-emerald-100 text-emerald-700' },
  lost: { label: 'Perdu', cls: 'bg-slate-100 text-slate-500' },
}

/** Libellé court d'un visiteur sans nom : « Visiteur #a3f9 ». */
export const visitorLabel = (c: Pick<Conversation, 'contact_name' | 'contact_email' | 'visitor_id'>) =>
  c.contact_name || c.contact_email || `Visiteur #${c.visitor_id.slice(-4)}`

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'à l’instant'
  if (diff < 3600) return `${Math.floor(diff / 60)} min`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`
  if (diff < 7 * 86400) return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short' })
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
