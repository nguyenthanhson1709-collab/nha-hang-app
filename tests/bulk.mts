import assert from 'node:assert'
import { cleanSegments } from '../src/lib/bulk.ts'
const s = (a: number, b: number) => ({ start_page: a, end_page: b, supplier: null, invoice_no: null })
const r = (x: ReturnType<typeof cleanSegments>) => x.map((y) => [y.start_page, y.end_page])
assert.deepStrictEqual(r(cleanSegments([s(1, 2), s(3, 3), s(4, 6)], 1, 6)), [[1, 2], [3, 3], [4, 6]])
assert.deepStrictEqual(r(cleanSegments([s(1, 2), s(4, 5)], 1, 6)), [[1, 3], [4, 6]]) // trang sót gộp vào trước
assert.deepStrictEqual(r(cleanSegments([], 21, 40)), [[21, 40]])
assert.deepStrictEqual(r(cleanSegments([s(0, 9), s(10, 99)], 1, 20)), [[1, 9], [10, 20]])
console.log('bulk ok')
