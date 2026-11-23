// Kiểm tra đọc Z-Bon mẫu: npx tsx tests/ocr-zbon.mts
import { createWorker } from 'tesseract.js'
import { parseZbon } from '../src/lib/ocr.ts'

const cases = [
  { file: 'tests/fixtures/zbon-b.png', pos: 'thermal_b', map: { BAREINNAHMEN: 'cash', KREDITZAHLUNGEN: 'card' },
    expect: { z_date: '2026-10-23', net7: 2888.22, tax7: 202.18, gross7: 3090.4, net19: 809.66, tax19: 153.84, gross19: 963.5, total: 4053.9, cash_pos: 591.7, card_pos: 3462.2, tip: 269.24 } },
  { file: 'tests/fixtures/zbon-b-scanned.jpg', pos: 'thermal_b', map: { BAREINNAHMEN: 'cash', KREDITZAHLUNGEN: 'card' },
    expect: { z_date: '2026-10-23', net7: 2888.22, tax7: 202.18, gross7: 3090.4, net19: 809.66, tax19: 153.84, gross19: 963.5, total: 4053.9, cash_pos: 591.7, card_pos: 3462.2, tip: 269.24 } },
  { file: 'tests/fixtures/zbon-a.png', pos: 'allo', map: { 'allO Pay': 'card', Bar: 'cash' },
    expect: { z_date: '2026-10-29', net7: 2429.63, tax7: 170.07, gross7: 2599.7, net19: 759.51, tax19: 144.3, gross19: 903.81, total: 3503.51, cash_pos: 547.27, card_pos: 2956.24, tip: 232.11 } },
] as const

const w = await createWorker('deu', 1, { langPath: new URL('../node_modules/@tesseract.js-data/deu/4.0.0_best_int', import.meta.url).pathname, cachePath: '/tmp/tess-cache' })
let fail = 0
for (const c of cases) {
  const { data } = await w.recognize(c.file)
  const z = parseZbon(data.text, c.pos, c.map as never) as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(c.expect)) {
    const ok = typeof v === 'number' ? Math.abs(Number(z[k]) - v) <= 0.011 : z[k] === v
    if (!ok) { fail++; console.log(`✗ ${c.file} ${k}: ${z[k]} (mong đợi ${v})`) }
  }
  console.log(`${c.file}: xong`)
}
await w.terminate()
console.log(fail ? `${fail} giá trị sai` : 'Tất cả đúng')
process.exit(fail ? 1 : 0)
