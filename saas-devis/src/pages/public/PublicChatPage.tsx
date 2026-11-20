import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { widgetApiUrl } from '../../lib/assistant'

/** Page de discussion autonome (lien de bio, QR code) : le widget en plein écran. */
export default function PublicChatPage() {
  const { key } = useParams()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!key || !/^[0-9a-f-]{36}$/i.test(key)) return
    document.title = 'Discussion'
    const s = document.createElement('script')
    s.src = '/widget.js'
    s.async = true
    s.dataset.key = key
    s.dataset.api = widgetApiUrl()
    s.dataset.inline = '#chat-root'
    document.body.appendChild(s)
    const el = ref.current
    return () => { s.remove(); if (el) el.innerHTML = '' }
  }, [key])
  return (
    <div className="flex min-h-[100dvh] items-stretch justify-center bg-slate-100 sm:items-center sm:p-6">
      <div id="chat-root" ref={ref} className="h-[100dvh] w-full max-w-lg sm:h-[min(720px,90dvh)]" />
    </div>
  )
}
