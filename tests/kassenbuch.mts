// Kiểm tra Kassenbuch chi tiết: npx tsx tests/kassenbuch.mts
import { writeFileSync } from 'node:fs'
import { kbLines, kbPdf, kbXlsx, kbTotals } from '../src/lib/kassenbuch.ts'

const r = { id: 'r1', name: 'Vietbowl Test', address: 'Berlin', tax_number: null, opening_cash: 0, tip_paid_cash: false } as never
const cats = [{ id: 'food', skr_account: '3300', parent_id: 'x' }, { id: 'buero', skr_account: '4930', parent_id: 'y' }, { id: 'rep', skr_account: '4980', parent_id: 'y' }] as never
const docs = [{
  id: 'd1', kind: 'purchase', status: 'reviewed', period: '2024-02', doc_date: '2024-02-01', supplier: 'Hamberger', invoice_no: '24-008-4032159', gross: 64.79, created_at: '2024-02-01T10:00',
  nh_document_payments: [{ method: 'cash', amount: 64.79 }],
  nh_document_taxes: [{ rate: 7, net: 2.95, tax: 0.21, gross: 3.16 }, { rate: 19, net: 51.79, tax: 9.84, gross: 61.63 }],
  nh_document_lines: [{ name: 'Reis', total: 3.16, rate: 7, category_id: 'food' }, { name: 'Papier', total: 33.14, rate: 19, category_id: 'buero' }, { name: 'Werkzeug', total: 28.49, rate: 19, category_id: 'rep' }],
}] as never
const zbons = [{ id: 'z1', z_date: '2024-02-01', z_no: '387', total: 5455.70, gross7: 123.70, tax7: 8.09, gross19: 5332.00, tax19: 851.33, cash_revenue: 1134.90, tip_card: 0, created_at: '2024-02-01T23:00' }] as never
const moves = [{ id: 'm1', move_date: '2024-02-01', type: 'geldtransit', amount: 360, description: null, created_at: '2024-02-01T23:30' }] as never

const L = kbLines(docs, zbons, moves, r, '2024-02', 5634.43, cats)
for (const x of L) console.log([x.date, x.beleg, x.ein, x.aus, x.rate, x.ust, x.vst, x.einNetto, x.ausNetto, x.saldo, x.konto, x.text].join(' | '))
const t = kbTotals(L)
const expectEnd = 5634.43 + 5455.70 - 4320.80 - 64.79 - 360
const end = L[L.length - 1].saldo
let fail = 0
if (Math.abs(end - expectEnd) > 0.001) { fail++; console.log('✗ Saldo cuối', end, 'mong đợi', expectEnd) }
if (L.filter((x) => x.text.startsWith('Hamberger')).map((x) => x.konto).join() !== '3300,4930,4980') { fail++; console.log('✗ tách food/nonfood') }
if (Math.abs(t.vst - (0.21 + 5.29 + 4.55)) > 0.011) { fail++; console.log('✗ VSt', t.vst) }
writeFileSync(process.argv[2] || '/tmp/kb.pdf', Buffer.from(await kbPdf(L, [], r, '2024-02', 5634.43).arrayBuffer()))
writeFileSync((process.argv[2] || '/tmp/kb.pdf').replace('.pdf', '.xlsx'), Buffer.from(await kbXlsx(L, r, '2024-02', 5634.43).arrayBuffer()))
console.log(fail ? `${fail} sai` : 'Tất cả đúng')
process.exit(fail ? 1 : 0)
