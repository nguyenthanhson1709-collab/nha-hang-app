import assert from 'node:assert'
import { autoProblems } from '../src/lib/autocheck.ts'
const ok = { doc_date: '2026-11-07', supplier: 'Lidl', invoice_no: '4711', seller_tax_id: 'DE813388858', gross: 17.36, payment: 'cash' as const,
  taxes: [{ rate: 7, net: 14.79, tax: 1.03, gross: 15.82 }, { rate: 19, net: 1.29, tax: 0.25, gross: 1.54 }],
  lines: [{ name: 'A', qty: 1, unit_price: 15.82, total: 15.82, rate: 7 }, { name: 'B', qty: 1, unit_price: 1.54, total: 1.54, rate: 19 }] }
const T = '2026-11-23'
assert.deepStrictEqual(autoProblems(ok, 'cash', T), [])
assert.deepStrictEqual(autoProblems({ ...ok, doc_date: null }, 'cash', T), ['date'])
assert.deepStrictEqual(autoProblems({ ...ok, invoice_no: null }, 'cash', T), ['invoice_no'])
assert.deepStrictEqual(autoProblems(ok, null, T), ['payment'])
assert.deepStrictEqual(autoProblems({ ...ok, gross: 17.9 }, 'cash', T), ['tax_sum', 'lines_sum'])
assert.deepStrictEqual(autoProblems({ ...ok, doc_date: '2026-12-01' }, 'cash', T), ['date'])
assert.ok(autoProblems({ ...ok, gross: 300, seller_tax_id: null }, 'cash', T).includes('tax_id'))
console.log('autocheck ok')
import { linesToGross } from '../src/lib/lines.ts'
const net = [{ name: 'Tomaten', total: 25.98, unit_price: 12.99, rate: 7 }, { name: 'X', total: 10, unit_price: null, rate: null }]
const g = linesToGross(net, [{ rate: 7, net: 35.98 }], 38.5)
assert.deepStrictEqual(g.map((l) => l.total), [27.8, 10.7])
assert.strictEqual(g[0].unit_price, 13.899)
assert.strictEqual(linesToGross(ok.lines, ok.taxes, ok.gross), ok.lines)
console.log('lines ok')
