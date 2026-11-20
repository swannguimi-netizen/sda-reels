/** Contrôle de clé (Luhn) d'un SIRET, avec l'exception La Poste (SIREN 356000000). */
export function isValidSiret(raw: string): boolean {
  const s = raw.replace(/\s/g, '')
  if (!/^\d{14}$/.test(s)) return false
  if (s.startsWith('356000000')) {
    return [...s].reduce((sum, c) => sum + Number(c), 0) % 5 === 0
  }
  let sum = 0
  for (let i = 0; i < 14; i++) {
    let d = Number(s[13 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

export const formatSiret = (s: string | null | undefined) =>
  (s ?? '').replace(/\s/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, '$1 $2 $3 $4')

export function isValidIban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rem = 0
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97
  return rem === 1
}

export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
