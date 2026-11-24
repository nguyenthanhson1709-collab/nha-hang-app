// Kassenbuch chi tiết theo mẫu của Steuerberater:
// Datum | Beleg | Einnahmen | Ausgaben | MwSt. | USt | VSt | Ein.Netto | Aus.Netto | Saldo | Konto | Text
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import type { CashMove, Category, Doc, Restaurant, ZBon, CashCount } from './supabase'
import { docGroups, revAcc, split } from './datev'
import { dmy, eur, pdfText, r2 } from './format'

export interface KbLine {
  date: string; beleg: string; ein: number; aus: number; rate: number | null; ust: number; vst: number
  einNetto: number; ausNetto: number; saldo: number; konto: string; text: string
  link?: string; moveId?: string; prio: number; ts: string
}

const taxOf = (gross: number, rate: number) => r2((gross * rate) / (100 + rate))
const deMonth = (p: string) => new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

export function kbLines(docs: Doc[], zbons: ZBon[], moves: CashMove[], r: Restaurant, period: string, opening: number, cats: Category[]): KbLine[] {
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const start = period + '-01'
  const out: KbLine[] = []
  const base = { beleg: '', ein: 0, aus: 0, rate: null, ust: 0, vst: 0, einNetto: 0, ausNetto: 0, saldo: 0, konto: '', text: '' }

  // Hoá đơn trả / thu bằng tiền mặt: tách theo mức thuế và food/nonfood
  for (const d of docs) {
    if (d.status !== 'reviewed' || d.period !== period) continue
    const cash = (d.nh_document_payments || []).filter((p) => p.method === 'cash').reduce((s, p) => s + Number(p.amount), 0)
    if (!cash) continue
    const sale = d.kind === 'sales'
    const date = d.doc_date < start ? start : d.doc_date
    const gl = docGroups(d, catMap)
    const parts = split(r2(cash), gl.map((g) => g.amount))
    const late = d.doc_date < start ? ` (Belegdatum ${dmy(d.doc_date)})` : ''
    gl.forEach((g, i) => {
      const amt = parts[i]; if (!amt) return
      const tax = taxOf(amt, g.rate)
      out.push({
        ...base, date, rate: g.rate, konto: g.acc, link: `/r/${r.id}/doc/${d.id}`, prio: 1, ts: d.created_at,
        text: `${d.supplier || 'Beleg'}${d.invoice_no ? ' - ' + d.invoice_no : ''}${late}`,
        ...(sale ? { ein: amt, ust: tax, einNetto: r2(amt - tax) } : { aus: amt, vst: tax, ausNetto: r2(amt - tax) }),
      })
    })
  }

  // Thu thẻ nhập tay (Viva Wallet) theo ngày: thay cho phần thẻ tính từ Z-Bon của ngày đó
  const viva = new Map<string, number>()
  for (const m of moves) if (m.channel === 'viva') viva.set(m.move_date, r2((viva.get(m.move_date) || 0) + Number(m.amount)))

  // Z-Bon: cả doanh thu trong ngày vào Einnahmen, phần khách trả thẻ ra Ausgaben (về ngân hàng)
  for (const z of zbons) {
    const total = Number(z.total); if (!total) continue
    const beleg = z.z_no || ''
    const link = `/r/${r.id}/z/${z.id}`
    const rows: [number, number, number][] = [[7, Number(z.gross7), Number(z.tax7)], [19, Number(z.gross19), Number(z.tax19)]]
    const rest = r2(total - Number(z.gross7) - Number(z.gross19))
    if (Math.abs(rest) >= 0.01) rows.push([0, rest, 0])
    for (const [rate, g, tax] of rows) if (g) out.push({
      ...base, date: z.z_date, beleg, ein: r2(g), rate, ust: r2(tax), einNetto: r2(g - tax), konto: rate ? revAcc(rate) : '8200',
      text: `Einnahmen Z-Bon ${dm(z.z_date)}${rate ? '' : ' (0 %)'}`, link, prio: 0, ts: z.created_at,
    })
    const card = Math.max(0, r2(total - Number(z.cash_revenue) - (viva.get(z.z_date) || 0)))
    if (card) out.push({ ...base, date: z.z_date, aus: card, ausNetto: card, konto: '1360', text: `Kartenzahlung - ${dm(z.z_date)}`, link, prio: 2.5, ts: z.created_at })
    if (r.tip_paid_cash && Number(z.tip_card) > 0)
      out.push({ ...base, date: z.z_date, aus: Number(z.tip_card), ausNetto: Number(z.tip_card), konto: '1592', text: 'Auszahlung Trinkgeld (Karte) an Personal', link, prio: 3, ts: z.created_at })
  }

  // Thu/chi khác, nộp tiền vào ngân hàng
  const MV: Record<string, [string, string, boolean]> = {
    geldtransit: ['1360', 'Geldtransit an Bank', false], sonstige_einnahme: ['2700', 'Sonstige Einnahme', true],
    sonstige_ausgabe: ['4900', 'Sonstige Ausgabe', false], einlage: ['1890', 'Einlage', true], privatentnahme: ['1800', 'Privatentnahme', false],
  }
  for (const m of moves) {
    const [konto0, txt0, isIn] = MV[m.type]
    // Viva Wallet có tài khoản riêng 1210 trong DATEV của Steuerberater (SKR03)
    const konto = m.channel === 'viva' ? '1210' : konto0
    const txt = m.channel === 'viva' ? 'Kartenzahlung' : txt0
    const a = Number(m.amount)
    out.push({
      ...base, date: m.move_date, konto, text: m.type === 'geldtransit' && m.description?.trim() ? m.description.trim() : m.description && m.description.trim() !== txt ? `${txt}: ${m.description}` : txt, moveId: m.id, prio: isIn ? 1 : 4, ts: m.created_at,
      ...(isIn ? { ein: a, einNetto: a } : { aus: a, ausNetto: a }),
    })
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.prio - b.prio || a.ts.localeCompare(b.ts))
  let saldo = opening
  for (const x of out) { saldo = r2(saldo + x.ein - x.aus); x.saldo = saldo }
  return out
}

