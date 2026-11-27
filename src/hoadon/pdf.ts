import { pdf } from '@react-pdf/renderer'
import { createElement } from 'react'
import { InvoicePdf } from './InvoicePdf'
import type { Company, Invoice, InvoiceItem } from './types'
import { girocodeDataUrl, qrReference } from './girocode'
import { computeTotals } from './money'
import { trimLogoUrl } from './logo'

export async function renderInvoicePdf(company: Company, invoice: Invoice, items: InvoiceItem[]): Promise<Blob> {
  const total = computeTotals(items, invoice.price_mode ?? 'gross').gross
  let qr: string | null = null
  if (invoice.doc_type !== 'quote' && company.iban && company.bic && total > 0 && invoice.invoice_number) {
    qr = await girocodeDataUrl({
      name: company.account_holder || company.name, iban: company.iban, bic: company.bic,
      amount: total, reference: qrReference(invoice.invoice_number),
    })
  }
  // Logo cũ có thể còn viền trắng rộng: cắt trước khi in để logo to đúng khung
  const co = company.logo_url ? { ...company, logo_url: await trimLogoUrl(company.logo_url) } : company
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdf(createElement(InvoicePdf, { company: co, invoice, items, qrDataUrl: qr }) as any).toBlob()
}

export { pdfFilename } from './docname'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Share the PDF through the device's share sheet (Gmail, WhatsApp, …). Returns false if not supported. */
export async function shareBlob(blob: Blob, filename: string, title: string, text: string): Promise<boolean> {
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (!nav.share || !nav.canShare?.({ files: [file] })) return false
  try { await nav.share({ files: [file], title, text }) } catch (e) { if ((e as Error).name !== 'AbortError') throw e }
  return true
}
