// Tạo PDF hoá đơn mẫu để kiểm tra bố cục: npx tsx --tsconfig tsconfig.app.json scripts/render-invoice-sample.tsx out.pdf
import { renderToFile } from '@react-pdf/renderer'
import { createElement } from 'react'
import { InvoicePdf } from '../src/hoadon/InvoicePdf'
import { girocodeDataUrl } from '../src/hoadon/girocode'
const company: any = { name: 'Muster Restaurant GmbH', street: 'Musterstr. 1', zip: '10115', city: 'Berlin', phone: '030 123456', email: 'info@example.de', website: 'https://example.de', vat_id: 'DE000000000', tax_number: '00/000/00000', managing_director: 'Max Mustermann', bank_name: 'Musterbank', account_holder: 'Muster Restaurant GmbH', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001', payment_days: 7, intro_text: 'Vielen Dank für Ihre Bestellung.', closing_text: 'Bitte innerhalb von {tage} Tagen überweisen.', logo_url: null }
const inv: any = { invoice_number: '202611003', doc_type: 'invoice', customer_snapshot: { name: 'Muster GmbH', street: 'Hauptstr. 1', zip: '10115', city: 'Berlin', customer_number: 10001 }, invoice_date: '2026-11-26', delivery_type: 'delivery_date', delivery_date: '2026-11-26', language: 'de', price_mode: 'gross', intro_text: '', closing_text: '', due_date: '2026-12-03' }
const items: any = [{ name: '12 Pho Bo', description: 'mit Rindfleisch', quantity: 3, unit: 'Stück', unit_price_gross: 13.9, tax_rate: 7 }, { name: 'Cola 0,33', description: '', quantity: 3, unit: 'Stück', unit_price_gross: 3.5, tax_rate: 19 }]
const qr = await girocodeDataUrl({ name: company.account_holder, iban: company.iban, bic: company.bic, amount: 52.2, reference: 'Rechnung 202611003' })
await renderToFile(createElement(InvoicePdf, { company, invoice: inv, items, qrDataUrl: qr }) as any, process.argv[2] || 'invoice-sample.pdf')
console.log('ok')
