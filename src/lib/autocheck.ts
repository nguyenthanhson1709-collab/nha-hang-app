// Hoá đơn do chủ/quản lý tải lên được duyệt luôn nếu AI đọc đủ và các con số khớp nhau.
// Thiếu hoặc lệch bất kỳ thông tin nào -> vẫn vào "Chờ kiểm tra".
import { r2 } from './format'
import type { ParsedInvoice } from './ocr'

export function autoProblems(pi: ParsedInvoice, payment: string | null, today = new Date().toISOString().slice(0, 10)): string[] {
  const p: string[] = []
  const gross = r2(pi.gross || 0)
  const d = pi.doc_date || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) p.push('date')
  else {
    const old = new Date(Date.parse(today) - 400 * 864e5).toISOString().slice(0, 10)
    if (d > today || d < old) p.push('date')
  }
  if (!pi.supplier?.trim()) p.push('supplier')
  if (!pi.invoice_no?.trim()) p.push('invoice_no')
  if (!(gross > 0)) p.push('gross')
  if (!payment) p.push('payment')
  // Rechnung > 250 € bắt buộc có USt-IdNr/Steuernummer người bán (Kleinbetragsrechnung thì không)
  if (gross > 250 && !pi.seller_tax_id?.trim()) p.push('tax_id')
  const taxes = pi.taxes || []
  if (!taxes.length) p.push('taxes')
  for (const t of taxes) {
    if (Math.abs(t.net + t.tax - t.gross) > 0.02) p.push('tax_row')
    else if (t.rate > 0 && Math.abs(t.net * t.rate / 100 - t.tax) > 0.02 + t.net * 0.001) p.push('tax_rate')
  }
  if (taxes.length && Math.abs(r2(taxes.reduce((s, t) => s + t.gross, 0)) - gross) > 0.02) p.push('tax_sum')
  const lines = pi.lines || []
  if (!lines.length) p.push('lines')
  else if (Math.abs(r2(lines.reduce((s, l) => s + (l.total || 0), 0)) - gross) > 0.05) p.push('lines_sum')
  return [...new Set(p)]
}
