// Hoá đơn sỉ (METRO, Frucht & Feld…) thường in giá Netto từng dòng. App tính bằng Brutto,
// nên nếu tổng các dòng = tổng Netto (không bằng tổng Brutto) thì đổi từng dòng sang Brutto theo % thuế.
import { r2 } from './format'

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
