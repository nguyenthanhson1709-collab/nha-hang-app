// Đọc/ghi Supabase cho module viết hoá đơn. Mọi dữ liệu theo từng nhà hàng (restaurant_id).
import { supabase } from '../lib/supabase'
import type { Article, Company, Customer, CustomerSnapshot, Invoice, InvoiceItem, TextPresets } from './types'
import { computeTotals, round2 } from './money'

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

const EMPTY_COMPANY: Omit<Company, 'intro_text' | 'closing_text' | 'email_subject' | 'email_body' | 'intro_text_en' | 'closing_text_en' | 'email_subject_en' | 'email_body_en'> = {
  name: '', street: '', zip: '', city: '', phone: '', email: '', website: '', vat_id: '', tax_number: '', managing_director: '', register_court: '', register_number: '',
  bank_name: '', account_holder: '', iban: '', bic: '', payment_days: 7, logo_url: null,
}

/** Thông tin công ty của quán; chưa có thì tạo dòng mặc định (tên/địa chỉ lấy từ quán). */
export async function loadCompany(rid: string): Promise<Company> {
  const row = check(await supabase.from('nh_inv_company').select('*').eq('restaurant_id', rid).maybeSingle()) as Company | null
  if (row) return row
  const r = check(await supabase.from('nh_restaurants').select('name, address, tax_number').eq('id', rid).single()) as { name: string; address: string | null; tax_number: string | null }
  const m = (r.address || '').match(/^(.*?)[,\s]+(\d{5})\s+(.+)$/)
  const init = { ...EMPTY_COMPANY, restaurant_id: rid, name: r.name, street: m ? m[1].trim() : r.address || '', zip: m?.[2] || '', city: m?.[3] || '', tax_number: r.tax_number || '' }
  return check(await supabase.from('nh_inv_company').insert(init).select('*').single()) as Company
}
export async function saveCompany(rid: string, c: Partial<Company>) {
  const row = { ...c } as Record<string, unknown>
  delete row.restaurant_id; delete row.updated_at
  check(await supabase.from('nh_inv_company').update(row).eq('restaurant_id', rid))
}

/** Lưu danh sách câu mẫu (lời mở đầu / lời kết) của quán */
export async function saveTextPresets(rid: string, presets: TextPresets) {
  check(await supabase.from('nh_inv_company').update({ text_presets: presets }).eq('restaurant_id', rid))
}

export async function listCustomers(rid: string, includeArchived = false): Promise<Customer[]> {
  let q = supabase.from('nh_inv_customers').select('*').eq('restaurant_id', rid).order('name').limit(5000)
  if (!includeArchived) q = q.eq('archived', false)
  return check(await q) as Customer[]
}
export async function saveCustomer(rid: string, c: Partial<Customer>): Promise<Customer> {
  const row = { ...c, restaurant_id: rid } as Record<string, unknown>
  delete row.created_at; delete row.updated_at
  if (c.id) return check(await supabase.from('nh_inv_customers').update(row).eq('id', c.id).select().single()) as Customer
  if (!row.customer_number) row.customer_number = check(await supabase.rpc('nh_inv_next_customer', { p_restaurant: rid })) as number
  return check(await supabase.from('nh_inv_customers').insert(row).select().single()) as Customer
}

export async function listArticles(rid: string, includeArchived = false): Promise<Article[]> {
  let q = supabase.from('nh_inv_articles').select('*').eq('restaurant_id', rid).order('name').limit(5000)
  if (!includeArchived) q = q.eq('archived', false)
  const rows = check(await q) as Article[]
  return rows.map((a) => ({ ...a, tax_rate: Number(a.tax_rate), price_net: Number(a.price_net), price_gross: Number(a.price_gross) }))
}
export async function saveArticle(rid: string, a: Partial<Article>): Promise<Article> {
  const row = { ...a, restaurant_id: rid } as Record<string, unknown>
  delete row.created_at; delete row.updated_at
  if (a.id) return check(await supabase.from('nh_inv_articles').update(row).eq('id', a.id).select().single()) as Article
  return check(await supabase.from('nh_inv_articles').insert(row).select().single()) as Article
}
export async function insertMany(table: 'nh_inv_customers' | 'nh_inv_articles', rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 200) check(await supabase.from(table).insert(rows.slice(i, i + 200)))
}

