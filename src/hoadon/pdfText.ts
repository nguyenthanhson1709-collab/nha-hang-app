import type { Company, DeliveryType } from './types'

export type Lang = 'de' | 'en'
export const LANGS: [Lang, string][] = [['de', 'Deutsch'], ['en', 'English']]

const de = {
  invoice: 'Rechnung', draft: 'Rechnung (Entwurf)', draftShort: 'Entwurf', number: 'Rechnungsnr.:', customerNo: 'Kundennr.:', date: 'Datum:', service: 'Leistung:',
  pos: 'Pos.', desc: 'Bezeichnung', qty: 'Menge', unit: 'Einheit', price: 'Einzel €', total: 'Gesamt €', grand: 'Gesamtbetrag*',
  taxIntro: (gross: string, net: string) => `* Im Gesamtbetrag von ${gross} € (Netto: ${net} €)`, taxVerb: (many: boolean): string => (many ? 'sind' : 'ist'), taxEnd: 'enthalten.' as string,
  noTax: 'ohne USt', vat: 'USt', qrTitle: 'Überweisen per Code', qr1: 'Ganz bequem Code mit der', qr2: 'Banking-App scannen.',
  phone: 'Tel.:', vatId: 'USt-IdNr.:', taxNo: 'Steuernummer:', md: 'Geschäftsführer:', page: 'Seite',
  priceNet: 'Netto €', totalNet: 'Gesamt €', netSum: 'Nettobetrag', plusVat: (r: string) => `zzgl. USt ${r} %`, grandNet: 'Gesamtbetrag',
  quote: 'Angebot', quoteDraft: 'Angebot (Entwurf)', quoteNumber: 'Angebotsnr.:', validUntil: 'Gültig bis:',
  quoteIntro: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot.',
  quoteClosing: 'Dieses Angebot ist gültig bis {gueltig}. Wir freuen uns auf Ihren Auftrag.\nMit freundlichen Grüßen\n{firma}',
  quoteSubject: 'Angebot {nummer}',
  quoteBody: 'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unser Angebot {nummer} über {betrag}.\n\nMit freundlichen Grüßen\n{firma}',
  delivery: { delivery_date: 'Lieferdatum', delivery_period: 'Lieferzeitraum', service_date: 'Leistungsdatum', service_period: 'Leistungszeitraum', none: '' } as Record<DeliveryType, string>,
}
const en: typeof de = {
  invoice: 'Invoice', draft: 'Invoice (draft)', draftShort: 'Draft', number: 'Invoice no.:', customerNo: 'Customer no.:', date: 'Date:', service: 'Service:',
  pos: 'No.', desc: 'Description', qty: 'Qty', unit: 'Unit', price: 'Price €', total: 'Amount €', grand: 'Total amount*',
  taxIntro: (gross: string, net: string) => `* The total amount of ${gross} € (net: ${net} €) includes`, taxVerb: () => '', taxEnd: '',
  noTax: 'without VAT', vat: 'VAT', qrTitle: 'Pay by code', qr1: 'Simply scan the code with', qr2: 'your banking app.',
  phone: 'Phone:', vatId: 'VAT ID:', taxNo: 'Tax number:', md: 'Managing director:', page: 'Page',
  priceNet: 'Net €', totalNet: 'Amount €', netSum: 'Net total', plusVat: (r: string) => `plus VAT ${r} %`, grandNet: 'Total amount',
  quote: 'Quote', quoteDraft: 'Quote (draft)', quoteNumber: 'Quote no.:', validUntil: 'Valid until:',
  quoteIntro: 'Thank you for your enquiry. We are pleased to submit the following quote.',
  quoteClosing: 'This quote is valid until {gueltig}. We look forward to your order.\nKind regards,\n{firma}',
  quoteSubject: 'Quote {nummer}',
  quoteBody: 'Dear Sir or Madam,\n\nplease find attached our quote {nummer} for {betrag}.\n\nKind regards,\n{firma}',
  delivery: { delivery_date: 'Delivery date', delivery_period: 'Delivery period', service_date: 'Service date', service_period: 'Service period', none: '' },
}
export const T = { de, en }

type TextKey = 'intro_text' | 'closing_text' | 'email_subject' | 'email_body'
const QUOTE_KEY = { intro_text: 'quoteIntro', closing_text: 'quoteClosing', email_subject: 'quoteSubject', email_body: 'quoteBody' } as const

/** Default text for a document in its language (quotes use built-in texts; invoices use company settings, falling back to German). */
export function companyText(c: Company, lang: Lang | undefined, key: TextKey, docType?: string): string {
  if (docType === 'quote') return T[lang === 'en' ? 'en' : 'de'][QUOTE_KEY[key]]
  if (lang === 'en') { const v = c[`${key}_en`]; if (v) return v }
  return c[key]
}