export function kbTotals(lines: KbLine[]) {
  const s = (k: 'ein' | 'aus' | 'ust' | 'vst' | 'einNetto' | 'ausNetto') => r2(lines.reduce((a, x) => a + x[k], 0))
  return { ein: s('ein'), aus: s('aus'), ust: s('ust'), vst: s('vst'), einNetto: s('einNetto'), ausNetto: s('ausNetto') }
}

const n = (v: number) => (v ? eur(v, false) : '')
const pct = (x: KbLine) => (x.rate == null ? '' : `${x.rate}%`)

export function kbPdf(lines: KbLine[], counts: CashCount[], r: Restaurant, period: string, opening: number): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const PW = 297, PH = 210, M = 10
  const cols = [
    { h: 'Datum', w: 14 }, { h: 'Beleg', w: 16 }, { h: 'Einnahmen', w: 23, r: true }, { h: 'Ausgaben', w: 23, r: true }, { h: 'MwSt.', w: 12, r: true },
    { h: 'USt', w: 18, r: true }, { h: 'VSt', w: 18, r: true }, { h: 'Ein.Netto', w: 23, r: true }, { h: 'Aus.Netto', w: 23, r: true },
    { h: 'Saldo', w: 25, r: true }, { h: 'Konto', w: 13 }, { h: 'Text', w: 69 },
  ]
  const lh = 5
  const head = (first: boolean) => {
    let y = 14
    if (first) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15)
      pdf.text(pdfText(`Kasse ${deMonth(period)}   (${r.name})`), M, y); y += 5
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
      pdf.text(pdfText([r.address, r.tax_number && `St.-Nr. ${r.tax_number}`].filter(Boolean).join(' · ')), M, y); y += 6
    }
    pdf.setFillColor(232, 232, 232); pdf.rect(M, y - 3.6, PW - 2 * M, 5.2, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8)
    let x = M
    for (const c of cols) { pdf.text(c.h, c.r ? x + c.w - 1 : x + 1, y, { align: c.r ? 'right' : 'left' }); x += c.w }
    pdf.setFont('helvetica', 'normal')
    return y + lh + 1
  }
  let y = head(true)
  const row = (cells: string[], bold = false) => {
    const wrapped = cells.map((c, i) => pdf.splitTextToSize(pdfText(c), cols[i].w - 2) as string[])
    const k = Math.max(...wrapped.map((w) => w.length))
    if (y + k * lh > PH - 12) { pdf.addPage(); y = head(false) }
    if (bold) pdf.setFont('helvetica', 'bold')
    let x = M
    wrapped.forEach((w, i) => { const c = cols[i]; w.forEach((ln, j) => pdf.text(ln, c.r ? x + c.w - 1 : x + 1, y + j * lh, { align: c.r ? 'right' : 'left' })); x += c.w })
    pdf.setDrawColor(225); pdf.line(M, y + (k - 1) * lh + 1.6, PW - M, y + (k - 1) * lh + 1.6)
    if (bold) pdf.setFont('helvetica', 'normal')
    y += k * lh
  }
  pdf.setFontSize(8)
  const [py, pm] = period.split('-').map(Number)
  const prevEnd = new Date(py, pm - 1, 0)
  row(['', '', '', '', '', '', '', '', '', eur(opening, false), '', `Saldo ${prevEnd.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`])
  const cmap = new Map(counts.map((c) => [c.count_date, c]))
  let last = ''
  const flush = (d: string) => {
    const c = cmap.get(d); if (!c) return
    row(['', '', '', '', '', '', '', '', '', '', '', `Kassensturz ${dm(d)}: gezählt ${eur(c.counted)}${Number(c.difference) ? `, Differenz ${eur(c.difference)} ${c.reason || ''}` : ' ✓'}`])
    cmap.delete(d)
  }
  for (const x of lines) {
    if (last && x.date !== last) flush(last)
    last = x.date
    row([dm(x.date), x.beleg, n(x.ein), n(x.aus), pct(x), n(x.ust), n(x.vst), n(x.einNetto), n(x.ausNetto), eur(x.saldo, false), x.konto, x.text])
  }
  if (last) flush(last)
  const t = kbTotals(lines)
  y += 1
  row(['', 'Summe', n(t.ein), n(t.aus), '', n(t.ust), n(t.vst), n(t.einNetto), n(t.ausNetto), eur(r2(opening + t.ein - t.aus), false), '', 'Endbestand'], true)
  const np = pdf.getNumberOfPages()
  for (let i = 1; i <= np; i++) { pdf.setPage(i); pdf.setFontSize(7); pdf.setTextColor(120); pdf.text(`Seite ${i} / ${np}`, PW - M, PH - 6, { align: 'right' }); pdf.setTextColor(0) }
  return pdf.output('blob')
}

