// Tải lên 1 file PDF chứa nhiều hoá đơn: AI chia trang theo hoá đơn (1 hoá đơn có thể nhiều trang),
// tách thành từng PDF, đọc từng hoá đơn, lưu vào "Chờ kiểm tra".
import { PDFDocument } from 'pdf-lib'
import { supabase, type Category, type PayMethod } from './supabase'
import { r2 } from './format'
import { aiReadInvoice, aiSegment, type Segment } from './ai'
import { dupKey, findDuplicate, saveChildren, uploadFiles } from './data'
import { guessCategory, loadMemory } from './categorize'
import { autoProblems } from './autocheck'

export const MAX_PAGES = 200
export const MAX_MB = 25
const CHUNK = 20 // số trang mỗi lần nhờ AI chia

async function subPdf(src: PDFDocument, from: number, to: number): Promise<Blob> {
  const out = await PDFDocument.create()
  const idx = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
  for (const p of await out.copyPages(src, idx)) out.addPage(p)
  return new Blob([await out.save() as BlobPart], { type: 'application/pdf' })
}

/** Làm sạch kết quả AI: trong khoảng [a, b], không chồng nhau, phủ hết các trang */
export function cleanSegments(segs: Segment[], a: number, b: number): Segment[] {
  const s = segs
    .map((x) => ({ ...x, start_page: Math.max(a, Math.round(x.start_page)), end_page: Math.min(b, Math.round(x.end_page)) }))
    .filter((x) => x.start_page <= x.end_page)
    .sort((x, y) => x.start_page - y.start_page)
  const out: Segment[] = []
  for (const x of s) {
    const prev = out[out.length - 1]
    if (prev && x.start_page <= prev.end_page) { if (x.end_page > prev.end_page) prev.end_page = x.end_page; continue }
    if (prev && x.start_page > prev.end_page + 1) prev.end_page = x.start_page - 1 // trang bỏ sót -> gộp vào hoá đơn trước
    out.push({ ...x })
  }
  if (!out.length) return [{ start_page: a, end_page: b, supplier: null, invoice_no: null }]
  out[0].start_page = a
  out[out.length - 1].end_page = b
  return out
}

/** Chia toàn bộ file thành từng hoá đơn. File dài được chia theo từng đoạn; hoá đơn cuối mỗi đoạn được xét lại ở đoạn sau để không cắt đôi. */
async function segmentAll(rid: string, src: PDFDocument, n: number, onProgress: (s: string) => void): Promise<Segment[]> {
  const all: Segment[] = []
  let start = 1
  while (start <= n) {
    const end = Math.min(n, start + CHUNK - 1)
    onProgress(`🔎 ${start}–${end} / ${n}`)
    const blob = start === 1 && end === n ? new Blob([await src.save() as BlobPart], { type: 'application/pdf' }) : await subPdf(src, start, end)
    const raw = await aiSegment(rid, blob, end - start + 1)
    if (!raw) throw new Error('AI: không chia được hoá đơn / Rechnungen konnten nicht getrennt werden')
    const segs = cleanSegments(raw.map((x) => ({ ...x, start_page: x.start_page + start - 1, end_page: x.end_page + start - 1 })), start, end)
    if (end === n || segs.length === 1) { all.push(...segs); start = end + 1 }
    else { all.push(...segs.slice(0, -1)); start = segs[segs.length - 1].start_page }
  }
  return all
}

export type BulkResult = { added: { supplier: string | null; date: string; gross: number; pages: string; ok: boolean }[]; skipped: { supplier: string | null; date: string; gross: number; pages: string; why: string }[] }

export async function bulkUpload(opts: {
  rid: string; file: File; folder: 'Bargeld' | 'Rechnungseingang'; period: string; categories: Category[]; onProgress: (s: string) => void
}): Promise<BulkResult> {
  const { rid, file, folder, period, categories, onProgress } = opts
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`> ${MAX_MB} MB`)
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  const n = src.getPageCount()
  if (n > MAX_PAGES) throw new Error(`> ${MAX_PAGES} Seiten`)
  const segs = n === 1 ? [{ start_page: 1, end_page: 1, supplier: null, invoice_no: null }] : await segmentAll(rid, src, n, onProgress)
  const mem = await loadMemory()
  const res: BulkResult = { added: [], skipped: [] }
  const known = new Set<string>()
  let done = 0

  async function one(sg: Segment) {
    const pages = sg.start_page === sg.end_page ? `S. ${sg.start_page}` : `S. ${sg.start_page}–${sg.end_page}`
    const part = await subPdf(src, sg.start_page, sg.end_page)
    const pi = await aiReadInvoice(rid, [{ blob: part, type: 'application/pdf' }])
    const date = pi?.doc_date || `${period}-01`
    if (!pi) { res.skipped.push({ supplier: sg.supplier, date, gross: 0, pages, why: 'AI' }); return }
    const gross = r2(pi.gross || pi.taxes.reduce((s, x) => s + x.gross, 0))
    const key = dupKey({ supplier: pi.supplier, invoice_no: pi.invoice_no, doc_date: date, gross })
    if ((key && known.has(key)) || await findDuplicate(rid, pi.supplier, date, gross, undefined, pi.invoice_no)) {
      res.skipped.push({ supplier: pi.supplier, date, gross, pages, why: 'dup' }); return
    }
    if (key) known.add(key)
    // Bargeld = trả tiền mặt; Rechnung = thẻ nếu hoá đơn ghi thẻ, còn lại chuyển khoản
    const payment: PayMethod = folder === 'Bargeld' ? 'cash' : pi.payment === 'card' ? 'card' : 'transfer'
    const files = await uploadFiles(rid, date, [part], ['rechnung.pdf'])
    const ok = autoProblems(pi, payment).length === 0
    const { data: doc, error } = await supabase.from('nh_documents').insert({
      restaurant_id: rid, kind: 'purchase', is_credit: !!pi.is_credit, ref_invoice_no: pi.is_credit ? pi.ref_invoice_no || null : null, status: ok ? 'reviewed' : 'uploaded', doc_date: date, period: date.slice(0, 7),
      supplier: pi.supplier, invoice_no: pi.invoice_no, seller_tax_id: pi.seller_tax_id, gross, files,
      ocr_text: ('AI: ' + JSON.stringify(pi)).slice(0, 50000),
    }).select().single()
    if (error) throw error
    if (pi.supplier) {
      const { data: ex } = await supabase.from('nh_suppliers').select('id').ilike('name', pi.supplier.replace(/[%_]/g, '')).limit(1)
      if (!ex?.length) await supabase.from('nh_suppliers').insert({ name: pi.supplier, tax_id: pi.seller_tax_id })
    }
    await saveChildren(doc.id, [{ method: payment, amount: gross }], pi.taxes,
      pi.lines.map((l, i) => ({ pos: i, name: l.name, qty: l.qty, unit: l.unit || null, unit_price: l.unit_price, total: l.total, rate: l.rate, category_id: guessCategory(l.name, categories, mem).id })),
      false)
    res.added.push({ supplier: pi.supplier, date, gross, pages, ok })
  }

  // Đọc tối đa 3 hoá đơn cùng lúc
  let next = 0
  const worker = async () => {
    while (next < segs.length) {
      const sg = segs[next++]
      try { await one(sg) } catch (e) { res.skipped.push({ supplier: sg.supplier, date: '', gross: 0, pages: `S. ${sg.start_page}–${sg.end_page}`, why: String((e as Error)?.message || e).slice(0, 80) }) }
      done++; onProgress(`📄 ${done}/${segs.length}`)
    }
  }
  onProgress(`📄 0/${segs.length}`)
  await Promise.all([worker(), worker(), worker()])
  res.added.sort((a, b) => a.pages.localeCompare(b.pages, undefined, { numeric: true }))
  return res
}

