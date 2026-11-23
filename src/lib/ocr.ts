// Đọc chứng từ ngay trên thiết bị: Tesseract cho ảnh, pdf.js cho file PDF có chữ.
import { parseNum, r2 } from './format'
import type { PayMethod, TaxRow } from './supabase'

// ---------- Ảnh ----------
export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}

/** Thu nhỏ ảnh để tải lên (tối đa 2200px, JPEG) */
export async function compressImage(file: File): Promise<Blob> {
  const img = await loadImage(file)
  const max = 2200
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.85))
}

/** Độ nét: phương sai Laplacian trên ảnh xám thu nhỏ. Càng thấp càng mờ. */
export async function sharpness(file: Blob): Promise<number> {
  const img = await loadImage(file)
  const w = 600, s = w / img.naturalWidth, h = Math.max(1, Math.round(img.naturalHeight * s))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  let sum = 0, sq = 0, n = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]
    sum += l; sq += l * l; n++
  }
  const m = sum / n
  return sq / n - m * m
}
export const BLUR_LIMIT = 30

async function prepForOcr(file: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(file)
  const target = 1800
  const s = Math.min(2.5, target / img.naturalWidth)
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data
  // xám + kéo giãn tương phản (giấy nhiệt hay nhạt)
  let lo = 255, hi = 0
  const gray = new Uint8ClampedArray(d.length / 4)
  for (let i = 0; i < gray.length; i++) {
    const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    gray[i] = v; if (v < lo) lo = v; if (v > hi) hi = v
  }
  const span = Math.max(1, hi - lo)
  for (let i = 0; i < gray.length; i++) {
    const v = ((gray[i] - lo) * 255) / span
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
  }
  ctx.putImageData(id, 0, 0)
  return c
}

let workerP: Promise<import('tesseract.js').Worker> | null = null
async function worker() {
  if (!workerP) workerP = import('tesseract.js').then((T) => T.createWorker('deu'))
  return workerP
}

export async function ocrImage(file: Blob): Promise<string> {
  const w = await worker()
  const c = await prepForOcr(file)
  const { data } = await w.recognize(c)
  return data.text
}

// ---------- PDF ----------
async function pdfjs() {
  const lib = await import('pdfjs-dist')
  const wurl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  lib.GlobalWorkerOptions.workerSrc = wurl
  return lib
}

export async function pdfText(file: Blob): Promise<string> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise
  const out: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str.trim()) continue
      const y = Math.round(it.transform[5] / 3)
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y)!.push({ x: it.transform[4], s: it.str })
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a))
      out.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(' '))
  }
  return out.join('\n')
}

/** Vẽ các trang PDF thành ảnh JPEG (dùng khi xuất PDF tổng hợp) */
export async function pdfToImages(file: Blob, scale = 1.6): Promise<string[]> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise
  const res: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale })
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c } as never).promise
    res.push(c.toDataURL('image/jpeg', 0.8))
  }
  return res
}

export async function readText(file: File | Blob, type: string): Promise<string> {
  if (type === 'application/pdf') {
    const t = await pdfText(file)
    if (t.replace(/\s/g, '').length > 40) return t
    // PDF chỉ có ảnh: vẽ ra rồi OCR
    const imgs = await pdfToImages(file, 2)
    const parts: string[] = []
    for (const u of imgs) parts.push(await ocrImage(await (await fetch(u)).blob()))
    return parts.join('\n')
  }
  return ocrImage(file)
}

// ---------- Phân tích ----------
const NUM = String.raw`-?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2,3}|-?\d+[,.]\d{2,3}`
const numRe = () => new RegExp(NUM, 'g')
const nums = (s: string) => (s.match(numRe()) || []).map(parseNum)