export function kbXlsx(lines: KbLine[], r: Restaurant, period: string, opening: number): Blob {
  const t = kbTotals(lines)
  const v = (x: number) => (x ? x : null)
  const aoa: (string | number | null)[][] = [
    [`Kasse ${deMonth(period)} (${r.name})`], [],
    ['Datum', 'Beleg', 'Einnahmen', 'Ausgaben', 'MwSt.', 'USt', 'VSt', 'Ein.Netto', 'Aus.Netto', 'Saldo', 'Konto', 'Text'],
    [null, null, null, null, null, null, null, null, null, opening, null, 'Saldo Vormonat'],
    ...lines.map((x) => [dmy(x.date), x.beleg || null, v(x.ein), v(x.aus), x.rate == null ? null : x.rate / 100, v(x.ust), v(x.vst), v(x.einNetto), v(x.ausNetto), x.saldo, x.konto, x.text]),
    [null, 'Summe', t.ein, t.aus, null, t.ust, t.vst, t.einNetto, t.ausNetto, r2(opening + t.ein - t.aus), null, 'Endbestand'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [10, 10, 12, 12, 7, 10, 10, 12, 12, 12, 7, 45].map((wch) => ({ wch }))
  const range = XLSX.utils.decode_range(ws['!ref']!)
  for (let R = 3; R <= range.e.r; R++) for (const C of [2, 3, 5, 6, 7, 8, 9]) { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c && typeof c.v === 'number') c.z = '#,##0.00' }
  for (let R = 3; R <= range.e.r; R++) { const c = ws[XLSX.utils.encode_cell({ r: R, c: 4 })]; if (c && typeof c.v === 'number') c.z = '0%' }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Kasse')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
