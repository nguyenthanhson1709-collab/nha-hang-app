import assert from 'node:assert'
import { cleanSegments } from '../src/lib/bulk.ts'
const s = (a: number, b: number) => ({ start_page: a, end_page: b, supplier: null, invoice_no: null })
const r = (x: ReturnType<typeof cleanSegments>) => x.map((y) => [y.start_page, y.end_page])
assert.deepStrictEqual(r(cleanSegments([s(1, 2), s(3, 3), s(4, 6)], 1, 6)), [[1, 2], [3, 3], [4, 6]])
assert.deepStrictEqual(r(cleanSegments([s(1, 2), s(4, 5)], 1, 6)), [[1, 3], [4, 6]]) // trang sót gộp vào trước
assert.deepStrictEqual(r(cleanSegments([], 21, 40)), [[21, 40]])
assert.deepStrictEqual(r(cleanSegments([s(0, 9), s(10, 99)], 1, 20)), [[1, 9], [10, 20]])
console.log('bulk ok')
import { groupUnits } from '../src/lib/bulk.ts'
// 3 ảnh + 1 PDF 3 trang: [ảnh0][ảnh1 ảnh2][pdf p1-2][pdf p3]
const units = [{ src: 0, page: 0, srcPages: 1 }, { src: 1, page: 0, srcPages: 1 }, { src: 2, page: 0, srcPages: 1 }, { src: 3, page: 0, srcPages: 3 }, { src: 3, page: 1, srcPages: 3 }, { src: 3, page: 2, srcPages: 3 }]
const img = (i: number) => i < 3
assert.deepStrictEqual(groupUnits(units, [s(1, 1), s(2, 3), s(4, 5), s(6, 6)], img).map((g) => g.whole), [[0], [1, 2], null, null])
assert.deepStrictEqual(groupUnits(units, [s(1, 3), s(4, 6)], img).map((g) => g.whole), [[0, 1, 2], [3]])
console.log('groupUnits ok')