function findDate(t: string): string | null {
  const m = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2}|\d{2})\b/)
  if (!m) return null
  let y = m[3]; if (y.length === 2) y = '20' + y
  const mo = Number(m[2]), d = Number(m[1])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function detectPayment(t: string): PayMethod | null {
  const s = t.toLowerCase()
  const card = /(ec-?karte|girocard|kartenzahlung|visa|mastercard|maestro|kreditkarte|v pay|contactless|kontaktlos|terminal-?id|trace-?nr|genehmigungs)/.test(s)
  const cash = /(\bbar\b|bargeld|gegeben|rückgeld|ruckgeld|r[uü]ckgeld)/.test(s)
  const transfer = /(überweisung|uberweisung|zahlbar bis|zahlungsziel|iban|lastschrift|sepa)/.test(s)
  if (card && !cash) return 'card'
  if (cash && !card) return 'cash'
  if (transfer && !card && !cash) return 'transfer'
  return null
}

const SUPPLIERS = ['METRO', 'Selgros', 'Transgourmet', 'EDEKA', 'REWE', 'Lidl', 'ALDI', 'Netto', 'Kaufland', 'Penny', 'Globus',
  'HIT', 'Real', 'dm', 'Rossmann', 'Go Asia', 'Vinh Loi', 'Dong Xuan', 'Asia', 'Bauhaus', 'OBI', 'IKEA', 'Hornbach', 'Norma', 'Tegut']

export interface ParsedInvoice {
  doc_date: string | null; supplier: string | null; invoice_no: string | null; seller_tax_id: string | null
  gross: number; taxes: TaxRow[]; payment: PayMethod | null
  lines: { name: string; qty: number | null; unit?: string | null; unit_price: number | null; total: number; rate: number | null }[]
}

function taxFromLine(line: string, rate: number): TaxRow | null {
  const ns = nums(line.replace(new RegExp(String.raw`\b${rate}[,.]?0{0,2}\s*%`), ' ')).filter((n) => n !== rate)
  const f = rate / 100
  for (let i = 0; i < ns.length; i++) for (let j = 0; j < ns.length; j++) for (let k = 0; k < ns.length; k++) {
    if (i === j || j === k || i === k) continue
    const [a, b, c] = [ns[i], ns[j], ns[k]]
    if (Math.abs(a + b - c) <= 0.02 && Math.abs(a * f - b) <= 0.03 + a * 0.002 && c > 0) return { rate, net: r2(a), tax: r2(b), gross: r2(c) }
  }
  for (let i = 0; i < ns.length; i++) for (let j = 0; j < ns.length; j++) {
    if (i === j) continue
    const [a, b] = [ns[i], ns[j]]
    if (a > 0 && Math.abs(a * f - b) <= 0.02 + a * 0.002) return { rate, net: r2(a), tax: r2(b), gross: r2(a + b) }
    if (a > 0 && Math.abs((a * f) / (1 + f) - b) <= 0.02 + a * 0.002) return { rate, net: r2(a - b), tax: r2(b), gross: r2(a) }
  }
  return null
}

