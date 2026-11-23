// Giấy tờ xuất ra luôn bằng tiếng Đức
import { jsPDF } from 'jspdf'
import type { Category, Doc, KbRow, Restaurant, CashCount, ZBon } from './supabase'
import { downloadFile } from './supabase'
import { dmy, eur, monthLabel, r2 } from './format'
import { folderParts } from './data'
import { pdfToImages } from './ocr'

/** Font chuẩn của PDF không có dấu tiếng Việt: bỏ dấu, giữ ä ö ü ß € */
export function pdfText(s: string | null | undefined) {
  if (!s) return ''
  return s.replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^\u0000-ÿ€]/g, (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .replace(/[^\u0000-ÿ€]/g, '?')
}

const W = 210, H = 297, M = 14

function header(pdf: jsPDF, title: string, r: Restaurant, sub?: string) {
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text(pdfText(title), M, 18)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  pdf.text(pdfText([r.name, r.address, r.tax_number && `St.-Nr. ${r.tax_number}`].filter(Boolean).join(' · ')), M, 24)
  if (sub) pdf.text(pdfText(sub), M, 29)
  pdf.setDrawColor(180); pdf.line(M, 32, W - M, 32)
  return 38
}

interface Col { h: string; w: number; right?: boolean }
function table(pdf: jsPDF, y: number, cols: Col[], rows: string[][], foot?: string[], onPage?: () => number) {
  const lh = 5.2
  const drawHead = (yy: number) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8)
    let x = M
    for (const c of cols) { pdf.text(pdfText(c.h), c.right ? x + c.w - 1 : x + 1, yy, { align: c.right ? 'right' : 'left' }); x += c.w }
    pdf.setDrawColor(200); pdf.line(M, yy + 1.5, W - M, yy + 1.5)
    pdf.setFont('helvetica', 'normal')
    return yy + lh + 0.5
  }
  y = drawHead(y)
  const all = foot ? [...rows, foot] : rows
  all.forEach((row, ri) => {
    const isFoot = !!foot && ri === all.length - 1
    // xuống dòng cho ô dài
    const wrapped = row.map((cell, i) => pdf.splitTextToSize(pdfText(cell), cols[i].w - 2) as string[])
    const n = Math.max(...wrapped.map((w) => w.length))
    if (y + n * lh > H - 14) { pdf.addPage(); y = onPage ? onPage() : 18; y = drawHead(y) }
    if (isFoot) { pdf.setDrawColor(120); pdf.line(M, y - 3.8, W - M, y - 3.8); pdf.setFont('helvetica', 'bold') }
    let x = M
    wrapped.forEach((w, i) => {
      const c = cols[i]
      w.forEach((ln, k) => pdf.text(ln, c.right ? x + c.w - 1 : x + 1, y + k * lh, { align: c.right ? 'right' : 'left' }))
      x += c.w
    })
    y += n * lh
    if (isFoot) pdf.setFont('helvetica', 'normal')
  })
  return y
}

function footerPages(pdf: jsPDF) {
  const n = pdf.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i); pdf.setFontSize(7); pdf.setTextColor(120)
    pdf.text(`Seite ${i} / ${n} · erstellt ${new Date().toLocaleString('de-DE')}`, W - M, H - 7, { align: 'right' })
    pdf.setTextColor(0)
  }
}

async function fileImages(path: string): Promise<string[]> {
  const b = await downloadFile(path)
  if (!b) return []
  if (/\.pdf$/i.test(path)) return pdfToImages(b)
  if (/\.xml$/i.test(path)) return []
  return [await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(b) })]
}

async function addImagePage(pdf: jsPDF, dataUrl: string, caption: string) {
  pdf.addPage()
  const img = new Image(); img.src = dataUrl; await img.decode()
  const maxW = W - 2 * M, maxH = H - 2 * M - 8
  const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
  const w = img.naturalWidth * s, h = img.naturalHeight * s
  pdf.setFontSize(8); pdf.text(pdfText(caption), M, M - 4)
  pdf.addImage(dataUrl, 'JPEG', (W - w) / 2, M, w, h)
}

const PM: Record<string, string> = { cash: 'Bar', card: 'Karte', transfer: 'Überweisung' }

