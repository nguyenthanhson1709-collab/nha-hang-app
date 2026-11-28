// Stundenzettel (từng nhân viên) và Dienstplan (tổng hợp tháng) dạng PDF – luôn bằng tiếng Đức
import { jsPDF } from 'jspdf'
import { dmy, pdfText } from './format'
import { calc, hhmm, holidayOf, monthDates, monthLabel, monthStat, shiftClass, tFull, tShort, weekday, WD_DE, zNote, type Shift } from './hrTime'

const BRAND: [number, number, number] = [255, 144, 24]
const FILL: Record<string, [number, number, number]> = { ft: [255, 236, 179], so: [255, 214, 224], frueh: [255, 241, 222], spaet: [224, 242, 230], u: [214, 234, 255] }

function head(pdf: jsPDF, title: string, sub: string, w: number) {
  pdf.setFillColor(...BRAND); pdf.rect(0, 0, w, 3, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(20); pdf.text(pdfText(title), 14, 15)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100); pdf.text(pdfText(sub), 14, 21)
  pdf.setDrawColor(200); pdf.line(14, 24, w - 14, 24); pdf.setTextColor(0)
}

/** Stundenzettel một tháng của một nhân viên */
export function stundenzettelPdf(o: { name: string; pnr: string | null; company: string; ym: string; contract: string | null; shifts: Shift[]; vac: string[]; noZ?: boolean }): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const W = 210
  head(pdf, `Stundenzettel ${monthLabel(o.ym, true)}`, [o.company, `${o.name}${o.pnr ? ` (Pers.-Nr. ${o.pnr})` : ''}`, o.contract ? `Vertrag: ${o.contract}` : ''].filter(Boolean).join(' · '), W)
  const st = monthStat(o.shifts, o.vac, o.noZ)
  pdf.setFontSize(9)
  const chips = [`Anwesenheitstage: ${st.days}`, `Ist: ${hhmm(st.ist)}`, `Nacht: ${hhmm(st.night)}`, `Sonntag: ${hhmm(st.sun)}`, `Feiertag 125 %: ${hhmm(st.hol)}`, ...(st.hol150 ? [`Feiertag 150 %: ${hhmm(st.hol150)}`] : []), `Urlaub: ${st.vac} Tage`]
  pdf.text(chips.join('   |   '), 14, 31)
  const cols = [14, 38, 50, 68, 84, 102, 120], hdr = ['Datum', 'Tag', 'Kommt', 'Pause', 'Geht', 'Ist', 'Bemerkung']
  let y = 38
  pdf.setFillColor(43, 35, 28); pdf.rect(14, y - 4.5, W - 28, 6.5, 'F')
  pdf.setTextColor(255); pdf.setFont('helvetica', 'bold'); hdr.forEach((h, i) => pdf.text(h, cols[i] + 1, y)); pdf.setTextColor(0); pdf.setFont('helvetica', 'normal')
  y += 6.4
  const byDate = new Map(o.shifts.map((s) => [s.shift_date, s]))
  for (const d of monthDates(o.ym)) {
    const s = byDate.get(d), hol = holidayOf(d), wd = weekday(d), isVac = o.vac.includes(d)
    const fill = s ? FILL[shiftClass(s)] : isVac ? FILL.u : hol ? FILL.ft : wd === 0 ? FILL.so : null
    if (fill) { pdf.setFillColor(...fill); pdf.rect(14, y - 4, W - 28, 5.6, 'F') }
    let note = ''
    if (s) {
      const c = calc(s)
      pdf.text(dmy(d), cols[0] + 1, y); pdf.text(WD_DE[wd], cols[1] + 1, y); pdf.text(tFull(s.start_time.slice(0, 5)), cols[2] + 1, y)
      pdf.text(hhmm(s.break_min || 0), cols[3] + 1, y); pdf.text(tFull(s.end_time.slice(0, 5)), cols[4] + 1, y)
      pdf.setFont('helvetica', 'bold'); pdf.text(hhmm(c.ist), cols[5] + 1, y); pdf.setFont('helvetica', 'normal')
      note = [s.note, ...zNote(c, true)].filter(Boolean).join('; ')
    } else {
      pdf.setTextColor(120); pdf.text(dmy(d), cols[0] + 1, y); pdf.text(WD_DE[wd], cols[1] + 1, y)
      note = isVac ? 'Urlaub' : hol ? `${hol} (frei)` : 'frei'
    }
    pdf.text(pdfText(note), cols[6] + 1, y); pdf.setTextColor(0)
    pdf.setDrawColor(230); pdf.line(14, y + 1.6, W - 14, y + 1.6)
    y += 5.6
  }
  y += 4; pdf.setFont('helvetica', 'bold'); pdf.text(`Gesamt Ist: ${hhmm(st.ist)} Std.`, cols[5] - 20, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(110)
  pdf.text(pdf.splitTextToSize(pdfText('Pause 1:00 bei Schichten ab 6 Std. · Zuschläge nach § 3b EStG: Nacht 20–24 Uhr 25 % (auch an Feiertagen, nicht an Sonntagen) · Sonntag 50 % · Feiertag 125 % (Silvester ab 14 Uhr) · 150 % Heiligabend ab 14 Uhr, 25./26.12., 1.5.'), W - 28), 14, y + 7)
  y = Math.max(y + 26, 270)
  pdf.setTextColor(0); pdf.setDrawColor(120); pdf.line(14, y, 84, y); pdf.line(W - 84, y, W - 14, y)
  pdf.text('Arbeitgeber', 14, y + 4); pdf.text('Arbeitnehmer', W - 84, y + 4)
  return pdf.output('blob')
}