export function parseInvoice(text: string): ParsedInvoice {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const res: ParsedInvoice = { doc_date: findDate(text), supplier: null, invoice_no: null, seller_tax_id: null, gross: 0, taxes: [], payment: detectPayment(text), lines: [] }

  for (const s of SUPPLIERS) if (new RegExp(`\\b${s}\\b`, 'i').test(text.slice(0, 600))) { res.supplier = s; break }
  if (!res.supplier) res.supplier = lines.find((l) => /[a-zA-ZäöüÄÖÜ]{3,}/.test(l) && !/rechnung|beleg|kasse|datum/i.test(l))?.slice(0, 60) || null

  const inv = text.match(/(?:rechnungs?[- ]?(?:nr|nummer)|beleg[- ]?nr|bon[- ]?nr|rg\.?[- ]?nr)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i)
  if (inv) res.invoice_no = inv[1]
  const ust = text.match(/\bDE\s?\d{3}\s?\d{3}\s?\d{3}\b/)
  const stnr = text.match(/St(?:euer)?\.?\s?-?Nr\.?\s*:?\s*(\d{2,3}\/\d{3}\/\d{4,5}|\d{10,13})/i)
  res.seller_tax_id = ust ? ust[0].replace(/\s/g, '') : stnr ? stnr[1] : null

  // Bảng thuế
  const seen = new Set<number>()
  for (const l of lines) {
    for (const rate of [19, 7]) {
      if (seen.has(rate)) continue
      if (new RegExp(String.raw`(^|[^\d])${rate}[,.]?0{0,2}\s*%`).test(l)) {
        const t = taxFromLine(l, rate)
        if (t) { res.taxes.push(t); seen.add(rate) }
      }
    }
  }
  // Dòng "Summe" của bảng thuế (Lidl, Aldi...): MwSt / Netto / Brutto cộng lại
  let sumRow: TaxRow | null = null
  const hdr = lines.findIndex((l) => /(mwst|ust|steuer)/i.test(l) && /(netto|brutto|%)/i.test(l))
  if (hdr >= 0) for (const l of lines.slice(hdr + 1, hdr + 8)) {
    if (!/summe|gesamt|total/i.test(l)) continue
    const ns = nums(l).filter((n) => n > 0)
    for (let i = 0; i < ns.length && !sumRow; i++) for (let j = 0; j < ns.length && !sumRow; j++) {
      if (i === j) continue
      const [tax, net] = [ns[i], ns[j]]
      if (tax / net < 0.065 || tax / net > 0.195) continue
      const g = ns.find((n, k) => k !== i && k !== j && Math.abs(n - (tax + net)) <= 0.02)
      if (g || ns.length === 2) sumRow = { rate: 0, net: r2(net), tax: r2(tax), gross: r2(g ?? net + tax) }
    }
    if (sumRow) break
  }
  // Thiếu một mức thuế: suy ra từ dòng Summe trừ mức đã đọc được
  if (sumRow && res.taxes.length === 1) {
    const k = res.taxes[0], rate = k.rate === 19 ? 7 : 19
    const net = r2(sumRow.net - k.net), tax = r2(sumRow.tax - k.tax)
    if (net > 0 && Math.abs(net * rate / 100 - tax) <= 0.03 + net * 0.003) res.taxes.push({ rate, net, tax, gross: r2(net + tax) })
  }
  if (sumRow && !res.taxes.length) {
    const ratio = sumRow.tax / sumRow.net
    if (Math.abs(ratio - 0.07) < 0.004) res.taxes.push({ ...sumRow, rate: 7 })
    else if (Math.abs(ratio - 0.19) < 0.004) res.taxes.push({ ...sumRow, rate: 19 })
  }
  res.taxes.sort((a, b) => a.rate - b.rate)

  // Tổng: chỉ lấy dòng tổng thật; "Bar 20,00" / "Gegeben" là tiền khách đưa, không phải tổng
  const strong: number[] = [], weak: number[] = []
  let tendered = 0
  for (const l of lines) {
    if (/(gegeben|r[uü]ckgeld|zur[uü]ck|wechselgeld|\bbar\b|bargeld)/i.test(l)) { tendered = Math.max(tendered, ...nums(l), 0); continue }
    if (/(mwst|netto|steuer|%)/i.test(l)) continue
    if (/(zu zahlen|summe|total|gesamt|endbetrag|rechnungsbetrag|betrag eur)/i.test(l)) strong.push(...nums(l).filter((n) => n > 0))
    else if (/(ec-?karte|girocard|kartenzahlung|visa|mastercard|betrag)/i.test(l)) weak.push(...nums(l).filter((n) => n > 0))
  }
  const taxSum = r2(res.taxes.reduce((s, t) => s + t.gross, 0))
  const all = [...strong, ...weak]
  if (sumRow) res.gross = sumRow.gross
  else if (taxSum > 0 && all.some((t) => Math.abs(t - taxSum) <= 0.02)) res.gross = taxSum
  else {
    const pool = (strong.length ? strong : weak).filter((n) => !tendered || n <= tendered + 0.001)
    res.gross = pool.length ? Math.max(...pool) : taxSum
  }
  // Bảng thuế không khớp tổng: bỏ bảng thuế sai, để người duyệt nhập
  if (res.gross && taxSum && Math.abs(taxSum - res.gross) > 0.05 && res.taxes.length) {
    const fixed = res.taxes.filter((t) => Math.abs(t.net * t.rate / 100 - t.tax) <= 0.03 && Math.abs(t.net + t.tax - t.gross) <= 0.02)
    res.taxes = fixed
  }

  // Ký hiệu A/B -> mức thuế
  const letterMap: Record<string, number> = {}
  for (const m of text.matchAll(/\b([A-D])\s*[=:]?\s*(7|19)[,.]?0{0,2}\s*%/g)) letterMap[m[1]] = Number(m[2])
  if (!Object.keys(letterMap).length) {
    for (const m of text.matchAll(/(7|19)[,.]?0{0,2}\s*%\s*[=:]?\s*\b([A-D])\b/g)) letterMap[m[2]] = Number(m[1])
  }

  // Dòng hàng: "Tên hàng ... 12,99 A"
  const stop = lines.findIndex((l) => /^(summe|total|zwischensumme|gesamt|zu zahlen)/i.test(l))
  const body = stop > 0 ? lines.slice(0, stop) : lines
  for (const l of body) {
    const m = l.match(new RegExp(String.raw`^(.{3,}?)\s+(${NUM})\s*(?:€|EUR)?\s*([A-D]|\d{1,2})?\s*\*?$`))
    if (!m) continue
    const name = m[1].replace(/\s{2,}/g, ' ').trim()
    if (/(mwst|ust|netto|brutto|steuer|summe|rückgeld|gegeben|datum|uhrzeit|kasse|bon|tel|www|%)/i.test(name)) continue
    if (!/[a-zA-ZäöüÄÖÜß]{2,}/.test(name)) continue
    const total = parseNum(m[2])
    let rate: number | null = null
    if (m[3] && letterMap[m[3]] !== undefined) rate = letterMap[m[3]]
    else if (m[3] === '1' || m[3] === '7') rate = 7
    else if (m[3] === '2' || m[3] === '19') rate = 19
    const qm = name.match(/^(\d+(?:[,.]\d+)?)\s*[xX×]\s*(.+)$/)
    res.lines.push({ name: qm ? qm[2] : name, qty: qm ? parseNum(qm[1]) : null, unit_price: null, total, rate })
  }
  if (res.taxes.length === 1 && res.lines.length) for (const ln of res.lines) if (ln.rate == null) ln.rate = res.taxes[0].rate
  return res
}

