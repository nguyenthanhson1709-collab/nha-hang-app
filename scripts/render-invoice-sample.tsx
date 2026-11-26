// Tạo PDF hoá đơn mẫu để kiểm tra bố cục (dữ liệu giả):
//   npx tsx --tsconfig tsconfig.app.json scripts/render-invoice-sample.tsx out.pdf [số dòng] [logo.png]
import { readFileSync } from 'node:fs'
import { renderToFile } from '@react-pdf/renderer'
import { createElement } from 'react'
import { InvoicePdf } from '../src/hoadon/InvoicePdf'
import { girocodeDataUrl, qrReference } from '../src/hoadon/girocode'
import { computeTotals } from '../src/hoadon/money'
const [out = 'invoice-sample.pdf', nArg = '2', logo] = process.argv.slice(2)
const company: any = { name: 'Muster Restaurant GmbH', street: 'Musterstr. 1', zip: '10115', city: 'Berlin', phone: '030 123456', email: 'info@example.de', website: 'https://example.de', vat_id: 'DE000000000', tax_number: '00/000/00000', managing_director: 'Max Mustermann', register_court: 'Charlottenburg', register_number: 'HRB 000000 B', bank_name: 'Musterbank', account_holder: 'Muster Restaurant GmbH', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001', payment_days: 7, intro_text: 'Vielen Dank für Ihre Bestellung. Wir stellen Ihnen folgende Leistungen in Rechnung:', closing_text: 'Bitte überweisen Sie den Rechnungsbetrag innerhalb von {tage} Tagen unter Angabe der Rechnungsnummer.\nVielen Dank für Ihr Vertrauen!', logo_url: logo ? `data:image/png;base64,${readFileSync(logo).toString('base64')}` : null }
const inv: any = { invoice_number: '202611003', doc_type: 'invoice', customer_snapshot: { name: 'Muster GmbH', supplement: 'z. Hd. Buchhaltung', street: 'Hauptstr. 1', zip: '10115', city: 'Berlin', customer_number: 10001 }, invoice_date: '2026-11-26', delivery_type: 'service_date', delivery_date: '2026-11-26', language: 'de', price_mode: 'gross', intro_text: '', closing_text: '', due_date: '2026-12-03' }
const base = [{ name: '12 Pho Bo', description: 'mit Rindfleisch', unit: 'Stück', unit_price_gross: 13.9, tax_rate: 7 }, { name: 'Cola 0,33', description: '', unit: 'Stück', unit_price_gross: 3.5, tax_rate: 19 }]
const items: any = Array.from({ length: Number(nArg) }, (_, i) => ({ ...base[i % 2], quantity: (i % 3) + 1 }))
const total = computeTotals(items, 'gross').gross
const qr = await girocodeDataUrl({ name: company.account_holder, iban: company.iban, bic: company.bic, amount: total, reference: qrReference(inv.invoice_number) })
await renderToFile(createElement(InvoicePdf, { company, invoice: inv, items, qrDataUrl: qr }) as any, out)
console.log('ok')
