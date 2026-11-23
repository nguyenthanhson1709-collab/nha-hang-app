export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function eur(n: number | null | undefined, withSymbol = true) {
  const v = Number(n || 0)
  const s = v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return withSymbol ? `${s} €` : s
}

/** "1.234,56" / "1234.56" / "2837,400" -> number */
export function parseNum(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s
  if (!s) return 0
  let t = String(s).replace(/[€\s]/g, '').replace(/[Oo]/g, '0')
  const neg = /^-|-$/.test(t)
  t = t.replace(/-/g, '')
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.')
  if (lc > ld) t = t.replace(/\./g, '').replace(',', '.')
  else if (ld > lc && lc >= 0) t = t.replace(/,/g, '')
  else if (ld >= 0 && t.length - ld - 1 === 3 && t.split('.').length > 2) t = t.replace(/\./g, '')
  const v = parseFloat(t)
  return isNaN(v) ? 0 : neg ? -v : v
}

export const dmy = (iso: string | null | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
export const todayIso = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
export const monthOf = (iso: string) => iso.slice(0, 7)
export const thisMonth = () => todayIso().slice(0, 7)
export function monthRange(p: string) {
  const [y, m] = p.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${p}-01`, to: `${p}-${String(last).padStart(2, '0')}` }
}
export function addMonths(p: string, n: number) {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export const monthLabel = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`
export function daysOfMonth(p: string) {
  const { to } = monthRange(p)
  const n = Number(to.slice(8))
  return Array.from({ length: n }, (_, i) => `${p}-${String(i + 1).padStart(2, '0')}`)
}
export const normName = (s: string) => s.toLowerCase().replace(/[0-9.,x×%]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Font chuẩn của PDF không có dấu tiếng Việt: bỏ dấu, giữ ä ö ü ß € */
export function pdfText(s: string | null | undefined) {
  if (!s) return ''
  return s.replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^\u0000-ÿ€]/g, (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .replace(/[^\u0000-ÿ€]/g, '?')
}

