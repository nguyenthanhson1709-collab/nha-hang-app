// Arbeitgeberbestätigung (PDF): giấy xác nhận của chủ, dùng mẫu thư của quán (nền thư in sẵn, điền thông tin nhân viên)
import { jsPDF } from 'jspdf'
import bgUrl from '../assets/arbeitgeberbestaetigung-bg.jpg?url'
import { dmy } from './format'
import type { Employee } from './hr'

export type Anrede = 'Herr' | 'Frau'
export type BestaetigungOpts = { anrede: Anrede; job: string | null; date: string }

/** Giữ ký tự dùng được với phông chuẩn của PDF (Latin-1, gạch ngang –) */
const t = (s: string) => s.replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
  .replace(/[^\u0000-ÿ€–—„“”‚‘’]/g, (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '')).replace(/[^\u0000-ÿ€–—„“”‚‘’]/g, '?')

async function dataUrl(url: string) {
  const b = await (await fetch(url)).blob()
  return new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b) })
}

/** Mục còn thiếu để báo trước khi tạo */
export function bestaetigungMissing(e: Employee, job: string | null): ('name' | 'birth_date' | 'birth_place' | 'address' | 'entry_date' | 'job')[] {
  const m: ReturnType<typeof bestaetigungMissing> = []
  if (!`${e.first_name}${e.last_name}`.trim()) m.push('name')
  if (!e.birth_date) m.push('birth_date')
  if (!e.birth_place?.trim()) m.push('birth_place')
  if (!e.address?.trim()) m.push('address')
  if (!e.entry_date) m.push('entry_date')
  if (!job?.trim()) m.push('job')
  return m
}

export async function arbeitgeberbestaetigungPdf(e: Employee, o: BestaetigungOpts): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const W = 595.28, H = 841.89
  pdf.addImage(await dataUrl(bgUrl), 'JPEG', 0, 0, W, H)
  const dots = '...............'
  const name = [e.first_name, e.last_name].map((x) => (x || '').trim()).filter(Boolean).join(' ') || dots
  const addr = (e.address || '').split(/\s*[,\n]\s*/).filter(Boolean)
  pdf.setTextColor(0, 0, 0)
  // Khối người nhận (bên trái, dưới dòng địa chỉ quán)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5)
  pdf.text(o.anrede === 'Herr' ? 'Herrn' : 'Frau', 77.9, 201.2)
  pdf.setFont('helvetica', 'bold')
  ;[name, ...(addr.length ? addr : [dots])].slice(0, 4).forEach((ln, i) => pdf.text(t(ln), 77.9, 219.6 + i * 18.2))
  // Ngày viết (bên phải)
  pdf.setFontSize(8.5)
  const d = `den ${dmy(o.date)}`
  pdf.setFont('helvetica', 'normal'); pdf.text(d, 539, 294, { align: 'right' })
  const dw = pdf.getTextWidth(` ${d}`)
  pdf.setFont('helvetica', 'bold'); pdf.text('Berlin,', 539 - dw, 294, { align: 'right' })
  // Nội dung
  const body = `Hiermit bestätigen wir, dass ${o.anrede} ${name} – geboren am ${e.birth_date ? dmy(e.birth_date) : dots} in ${e.birth_place?.trim() || dots}, `
    + `wohnhaft in der ${addr.length ? addr.join(', ') : dots} – seit dem ${e.entry_date ? dmy(e.entry_date) : dots} in einem unbefristeten und ungekündigten `
    + `Arbeitsverhältnis als ${o.job?.trim() || dots} in unserem Unternehmen tätig ist.`
  pdf.setFont('times', 'normal')
  // Vừa 4 dòng như mẫu (không đè lên "Mit freundlichen Grüßen")
  let size = 11.5, lines: string[] = []
  for (; size >= 9.5; size -= 0.5) { pdf.setFontSize(size); lines = pdf.splitTextToSize(t(body), 440) as string[]; if (lines.length <= 4) break }
  lines.slice(0, 4).forEach((ln, i) => pdf.text(ln, 92.2, 377.4 + i * 22.9))
  return pdf.output('blob')
}