export async function listInvoices(rid: string, docType: 'invoice' | 'quote' = 'invoice'): Promise<Invoice[]> {
  return check(await supabase.from('nh_invoices').select('*').eq('restaurant_id', rid).eq('doc_type', docType)
    .order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000)) as Invoice[]
}
export async function loadInvoice(id: string): Promise<{ invoice: Invoice; items: InvoiceItem[] }> {
  const invoice = check(await supabase.from('nh_invoices').select('*').eq('id', id).single()) as Invoice
  const items = (check(await supabase.from('nh_invoice_items').select('*').eq('invoice_id', id).order('position')) as InvoiceItem[])
    .map((i) => ({ ...i, quantity: Number(i.quantity), unit_price_gross: Number(i.unit_price_gross), tax_rate: Number(i.tax_rate) }))
  return { invoice, items }
}

export function snapshotOf(c: Customer | null | undefined): CustomerSnapshot {
  if (!c) return {}
  return { customer_number: c.customer_number, name: c.name, street: c.street, supplement: c.supplement, zip: c.zip, city: c.city, country: c.country }
}

/** Lưu nháp kèm các dòng. Trả về id hoá đơn. */
export async function saveDraft(rid: string, inv: Partial<Invoice>, items: InvoiceItem[]): Promise<string> {
  const totals = computeTotals(items, inv.price_mode ?? 'gross')
  const row = {
    restaurant_id: rid,
    status: 'draft',
    doc_type: inv.doc_type ?? 'invoice',
    source_quote_id: inv.source_quote_id ?? null,
    customer_id: inv.customer_id ?? null,
    customer_snapshot: inv.customer_snapshot ?? {},
    invoice_date: inv.invoice_date,
    service_period: inv.service_period ?? '',
    delivery_type: inv.delivery_type ?? 'none',
    language: inv.language ?? 'de',
    price_mode: inv.price_mode ?? 'gross',
    delivery_date: inv.delivery_type && inv.delivery_type !== 'none' ? inv.delivery_date || inv.invoice_date || null : null,
    delivery_end: inv.delivery_type === 'delivery_period' || inv.delivery_type === 'service_period' ? inv.delivery_end || null : null,
    due_date: inv.due_date ?? null,
    intro_text: inv.intro_text ?? '',
    closing_text: inv.closing_text ?? '',
    total_net: totals.net, total_tax: totals.tax, total_gross: totals.gross,
  }
  let id = inv.id
  if (id) check(await supabase.from('nh_invoices').update(row).eq('id', id))
  else id = (check(await supabase.from('nh_invoices').insert(row).select('id').single()) as { id: string }).id
  check(await supabase.from('nh_invoice_items').delete().eq('invoice_id', id))
  if (items.length) {
    check(await supabase.from('nh_invoice_items').insert(items.map((it, i) => ({
      invoice_id: id, position: i + 1, article_id: it.article_id, name: it.name, description: it.description ?? '',
      quantity: it.quantity, unit: it.unit, unit_price_gross: it.unit_price_gross, tax_rate: it.tax_rate,
      line_total_gross: round2(it.quantity * it.unit_price_gross),
    }))))
  }
  return id!
}

export async function finalizeInvoice(id: string): Promise<string> {
  return check(await supabase.rpc('nh_inv_finalize', { p_invoice: id })) as string
}

export async function setInvoiceStatus(id: string, status: 'open' | 'paid' | 'cancelled' | 'accepted') {
  check(await supabase.from('nh_invoices').update({
    status, paid_at: status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
  }).eq('id', id))
}

export async function findInvoiceFromQuote(quoteId: string): Promise<string | null> {
  const rows = check(await supabase.from('nh_invoices').select('id').eq('source_quote_id', quoteId).order('created_at', { ascending: false }).limit(1)) as { id: string }[]
  return rows[0]?.id ?? null
}

export async function deleteDraft(id: string) {
  check(await supabase.from('nh_invoices').delete().eq('id', id).is('invoice_number', null))
}

export async function markSent(id: string, to: string) {
  check(await supabase.from('nh_invoices').update({ sent_at: new Date().toISOString(), sent_to: to }).eq('id', id))
}

export async function sendInvoiceEmail(args: { invoiceId: string; to: string[]; subject: string; body: string; pdfBase64: string; filename: string }) {
  const { data, error } = await supabase.functions.invoke('nh-send-invoice', { body: args })
  if (error) {
    // Lấy thông báo lỗi cụ thể từ function nếu có
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) throw new Error(j.error) } catch (e) { if (e instanceof Error && e.message) throw e } }
    throw new Error(error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function getCounter(rid: string, period: string): Promise<number> {
  const rows = check(await supabase.from('nh_inv_counters').select('last_value').eq('restaurant_id', rid).eq('period', period)) as { last_value: number }[]
  return rows[0]?.last_value ?? 0
}
export async function setCounter(rid: string, period: string, value: number) {
  check(await supabase.rpc('nh_inv_set_counter', { p_restaurant: rid, p_period: period, p_value: value }))
}
