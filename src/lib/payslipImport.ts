// Đọc bảng lương DATEV (PDF hoặc ZIP) trong trình duyệt, dùng để tự điền form Nhân viên mới
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { parsePayslip, type Payslip, type TextItem } from './payslip'

export type Slip = { p: Payslip; blob: Blob; file: string }

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
