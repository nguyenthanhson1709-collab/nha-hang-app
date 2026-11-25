// Tải bảng lương DATEV (PDF hoặc ZIP) vào hồ sơ nhân viên:
// tự tạo hồ sơ theo Personal-Nr., cập nhật thông tin, lưu từng bảng lương vào đúng người,
// người không còn bảng lương ở tháng sau = đã nghỉ việc.
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { supabase } from './supabase'
import { HR_BUCKET, type Employee } from './hr'
import { baseSalary, empTypeOf, hourlyOf, monthEnd, nameKey, parsePayslip, splitName, type Payslip, type TextItem } from './payslip'
import { dmy } from './format'

export type Slip = { p: Payslip; blob: Blob; file: string }
export interface ImportResult { created: string[]; updated: string[]; added: number; skipped: number; left: string[]; unread: string[] }

async function pdfjs() {
  const lib = await import('pdfjs-dist')
  const wurl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  lib.GlobalWorkerOptions.workerSrc = wurl
  return lib
}

/** Mở ZIP, lấy các file PDF */
async function expand(files: File[]): Promise<{ name: string; blob: Blob }[]> {
  const out: { name: string; blob: Blob }[] = []
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || f.type.includes('zip')) {
      const zip = await JSZip.loadAsync(f)
      for (const e of Object.values(zip.files)) {
        if (e.dir || !/\.pdf$/i.test(e.name) || e.name.includes('__MACOSX')) continue
        out.push({ name: e.name.split('/').pop()!, blob: new Blob([await e.async('arraybuffer')], { type: 'application/pdf' }) })
      }
    } else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') out.push({ name: f.name, blob: f })
  }
  return out
}

/** Đọc một PDF: mỗi trang một bảng lương (trang "Blatt 2" gộp vào trang trước) */
async function readPdf(name: string, blob: Blob): Promise<Slip[]> {
  const lib = await pdfjs()
  const buf = await blob.arrayBuffer()
  const doc = await lib.getDocument({ data: buf.slice(0) }).promise
  const groups: { p: Payslip; pages: number[] }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    const items: TextItem[] = (tc.items as { str: string; transform: number[] }[]).map((t) => ({ x: t.transform[4], y: t.transform[5], s: t.str }))
    const p = parsePayslip(items)
    const last = groups[groups.length - 1]
    if (p && !(last && last.p.pnr === p.pnr && last.p.period === p.period)) groups.push({ p, pages: [i - 1] })
    else if (last) last.pages.push(i - 1)
  }
  await doc.destroy()
  if (groups.length <= 1) return groups.map((g) => ({ p: g.p, blob, file: name }))
  const src = await PDFDocument.load(buf)
  const out: Slip[] = []
  for (const g of groups) {
    const d = await PDFDocument.create()
    for (const pg of await d.copyPages(src, g.pages)) d.addPage(pg)
    out.push({ p: g.p, blob: new Blob([await d.save() as BlobPart], { type: 'application/pdf' }), file: name })
  }
  return out
}

/** Đọc bảng lương từ một hoặc nhiều file (PDF / ZIP), không ghi gì vào cơ sở dữ liệu */
export async function readPayslips(files: File[]): Promise<Slip[]> {
  const out: Slip[] = []
  for (const f of await expand(files)) out.push(...await readPdf(f.name, f.blob))
  return out.sort((a, b) => a.p.period.localeCompare(b.p.period))
}

