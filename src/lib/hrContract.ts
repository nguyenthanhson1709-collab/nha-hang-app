// Arbeitsvertrag (Word): điền thông tin nhân viên vào mẫu hợp đồng của quán (Vollzeit/Teilzeit; Minijob dùng mẫu riêng)
import JSZip from 'jszip'
import { jsPDF } from 'jspdf'
import templateUrl from '../assets/arbeitsvertrag.docx?url'
import { dmy, pdfText } from './format'
import type { Employee } from './hr'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const num = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const money = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const WORDS = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf']
/** Số nguyên 2–12 viết bằng chữ như trong mẫu ("vier", "acht"), còn lại viết số ("7,5") */
const word = (v: number) => (Number.isInteger(v) && v >= 2 && v <= 12 ? WORDS[v] : num(v))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Số ngày làm/tuần gợi ý từ giờ/tuần (8 giờ một ngày), trong khoảng 2–6 */
export const guessDays = (weekly: number | null) => (weekly ? Math.min(6, Math.max(2, Math.round(weekly / 8))) : 5)
/** Phép tối thiểu theo luật (BUrlG: 24 Werktage ở tuần 6 ngày → 4 × số ngày làm/tuần) */
export const legalMinVacation = (days: number) => days * 4

export type ContractOpts = { job: string | null; days: number }
export type Missing = 'name' | 'address' | 'entry_date' | 'gross_monthly' | 'weekly_hours' | 'vacation_days' | 'job'

/** Các mục còn thiếu (để báo trước khi tạo hợp đồng) */
export function contractMissing(e: Employee, o?: ContractOpts): Missing[] {
  const m: Missing[] = []
  if (!`${e.first_name} ${e.last_name}`.trim()) m.push('name')
  if (!e.address?.trim()) m.push('address')
  if (!e.entry_date) m.push('entry_date')
  if (e.gross_monthly == null) m.push('gross_monthly')
  if (e.weekly_hours == null) m.push('weekly_hours')
  if (e.vacation_days == null) m.push('vacation_days')
  if (!(o ? o.job : e.job_title)?.trim()) m.push('job')
  return m
}

/** Điền mẫu: trả về file .docx và bản PDF (cùng nội dung) để lưu vào giấy tờ của nhân viên.
 *  Mục nào còn trống thì để dòng chấm để điền tay. */
export async function arbeitsvertrag(e: Employee, o: ContractOpts): Promise<{ docx: Blob; pdf: Blob }> {
  const zip = await JSZip.loadAsync(await (await fetch(templateUrl)).arrayBuffer())
  let xml = await zip.file('word/document.xml')!.async('string')
  // Tên và địa chỉ: mỗi phần một dòng (ngắt dòng trong cùng đoạn như khối Arbeitgeber)
  const name = [e.first_name, e.last_name].map((x) => (x || '').trim()).filter(Boolean).join(' ')
  const lines = [name || '....................', ...(e.address ? e.address.split(/\s*[,\n]\s*/).filter(Boolean) : ['....................'])]
  const days = o.days
  const weekly = e.weekly_hours != null ? Number(e.weekly_hours) : null
  const hpd = weekly != null ? Math.round((weekly / days) * 100) / 100 : null
  const vac = e.vacation_days != null ? Number(e.vacation_days) : null
  const min = legalMinVacation(days)
  const split = vac == null ? `Davon entfallen ${num(min)} Arbeitstage auf den gesetzlichen Mindesturlaub.`
    : vac > min ? `Davon entfallen ${num(min)} Arbeitstage auf den gesetzlichen Mindesturlaub und ${num(vac - min)} Arbeitstage auf den vertraglichen Zusatzurlaub.`
    : 'Dies entspricht dem gesetzlichen Mindesturlaub.'
  const vals: Record<string, string> = {
    START: e.entry_date ? dmy(e.entry_date) : '....../....../20....',
    SIGN: e.entry_date ? dmy(e.entry_date) : '....................',
    HOURS: weekly != null ? num(weekly) : '........',
    SALARY: e.gross_monthly != null ? money(Number(e.gross_monthly)) : '............',
    VACATION: vac != null ? num(vac) : '........',
    JOB: o.job?.trim() || '....................',
    DAYS_W: word(days),
    DAYS_C: cap(word(days)),
    HPD: hpd != null ? word(hpd) : '........',
    URLAUB_SPLIT: split,
  }
  xml = xml.replace('{{NAME_ADDR}}', lines.map(esc).join('</w:t><w:br/><w:t xml:space="preserve">'))
  for (const [k, v] of Object.entries(vals)) xml = xml.split(`{{${k}}}`).join(esc(v))
  zip.file('word/document.xml', xml)
  const docx = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const img = async (n: string) => { const f = zip.file(`word/media/${n}`); return f ? `data:image/png;base64,${await f.async('base64')}` : null }
  return { docx, pdf: docxToPdf(xml, await img('image1.png'), await img('image2.png')) }
}

