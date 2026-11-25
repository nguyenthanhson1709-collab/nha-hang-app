// Đọc hoá đơn / Z-Bon bằng AI qua edge function nh-read. Lỗi hoặc chưa có khoá -> trả null để dùng bộ đọc miễn phí.
import { supabase, BUCKET } from './supabase'
import { r2 } from './format'
import { flipNegative } from './lines'
import { shrinkImage, type ParsedInvoice, type ParsedZ } from './ocr'

async function toB64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

type F = { blob: Blob; type: string }
const MAX_FILES = 8 // giới hạn của nh-read
const MB = 1024 * 1024

/** Gộp nhiều ảnh/PDF thành một PDF (khi quá MAX_FILES file) */
async function mergeToPdf(files: F[]): Promise<F> {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  for (const f of files) {
    const bytes = new Uint8Array(await f.blob.arrayBuffer())
    if (f.type === 'application/pdf') {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p)
    } else {
      const img = f.type === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes)
      out.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    }
  }
  return { blob: new Blob([await out.save() as BlobPart], { type: 'application/pdf' }), type: 'application/pdf' }
}

/** Ảnh chụp điện thoại rất nặng: thu nhỏ bản gửi AI để yêu cầu không quá lớn (ảnh lưu trữ không đổi) */
export async function prepareForAi(files: F[]): Promise<F[]> {
  let use = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
  const total = () => use.reduce((s, f) => s + f.blob.size, 0)
  const shrink = async (max: number, q: number, over: number) => {
    use = await Promise.all(use.map(async (f) => {
      if (!f.type.startsWith('image/') || f.blob.size <= over) return f
      try { return { blob: await shrinkImage(f.blob, max, q), type: 'image/jpeg' } } catch { return f }
    }))
  }
  await shrink(2000, 0.8, 1.2 * MB)
  if (total() > 8 * MB) await shrink(1500, 0.65, 300 * 1024)
  if (use.length > MAX_FILES) use = [await mergeToPdf(use)]
  return use
}

async function call<T>(kind: 'invoice' | 'zbon' | 'segment', rid: string, files: F[], pages?: number): Promise<T | null> {
  let use: F[]
  try { use = await prepareForAi(files) } catch (e) { console.warn('nh-read prepare', e); return null }
  if (!use.length) return null
  const body = { kind, restaurant_id: rid, pages, files: await Promise.all(use.map(async (f) => ({ type: f.type, data: await toB64(f.blob) }))) }
  // Mạng di động hay rớt khi gửi file lớn: thử lại 1 lần
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('nh-read', { body })
      if (!error && data?.result) { lastAiError = ''; return data.result as T }
      console.warn('nh-read', error || data)
      const res = error && 'context' in error ? (error.context as Response) : null
      let detail = ''
      try { const j = res ? await res.clone().json() : data; detail = [j?.error, j?.status, j?.message].filter(Boolean).join(' · ') } catch { /* không đọc được nội dung lỗi */ }
      lastAiError = `${kind}: ${detail || (error as Error)?.message || 'không rõ'}`.slice(0, 300)
      if (res?.status && res.status < 500) return null
    } catch (e) { console.warn('nh-read', e); lastAiError = `${kind}: ${String((e as Error)?.message || e)}`.slice(0, 300) }
  }
  return null
}

/** Lỗi AI gần nhất (để báo cho người dùng và lưu vào chứng từ). Rỗng khi lần gọi cuối thành công. */
export let lastAiError = ''

export async function aiReadInvoice(rid: string, files: { blob: Blob; type: string }[]): Promise<ParsedInvoice | null> {
  const r = await call<ParsedInvoice>('invoice', rid, files)
  if (!r) return null
  r.gross = r2(r.gross || 0)
  r.taxes = (r.taxes || []).filter((t) => t.gross || t.net).map((t) => ({ rate: t.rate, net: r2(t.net), tax: r2(t.tax), gross: r2(t.gross) }))
  r.lines = r.lines || [] // giữ giá dòng như in trên hoá đơn (Netto hoặc Brutto)
  const fl = flipNegative(r.gross, r.taxes, r.lines) // tổng âm = Gutschrift
  if (fl) Object.assign(r, fl, { is_credit: true })
  if (r.is_credit) { r.gross = Math.abs(r.gross); r.taxes = r.taxes.map((t) => ({ ...t, net: Math.abs(t.net), tax: Math.abs(t.tax), gross: Math.abs(t.gross) })) }
  return r
}

export async function aiReadZbon(rid: string, files: { blob: Blob; type: string }[]): Promise<ParsedZ | null> {
  const r = await call<ParsedZ>('zbon', rid, files)
  if (!r) return null
  return { ...r, details: {} }
}

export type Segment = { start_page: number; end_page: number; supplier: string | null; invoice_no: string | null }
/** Chia một PDF nhiều hoá đơn thành từng hoá đơn (theo trang). null khi lỗi. */
export async function aiSegment(rid: string, pdf: Blob, pages: number): Promise<Segment[] | null> {
  const r = await call<{ invoices: Segment[] }>('segment', rid, [{ blob: pdf, type: 'application/pdf' }], pages)
  return r?.invoices || null
}

/** Bổ sung đơn vị (và số lượng / giá đơn vị nếu còn trống) cho dòng hàng của hoá đơn cũ.
 *  Chỉ điền ô trống, không đổi thành tiền, nhóm hàng hay tên. Trả về số dòng đã bổ sung. */
export async function fillUnits(d: { restaurant_id: string; files: string[]; nh_document_lines?: { id?: string; name: string; qty: number | null; unit: string | null; unit_price: number | null }[] }): Promise<number> {
  const lines = d.nh_document_lines || []
  if (!lines.length || !d.files.length) return 0
  const files = await Promise.all(d.files.map(async (p) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(p)
    if (error || !data) throw error || new Error('download')
    return { blob: data, type: data.type || (/\.pdf$/i.test(p) ? 'application/pdf' : 'image/jpeg') }
  }))
  const pi = await aiReadInvoice(d.restaurant_id, files)
  const got = pi?.lines || []
  if (!got.length) return 0
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '')
  const byName = new Map(got.map((l) => [norm(l.name), l]))
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.id || l.unit) continue
    const m = byName.get(norm(l.name)) || (got.length === lines.length ? got[i] : undefined)
    if (!m?.unit) continue
    const patch: Record<string, unknown> = { unit: m.unit }
    if (l.qty == null && m.qty != null) patch.qty = m.qty
    if (l.unit_price == null && m.unit_price != null) patch.unit_price = m.unit_price
    const { error } = await supabase.from('nh_document_lines').update(patch).eq('id', l.id)
    if (error) throw error
    Object.assign(l, patch); n++
  }
  return n
}
