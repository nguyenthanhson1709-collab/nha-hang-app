import type { Invoice } from './types'

/** PDF file name: Rechnung_/Invoice_/Angebot_/Quote_ + number (or draft). */
export function pdfFilename(inv: Partial<Invoice>) {
  const en = inv.language === 'en'
  const kind = inv.doc_type === 'quote' ? (en ? 'Quote' : 'Angebot') : (en ? 'Invoice' : 'Rechnung')
  return `${kind}_${inv.invoice_number ?? (en ? 'Draft' : 'Entwurf')}.pdf`
}
