import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, MessageSquare, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { logoUrl } from '../../lib/format'
import { Spinner } from '../../components/ui'

interface Page { first_name: string | null; company_name: string; logo_path: string | null; brand_color: string; google_review_url: string; feedback_sent: boolean }

/**
 * Page d'avis envoyée au client. Conforme aux règles de Google : le bouton vers la fiche Google est proposé à TOUS
 * les clients, sans note préalable ni tri. La remarque privée est une option supplémentaire.
 */
export default function ReviewPage() {
  const { token } = useParams()
  const [page, setPage] = useState<Page | null | undefined>(undefined)
  const [going, setGoing] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return setPage(null)
    supabase.rpc('get_review_page', { p_token: token }).then(({ data }) => setPage((data as Page) ?? null))
  }, [token])

  if (page === undefined) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-8 w-8 text-slate-400" /></div>
  if (page === null) return <div className="flex min-h-screen items-center justify-center p-6 text-center text-slate-500">Ce lien n’est plus valide.</div>

  async function goToGoogle() {
    setGoing(true)
    const { data } = await supabase.rpc('record_review_click', { p_token: token })
    window.location.href = (data as string | null) ?? page!.google_review_url
  }

  async function sendFeedback() {
    setError(null)
    const { error } = await supabase.rpc('submit_review_feedback', { p_token: token, p_feedback: feedback })
    if (error) return setError(error.message)
    setSent(true)
  }

  const logo = logoUrl(page.logo_path)
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        {logo ? <img src={logo} alt={page.company_name} className="mx-auto mb-4 max-h-14 max-w-[180px] object-contain" />
          : <p className="mb-4 text-xl font-bold" style={{ color: page.brand_color }}>{page.company_name}</p>}
        <h1 className="text-2xl font-bold text-slate-900">Merci{page.first_name ? ` ${page.first_name}` : ''} !</h1>
        <p className="mt-2 text-slate-600">Votre avis aide {page.company_name} à se faire connaître. Il ne prend qu’une minute.</p>
        <div className="my-6 flex justify-center gap-1" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-8 w-8 fill-amber-400 text-amber-400" />)}</div>
        <button onClick={goToGoogle} disabled={going} className="btn w-full py-3 text-base text-white" style={{ backgroundColor: page.brand_color }}>
          {going ? <Spinner className="h-5 w-5" /> : null} Laisser un avis sur Google
        </button>

        <div className="mt-6 border-t border-slate-100 pt-5">
          {sent || page.feedback_sent ? (
            <p className="flex items-center justify-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Merci, votre message a été transmis à {page.company_name}.</p>
          ) : feedbackOpen ? (
            <div className="space-y-3 text-left">
              <label className="label" htmlFor="fb">Votre message à {page.company_name}</label>
              <textarea id="fb" rows={4} className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Une suggestion, une remarque…" />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button className="btn-secondary w-full" onClick={sendFeedback} disabled={feedback.trim().length < 3}>Envoyer</button>
              <p className="text-xs text-slate-400">Ce message est transmis uniquement à l’entreprise. Vous pouvez aussi laisser un avis sur Google.</p>
            </div>
          ) : (
            <button className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800" onClick={() => setFeedbackOpen(true)}>
              <MessageSquare className="h-4 w-4" /> Envoyer aussi un message à l’entreprise
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
