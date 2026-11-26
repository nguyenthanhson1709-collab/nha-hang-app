export interface Company {
  restaurant_id?: string
  name: string; street: string; zip: string; city: string
  phone: string; email: string; website: string
  vat_id: string; tax_number: string; managing_director: string
  register_court?: string; register_number?: string
  bank_name: string; account_holder: string; iban: string; bic: string
  payment_days: number
  intro_text: string; closing_text: string
  email_subject: string; email_body: string
  intro_text_en: string; closing_text_en: string
  email_subject_en: string; email_body_en: string
  logo_url: string | null
  text_presets?: TextPresets
}

export interface TextPresets { intro: string[]; closing: string[] }

export interface Customer {
  id: string
  restaurant_id: string
  customer_number: number | null
  kind: 'customer' | 'vendor'
  name: string
  street: string; supplement: string; zip: string; city: string; country: string
  emails: string; phone: string; vat_id: string; note: string
  archived: boolean
}

export interface Article {
  id: string
  restaurant_id: string
  number: string
  name: string
  description: string
  unit: string
  tax_rate: number
  price_net: number
  price_gross: number
  is_lunch: boolean
  archived: boolean
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'cancelled' | 'accepted'
export type DocType = 'invoice' | 'quote'

export interface CustomerSnapshot {
  customer_number?: number | null
  name?: string; street?: string; supplement?: string; zip?: string; city?: string; country?: string
}

export type DeliveryType = 'none' | 'delivery_date' | 'delivery_period' | 'service_date' | 'service_period'
export const DELIVERY_LABEL: Record<DeliveryType, string> = {
  delivery_date: 'Lieferdatum', delivery_period: 'Lieferzeitraum',
  service_date: 'Leistungsdatum', service_period: 'Leistungszeitraum', none: 'Kein Lieferdatum',
}
export const isPeriod = (t?: DeliveryType) => t === 'delivery_period' || t === 'service_period'

export interface Invoice {
  id: string
  restaurant_id: string
  invoice_number: string | null
  /** Số nhập tay cho bản nháp; được gán khi hoàn tất (để trống = số tự động) */
  desired_number?: string | null
  status: InvoiceStatus
  doc_type: DocType
  source_quote_id: string | null
  customer_id: string | null
  customer_snapshot: CustomerSnapshot
  invoice_date: string
  service_period: string
  delivery_type: DeliveryType
  language: 'de' | 'en'
  price_mode: 'gross' | 'net'
  delivery_date: string | null
  delivery_end: string | null
  due_date: string | null
  intro_text: string
  closing_text: string
  total_net: number
  total_tax: number
  total_gross: number
  sent_at: string | null
  sent_to: string | null
  paid_at: string | null
  created_at: string
}

export interface InvoiceItem {
  id?: string
  invoice_id?: string
  position: number
  article_id: string | null
  name: string
  description: string
  quantity: number
  unit: string
  unit_price_gross: number
  tax_rate: number
  line_total_gross: number
}

export const STATUS_LABEL: Record<'vi' | 'de', Record<InvoiceStatus, string>> = {
  vi: { draft: 'Nháp', open: 'Chưa thanh toán', paid: 'Đã thanh toán', cancelled: 'Đã huỷ', accepted: 'Đã chuyển hoá đơn' },
  de: { draft: 'Entwurf', open: 'Offen', paid: 'Bezahlt', cancelled: 'Storniert', accepted: 'In Rechnung gestellt' },
}
export const QUOTE_STATUS_LABEL: Record<'vi' | 'de', Record<InvoiceStatus, string>> = {
  vi: { draft: 'Nháp', open: 'Đang chờ', paid: 'Đã chuyển hoá đơn', accepted: 'Đã chuyển hoá đơn', cancelled: 'Bị từ chối' },
  de: { draft: 'Entwurf', open: 'Offen', paid: 'Angenommen', accepted: 'Angenommen', cancelled: 'Abgelehnt' },
}
