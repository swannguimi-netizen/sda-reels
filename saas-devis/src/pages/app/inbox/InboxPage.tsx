import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Archive, ArchiveRestore, ArrowLeft, Bot, FileText, Globe, Hand, Inbox, Mail, Phone, Send, Sparkles, User, UserCheck,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { EmptyState, Spinner } from '../../../components/ui'
import { type ChatMessage, type Conversation, LEAD_STATUS, relativeTime, visitorLabel } from '../../../lib/inbox'
import { dbError } from '../../../lib/format'

type Filter = 'all' | 'unread' | 'human' | 'quotes' | 'closed'
const FILTERS: Array<[Filter, string]> = [
  ['all', 'Toutes'], ['unread', 'Non lues'], ['human', 'À traiter'], ['quotes', 'Demandes de devis'], ['closed', 'Archivées'],
]

const SELECT = '*, lead:leads!conversations_lead_id_company_id_fkey(id, name, email, phone, need, details, urgency, status, is_quote_request, client_id)'

function matches(c: Conversation, f: Filter) {
  if (f === 'closed') return c.status === 'closed'
  if (c.status === 'closed') return false
  if (f === 'unread') return c.unread
  if (f === 'human') return c.mode === 'human'
  if (f === 'quotes') return !!c.lead?.is_quote_request
  return true
}