export type PlanRow = { name: string; pnr: string | null; contract: string; shifts: Shift[]; vac: string[]; noZ?: boolean }
/** Dienstplan một tháng: trang 1 bảng tổng hợp, sau đó bảng theo ngày (khổ ngang) */
export function dienstplanPdf(o: { company: string; ym: string; rows: PlanRow[] }): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const W = 297
  head(pdf, `Dienstplan ${monthLabel(o.ym, true)} – Zusammenfassung`, `${o.company} · ${o.rows.length} Mitarbeiter`, W)
  const cols = [14, 30, 95, 130, 145, 165, 185, 205, 228, 251], hdr = ['PNR', 'Name', 'Vertrag', 'Tage', 'Ist', 'Nacht', 'Sonntag', 'FT 125 %', 'FT 150 %', 'Urlaub']
  let y = 32
  const th = () => { pdf.setFillColor(43, 35, 28); pdf.rect(14, y - 4.5, W - 28, 6.5, 'F'); pdf.setTextColor(255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); hdr.forEach((h, i) => pdf.text(h, cols[i] + 1, y)); pdf.setTextColor(0); pdf.setFont('helvetica', 'normal'); y += 6.4 }
  th()
  const tot = { days: 0, ist: 0, night: 0, sun: 0, hol: 0, hol150: 0, vac: 0 }
  for (const r of o.rows) {
    if (y > 195) { pdf.addPage(); y = 20; th() }
    const st = monthStat(r.shifts, r.vac, r.noZ); (Object.keys(tot) as (keyof typeof tot)[]).forEach((k) => (tot[k] += st[k]))
    const v = [r.pnr || '', r.name, r.contract, String(st.days), hhmm(st.ist), hhmm(st.night), hhmm(st.sun), hhmm(st.hol), hhmm(st.hol150), String(st.vac)]
    v.forEach((x, i) => pdf.text(pdfText(x), cols[i] + 1, y))
    pdf.setDrawColor(230); pdf.line(14, y + 1.6, W - 14, y + 1.6); y += 5.8
  }
  pdf.setFont('helvetica', 'bold')
  ;['GESAMT', '', '', String(tot.days), hhmm(tot.ist), hhmm(tot.night), hhmm(tot.sun), hhmm(tot.hol), hhmm(tot.hol150), String(tot.vac)].forEach((x, i) => x && pdf.text(x, cols[i] + 1, y + 1))
  // Monatsübersicht
  pdf.addPage()
  head(pdf, `Dienstplan ${monthLabel(o.ym, true)} – Monatsübersicht`, o.company, W)
  const dates = monthDates(o.ym), x0 = 14, nameW = 44, cw = (W - 28 - nameW - 12) / dates.length
  y = 32; pdf.setFontSize(6.5); pdf.setFont('helvetica', 'bold')
  dates.forEach((d, i) => { const x = x0 + nameW + i * cw; pdf.text(d.slice(8), x + cw / 2, y - 3, { align: 'center' }); pdf.text(WD_DE[weekday(d)], x + cw / 2, y, { align: 'center' }) })
  pdf.text('Std.', W - 14 - 6, y, { align: 'center' }); y += 2
  pdf.setFont('helvetica', 'normal')
  const rh = Math.min(6, (200 - y) / Math.max(1, o.rows.length))
  for (const r of o.rows) {
    const by = new Map(r.shifts.map((s) => [s.shift_date, s]))
    pdf.setFontSize(6.5); pdf.text(pdfText(`${r.pnr || ''} ${r.name}`).slice(0, 34), x0, y + rh * 0.7)
    dates.forEach((d, i) => {
      const x = x0 + nameW + i * cw, s = by.get(d), u = r.vac.includes(d)
      const f = s ? FILL[shiftClass(s)] : u ? FILL.u : null
      if (f) { pdf.setFillColor(...f); pdf.rect(x + 0.15, y + 0.15, cw - 0.3, rh - 0.3, 'F') }
      const t = s ? `${tShort(s.start_time.slice(0, 5))}-${tShort(s.end_time.slice(0, 5))}` : u ? 'U' : ''
      if (t) { pdf.setFontSize(t.length > 7 ? 4.2 : 5); pdf.text(t, x + cw / 2, y + rh * 0.68, { align: 'center' }) }
    })
    pdf.setFontSize(6.5); pdf.text(hhmm(monthStat(r.shifts, []).ist), W - 14 - 6, y + rh * 0.7, { align: 'center' })
    pdf.setDrawColor(225); pdf.line(x0, y + rh, W - 14, y + rh); y += rh
  }
  return pdf.output('blob')
}

