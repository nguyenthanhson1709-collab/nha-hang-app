import { supabase, BUCKET, type Doc, type KbRow, type Line, type Payment, type TaxRow, type ZBon } from './supabase'
import { monthRange, r2 } from './format'

export async function uploadFiles(rid: string, date: string, files: Blob[], names: string[]): Promise<string[]> {
  const out: string[] = []
  const [y, m] = date.split('-')
  for (let i = 0; i < files.length; i++) {
    const ext = (names[i].split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${rid}/${y}/${m}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, files[i], { contentType: files[i].type || undefined })
    if (error) throw error
    out.push(path)
  }
  return out
}

export const DOC_SELECT = '*, nh_document_payments(*), nh_document_taxes(*), nh_document_lines(*)'

export async function getDoc(id: string) {
  const { data, error } = await supabase.from('nh_documents').select(DOC_SELECT).eq('id', id).single()
  if (error) throw error
  const d = data as Doc
  d.nh_document_lines?.sort((a, b) => a.pos - b.pos)
  d.nh_document_taxes?.sort((a, b) => a.rate - b.rate)
  return d
}

export async function saveChildren(docId: string, payments: Payment[], taxes: TaxRow[], lines: Line[], replace: boolean) {
  if (replace) {
    for (const tb of ['nh_document_payments', 'nh_document_taxes', 'nh_document_lines']) {
      const { error } = await supabase.from(tb).delete().eq('document_id', docId)
      if (error) throw error
    }
  }
  const strip = <T extends { id?: string }>(a: T[]) => a.map(({ id: _id, ...x }) => ({ ...x, document_id: docId }))
  if (payments.length) { const { error } = await supabase.from('nh_document_payments').insert(strip(payments.filter((p) => p.amount > 0 || payments.length === 1))); if (error) throw error }
  if (taxes.length) { const { error } = await supabase.from('nh_document_taxes').insert(strip(taxes)); if (error) throw error }
  if (lines.length) { const { error } = await supabase.from('nh_document_lines').insert(strip(lines.map((l, i) => ({ ...l, pos: i })))); if (error) throw error }
}

export async function findDuplicate(rid: string, supplier: string | null, date: string, gross: number, excludeId?: string) {
  if (!supplier || !gross) return null
  let q = supabase.from('nh_documents').select('id').eq('restaurant_id', rid).eq('doc_date', date).ilike('supplier', supplier).eq('gross', gross)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q.limit(1)
  return data?.[0]?.id || null
}

export async function docsInRange(rid: string | null, from: string, to: string, byPeriod = false) {
  const all: Doc[] = []
  for (let off = 0; ; off += 1000) {
    let q = supabase.from('nh_documents').select(DOC_SELECT).order('doc_date').range(off, off + 999)
    if (rid) q = q.eq('restaurant_id', rid)
    if (byPeriod) q = q.gte('period', from.slice(0, 7)).lte('period', to.slice(0, 7))
    else q = q.gte('doc_date', from).lte('doc_date', to)
    const { data, error } = await q
    if (error) throw error
    all.push(...((data || []) as Doc[]))
    if (!data || data.length < 1000) break
  }
  return all
}

export async function zbonsInRange(rid: string | null, from: string, to: string) {
  let q = supabase.from('nh_zbons').select('*').gte('z_date', from).lte('z_date', to).order('z_date')
  if (rid) q = q.eq('restaurant_id', rid)
  const { data, error } = await q
  if (error) throw error
  return (data || []) as ZBon[]
}

export async function kassenbuch(rid: string, period: string) {
  const { data, error } = await supabase.from('nh_kassenbuch').select('*').eq('restaurant_id', rid).eq('period', period).order('nr')
  if (error) throw error
  return (data || []) as KbRow[]
}

/** Tồn quỹ hiện tại = số dư dòng cuối cùng (hoặc tồn đầu kỳ nếu chưa có dòng) */
export async function currentBalance(rid: string, opening: number) {
  const { data } = await supabase.from('nh_kassenbuch').select('saldo, entry_date').eq('restaurant_id', rid)
    .order('entry_date', { ascending: false }).order('period', { ascending: false }).order('nr', { ascending: false }).limit(1)
  return data?.[0] ? Number(data[0].saldo) : opening
}

/** Số dư trước ngày (dùng cho dòng "Tồn đầu ngày") */
export async function balanceBefore(rid: string, date: string, opening: number) {
  const { data } = await supabase.from('nh_kassenbuch').select('saldo').eq('restaurant_id', rid).lt('entry_date', date)
    .order('entry_date', { ascending: false }).order('nr', { ascending: false }).limit(1)
  return data?.[0] ? Number(data[0].saldo) : opening
}

export async function lockedPeriods(rid: string) {
  const { data } = await supabase.from('nh_periods').select('period, locked_at').eq('restaurant_id', rid)
  return new Set((data || []).map((x) => x.period as string))
}

export function folderParts(d: Doc): { folder: 'Bargeld' | 'Rechnungseingang' | 'Rechnungsausgang'; amount: number; method: string }[] {
  const pays = d.nh_document_payments || []
  if (d.kind === 'sales') return [{ folder: 'Rechnungsausgang', amount: d.gross, method: pays.map((p) => p.method).join('+') || '' }]
  if (!pays.length) return [{ folder: 'Rechnungseingang', amount: d.gross, method: '' }]
  const out: ReturnType<typeof folderParts> = []
  const cash = r2(pays.filter((p) => p.method === 'cash').reduce((s, p) => s + Number(p.amount), 0))
  const other = pays.filter((p) => p.method !== 'cash')
  if (cash > 0) out.push({ folder: 'Bargeld', amount: cash, method: 'cash' })
  for (const p of other) if (Number(p.amount) > 0) out.push({ folder: 'Rechnungseingang', amount: Number(p.amount), method: p.method })
  return out.length ? out : [{ folder: 'Rechnungseingang', amount: d.gross, method: pays[0].method }]
}

export { monthRange }
