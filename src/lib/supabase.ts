import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  // ?. để chạy được trong bài kiểm tra bằng Node (không có import.meta.env)
  (import.meta.env?.VITE_SUPABASE_URL as string) || 'http://localhost',
  (import.meta.env?.VITE_SUPABASE_KEY as string) || 'test',
)

export const BUCKET = 'nh-belege'

export type Role = 'owner' | 'manager' | 'staff'
export type PayMethod = 'cash' | 'card' | 'transfer'

export interface Profile { id: string; email: string; full_name: string; is_owner: boolean; lang: 'vi' | 'de'; home_title?: string | null }
export interface Restaurant {
  id: string; name: string; address: string | null; tax_number: string | null; active: boolean
  opening_cash: number; opening_date: string | null; tip_paid_cash: boolean; pos_type: string; card_source?: 'zbon' | 'viva'
  datev_consultant_no: string | null; datev_client_no: string | null
  pos_payment_map: Record<string, PayMethod>
}
export interface Category { id: string; parent_id: string | null; kind: 'food' | 'drink' | 'nonfood'; name_vi: string; name_de: string; skr_account: string | null; sort: number }
export interface TaxRow { id?: string; rate: number; net: number; tax: number; gross: number }
export interface Payment { id?: string; method: PayMethod; amount: number }
export interface Line { id?: string; pos: number; name: string; qty: number | null; unit: string | null; unit_price: number | null; total: number; rate: number | null; category_id: string | null }
export interface Doc {
  id: string; restaurant_id: string; kind: 'purchase' | 'sales'; status: 'uploaded' | 'reviewed'
  doc_date: string; period: string; supplier: string | null; invoice_no: string | null; seller_tax_id: string | null
  gross: number; note: string | null; files: string[]; ocr_text: string | null; flags: string[]
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string
  nh_document_payments?: Payment[]; nh_document_taxes?: TaxRow[]; nh_document_lines?: Line[]
}
export interface ZBon {
  id: string; restaurant_id: string; z_date: string; period: string; z_no: string | null
  net7: number; tax7: number; gross7: number; net19: number; tax19: number; gross19: number; gross0: number
  total: number; cash_pos: number; card_pos: number; card_terminal: number | null; tip: number; tip_card: number
  storno: number; storno_count: number; details: Record<string, unknown>; files: string[]; ocr_text: string | null
  cash_revenue: number; created_by: string | null; created_at: string
}
export interface KbRow {
  restaurant_id: string; entry_date: string; period: string; source: string; source_id: string
  text: string; einnahme: number; ausgabe: number; mwst: string | null; nr: number; saldo: number
}
export interface CashMove { id: string; restaurant_id: string; move_date: string; period: string; type: string; amount: number; description: string | null; files?: string[]; created_at: string; channel?: string | null }
export interface CashCount { restaurant_id: string; count_date: string; period: string; counted: number; book_balance: number; difference: number; reason: string | null }

export async function signedUrl(path: string) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl || ''
}

export async function downloadFile(path: string): Promise<Blob | null> {
  const { data } = await supabase.storage.from(BUCKET).download(path)
  return data
}

export function errMsg(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e)
  if (m.includes('NH_LOCKED')) return m.replace(/^.*NH_LOCKED:\s*/, '')
  return m
}
