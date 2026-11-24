// Đọc hoá đơn / Z-Bon bằng AI qua edge function nh-read. Lỗi hoặc chưa có khoá -> trả null để dùng bộ đọc miễn phí.
import { supabase } from './supabase'
import { r2 } from './format'
import type { ParsedInvoice, ParsedZ } from './ocr'

async function toB64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

async function call<T>(kind: 'invoice' | 'zbon' | 'segment', rid: string, files: { blob: Blob; type: string }[], pages?: number): Promise<T | null> {
  const use = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
  if (!use.length) return null
  try {
    const body = { kind, restaurant_id: rid, pages, files: await Promise.all(use.map(async (f) => ({ type: f.type, data: await toB64(f.blob) }))) }
    const { data, error } = await supabase.functions.invoke('nh-read', { body })
    if (error || !data?.result) { console.warn('nh-read', error || data); return null }
    return data.result as T
  } catch (e) { console.warn('nh-read', e); return null }
}

export async function aiReadInvoice(rid: string, files: { blob: Blob; type: string }[]): Promise<ParsedInvoice | null> {
  const r = await call<ParsedInvoice>('invoice', rid, files)
  if (!r) return null
  r.gross = r2(r.gross || 0)
  r.taxes = (r.taxes || []).filter((t) => t.gross || t.net).map((t) => ({ rate: t.rate, net: r2(t.net), tax: r2(t.tax), gross: r2(t.gross) }))
  r.lines = r.lines || [] // giữ giá dòng như in trên hoá đơn (Netto hoặc Brutto)
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
