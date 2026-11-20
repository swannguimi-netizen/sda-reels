import type React from 'react'
import { useEffect, useState } from 'react'
import { parseNumber } from '../lib/format'

/** Champ numérique acceptant la virgule française ; garde la saisie brute pendant l'édition. */
export function NumberInput({ value, onChange, className = 'input', min, max, ...rest }: {
  value: number
  onChange: (n: number) => void
  className?: string
  min?: number
  max?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max'>) {
  const fmt = (n: number) => (Number.isFinite(n) ? String(n).replace('.', ',') : '')
  const [raw, setRaw] = useState(fmt(value))
  useEffect(() => {
    if (parseNumber(raw) !== value) setRaw(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  return (
    <input {...rest} inputMode="decimal" className={className} value={raw}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d,.\-\s]/g, '')
        setRaw(v)
        onChange(clamp(parseNumber(v)))
      }}
      onBlur={() => setRaw(fmt(clamp(parseNumber(raw))))} />
  )
}