export async function importPayslips(rid: string, files: File[], onProgress: (s: string) => void): Promise<ImportResult> {
  const res: ImportResult = { created: [], updated: [], added: 0, skipped: 0, left: [], unread: [] }
  onProgress('ZIP…')
  const pdfs = await expand(files)
  const slips: Slip[] = []
  for (let i = 0; i < pdfs.length; i++) {
    onProgress(`PDF ${i + 1}/${pdfs.length}`)
    try {
      const s = await readPdf(pdfs[i].name, pdfs[i].blob)
      if (!s.length) res.unread.push(pdfs[i].name)
      slips.push(...s)
    } catch { res.unread.push(pdfs[i].name) }
  }
  if (!slips.length) return res

  const { data: emps, error } = await supabase.from('nh_employees').select('*').eq('restaurant_id', rid)
  if (error) throw error
  const list = (emps || []) as (Employee & { id: string; personnel_no: string | null })[]
  const { data: docs } = await supabase.from('nh_employee_docs').select('employee_id, period').eq('restaurant_id', rid).eq('kind', 'payslip')
  const have = new Set((docs || []).map((d) => `${d.employee_id}|${d.period}`))
  const periodsOf = new Map<string, string[]>()
  for (const d of docs || []) if (d.period) periodsOf.set(d.employee_id, [...(periodsOf.get(d.employee_id) || []), d.period])

  // Gom theo Personal-Nr.
  const byPnr = new Map<string, Slip[]>()
  for (const s of slips) byPnr.set(s.p.pnr, [...(byPnr.get(s.p.pnr) || []), s])
  const idOf = new Map<string, string>()
  let n = 0
  for (const [pnr, ss] of byPnr) {
    ss.sort((a, b) => a.p.period.localeCompare(b.p.period))
    const last = ss[ss.length - 1].p
    onProgress(`${++n}/${byPnr.size} ${last.name}`)
    let e = list.find((x) => x.personnel_no === pnr)
      || list.find((x) => !x.personnel_no && nameKey(`${x.first_name} ${x.last_name}`) === nameKey(last.name))
    const withBase = [...ss].reverse().find((s) => (baseSalary(s.p) || 0) > 0)?.p
    const typ = empTypeOf(withBase || last)
    const hourly = [...ss].reverse().map((s) => hourlyOf(s.p)).find((h) => h != null) ?? null
    const fromSlip: Partial<Employee> & { personnel_no: string } = {
      personnel_no: pnr, address: last.address, birth_date: last.birth, tax_class: last.taxClass, pension_no: last.svNo,
      health_insurance: last.health, tax_id: last.taxId, bank_name: last.bank, company: last.employer, entry_date: last.entry,
    }
    for (const k of Object.keys(fromSlip) as (keyof typeof fromSlip)[]) if (fromSlip[k] == null) delete fromSlip[k]
    const fill: Partial<Employee> = {}
    if (!e?.employment_type && typ.employment_type) fill.employment_type = typ.employment_type
    if (!e?.job_title && typ.job_title) fill.job_title = typ.job_title
    if (e?.gross_monthly == null && withBase) fill.gross_monthly = baseSalary(withBase)
    if (e?.hourly_wage == null && hourly != null) fill.hourly_wage = hourly
    // Làm lại sau khi đã nghỉ: ghi lại thời gian làm trước đó
    const prevExit = ss.map((s) => s.p.exit).filter((x): x is string => !!x && !!last.entry && x < last.entry).pop()
    const notes = [
      !e?.iban && last.ibanMasked && !(e?.note || '').includes(last.ibanMasked) ? `IBAN lt. Lohnabrechnung: ${last.ibanMasked}` : null,
      prevExit && !(e?.note || '').includes(dmy(prevExit)) ? `Früher beschäftigt bis ${dmy(prevExit)}` : null,
    ].filter(Boolean)
    if (notes.length) fill.note = [e?.note, ...notes].filter(Boolean).join('\n')

    if (!e) {
      const { data, error: ie } = await supabase.from('nh_employees').insert({ restaurant_id: rid, ...splitName(last.name), ...fromSlip, ...fill }).select('*').single()
      if (ie) throw ie
      e = data as typeof list[number]; list.push(e); res.created.push(last.name)
    } else {
      const { error: ue } = await supabase.from('nh_employees').update({ ...fromSlip, ...fill }).eq('id', e.id)
      if (ue) throw ue
      Object.assign(e, fromSlip, fill); res.updated.push(last.name)
    }
    idOf.set(pnr, e.id)

    for (const s of ss) {
      const key = `${e.id}|${s.p.period}`
      if (have.has(key)) { res.skipped++; continue }
      const path = `${rid}/${e.id}/${crypto.randomUUID()}.pdf`
      const { error: se } = await supabase.storage.from(HR_BUCKET).upload(path, s.blob, { contentType: 'application/pdf' })
      if (se) throw se
      const [y, m] = s.p.period.split('-')
      const { error: de } = await supabase.from('nh_employee_docs').insert({ restaurant_id: rid, employee_id: e.id, kind: 'payslip', period: s.p.period, title: `Lohnabrechnung ${m}/${y}`, path })
      if (de) throw de
      have.add(key); periodsOf.set(e.id, [...(periodsOf.get(e.id) || []), s.p.period]); res.added++
    }
  }

  // Nghỉ việc: có Austritt trên bảng lương cuối, hoặc tháng sau không còn bảng lương
  const maxPeriod = [...periodsOf.values()].flat().sort().pop()!
  for (const e of list) {
    const ps = (periodsOf.get(e.id) || []).sort()
    if (!ps.length) continue
    const latest = ps[ps.length - 1]
    const slip = byPnr.get(e.personnel_no || '')?.find((s) => s.p.period === latest)?.p
    let exit: string | null | undefined
    if (slip?.exit && (!slip.entry || slip.exit >= slip.entry)) exit = slip.exit
    else if (latest < maxPeriod) exit = e.exit_date || monthEnd(latest)
    else if (slip && e.exit_date && slip.entry && e.exit_date < slip.entry) exit = null   // đi làm lại
    if (exit === undefined || exit === e.exit_date) continue
    const { error: xe } = await supabase.from('nh_employees').update({ exit_date: exit, ...(exit ? {} : { exit_reason: null }) }).eq('id', e.id)
    if (xe) throw xe
    e.exit_date = exit
    if (exit) res.left.push(`${e.first_name} ${e.last_name} (${dmy(exit)})`)
  }

  // Tên công ty của quán, nếu chưa đặt
  const latestEmployer = [...slips].sort((a, b) => a.p.period.localeCompare(b.p.period)).pop()?.p.employer
  if (latestEmployer) {
    const { data: hs } = await supabase.from('nh_hr_settings').select('company_name').eq('restaurant_id', rid).maybeSingle()
    if (!hs?.company_name) await supabase.from('nh_hr_settings').upsert({ restaurant_id: rid, company_name: latestEmployer })
  }
  return res
}