export type ZBulkResult = { added: { date: string; total: number; src: string; warn: boolean }[]; skipped: { src: string; date: string; why: string }[] }

/** Tải nhiều Z-Bon (ảnh hoặc PDF, PDF nhiều ngày được tách theo ngày) -> lưu thẳng vào nh_zbons để viết Kassenbuch */
export async function bulkZbon(opts: { rid: string; files: File[]; onProgress: (s: string) => void }): Promise<ZBulkResult> {
  const { rid, files, onProgress } = opts
  const parts: { blob: Blob; type: string; name: string; src: string }[] = []
  for (const f of files) {
    if (f.size > MAX_MB * 1024 * 1024) throw new Error(`${f.name} > ${MAX_MB} MB`)
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    if (!isPdf) { parts.push({ blob: f, type: f.type || 'image/jpeg', name: f.name, src: f.name }); continue }
    const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true })
    const n = src.getPageCount()
    if (n > MAX_PAGES) throw new Error(`${f.name} > ${MAX_PAGES} Seiten`)
    if (n === 1) { parts.push({ blob: f, type: 'application/pdf', name: 'zbon.pdf', src: f.name }); continue }
    for (const sg of await segmentAll(rid, src, n, onProgress))
      parts.push({ blob: await subPdf(src, sg.start_page, sg.end_page), type: 'application/pdf', name: 'zbon.pdf', src: `${f.name} S. ${sg.start_page}${sg.end_page > sg.start_page ? '–' + sg.end_page : ''}` })
  }
  const { aiReadZbon } = await import('./ai')
  const res: ZBulkResult = { added: [], skipped: [] }
  let next = 0, done = 0
  const worker = async () => {
    while (next < parts.length) {
      const p = parts[next++]
      try {
        const z = await aiReadZbon(rid, [{ blob: p.blob, type: p.type }])
        if (!z || !z.z_date || !/^\d{4}-\d{2}-\d{2}$/.test(z.z_date)) { res.skipped.push({ src: p.src, date: '', why: 'AI' }); continue }
        const { data: ex } = await supabase.from('nh_zbons').select('id').eq('restaurant_id', rid).eq('z_date', z.z_date).limit(1)
        if (ex?.length) { res.skipped.push({ src: p.src, date: z.z_date, why: 'dup' }); continue }
        const fl = await uploadFiles(rid, z.z_date, [p.blob], [p.name])
        const { details: _d, ...vals } = z
        const row = { ...vals, restaurant_id: rid, period: z.z_date.slice(0, 7), files: fl, card_terminal: null, tip_card: 0, details: {}, ocr_text: ('AI: ' + JSON.stringify(z)).slice(0, 50000) }
        const { error } = await supabase.from('nh_zbons').insert(row)
        if (error) { res.skipped.push({ src: p.src, date: z.z_date, why: error.code === '23505' ? 'dup' : error.message.slice(0, 80) }); continue }
        const warn = Math.abs(z.net7 + z.tax7 - z.gross7) > 0.02 || Math.abs(z.net19 + z.tax19 - z.gross19) > 0.02 || Math.abs(z.gross7 + z.gross19 + (z.gross0 || 0) - z.total) > 0.05
        res.added.push({ date: z.z_date, total: Number(z.total), src: p.src, warn })
      } catch (e) { res.skipped.push({ src: p.src, date: '', why: String((e as Error)?.message || e).slice(0, 80) }) }
      finally { done++; onProgress(`🧾 ${done}/${parts.length}`) }
    }
  }
  onProgress(`🧾 0/${parts.length}`)
  await Promise.all([worker(), worker(), worker()])
  res.added.sort((a, b) => a.date.localeCompare(b.date))
  return res
}
