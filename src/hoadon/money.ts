import type { InvoiceItem } from './types'

const eur = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const fmt = (n: number | null | undefined) => eur.format(Number(n ?? 0))
export const fmtEur = (n: number | null | undefined) => `${fmt(n)} €`

/** Parse German or English number input: "1.234,50" or "1234.50" */
export function parseNum(s: string): number {
  const t = s.trim()
  if (!t) return 0
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

export const fmtQty = (n: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(n)

export interface TaxGroup { rate: number; gross: number; net: number; tax: number }

/** Prices are gross (USt enthalten), like the Lexware invoices. Tax is computed per rate group. */
/** Totals per tax rate. mode 'net': net unit prices (rounded) are the basis and USt is added on top, as printed on a net invoice. */
export function computeTotals(items: Pick<InvoiceItem, 'quantity' | 'unit_price_gross' | 'tax_rate'>[], mode: 'gross' | 'net' = 'gross') {
  if (mode === 'net') {
    const nets = new Map<number, number>()
    for (const it of items) {
      const r = Number(it.tax_rate)
      const line = round2(Number(it.quantity) * round2(Number(it.unit_price_gross) / (1 + r / 100)))
      nets.set(r, round2((nets.get(r) ?? 0) + line))
    }
    const taxGroups: TaxGroup[] = [...nets.entries()].sort((a, b) => b[0] - a[0]).map(([rate, net]) => {
      const tax = round2(net * rate / 100)
      return { rate, net, tax, gross: round2(net + tax) }
    })
    const gross = round2(taxGroups.reduce((s, g) => s + g.gross, 0))
    const net = round2(taxGroups.reduce((s, g) => s + g.net, 0))
    return { taxGroups, gross, net, tax: round2(gross - net) }
  }
  const groups = new Map<number, number>()
  for (const it of items) {
    const line = round2(Number(it.quantity) * Number(it.unit_price_gross))
    groups.set(Number(it.tax_rate), round2((groups.get(Number(it.tax_rate)) ?? 0) + line))
  }
  const taxGroups: TaxGroup[] = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, gross]) => {
      const net = round2(gross / (1 + rate / 100))
      return { rate, gross, net, tax: round2(gross - net) }
    })
  const gross = round2(taxGroups.reduce((s, g) => s + g.gross, 0))
  const net = round2(taxGroups.reduce((s, g) => s + g.net, 0))
  return { taxGroups, gross, net, tax: round2(gross - net) }
}

/** Net unit price from a gross one (unrounded), and gross (rounded to cents) from a net one. */
export const netOf = (gross: number, rate: number) => Number(gross) / (1 + Number(rate) / 100)
export const grossOf = (net: number, rate: number) => round2(Number(net) * (1 + Number(rate) / 100))

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

export const todayIso = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