/** Mitarbeiterliste je Monat (bảng Lịch làm nhân viên) dạng PDF, A3 ngang, tô màu giống file Excel:
 * dòng thay đổi so với tháng trước nền cam (ô thay đổi cam đậm, chữ đậm), nhân viên mới nền xanh */
export function mitarbeiterlistePdf(o: { title: string; sub: string; headers: string[]; widths: number[]; right: boolean[]; rows: string[][]; marks: { row: 'new' | 'chg' | null; cells: boolean[] }[] }): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape', compress: true })
  const W = 420, H = 297, X0 = 10, avail = W - 2 * X0
  head(pdf, o.title, o.sub, W)
  const FS = 7, LH = 3
  pdf.setFontSize(FS)
  // Độ rộng cột theo nội dung: từ dài nhất của tiêu đề (đậm) và ô dài nhất, rồi co giãn cho vừa trang
  const tw = (t: string) => pdf.getTextWidth(pdfText(t))
  const nat = o.headers.map((h, i) => {
    pdf.setFont('helvetica', 'bold'); const hw = Math.max(...pdfText(h).split(/\s+/).map((w) => pdf.getTextWidth(w)), 6)
    pdf.setFont('helvetica', 'normal'); const cw = Math.max(0, ...o.rows.map((r) => tw(r[i] || '')))
    return Math.max(hw, cw, o.widths[i] ? 0 : 0) + 2
  })
  const tot = nat.reduce((a, b) => a + b, 0), ws = nat.map((w) => (w / tot) * avail)
  const xs: number[] = []; ws.reduce((x, w, i) => ((xs[i] = x), x + w), X0)
  const cellLines = (t: string, i: number) => pdf.splitTextToSize(pdfText(t), ws[i] - 1.6) as string[]
  let y = 30
  const th = () => {
    pdf.setFont('helvetica', 'bold')
    const ls = o.headers.map((h, i) => cellLines(h, i))
    const hh = Math.max(...ls.map((l) => l.length)) * LH + 2.4
    pdf.setFillColor(237, 237, 237); pdf.rect(X0, y, avail, hh, 'F')
    pdf.setDrawColor(190); pdf.rect(X0, y, avail, hh)
    ls.forEach((l, i) => { pdf.text(l, o.right[i] ? xs[i] + ws[i] - 0.8 : xs[i] + 0.8, y + 3, { align: o.right[i] ? 'right' : 'left' }); if (i) pdf.line(xs[i], y, xs[i], y + hh) })
    pdf.setFont('helvetica', 'normal'); y += hh
  }
  th()
  o.rows.forEach((r, ri) => {
    const ls = r.map((t, i) => cellLines(t, i)), rh = Math.max(1, ...ls.map((l) => l.length)) * LH + 2
    if (y + rh > H - 16) { pdf.addPage(); y = 14; th() }
    const m = o.marks[ri]
    if (m?.row === 'new') { pdf.setFillColor(198, 239, 206); pdf.rect(X0, y, avail, rh, 'F') }
    if (m?.row === 'chg') {
      pdf.setFillColor(255, 229, 180); pdf.rect(X0, y, avail, rh, 'F')
      m.cells.forEach((c, i) => { if (c) { pdf.setFillColor(255, 192, 0); pdf.rect(xs[i], y, ws[i], rh, 'F') } })
    }
    ls.forEach((l, i) => {
      pdf.setFont('helvetica', m?.row === 'chg' && m.cells[i] ? 'bold' : 'normal')
      pdf.text(l, o.right[i] ? xs[i] + ws[i] - 0.8 : xs[i] + 0.8, y + 3.1, { align: o.right[i] ? 'right' : 'left' })
    })
    pdf.setDrawColor(200); pdf.line(X0, y + rh, X0 + avail, y + rh)
    xs.forEach((x, i) => i && pdf.line(x, y, x, y + rh)); pdf.line(X0, y, X0, y + rh); pdf.line(X0 + avail, y, X0 + avail, y + rh)
    y += rh
  })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(110)
  if (o.marks.some((m) => m.row)) pdf.text('Orange: Änderung gegenüber Vormonat · Grün: neuer Mitarbeiter', X0, Math.min(y + 6, H - 8))
  const n = pdf.getNumberOfPages()
  for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(140); pdf.text(`Seite ${i} / ${n}`, W - X0, H - 6, { align: 'right' }) }
  return pdf.output('blob')
}
