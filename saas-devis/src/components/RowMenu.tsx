import { useState } from 'react'
import type React from 'react'
import { MoreHorizontal } from 'lucide-react'

export function RowMenu({ items }: {
  items: Array<{ label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; danger?: boolean }>
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Actions">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {items.map(({ label, icon: Icon, onClick, danger }) => (
            <button key={label} onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); onClick() }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${danger ? 'text-red-600' : 'text-slate-700'}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
