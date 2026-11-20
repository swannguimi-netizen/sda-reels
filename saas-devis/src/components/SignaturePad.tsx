import type React from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

export interface SignaturePadHandle {
  isEmpty: () => boolean
  toDataURL: () => string
  clear: () => void
}

/** Zone de signature (souris, doigt, stylet). Exporte un PNG à fond blanc. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  const setup = () => {
    const c = canvas.current!
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }

  useEffect(() => {
    setup()
  }, [])

  const mark = (v: boolean) => { setEmpty(v); onChange?.(v) }

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear: () => { setup(); mark(true) },
    toDataURL: () => {
      // Recadre sur fond blanc pour un rendu propre dans le PDF
      const src = canvas.current!
      const out = document.createElement('canvas')
      out.width = src.width
      out.height = src.height
      const ctx = out.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(src, 0, 0)
      const small = document.createElement('canvas')
      small.width = 600
      small.height = Math.round(600 * out.height / out.width)
      small.getContext('2d')!.drawImage(out, 0, 0, small.width, small.height)
      return small.toDataURL('image/png')
    },
  }))

  return (
    <div className="relative">
      <canvas ref={canvas} aria-label="Zone de signature"
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white"
        onPointerDown={(e) => { drawing.current = true; last.current = pos(e); canvas.current!.setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return
          const p = pos(e)
          const ctx = canvas.current!.getContext('2d')!
          ctx.beginPath()
          ctx.moveTo(last.current.x, last.current.y)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          last.current = p
          if (empty) mark(false)
        }}
        onPointerUp={() => { drawing.current = false; last.current = null }}
        onPointerLeave={() => { drawing.current = false; last.current = null }} />
      {empty
        ? <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Signez ici</span>
        : (
          <button type="button" onClick={() => { setup(); mark(true) }}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm hover:text-slate-900">
            <Eraser className="h-3.5 w-3.5" /> Effacer
          </button>
        )}
    </div>
  )
})