type Para = { lines: { text: string; bold: boolean }[]; text: string; align: string; size: number; bold: boolean; after: number }
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** Đọc các đoạn văn của document.xml (chữ, căn lề, cỡ chữ, đậm, khoảng cách sau đoạn) */
function paragraphs(xml: string): Para[] {
  const body = xml.slice(xml.indexOf('<w:body>'))
  return (body.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map((p) => {
    const ppr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0]
    const align = (ppr.match(/<w:jc w:val="(\w+)"/) || [])[1] || 'left'
    const after = Number((ppr.match(/w:after="(\d+)"/) || [])[1] || 0) / 20
    let text = '', allBold = true, any = false, size = 12
    for (const r of p.match(/<w:r\b[\s\S]*?<\/w:r>/g) || []) {
      if (r.includes('<w:drawing>')) continue
      const rpr = (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0]
      const sz = rpr.match(/<w:sz w:val="(\d+)"/)
      let t = ''
      for (const m of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) t += m[1] != null ? unxml(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n'
      if (t.trim()) { any = true; if (!/<w:b\/>/.test(rpr)) allBold = false; if (sz) size = Number(sz[1]) / 2 }
      text += t
    }
    return { lines: [], text, align, size, bold: any && allBold, after }
  })
}

/** Dựng PDF A4 từ nội dung hợp đồng (Arial ~ Helvetica, lề 25 mm như mẫu), khối chữ ký có con dấu và chữ ký của quán */
function docxToPdf(xml: string, stamp: string | null, sign: string | null): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const W = 210, H = 297, L = 25, R = 25, TOP = 25, BOT = 22, CW = W - L - R
  const PT = 0.3528
  let y = TOP
  const all = paragraphs(xml)
  const sigAt = all.findIndex((p) => p.text.includes('____'))
  const body = sigAt >= 0 ? all.slice(0, sigAt) : all
  const newPage = () => { pdf.addPage(); y = TOP }
  body.forEach((p, i) => {
    const lh = p.size * PT * 1.15 * 1.08
    if (!p.text.trim()) { y += lh * 0.8; return }
    pdf.setFont('helvetica', p.bold ? 'bold' : 'normal'); pdf.setFontSize(p.size)
    const lines: string[] = p.text.split('\n').flatMap((seg) => pdf.splitTextToSize(pdfText(seg.replace(/\t/g, '    ')), CW) as string[])
    const heading = p.align === 'center' && p.bold && p.size > 12
    // Tiêu đề không đứng một mình cuối trang
    const need = lines.length * lh + (heading ? lh * 3 : 0)
    if (y + Math.min(need, lh * 3) > H - BOT) newPage()
    if (heading && i > 0) y += lh * 0.4
    lines.forEach((ln, k) => {
      if (y + lh > H - BOT) newPage()
      const last = k === lines.length - 1 || /\n/.test(p.text) // đoạn có ngắt dòng: không dàn đều
      if (p.align === 'center') pdf.text(ln, W / 2, y + lh * 0.75, { align: 'center' })
      else if (p.align === 'right') pdf.text(ln, W - R, y + lh * 0.75, { align: 'right' })
      else if (p.align === 'both' && !last) {
        // Dàn đều hai bên: chia khoảng trống thừa cho các khoảng cách giữa các từ
        const words = ln.trim().split(/\s+/)
        const gap = words.length > 1 ? (CW - words.reduce((a, w) => a + pdf.getTextWidth(w), 0)) / (words.length - 1) : 0
        let x = L
        for (const w of words) { pdf.text(w, x, y + lh * 0.75); x += pdf.getTextWidth(w) + gap }
      }
      else pdf.text(ln, L, y + lh * 0.75)
      y += lh
    })
    y += Math.max(p.after * PT, lh * 0.35)
  })
  // Khối chữ ký
  if (sigAt >= 0) {
    const sig = all.slice(sigAt)
    const dates = sig.find((p) => /\d{2}\.\d{2}\.\d{4}|\.{5,}/.test(p.text) && /Berlin/.test(p.text))
    const [d1, d2] = dates ? dates.text.split(/\s{3,}(?=Berlin)/).map((x) => x.replace(/\s+/g, ' ').trim()) : ['', '']
    if (y + 60 > H - BOT) newPage()
    y += 22
    const colR = L + CW / 2 + 8, lineW = 62
    if (stamp) pdf.addImage(stamp, 'PNG', L + 20, y - 21, 46, 22)
    if (sign) pdf.addImage(sign, 'PNG', L, y - 15, 30, 13)
    pdf.setDrawColor(0); pdf.setLineWidth(0.2)
    pdf.line(L, y, L + lineW, y); pdf.line(colR, y, colR + lineW, y)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11)
    pdf.text('(Arbeitgeber)', L, y + 5); pdf.text('(Arbeitnehmer)', colR, y + 5)
    pdf.text(pdfText(d1 || 'Berlin,'), L, y + 17); pdf.text(pdfText(d2 || 'Berlin,'), colR, y + 17)
    pdf.text('(Ort, Datum)', L, y + 22); pdf.text('(Ort, Datum)', colR, y + 22)
  }
  // Số trang
  const n = pdf.getNumberOfPages()
  for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text(String(i), W - R, H - 10, { align: 'right' }) }
  return pdf.output('blob')
}
