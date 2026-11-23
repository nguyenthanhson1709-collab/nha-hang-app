// Kiểm tra phân tích chữ hoá đơn (không cần OCR): npx tsx tests/invoice-parse.mts
import { readFileSync } from 'node:fs'
import { parseInvoice } from '../src/lib/ocr.ts'

const cases = [
  { file: 'tests/fixtures/lidl-ocr.txt', expect: { gross: 17.36, supplier: 'Lidl', payment: 'cash', taxes: [[7, 14.79, 1.03, 15.82], [19, 1.29, 0.25, 1.54]] } },
  { text: 'REWE Markt\nApfel 2,99 A\nCola 1,99 B\nSUMME EUR 4,98\nGegeben Bar 10,00\nRückgeld 5,02\nA= 7% 2,79 0,20 2,99\nB= 19% 1,67 0,32 1,99',
    expect: { gross: 4.98, supplier: 'REWE', payment: 'cash', taxes: [[7, 2.79, 0.2, 2.99], [19, 1.67, 0.32, 1.99]] } },
]
let fail = 0
for (const c of cases) {
  const r = parseInvoice('file' in c ? readFileSync(c.file!, 'utf8') : c.text!)
  const got = { gross: r.gross, supplier: r.supplier, payment: r.payment, taxes: r.taxes.map((t) => [t.rate, t.net, t.tax, t.gross]) }
  const ok = JSON.stringify(got) === JSON.stringify(c.expect)
  if (!ok) { fail++; console.log('✗', JSON.stringify(got), '\n  mong đợi', JSON.stringify(c.expect)) }
}
console.log(fail ? `${fail} sai` : 'Tất cả đúng')
process.exit(fail ? 1 : 0)