export default function InboxPage() {
  const { company } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const selectedId = params.get('c')
  const companyId = company?.id

  const loadList = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase.from('conversations').select(SELECT)
      .eq('company_id', companyId).order('last_message_at', { ascending: false }).limit(200)
    if (error) toast('error', dbError(error) ?? 'Erreur')
    setConversations((data as unknown as Conversation[]) ?? [])
  }, [companyId, toast])

  useEffect(() => { loadList() }, [loadList])

  // Temps réel : nouvelles conversations et nouveaux messages
  useEffect(() => {
    if (!companyId) return
    const channel = supabase.channel(`inbox-${companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `company_id=eq.${companyId}` }, () => loadList())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `company_id=eq.${companyId}` }, () => loadList())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [companyId, loadList])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (conversations ?? []).filter((c) => matches(c, filter) && (!q || [c.contact_name, c.contact_email, c.contact_phone, c.last_message_preview, c.lead?.need]
      .some((v) => v?.toLowerCase().includes(q))))
  }, [conversations, filter, search])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([f]) => [f, (conversations ?? []).filter((c) => matches(c, f)).length])), [conversations])
  const selected = conversations?.find((c) => c.id === selectedId) ?? null
  const select = (id: string | null) => setParams(id ? { c: id } : {}, { replace: false })

  if (conversations === null) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7 text-brand-600" /></div>

  if (conversations.length === 0) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">Boîte de réception</h1>
        <EmptyState icon={Inbox} title="Aucune conversation pour l’instant"
          text="Installez l’assistant sur votre site ou partagez votre lien de discussion : les échanges avec vos visiteurs arriveront ici, en direct."
          action={<Link to="/assistant" className="btn-primary"><Sparkles className="h-4 w-4" /> Configurer l’assistant</Link>} />
      </>
    )
  }

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-white sm:-mx-6 lg:-mx-8 lg:-my-8 lg:h-dvh">
      {/* Liste */}
      <div className={`flex w-full flex-col border-r border-slate-200 md:w-80 lg:w-96 ${selected ? 'hidden md:flex' : 'flex'}`}>
        <div className="space-y-3 border-b border-slate-200 p-4">
          <h1 className="text-xl font-bold text-slate-900">Boîte de réception</h1>
          <input type="search" className="input" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher une conversation" />
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {FILTERS.map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${filter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {label}{counts[f] ? ` · ${counts[f]}` : ''}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {visible.map((c) => (
            <li key={c.id}>
              <button onClick={() => select(c.id)}
                className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${c.id === selectedId ? 'bg-brand-50/60' : ''}`}>
                <Avatar c={c} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${c.unread ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{visitorLabel(c)}</p>
                    <span className="shrink-0 text-xs text-slate-400">{relativeTime(c.last_message_at)}</span>
                  </div>
                  <p className={`truncate text-sm ${c.unread ? 'text-slate-800' : 'text-slate-500'}`}>{c.last_message_preview ?? '…'}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.lead?.is_quote_request && <Tag cls="bg-amber-100 text-amber-800"><FileText className="h-3 w-3" />Devis</Tag>}
                    {c.mode === 'human' && c.status === 'open' && <Tag cls="bg-red-100 text-red-700"><Hand className="h-3 w-3" />À traiter</Tag>}
                    {c.lead?.urgency === 'urgente' && <Tag cls="bg-red-600 text-white">Urgent</Tag>}
                    {c.page_url?.startsWith(window.location.origin + '/assistant') && <Tag cls="bg-slate-100 text-slate-500">Test</Tag>}
                  </div>
                </div>
                {c.unread && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" aria-label="Non lu" />}
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">Aucune conversation.</li>}
        </ul>
      </div>

      {/* Conversation */}
      <div className={`min-w-0 flex-1 ${selected ? 'flex' : 'hidden md:flex'}`}>
        {selected
          ? <ConversationView key={selected.id} conversation={selected} onBack={() => select(null)} onChanged={loadList} />
          : <div className="m-auto text-center text-sm text-slate-400"><Inbox className="mx-auto mb-2 h-8 w-8" />Sélectionnez une conversation</div>}
      </div>
    </div>
  )
}

function Tag({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

function Avatar({ c }: { c: Conversation }) {
  const named = c.contact_name || c.contact_email
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${named ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'}`}>
      {named ? visitorLabel(c).slice(0, 1).toUpperCase() : <User className="h-4 w-4" />}
    </span>
  )
}

// ---------------------------------------------------------------------
function ConversationView({ conversation: c, onBack, onChanged }: { conversation: Conversation; onBack: () => void; onChanged: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('messages').select('*').eq('conversation_id', c.id).order('created_at').then(({ data }) => setMessages((data as ChatMessage[]) ?? []))
    if (c.unread) supabase.from('conversations').update({ unread: false }).eq('id', c.id).then(() => onChanged())
    const channel = supabase.channel(`conv-${c.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${c.id}` }, (payload) => {
        setMessages((m) => (m && !m.some((x) => x.id === payload.new.id) ? [...m, payload.new as ChatMessage] : m))
        supabase.from('conversations').update({ unread: false }).eq('id', c.id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const content = text.trim()
    if (!content) return
    setSending(true)
    const { data, error } = await supabase.from('messages')
      .insert({ conversation_id: c.id, company_id: c.company_id, role: 'agent', content }).select().single()
    setSending(false)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    setText('')
    setMessages((m) => (m && !m.some((x) => x.id === data.id) ? [...m, data as ChatMessage] : m))
    onChanged()
  }

  async function update(patch: Partial<Conversation>, msg: string) {
    const { error } = await supabase.from('conversations').update(patch).eq('id', c.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    toast('success', msg)
    onChanged()
  }

  /** Prospect → client → nouveau devis, avec le besoin pré-rempli dans le panneau IA. */
  async function createQuote() {
    setBusy(true)
    try {
      let leadId = c.lead?.id ?? null
      if (!leadId) {
        if (!c.contact_name && !c.contact_email && !c.contact_phone) throw new Error('Ajoutez au moins un nom, un email ou un téléphone pour ce contact.')
        const need = (messages ?? []).filter((m) => m.role === 'visitor').map((m) => m.content).join(' ').slice(0, 300)
        const { data, error } = await supabase.from('leads').insert({
          company_id: c.company_id, conversation_id: c.id, name: c.contact_name, email: c.contact_email, phone: c.contact_phone,
          need: need || null, source: c.channel,
        }).select('id').single()
        if (error) throw error
        leadId = data.id
        await supabase.from('conversations').update({ lead_id: leadId }).eq('id', c.id)
      }
      const { data: clientId, error } = await supabase.rpc('convert_lead_to_client', { p_lead_id: leadId })
      if (error) throw error
      const besoin = [c.lead?.need, c.lead?.details].filter(Boolean).join('. ')
      const qs = new URLSearchParams({ client: clientId as string, lead: leadId! })
      if (besoin) qs.set('besoin', besoin)
      navigate(`/devis/nouveau?${qs}`)
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button onClick={onBack} className="rounded-md p-1 text-slate-500 md:hidden" aria-label="Retour"><ArrowLeft className="h-5 w-5" /></button>
          <Avatar c={c} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-900">{visitorLabel(c)}</p>
            <p className="flex items-center gap-1 truncate text-xs text-slate-500">
              {c.mode === 'ai' ? <><Bot className="h-3.5 w-3.5 text-emerald-600" /> L’assistant répond</> : <><UserCheck className="h-3.5 w-3.5 text-brand-600" /> Vous avez la main</>}
            </p>
          </div>
          {c.mode === 'ai'
            ? <button className="btn-secondary px-3 py-1.5" onClick={() => update({ mode: 'human' }, 'Vous avez repris la main')}><Hand className="h-4 w-4" /> <span className="hidden sm:inline">Reprendre la main</span></button>
            : <button className="btn-secondary px-3 py-1.5" onClick={() => update({ mode: 'ai' }, 'L’assistant répond de nouveau')}><Bot className="h-4 w-4" /> <span className="hidden sm:inline">Rendre à l’assistant</span></button>}
          {c.status === 'open'
            ? <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Archiver" aria-label="Archiver" onClick={() => update({ status: 'closed', unread: false }, 'Conversation archivée')}><Archive className="h-4 w-4" /></button>
            : <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Rouvrir" aria-label="Rouvrir" onClick={() => update({ status: 'open' }, 'Conversation rouverte')}><ArchiveRestore className="h-4 w-4" /></button>}
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-5">
          {messages === null ? <div className="flex justify-center"><Spinner className="h-6 w-6 text-slate-400" /></div> : messages.map((m) => <Bubble key={m.id} m={m} />)}
          <div ref={bottom} />
        </div>

        <form onSubmit={send} className="border-t border-slate-200 bg-white p-3">
          {c.mode === 'ai' && <p className="mb-2 text-xs text-slate-500">En répondant, vous reprenez la main : l’assistant ne répondra plus dans cette conversation.</p>}
          <div className="flex items-end gap-2">
            <textarea rows={2} className="input resize-none" placeholder="Votre réponse…" value={text} aria-label="Votre réponse"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button className="btn-primary h-10" disabled={sending || !text.trim()} aria-label="Envoyer">{sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}</button>
          </div>
        </form>
      </div>

      {/* Fiche contact */}
      <aside className="hidden w-72 shrink-0 space-y-5 overflow-y-auto border-l border-slate-200 p-5 xl:block">
        <ContactCard c={c} onChanged={onChanged} />
        {c.lead?.need && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{c.lead.is_quote_request ? 'Demande de devis' : 'Besoin'}</h3>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{c.lead.need}</p>
              {c.lead.details && <p className="mt-1 whitespace-pre-line text-slate-600">{c.lead.details}</p>}
              {c.lead.urgency && c.lead.urgency !== 'normale' && <p className="mt-2 text-xs font-semibold uppercase text-red-600">Urgence : {c.lead.urgency}</p>}
            </div>
            <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LEAD_STATUS[c.lead.status].cls}`}>{LEAD_STATUS[c.lead.status].label}</span>
          </section>
        )}
        <button className="btn-primary w-full" onClick={createQuote} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />} Créer le devis
        </button>
        {c.page_url && (
          <p className="flex items-start gap-1.5 break-all text-xs text-slate-500"><Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {c.page_url}</p>
        )}
        <p className="text-xs text-slate-400">Conversation démarrée le {new Date(c.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
      </aside>
    </div>
  )
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'system') return <p className="text-center text-xs text-slate-400">{m.content}</p>
  const visitor = m.role === 'visitor'
  return (
    <div className={`flex ${visitor ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[80%]">
        <p className={`mb-0.5 flex items-center gap-1 text-[11px] text-slate-400 ${visitor ? '' : 'justify-end'}`}>
          {m.role === 'assistant' && <><Bot className="h-3 w-3" /> Assistant ·</>}
          {m.role === 'agent' && <><UserCheck className="h-3 w-3" /> Vous ·</>}
          {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <div className={`whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm ${
          visitor ? 'rounded-bl-sm border border-slate-200 bg-white text-slate-900'
            : m.role === 'agent' ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-br-sm bg-brand-100 text-brand-950'}`}>
          {m.content}
        </div>
      </div>
    </div>
  )
}

function ContactCard({ c, onChanged }: { c: Conversation; onChanged: () => void }) {
  const toast = useToast()
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ contact_name: c.contact_name ?? '', contact_email: c.contact_email ?? '', contact_phone: c.contact_phone ?? '' })

  async function save() {
    const patch = { contact_name: f.contact_name.trim() || null, contact_email: f.contact_email.trim().toLowerCase() || null, contact_phone: f.contact_phone.trim() || null }
    const { error } = await supabase.from('conversations').update(patch).eq('id', c.id)
    if (error) return toast('error', dbError(error) ?? 'Erreur')
    if (c.lead) await supabase.from('leads').update({ name: patch.contact_name, email: patch.contact_email, phone: patch.contact_phone }).eq('id', c.lead.id)
    setEdit(false)
    onChanged()
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contact</h3>
        <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => (edit ? save() : setEdit(true))}>{edit ? 'Enregistrer' : 'Modifier'}</button>
      </div>
      {edit ? (
        <div className="space-y-2">
          <input className="input" placeholder="Nom" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} aria-label="Nom" />
          <input className="input" placeholder="Email" type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} aria-label="Email" />
          <input className="input" placeholder="Téléphone" type="tel" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} aria-label="Téléphone" />
        </div>
      ) : (
        <div className="space-y-1.5 text-sm">
          <p className="font-medium text-slate-900">{c.contact_name ?? <span className="text-slate-400">Nom inconnu</span>}</p>
          {c.contact_email ? <a href={`mailto:${c.contact_email}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-600"><Mail className="h-3.5 w-3.5" />{c.contact_email}</a> : null}
          {c.contact_phone ? <a href={`tel:${c.contact_phone}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-600"><Phone className="h-3.5 w-3.5" />{c.contact_phone}</a> : null}
          {!c.contact_email && !c.contact_phone && <p className="text-xs text-slate-400">Pas encore de coordonnées.</p>}
          {c.lead?.client_id && <Link to="/clients" className="inline-block text-xs font-medium text-brand-600 hover:underline">Fiche client créée →</Link>}
        </div>
      )}
    </section>
  )
}
