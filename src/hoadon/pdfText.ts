import type { Company, DeliveryType } from './types'

export type Lang = 'de' | 'en'
export const LANGS: [Lang, string][] = [['de', 'Deutsch'], ['en', 'English']]

const de = {
  invoice: 'Rechnung', draft: 'Rechnung (Entwurf)', draftShort: 'Entwurf', nr: 'Nr.',
  number: 'Rechnungsnummer', customerNo: 'Kundennummer', date: 'Rechnungsdatum', dueDate: 'Zahlbar bis', service: 'Leistung',
  pos: 'Pos.', desc: 'Bezeichnung', qty: 'Menge', unit: 'Einheit', price: 'Einzel €', total: 'Gesamt €',
  priceNet: 'Einzel netto €', totalNet: 'Gesamt netto €',
  netSum: 'Nettobetrag', vatLine: (r: string) => `Umsatzsteuer ${r} %`, vatOn: (net: string) => `auf ${net} €`, noVat: 'Umsatzsteuerfrei 0 %', grand: 'Gesamtbetrag',
  qrTitle: 'Bequem per QR-Code bezahlen', qrText: 'Scannen Sie den QR-Code mit Ihrer Banking-App.',
  payTitle: 'Zahlung per Überweisung', recipient: 'Empfänger', reference: 'Verwendungszweck', amount: 'Betrag', refPrefix: 'Rechnung',
  fContact: 'Kontaktdaten', fCompany: 'Unternehmensdaten', fBank: 'Bankverbindung',
  phone: 'Tel.', vatId: 'USt-IdNr.', taxNo: 'Steuernummer', md: 'Geschäftsführer', court: 'Amtsgericht', holder: 'Kontoinhaber', page: 'Seite',
  quote: 'Angebot', quoteDraft: 'Angebot (Entwurf)', quoteNumber: 'Angebotsnummer', quoteDate: 'Angebotsdatum', validUntil: 'Gültig bis',
  quoteIntro: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot.',
  quoteClosing: 'Dieses Angebot ist gültig bis {gueltig}. Wir freuen uns auf Ihren Auftrag.\nMit freundlichen Grüßen\n{firma}',
  quoteSubject: 'Angebot {nummer}',
  quoteBody: 'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unser Angebot {nummer} über {betrag}.\n\nMit freundlichen Grüßen\n{firma}',
  delivery: { delivery_date: 'Lieferdatum', delivery_period: 'Lieferzeitraum', service_date: 'Leistungsdatum', service_period: 'Leistungszeitraum', none: '' } as Record<DeliveryType, string>,
}
const en: typeof de = {
  invoice: 'Invoice', draft: 'Invoice (draft)', draftShort: 'Draft', nr: 'No.',
  number: 'Invoice number', customerNo: 'Customer number', date: 'Invoice date', dueDate: 'Payable by', service: 'Service',
  pos: 'No.', desc: 'Description', qty: 'Qty', unit: 'Unit', price: 'Price €', total: 'Amount €',
  priceNet: 'Net price €', totalNet: 'Net amount €',
  netSum: 'Net amount', vatLine: (r: string) => `VAT ${r} %`, vatOn: (net: string) => `on ${net} €`, noVat: 'VAT exempt 0 %', grand: 'Total amount',
  qrTitle: 'Pay conveniently by QR code', qrText: 'Scan the QR code with your banking app.',
  payTitle: 'Payment by bank transfer', recipient: 'Recipient', reference: 'Reference', amount: 'Amount', refPrefix: 'Invoice',
  fContact: 'Contact', fCompany: 'Company details', fBank: 'Bank details',
  phone: 'Phone', vatId: 'VAT ID', taxNo: 'Tax number', md: 'Managing director', court: 'Register court', holder: 'Account holder', page: 'Page',
  quote: 'Quote', quoteDraft: 'Quote (draft)', quoteNumber: 'Quote number', quoteDate: 'Quote date', validUntil: 'Valid until',
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
