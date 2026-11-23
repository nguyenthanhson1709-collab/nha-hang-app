// Định khoản tự động (SKR03) và xuất DATEV Buchungsstapel (EXTF 700)
import type { CashMove, Category, Doc, Restaurant, ZBon } from './supabase'
import { accountFor } from './categorize'
import { r2 } from './format'
import { pdfText } from './pdf'

export interface Booking { date: string; amount: number; soll: string; haben: string; bu: string; text: string; beleg: string; source: string }

const AUTO = new Set(['3300', '3400', '3200', '8300', '8400', '8200'])
const buFor = (acc: string, rate: number) => (AUTO.has(acc) ? '' : rate === 19 ? '9' : rate === 7 ? '8' : '')
const payAcc = (m: string, sale: boolean) => (m === 'cash' ? '1000' : m === 'card' ? (sale ? '1360' : '1200') : '1200')
const revAcc = (rate: number) => (rate === 7 ? '8300' : rate === 19 ? '8400' : '8200')

/** chia số tiền theo tỉ lệ, cộng phần làm tròn vào dòng cuối */
function split(total: number, weights: number[]) {
  const sw = weights.reduce((a, b) => a + b, 0) || 1
  const out = weights.map((w) => r2((total * w) / sw))
  const diff = r2(total - out.reduce((a, b) => a + b, 0))
  if (out.length) out[out.length - 1] = r2(out[out.length - 1] + diff)
  return out
}

