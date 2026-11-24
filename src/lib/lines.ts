// Hoá đơn sỉ (METRO, Frucht & Feld…) in giá Netto từng dòng. Dòng hàng giữ nguyên giá Netto như trên hoá đơn;
// kiểm tra: tổng dòng = tổng Netto, cộng thuế = tổng Brutto. Báo cáo / DATEV tự quy ra Brutto khi tính.
import { r2 } from './format'
import type { Doc } from './supabase'

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
/** 'gross' | 'net' | null (lệch cả hai) */
export function linesBasis(lines: { total: number | null }[], taxes: { net: number }[], gross: number): 'gross' | 'net' | null {
  const sum = r2(lines.reduce((s, l) => s + (Number(l.total) || 0), 0))
  if (near(sum, gross, 0.05)) return 'gross'
  if (taxes.length) {
    const net = r2(taxes.reduce((s, t) => s + Number(t.net), 0))
    if (near(sum, net, 0.05 + net * 0.002)) return 'net'
  }
  return null
}
/** Bản sao chứng từ với dòng hàng quy ra Brutto (chỉ để tính báo cáo / DATEV, không lưu) */
export function grossDoc(d: Doc): Doc {
  const ls = d.nh_document_lines || []
  if (!ls.length) return d
  const taxes = (d.nh_document_taxes || []).map((t) => ({ rate: Number(t.rate), net: Number(t.net) }))
  const raw = ls.map((l) => ({ ...l, total: Number(l.total), unit_price: l.unit_price == null ? null : Number(l.unit_price), rate: l.rate == null ? null : Number(l.rate) }))
  const g = linesToGross(raw, taxes, Number(d.gross))
  return g === raw ? d : { ...d, nh_document_lines: g as typeof ls }
}

type L = { total: number; unit_price: number | null; rate: number | null }
export function linesToGross<T extends L>(lines: T[], taxes: { rate: number; net: number }[], gross: number): T[] {
  if (!lines.length || !taxes.length) return lines
  const sum = r2(lines.reduce((s, l) => s + (Number(l.total) || 0), 0))
  const net = r2(taxes.reduce((s, t) => s + Number(t.net), 0))
  if (Math.abs(sum - gross) <= 0.05 || Math.abs(sum - net) > 0.05 + net * 0.002) return lines
  const one = taxes.length === 1 ? Number(taxes[0].rate) : null
  const out = lines.map((l) => {
    const rate = l.rate ?? one
    if (rate == null) return l
    const f = 1 + rate / 100
    return { ...l, total: r2(Number(l.total) * f), unit_price: l.unit_price == null ? null : Math.round(Number(l.unit_price) * f * 1000) / 1000 }
  })
  // Sai số làm tròn từng dòng (vài cent): dồn vào dòng lớn nhất để tổng khớp đúng tổng hoá đơn
  const diff = r2(gross - out.reduce((s, l) => s + Number(l.total), 0))
  if (diff && Math.abs(diff) <= 0.01 * out.length) {
    let k = 0
    out.forEach((l, i) => { if (Math.abs(Number(l.total)) > Math.abs(Number(out[k].total))) k = i })
    out[k] = { ...out[k], total: r2(Number(out[k].total) + diff) }
  }
  return out
}

/** Cờ cảnh báo tính lại theo dữ liệu hiện tại: bỏ 'lines_mismatch' cũ nếu dòng hàng nay khớp Netto hoặc Brutto */
export function liveFlags(d: Doc): string[] {
  const f = d.flags || []
  if (!f.includes('lines_mismatch')) return f
  const ls = (d.nh_document_lines || []).map((l) => ({ total: Number(l.total) }))
  const taxes = (d.nh_document_taxes || []).map((t) => ({ net: Number(t.net) }))
  return ls.length && linesBasis(ls, taxes, Number(d.gross)) ? f.filter((x) => x !== 'lines_mismatch') : f
}

/** Ngược lại linesToGross: dòng đang là Brutto -> về giá Netto như in trên hoá đơn sỉ */
export function linesToNet<T extends L>(lines: T[], taxes: { rate: number }[]): T[] {
  const one = taxes.length === 1 ? Number(taxes[0].rate) : null
  return lines.map((l) => {
    const rate = l.rate ?? one
    if (!rate) return l
    const f = 1 + rate / 100
    return { ...l, total: r2(Number(l.total) / f), unit_price: l.unit_price == null ? null : r2(Number(l.unit_price) / f) }
  })
}

/** Gutschrift trong báo cáo chi phí: đổi dấu (trừ vào chi phí) */
export function signCredit(d: Doc): Doc {
  if (!d.is_credit) return d
  return {
    ...d, gross: -Number(d.gross),
    nh_document_lines: (d.nh_document_lines || []).map((l) => ({ ...l, total: -Number(l.total), qty: l.qty == null ? l.qty : -Number(l.qty) })),
    nh_document_taxes: (d.nh_document_taxes || []).map((t) => ({ ...t, net: -Number(t.net), tax: -Number(t.tax), gross: -Number(t.gross) })),
  }
}

/** Số âm (hoá đơn ghi -30,17) = Gutschrift: lưu số dương + is_credit, dòng hàng đổi dấu */
export function flipNegative<T extends { total: number; unit_price?: number | null }>(gross: number, taxes: { rate: number; net: number; tax: number; gross: number }[], lines: T[]) {
  if (!(gross < 0)) return null
  return {
    gross: r2(-gross),
    taxes: taxes.map((t) => ({ ...t, net: r2(Math.abs(t.net)), tax: r2(Math.abs(t.tax)), gross: r2(Math.abs(t.gross)) })),
    lines: lines.map((l) => ({ ...l, total: r2(-Number(l.total)), unit_price: l.unit_price == null ? l.unit_price : r2(Math.abs(Number(l.unit_price))) })),
  }
}
