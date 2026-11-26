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
