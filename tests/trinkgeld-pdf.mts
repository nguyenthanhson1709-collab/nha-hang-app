// Trinkgeld-PDF: mehrseitig, Seitenzahlen, Kopfzeile wiederholt (Testdaten, kein echter Beleg). npx tsx tests/trinkgeld-pdf.mts
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { writeFileSync } from 'node:fs'
import { TgPdf } from '../src/trinkgeld/TgPdf'
import { distribute } from '../src/trinkgeld/calc'

const company = { name: 'Testfirma GmbH', street: 'Teststraße 1', zip: '10115', city: 'Berlin', phone: '030 000', email: 'test@example.com', website: 'example.com',
  vat_id: 'DE000000000', tax_number: '00/000/00000', managing_director: 'Test', register_court: 'Charlottenburg', register_number: 'HRB 0 B', bank_name: 'Testbank', account_holder: 'Testfirma GmbH', iban: 'DE00 0000 0000 0000 0000 00', bic: 'TESTDEXX', logo_url: null } as never
const n = 46
const mins = Array.from({ length: n }, (_, i) => 3000 + i * 137)
const d = distribute(887_806, mins.map((m) => ({ minutes: m, participates: true })), 'euro')
const s = { id: 'x', restaurant_id: 'r', period: '2026-10', beleg_no: 'TG-2026-10', kind: 'original', ref_id: null, status: 'festgeschrieben', betriebsstaette: 'Test', period_from: '2026-10-01', period_to: '2026-10-31', stichtag: '2026-10-31', created_on: '2026-11-03',
  tip_source: 'differenz', terminal_cents: 25_271_353, z_cents: 24_383_547, pos_tip_cents: null, z_from: '1357', z_to: '1387', cash_tip_cents: 0, carry_in_cents: 0, correction_cents: 0, correction_reason: null, remarks: null, tip_confirmed: true,
  rounding: 'euro', available_cents: 887_806, total_minutes: d.totalMinutes, payout_cents: d.payout, rest_cents: d.rest, data_source: 'Testdaten' } as never
const lines = mins.map((m, i) => ({ id: `l${i}`, settlement_id: 'x', restaurant_id: 'r', employee_id: `e${i}`, personnel_no: String(100 + i), first_name: `Vorname${i}`, last_name: `Testperson${i}`, emp_type: null, department: null, exit_date: i === 3 ? '2026-10-15' : null, minutes_auto: m, minutes: m, edit_reason: null, participates: true, amount_cents: d.amounts[i], sort: i }))
const buf = await renderToBuffer(createElement(TgPdf, { company, s, lines, payments: [{ id: 'p', settlement_id: 'x', line_id: 'l0', restaurant_id: 'r', employee_id: 'e0', amount_cents: d.amounts[0], paid_on: '2026-11-05', method: 'bar', receipt_no: null, booking_ref: null, paid_by: null, remarks: null, files: [], cash_move_id: null, cancelled_at: null, cancel_reason: null, created_by: null, created_at: '' }] as never, restaurantName: 'Test' }) as never)
const txt = buf.toString('latin1')
const pages = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length
writeFileSync(process.argv[2] || '/tmp/tg-test.pdf', buf)
let fails = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
ok(buf.length > 5000 && txt.startsWith('%PDF'), `PDF erzeugt (${(buf.length / 1024).toFixed(0)} KB)`)
ok(pages >= 2, `Mehrseitig: ${pages} Seiten bei ${n} Mitarbeitern`)
process.exit(fails ? 1 : 0)
