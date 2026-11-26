// Chuyển dữ liệu đọc từ hoá đơn Kasse thành các dòng của Rechnung
import type { KasseLine } from '../lib/ai'
import type { Article, InvoiceItem } from './types'
import { round2 } from './money'

const cleanName = (n: string, nr: string | null) => {
  const t = n.trim()
  return nr && !t.startsWith(`${nr} `) ? `${nr} ${t}` : t
}

/** Mỗi dòng Kasse -> một dòng hoá đơn. Giá và thuế lấy đúng như in trên Kasse; tên lấy từ danh sách món nếu khớp số món.
 *  Các dòng giống hệt nhau (cùng món, cùng giá, cùng thuế) được gộp và cộng số lượng. */
export function kasseToItems(lines: KasseLine[], articles: Article[]): InvoiceItem[] {
  const out: InvoiceItem[] = []
  for (const l of lines) {
    const qty = Number(l.qty) || 1
    const price = round2(l.unit_price || (l.total || 0) / qty)
    const rate = [0, 7, 19].includes(Number(l.rate)) ? Number(l.rate) : 7
    const nr = l.number ? String(l.number).trim() : null
    const cands = nr ? articles.filter((a) => a.number === nr && !a.archived) : []
    const art = cands.find((a) => Math.abs(a.price_gross - price) < 0.005 && a.tax_rate === rate) || (cands.length === 1 ? cands[0] : undefined)
    const name = art ? (art.number ? `${art.number} ${art.name}` : art.name) : cleanName(l.name, nr)
    const same = out.find((it) => it.name === name && it.unit_price_gross === price && it.tax_rate === rate)
    if (same) { same.quantity = round2(same.quantity + qty); same.line_total_gross = round2(same.quantity * price); continue }
    out.push({
      position: out.length + 1, article_id: art?.id ?? null, name, description: art?.description ?? '',
      quantity: qty, unit: art?.unit || 'Stück', unit_price_gross: price, tax_rate: rate, line_total_gross: round2(qty * price),
    })
  }
  return out
}

// ---------- Chuẩn bị ảnh gửi AI ----------
// Bon Kasse rất dài và hẹp: gửi nguyên trang thì AI phải thu nhỏ đến mức không đọc được chữ.
// Vì vậy vẽ lại với chiều rộng cố định rồi cắt thành nhiều ảnh, cắt ở khoảng trắng giữa hai dòng.
const TILE_W = 900
const TILE_H = 1300
const MAX_TILES = 8

/** Chọn vị trí cắt gần `target` nhất mà hàng điểm ảnh gần như trắng (giữa hai dòng chữ) */
export function bestCut(dark: number[], target: number, range: number): number {
  let best = target, bestScore = Infinity
  for (let y = Math.max(1, target - range); y <= Math.min(dark.length - 1, target); y++) {
    const score = dark[y] * 1000 + (target - y) // ưu tiên hàng trắng, rồi gần target
    if (score < bestScore) { bestScore = score; best = y }
  }
  return best
}

function rowDarkness(c: HTMLCanvasElement): number[] {
  const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  const out = new Array<number>(c.height).fill(0)
  for (let y = 0; y < c.height; y++) {
    let n = 0
    for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4
      if (data[i] + data[i + 1] + data[i + 2] < 384) n++
    }
    out[y] = n
  }
  return out
}

function slice(c: HTMLCanvasElement, tileH: number): HTMLCanvasElement[] {
  if (c.height <= tileH * 1.15) return [c]
  const dark = rowDarkness(c)
  const parts: HTMLCanvasElement[] = []
  let top = 0
  while (top < c.height) {
    const end = c.height - top <= tileH * 1.15 ? c.height : bestCut(dark, top + tileH, Math.round(tileH * 0.15))
    const t = document.createElement('canvas'); t.width = c.width; t.height = end - top
    t.getContext('2d')!.drawImage(c, 0, top, c.width, end - top, 0, 0, c.width, end - top)
    parts.push(t); top = end
  }
  return parts
}

async function toCanvas(f: File, width: number): Promise<HTMLCanvasElement[]> {
  const { pdfToCanvases, loadImage } = await import('../lib/ocr')
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) return pdfToCanvases(f, width)
  const img = await loadImage(f)
  URL.revokeObjectURL(img.src)
  const s = Math.min(1, (width * 1.5) / img.naturalWidth) // ảnh chụp: giữ đủ nét, không quá lớn
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return [c]
}

/** PDF/ảnh bon Kasse -> tối đa 8 ảnh JPEG, mỗi ảnh một đoạn bon từ trên xuống dưới */
export async function kasseImages(files: File[]): Promise<{ blob: Blob; type: string }[]> {
  let width = TILE_W
  for (let attempt = 0; attempt < 4; attempt++) {
    const pages = (await Promise.all(files.map((f) => toCanvas(f, width)))).flat()
    const tiles = pages.flatMap((c) => slice(c, Math.round(TILE_H * c.width / TILE_W)))
    if (tiles.length <= MAX_TILES || attempt === 3) {
      return Promise.all(tiles.slice(0, MAX_TILES).map((t) => new Promise<{ blob: Blob; type: string }>((res, rej) =>
        t.toBlob((b) => (b ? res({ blob: b, type: 'image/jpeg' }) : rej(new Error('toBlob'))), 'image/jpeg', 0.85))))
    }
    width = Math.round(width * 0.8) // quá nhiều đoạn: vẽ nhỏ hơn một chút
  }
  return []
}
