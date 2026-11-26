// Arbeitsvertrag (Word): điền thông tin nhân viên vào mẫu hợp đồng của quán (các chỗ chủ quán đánh dấu đỏ)
import JSZip from 'jszip'
import templateUrl from '../assets/arbeitsvertrag.docx?url'
import { dmy } from './format'
import type { Employee } from './hr'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const num = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const money = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Các mục còn thiếu trong hồ sơ (để báo trước khi tạo hợp đồng) */
export function contractMissing(e: Employee): ('name' | 'address' | 'entry_date' | 'gross_monthly' | 'weekly_hours' | 'vacation_days')[] {
  const m: ReturnType<typeof contractMissing> = []
  if (!`${e.first_name} ${e.last_name}`.trim()) m.push('name')
  if (!e.address?.trim()) m.push('address')
  if (!e.entry_date) m.push('entry_date')
  if (e.gross_monthly == null) m.push('gross_monthly')
  if (e.weekly_hours == null) m.push('weekly_hours')
  if (e.vacation_days == null) m.push('vacation_days')
  return m
}

/** Tạo file .docx; mục nào còn trống thì để dòng chấm để điền tay */
export async function arbeitsvertragDocx(e: Employee): Promise<Blob> {
  const zip = await JSZip.loadAsync(await (await fetch(templateUrl)).arrayBuffer())
  let xml = await zip.file('word/document.xml')!.async('string')
  // Tên và địa chỉ: mỗi phần một dòng (ngắt dòng trong cùng đoạn như khối Arbeitgeber)
  const name = [e.first_name, e.last_name].map((x) => (x || '').trim()).filter(Boolean).join(' ')
  const lines = [name || '....................', ...(e.address ? e.address.split(/\s*[,\n]\s*/).filter(Boolean) : ['....................'])]
  const start = e.entry_date ? dmy(e.entry_date) : '....../....../20....'
  const vals: Record<string, string> = {
    START: start,
    SIGN: e.entry_date ? dmy(e.entry_date) : '....................',
    HOURS: e.weekly_hours != null ? num(Number(e.weekly_hours)) : '........',
    SALARY: e.gross_monthly != null ? money(Number(e.gross_monthly)) : '............',
    VACATION: e.vacation_days != null ? num(Number(e.vacation_days)) : '........',
  }
  xml = xml.replace('{{NAME_ADDR}}', lines.map(esc).join('</w:t><w:br/><w:t xml:space="preserve">'))
  for (const [k, v] of Object.entries(vals)) xml = xml.split(`{{${k}}}`).join(esc(v))
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}