function summaryPage(pdf: jsPDF, d: Doc, _r: Restaurant, cats: Category[], y: number) {
  const pays = d.nh_document_payments || []
  const kv: [string, string][] = [
    ['Belegart', d.kind === 'sales' ? 'Ausgangsrechnung' : 'Eingangsrechnung'],
    ['Lieferant / Kunde', d.supplier || '—'],
    ['Belegdatum', dmy(d.doc_date)],
    ['Buchungsmonat', monthLabel(d.period)],
    ['Rechnungsnummer', d.invoice_no || '—'],
    ['USt-IdNr. / St.-Nr. Verkäufer', d.seller_tax_id || '—'],
    ['Zahlungsart', pays.map((p) => `${PM[p.method]} ${eur(Number(p.amount))}`).join(' + ') || '—'],
    ['Ablage', folderParts(d).map((p) => `${p.folder} ${eur(p.amount)}`).join(' + ')],
    ['Bruttobetrag', eur(Number(d.gross))],
  ]
  pdf.setFontSize(9)
  for (const [k, v] of kv) { pdf.setFont('helvetica', 'bold'); pdf.text(pdfText(k), M, y); pdf.setFont('helvetica', 'normal'); pdf.text(pdfText(v), M + 55, y); y += 5.5 }
  y += 3
  const taxes = d.nh_document_taxes || []
  if (taxes.length) {
    y = table(pdf, y, [{ h: 'Steuersatz', w: 40 }, { h: 'Netto', w: 45, right: true }, { h: 'MwSt', w: 45, right: true }, { h: 'Brutto', w: 52, right: true }],
      taxes.map((t) => [`${Number(t.rate)} %`, eur(Number(t.net)), eur(Number(t.tax)), eur(Number(t.gross))]),
      ['Summe', eur(taxes.reduce((s, t) => s + Number(t.net), 0)), eur(taxes.reduce((s, t) => s + Number(t.tax), 0)), eur(taxes.reduce((s, t) => s + Number(t.gross), 0))]) + 4
  }
  const lines = d.nh_document_lines || []
  if (lines.length) {
    y = table(pdf, y, [{ h: 'Artikel', w: 80 }, { h: 'Menge', w: 18, right: true }, { h: 'USt', w: 16, right: true }, { h: 'Warengruppe', w: 42 }, { h: 'Brutto', w: 26, right: true }],
      lines.map((l) => [l.name, l.qty == null ? '' : String(l.qty).replace('.', ','), l.rate == null ? '' : `${Number(l.rate)}%`, cats.find((c) => c.id === l.category_id)?.name_de || '', eur(Number(l.total))]))
  }
  if (d.note) { y += 4; pdf.setFontSize(8); pdf.text(pdfText('Notiz: ' + d.note), M, y) }
  return y
}

/** Một chứng từ: trang tóm tắt + ảnh gốc */
export async function docPdf(d: Doc, r: Restaurant, cats: Category[]): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const y = header(pdf, 'Beleg', r, `${d.supplier || ''} · ${dmy(d.doc_date)}`)
  summaryPage(pdf, d, r, cats, y)
  for (const f of d.files) for (const img of await fileImages(f)) await addImagePage(pdf, img, `Original: ${d.supplier || ''} ${dmy(d.doc_date)}`)
  footerPages(pdf)
  return pdf.output('blob')
}

export type Folder = 'Bargeld' | 'Rechnungseingang' | 'Rechnungsausgang'

/** Cả thư mục theo tháng: danh sách + từng chứng từ */
export async function folderPdf(folder: Folder, docs: Doc[], zbons: ZBon[], r: Restaurant, period: string, cats: Category[], onProgress?: (s: string) => void): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const y = header(pdf, `${folder} ${monthLabel(period)}`, r, 'Belegliste')
  type Item = { date: string; who: string; nr: string; net: number; tax: number; gross: number; amount: number; pay: string; doc?: Doc; z?: ZBon }
  const items: Item[] = []
  for (const d of docs) for (const p of folderParts(d)) if (p.folder === folder) {
    const f = Number(d.gross) ? p.amount / Number(d.gross) : 1
    const taxes = d.nh_document_taxes || []
    const split = folderParts(d).length > 1
    items.push({ date: d.doc_date, who: (d.supplier || '—') + (split ? ' (Teilbetrag)' : ''), nr: d.invoice_no || '', net: r2(taxes.reduce((s, t) => s + Number(t.net), 0) * f), tax: r2(taxes.reduce((s, t) => s + Number(t.tax), 0) * f), gross: Number(d.gross), amount: p.amount, pay: PM[p.method] || p.method, doc: d })
  }
  if (folder === 'Rechnungsausgang') for (const z of zbons)
    items.push({ date: z.z_date, who: 'Z-Bon Tagesabschluss', nr: z.z_no || '', net: r2(Number(z.net7) + Number(z.net19)), tax: r2(Number(z.tax7) + Number(z.tax19)), gross: Number(z.total), amount: Number(z.total), pay: 'Bar/Karte', z })
  items.sort((a, b) => a.date.localeCompare(b.date))
  table(pdf, y, [{ h: 'Nr.', w: 10 }, { h: 'Datum', w: 20 }, { h: 'Lieferant / Text', w: 58 }, { h: 'Zahlung', w: 20 }, { h: 'Netto', w: 25, right: true }, { h: 'MwSt', w: 22, right: true }, { h: 'Betrag', w: 27, right: true }],
    items.map((it, i) => [String(i + 1), dmy(it.date), it.who + (it.nr ? ` Nr. ${it.nr}` : ''), it.pay, eur(it.net), eur(it.tax), eur(it.amount)]),
    ['', '', 'Summe', '', eur(items.reduce((s, i) => s + i.net, 0)), eur(items.reduce((s, i) => s + i.tax, 0)), eur(items.reduce((s, i) => s + i.amount, 0))])
  let n = 0
  for (const it of items) {
    n++; onProgress?.(`${folder} ${n}/${items.length}`)
    if (it.doc) {
      pdf.addPage()
      const yy = header(pdf, `Beleg ${n}`, r, `${folder} · ${it.who} · ${dmy(it.date)} · ${eur(it.amount)}`)
      summaryPage(pdf, it.doc, r, cats, yy)
      for (const f of it.doc.files) for (const img of await fileImages(f)) await addImagePage(pdf, img, `Beleg ${n}: ${it.who} ${dmy(it.date)}`)
    } else if (it.z) {
      pdf.addPage()
      let yy = header(pdf, `Beleg ${n}: Z-Bon ${dmy(it.date)}`, r)
      const z = it.z
      yy = table(pdf, yy, [{ h: '', w: 70 }, { h: 'Netto', w: 37, right: true }, { h: 'MwSt', w: 37, right: true }, { h: 'Brutto', w: 38, right: true }], [
        ['Umsatz 7 %', eur(z.net7), eur(z.tax7), eur(z.gross7)], ['Umsatz 19 %', eur(z.net19), eur(z.tax19), eur(z.gross19)],
      ], ['Gesamtumsatz (ohne Trinkgeld)', eur(Number(z.net7) + Number(z.net19)), eur(Number(z.tax7) + Number(z.tax19)), eur(z.total)]) + 4
      table(pdf, yy, [{ h: '', w: 120 }, { h: 'Betrag', w: 62, right: true }], [
        ['Bar lt. Kasse', eur(z.cash_pos)], ['Karte lt. Kasse', eur(z.card_pos)],
        ['Karte lt. EC-Terminal (inkl. Trinkgeld)', z.card_terminal == null ? '—' : eur(z.card_terminal)], ['davon Trinkgeld Karte', eur(z.tip_card)],
        ['Bareinnahmen (Kassenbuch)', eur(z.cash_revenue)], ['Trinkgeld lt. Kasse', eur(z.tip)], [`Storno (${z.storno_count})`, eur(z.storno)],
      ])
      for (const f of z.files) for (const img of await fileImages(f)) await addImagePage(pdf, img, `Z-Bon ${dmy(z.z_date)}`)
    }
  }
  footerPages(pdf)
  return pdf.output('blob')
}