// ---------- Z-Bon ----------
export interface ParsedZ {
  z_date: string | null; z_no: string | null
  net7: number; tax7: number; gross7: number; net19: number; tax19: number; gross19: number; gross0: number
  total: number; cash_pos: number; card_pos: number; tip: number; storno: number; storno_count: number
  details: Record<string, number | string>
}

const first = (t: string, re: RegExp) => { const m = t.match(re); return m ? parseNum(m[1]) : 0 }

/** Mẫu quán B: bon in nhiệt ("Summen", "Zahlungsmethoden") */
export function parseZbonThermal(text: string, payMap: Record<string, PayMethod>): ParsedZ {
  const t = text.replace(/[|]/g, ' ').replace(/\s*=\s*/g, ' = ')
  const P = String.raw`\s*[%X×#]?\s*=?\s*(${NUM})`
  const z: ParsedZ = {
    z_date: null, z_no: null,
    tax7: first(t, new RegExp(String.raw`MwSt\.?\s*7` + P, 'i')),
    tax19: first(t, new RegExp(String.raw`MwSt\.?\s*19` + P, 'i')),
    net7: first(t, new RegExp(String.raw`Netto\s*7` + P, 'i')),
    net19: first(t, new RegExp(String.raw`Netto\s*19` + P, 'i')),
    gross7: first(t, new RegExp(String.raw`Brutto\s*7` + P, 'i')),
    gross19: first(t, new RegExp(String.raw`Brutto\s*19` + P, 'i')),
    gross0: first(t, new RegExp(String.raw`Brutto\s*0` + P, 'i')),
    total: first(t, new RegExp(String.raw`Summe\s*Brutto\s*(${NUM})`, 'i')) || first(t, new RegExp(String.raw`\bTotal\s*(${NUM})`, 'i')),
    cash_pos: 0, card_pos: 0,
    tip: first(t, new RegExp(String.raw`Trinkgeld\s*(${NUM})`, 'i')),
    storno: 0, storno_count: 0, details: {},
  }
  z.z_date = pickDate(t)
  const zn = t.match(/Z[- ]?(?:Nr|Nummer|Bon)\.?\s*:?\s*(\d+)/i)
  if (zn) z.z_no = zn[1]
  const st = t.match(/Stornos?["“”]?\s*(\d+)\s+(${NUM})/i)
  if (st) { z.storno_count = Number(st[1]); z.storno = parseNum(st[2]) }
  // Hình thức thanh toán theo bảng gán tên của quán
  for (const [label, method] of Object.entries(payMap)) {
    const i = t.toUpperCase().indexOf(label.toUpperCase())
    if (i < 0) continue
    const after = t.slice(i + label.length, i + label.length + 80)
    const n = after.match(numRe())
    if (!n) continue
    const v = parseNum(n[0])
    if (method === 'cash') z.cash_pos = r2(z.cash_pos + v)
    else z.card_pos = r2(z.card_pos + v)
  }
  for (const [k, re] of Object.entries({
    speisen_im_haus: /Speisen\s+im\s+Haus\s*(NUM)/i, speisen_mitnehmen: /zum\s+Mitnehmen\s*(NUM)/i, getraenke: /Getr[äa]nke\s*(NUM)/i,
  })) { const v = first(t, new RegExp(re.source.replace('NUM', NUM), 'i')); if (v) z.details[k] = r2(v) }
  // Làm tròn 3 số lẻ -> 2
  for (const k of ['net7', 'tax7', 'gross7', 'net19', 'tax19', 'gross19', 'gross0', 'total', 'tip', 'storno'] as const) z[k] = r2(z[k])
  fillZ(z)
  return z
}

/** Mẫu quán A: PDF "Umsatzanalyze" của allO */
export function parseZbonAllo(text: string, payMap: Record<string, PayMethod>): ParsedZ {
  const row = (label: string) => {
    const m = text.match(new RegExp(label + String.raw`[^\n]*`, 'i'))
    return m ? nums(m[0].replace(/\b\d{1,2}\s*%/, '')) : []
  }
  const u7 = row(String.raw`Umsatz\s*7\s*%`), u19 = row(String.raw`Umsatz\s*19\s*%`), u0 = row(String.raw`Umsatz\s*0\s*%`)
  const z: ParsedZ = {
    z_date: findDate(text.replace(/(\d{2})-(\d{2})-(\d{4})/, '$1.$2.$3')), z_no: null,
    net7: u7[0] || 0, tax7: u7[1] || 0, gross7: u7[2] || 0, net19: u19[0] || 0, tax19: u19[1] || 0, gross19: u19[2] || 0,
    gross0: 0, total: 0, cash_pos: 0, card_pos: 0, tip: u0[2] || u0[0] || 0, storno: 0, storno_count: 0, details: {},
  }
  let tipCols = 0
  for (const [label, method] of Object.entries(payMap)) {
    const m = text.match(new RegExp(String.raw`^[|\s]*` + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`\s+(${NUM})[^\n]*`, 'im'))
    if (!m) continue
    const v = parseNum(m[1])
    const rowNums = nums(m[0])
    if (!u0.length && rowNums.length >= 3) tipCols += rowNums[1]
    if (method === 'cash') z.cash_pos = r2(z.cash_pos + v); else z.card_pos = r2(z.card_pos + v)
  }
  if (!z.tip && tipCols) z.tip = r2(tipCols)
  fillZ(z)
  return z
}

/** Chọn ngày hợp lý: ưu tiên "für den", bỏ ngày ở tương lai (lỗi đọc), đối chiếu với "Gedruckt am" */
function pickDate(t: string): string | null {
  const all = [...t.matchAll(/\b\d{1,2}[./-]\d{1,2}[./-](?:20)?\d{2}\b/g)].map((m) => findDate(m[0])).filter(Boolean) as string[]
  const fd = t.match(/f[üu]r\s+den\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/i)
  const main = fd ? findDate(fd[1]) : null
  const limit = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const ok = (d: string | null) => !!d && d <= limit && d >= '2020-01-01'
  if (ok(main)) return main
  if (main) { const same = all.find((d) => ok(d) && d.slice(5) === main.slice(5)); if (same) return same }
  return all.find(ok) || main
}

/** Sửa lỗi đọc thường gặp bằng các quan hệ số học của Z-Bon */
function reconcile(z: ParsedZ) {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.02
  // Brutto + MwSt đáng tin hơn Netto (Brutto được kiểm bằng tổng)
  if (z.gross7 && z.tax7 && !near(z.net7 + z.tax7, z.gross7)) z.net7 = r2(z.gross7 - z.tax7)
  if (z.gross19 && z.tax19 && !near(z.net19 + z.tax19, z.gross19)) z.net19 = r2(z.gross19 - z.tax19)
  // Tiền mặt + thẻ = tổng: suy ra số bị đọc thiếu chữ số
  if (z.total && !near(z.cash_pos + z.card_pos, z.total)) {
    const digits = (n: number) => n.toFixed(2).replace('.', '')
    const card2 = r2(z.total - z.cash_pos), cash2 = r2(z.total - z.card_pos)
    if (z.card_pos && card2 > 0 && digits(card2).endsWith(digits(z.card_pos))) z.card_pos = card2
    else if (z.cash_pos && cash2 > 0 && digits(cash2).endsWith(digits(z.cash_pos))) z.cash_pos = cash2
    else if (!z.card_pos && z.cash_pos) z.card_pos = card2
    else if (!z.cash_pos && z.card_pos) z.cash_pos = cash2
  }
}

function fillZ(z: ParsedZ) {
  if (!z.gross7 && z.net7) z.gross7 = r2(z.net7 + z.tax7)
  if (!z.gross19 && z.net19) z.gross19 = r2(z.net19 + z.tax19)
  if (!z.net7 && z.gross7) z.net7 = r2(z.gross7 - z.tax7)
  if (!z.net19 && z.gross19) z.net19 = r2(z.gross19 - z.tax19)
  const sum = r2(z.gross7 + z.gross19)
  if (!z.total || Math.abs(z.total - sum) > 0.05) z.total = sum || z.total
  reconcile(z)
}

export function parseZbon(text: string, posType: string, payMap: Record<string, PayMethod>): ParsedZ {
  if (posType === 'allo' || /Umsatzanaly|Steuerssicht/i.test(text)) return parseZbonAllo(text, payMap)
  return parseZbonThermal(text, payMap)
}

// ---------- E-Rechnung (XRechnung / ZUGFeRD) ----------
export function parseEInvoice(xml: string): ParsedInvoice | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  const byLocal = (root: Element | Document, name: string) =>
    Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name)
  const txt = (root: Element | Document, name: string) => byLocal(root, name)[0]?.textContent?.trim() || null
  const res: ParsedInvoice = { doc_date: null, supplier: null, invoice_no: null, seller_tax_id: null, gross: 0, taxes: [], payment: 'transfer', lines: [] }
  const isCII = byLocal(doc, 'CrossIndustryInvoice').length > 0
  if (isCII) {
    const ed = byLocal(doc, 'ExchangedDocument')[0]
    res.invoice_no = ed ? txt(ed, 'ID') : null
    const ds = ed ? txt(ed, 'DateTimeString') : null
    if (ds && /^\d{8}$/.test(ds)) res.doc_date = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`
    const seller = byLocal(doc, 'SellerTradeParty')[0]
    if (seller) {
      res.supplier = txt(seller, 'Name')
      const reg = byLocal(seller, 'SpecifiedTaxRegistration').map((e) => txt(e, 'ID')).filter(Boolean)
      res.seller_tax_id = (reg[0] as string) || null
    }
    for (const tt of byLocal(doc, 'ApplicableTradeTax')) {
      const basis = tt.parentElement?.localName === 'ApplicableHeaderTradeSettlement'
      if (!basis) continue
      const rate = Number(txt(tt, 'RateApplicablePercent') || 0)
      const net = Number(txt(tt, 'BasisAmount') || 0), tax = Number(txt(tt, 'CalculatedAmount') || 0)
      if ([0, 7, 19].includes(rate)) res.taxes.push({ rate, net: r2(net), tax: r2(tax), gross: r2(net + tax) })
    }
    res.gross = Number(txt(doc, 'GrandTotalAmount') || 0)
    for (const li of byLocal(doc, 'IncludedSupplyChainTradeLineItem')) {
      const net = Number(txt(li, 'LineTotalAmount') || 0)
      const rate = Number(txt(li, 'RateApplicablePercent') || 0)
      res.lines.push({ name: txt(li, 'Name') || '', qty: Number(txt(li, 'BilledQuantity') || 0) || null, unit_price: null, total: r2(net * (1 + rate / 100)), rate: [0, 7, 19].includes(rate) ? rate : null })
    }
  } else if (byLocal(doc, 'Invoice').length) {
    res.invoice_no = txt(doc.documentElement, 'ID')
    res.doc_date = txt(doc.documentElement, 'IssueDate')
    const sp = byLocal(doc, 'AccountingSupplierParty')[0]
    if (sp) { res.supplier = txt(sp, 'RegistrationName') || txt(sp, 'Name'); res.seller_tax_id = txt(sp, 'CompanyID') }
    for (const st of byLocal(doc, 'TaxSubtotal')) {
      const rate = Number(txt(st, 'Percent') || 0)
      const net = Number(txt(st, 'TaxableAmount') || 0), tax = Number(txt(st, 'TaxAmount') || 0)
      if ([0, 7, 19].includes(rate)) res.taxes.push({ rate, net: r2(net), tax: r2(tax), gross: r2(net + tax) })
    }
    res.gross = Number(txt(doc, 'PayableAmount') || txt(doc, 'TaxInclusiveAmount') || 0)
    for (const li of byLocal(doc, 'InvoiceLine')) {
      const net = Number(txt(li, 'LineExtensionAmount') || 0), rate = Number(txt(li, 'Percent') || 0)
      res.lines.push({ name: txt(li, 'Name') || '', qty: Number(txt(li, 'InvoicedQuantity') || 0) || null, unit_price: null, total: r2(net * (1 + rate / 100)), rate: [0, 7, 19].includes(rate) ? rate : null })
    }
  } else return null
  res.taxes.sort((a, b) => a.rate - b.rate)
  return res
}

/** ZUGFeRD: PDF có file XML đính kèm */
export async function pdfEmbeddedXml(file: Blob): Promise<string | null> {
  try {
    const lib = await pdfjs()
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise
    const att = (await doc.getAttachments()) as Record<string, { filename: string; content: Uint8Array }> | null
    if (!att) return null
    for (const a of Object.values(att)) if (/\.xml$/i.test(a.filename)) return new TextDecoder().decode(a.content)
  } catch { /* */ }
  return null
}