export function buildBookings(docs: Doc[], zbons: ZBon[], moves: CashMove[], r: Restaurant, cats: Category[]): Booking[] {
  const out: Booking[] = []
  const catMap = new Map(cats.map((c) => [c.id, c]))
  for (const d of docs) {
    if (d.status !== 'reviewed') continue
    const gross = Number(d.gross)
    const pays = (d.nh_document_payments || []).filter((p) => Number(p.amount) > 0)
    if (!pays.length || !gross) continue
    const sale = d.kind === 'sales'
    // Nhóm theo (tài khoản, mức thuế)
    const groups = new Map<string, { acc: string; rate: number; amount: number }>()
    const lines = d.nh_document_lines || []
    const add = (acc: string, rate: number, amount: number) => {
      const k = `${acc}|${rate}`
      const g = groups.get(k) || { acc, rate, amount: 0 }
      g.amount += amount; groups.set(k, g)
    }
    const taxes = d.nh_document_taxes || []
    if (sale) {
      if (taxes.length) taxes.forEach((t) => add(revAcc(Number(t.rate)), Number(t.rate), Number(t.gross)))
      else add('8400', 19, gross)
    } else if (lines.length && lines.every((l) => l.rate != null)) {
      lines.forEach((l) => add(accountFor(catMap.get(l.category_id || ''), Number(l.rate)), Number(l.rate), Number(l.total)))
    } else if (taxes.length) {
      taxes.forEach((t) => add(accountFor(undefined, Number(t.rate)), Number(t.rate), Number(t.gross)))
    } else add('3400', 19, gross)
    const gl = [...groups.values()]
    const scaled = split(gross, gl.map((g) => g.amount))
    gl.forEach((g, i) => {
      const parts = split(scaled[i], pays.map((p) => Number(p.amount)))
      pays.forEach((p, j) => {
        if (!parts[j]) return
        const pa = payAcc(p.method, sale)
        out.push({
          date: d.doc_date, amount: parts[j], soll: sale ? pa : g.acc, haben: sale ? g.acc : pa, bu: sale ? '' : buFor(g.acc, g.rate),
          text: `${d.supplier || 'Beleg'}${pays.length > 1 ? ` (${p.method === 'cash' ? 'Bar' : 'Karte'})` : ''}`, beleg: d.invoice_no || '', source: d.id,
        })
      })
    })
  }
  for (const z of zbons) {
    const total = Number(z.total)
    if (!total) continue
    const cardRev = z.card_terminal == null ? Number(z.card_pos) : r2(Number(z.card_terminal) - Number(z.tip_card))
    const cashRev = r2(total - cardRev)
    const parts7 = split(Number(z.gross7), [cashRev, cardRev]), parts19 = split(Number(z.gross19), [cashRev, cardRev])
    const t = `Z-Bon ${z.z_date.slice(8, 10)}.${z.z_date.slice(5, 7)}.`
    if (parts7[0]) out.push({ date: z.z_date, amount: parts7[0], soll: '1000', haben: '8300', bu: '', text: `${t} Bar 7%`, beleg: z.z_no || '', source: z.id })
    if (parts7[1]) out.push({ date: z.z_date, amount: parts7[1], soll: '1360', haben: '8300', bu: '', text: `${t} Karte 7%`, beleg: z.z_no || '', source: z.id })
    if (parts19[0]) out.push({ date: z.z_date, amount: parts19[0], soll: '1000', haben: '8400', bu: '', text: `${t} Bar 19%`, beleg: z.z_no || '', source: z.id })
    if (parts19[1]) out.push({ date: z.z_date, amount: parts19[1], soll: '1360', haben: '8400', bu: '', text: `${t} Karte 19%`, beleg: z.z_no || '', source: z.id })
    if (Number(z.tip_card) > 0) {
      out.push({ date: z.z_date, amount: Number(z.tip_card), soll: '1360', haben: '1590', bu: '', text: `${t} Trinkgeld Karte`, beleg: z.z_no || '', source: z.id })
      if (r.tip_paid_cash) out.push({ date: z.z_date, amount: Number(z.tip_card), soll: '1590', haben: '1000', bu: '', text: `${t} Auszahlung Trinkgeld`, beleg: z.z_no || '', source: z.id })
    }
  }
  const MV: Record<string, [string, string, string]> = {
    einlage: ['1000', '1890', 'Einlage'], privatentnahme: ['1800', '1000', 'Privatentnahme'], geldtransit: ['1360', '1000', 'Geldtransit an Bank'],
    sonstige_einnahme: ['1000', '2700', 'Sonstige Einnahme'], sonstige_ausgabe: ['4900', '1000', 'Sonstige Ausgabe'],
  }
  for (const m of moves) {
    const [s, h, txt] = MV[m.type]
    out.push({ date: m.move_date, amount: Number(m.amount), soll: s, haben: h, bu: '', text: m.description ? `${txt}: ${m.description}` : txt, beleg: '', source: m.id })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

const q = (s: string) => `"${s.replace(/"/g, "'")}"`
const num = (n: number) => n.toFixed(2).replace('.', ',')

export function datevCsv(bookings: Booking[], r: Restaurant, period: string): Blob {
  const [y, m] = period.split('-')
  const last = new Date(Number(y), Number(m), 0).getDate()
  const now = new Date()
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}000`
  const head = [
    q('EXTF'), '700', '21', q('Buchungsstapel'), '13', ts, '', q('RE'), q(''), q(''),
    r.datev_consultant_no || '', r.datev_client_no || '', `${y}0101`, '4', `${y}${m}01`, `${y}${m}${last}`,
    q(pdfText(`Kasse ${r.name} ${m}/${y}`).slice(0, 30)), q(''), '1', '0', '0', q('EUR'), '', q(''), '', '', q('03'), '', '', q(''), q(''),
  ].join(';')
  const cols = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto',
    'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'].join(';')
  const rows = bookings.map((b) => [
    num(b.amount), q('S'), q('EUR'), '', '', q(''), b.soll, b.haben, q(b.bu), `${b.date.slice(8, 10)}${b.date.slice(5, 7)}`,
    q(pdfText(b.beleg).slice(0, 36)), q(''), '', q(pdfText(b.text).slice(0, 60)),
  ].join(';'))
  const text = [head, cols, ...rows].join('\r\n') + '\r\n'
  // Windows-1252
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    bytes[i] = c === 0x20ac ? 0x80 : c < 256 ? c : 0x3f
  }
  return new Blob([bytes], { type: 'text/csv;charset=windows-1252' })
}