export function kassenbuchPdf(rows: KbRow[], counts: CashCount[], r: Restaurant, period: string, opening: number): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const y = header(pdf, `Kassenbuch ${monthLabel(period)}`, r)
  const out: string[][] = [['', '', 'Anfangsbestand', '', '', '', eur(opening)]]
  const cmap = new Map(counts.map((c) => [c.count_date, c]))
  let lastDate = ''
  const flushCount = (d: string) => {
    const c = cmap.get(d)
    if (c) { out.push(['', dmy(d), `Kassensturz: gezählt ${eur(c.counted)}${Number(c.difference) ? ` · Differenz ${eur(c.difference)} (${c.reason || ''})` : ' ✓'}`, '', '', '', eur(c.counted)]); cmap.delete(d) }
  }
  for (const x of rows) {
    if (lastDate && x.entry_date !== lastDate) flushCount(lastDate)
    lastDate = x.entry_date
    out.push([String(x.nr), dmy(x.entry_date), x.text, Number(x.einnahme) ? eur(x.einnahme) : '', Number(x.ausgabe) ? eur(x.ausgabe) : '', x.mwst || '', eur(x.saldo)])
  }
  if (lastDate) flushCount(lastDate)
  for (const c of [...cmap.values()].sort((a, b) => a.count_date.localeCompare(b.count_date))) out.push(['', dmy(c.count_date), `Kassensturz: gezählt ${eur(c.counted)}`, '', '', '', eur(c.counted)])
  const ein = rows.reduce((s, x) => s + Number(x.einnahme), 0), aus = rows.reduce((s, x) => s + Number(x.ausgabe), 0)
  table(pdf, y, [{ h: 'Nr.', w: 10 }, { h: 'Datum', w: 19 }, { h: 'Text', w: 70 }, { h: 'Einnahme', w: 22, right: true }, { h: 'Ausgabe', w: 22, right: true }, { h: 'USt', w: 15 }, { h: 'Bestand', w: 24, right: true }],
    out, ['', '', 'Summe / Endbestand', eur(ein), eur(aus), '', eur(opening + ein - aus)])
  footerPages(pdf)
  return pdf.output('blob')
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}

/** Báo cáo dạng bảng (tiếng Đức) */
export function reportPdf(title: string, r: Restaurant | null, sub: string, sections: { title: string; cols: Col[]; rows: string[][]; foot?: string[] }[]): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = header(pdf, title, r || ({ name: 'Alle Restaurants' } as Restaurant), sub)
  for (const s of sections) {
    if (y > H - 40) { pdf.addPage(); y = 18 }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(pdfText(s.title), M, y); y += 6
    y = table(pdf, y, s.cols, s.rows, s.foot) + 6
  }
  footerPages(pdf)
  return pdf.output('blob')
}
export type { Col }
