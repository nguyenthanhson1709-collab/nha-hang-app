// Logic thuần (không gọi mạng) cho Viva Wallet: đọc danh sách giao dịch, quy về ngày kinh doanh ở Berlin
// rồi cộng tổng tiền thẻ, Trinkgeld, số hoàn tiền. Dùng chung cho edge function nh-viva và tests/viva.mts.

export interface VivaFilter { sourceCodes?: string[]; terminalIds?: string[]; cutoffHour?: number }
export interface VivaDay { day: string; amount: number; tip: number; refunds: number; n: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Mã loại giao dịch Viva (TransactionTypeId): không phải tiền thu (pre-auth, void, payout, kiểm tra thẻ...) và hoàn tiền.
const NOT_CHARGE = new Set([1, 4, 7, 8, 11, 18, 19, 31, 69])
const REFUND = new Set([4, 11, 18])

// Viva trả field kiểu PascalCase (API cũ) hoặc camelCase (API mới): đọc cả hai
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k]
    const c = k[0].toLowerCase() + k.slice(1)
    if (o[c] !== undefined && o[c] !== null) return o[c]
  }
  return undefined
}
const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }

/** Độ lệch (phút) của một múi giờ so với UTC tại thời điểm cho trước */
function tzOffsetMin(tz: string, utcMs: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000)
}

/** Đọc InsDate: có múi giờ thì dùng luôn, không có thì coi là giờ Athens (giờ máy chủ Viva) */
export function parseInsDate(s: string, assumeTz = 'Europe/Athens'): number | null {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/)
  if (!m) return null
  const ms = Math.round(Number(m[7] || 0) * 1000)
  const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), ms)
  if (m[8]) {
    if (m[8] === 'Z') return local
    const sign = m[8][0] === '-' ? -1 : 1
    const hh = +m[8].slice(1, 3), mm = +m[8].slice(-2)
    return local - sign * (hh * 60 + mm) * 60000
  }
  // giờ địa phương không kèm múi giờ: thử hai lần để đúng cả lúc đổi giờ hè/đông
  let utc = local - tzOffsetMin(assumeTz, local) * 60000
  utc = local - tzOffsetMin(assumeTz, utc) * 60000
  return utc
}

/** Ngày kinh doanh ở Berlin: giao dịch trước giờ chốt (mặc định 4:00) tính vào hôm trước, như Z-Bon */
export function businessDay(utcMs: number, cutoffHour = 4) {
  const shifted = utcMs - cutoffHour * 3600000
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(shifted)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Lấy mảng giao dịch từ câu trả lời của Viva (nhiều dạng) */
export function txList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[]
  const b = (body || {}) as Record<string, unknown>
  const t = pick(b, 'Transactions', 'Items', 'Data')
  return Array.isArray(t) ? t as Record<string, unknown>[] : []
}

/** Cộng giao dịch theo ngày kinh doanh. Trùng TransactionId (do lấy 2 ngày liền nhau) chỉ tính một lần. */
export function aggregate(txs: Record<string, unknown>[], f: VivaFilter = {}): Map<string, VivaDay> {
  const seen = new Set<string>()
  const out = new Map<string, VivaDay>()
  const src = (f.sourceCodes || []).map((s) => s.trim()).filter(Boolean)
  const term = (f.terminalIds || []).map((s) => s.trim()).filter(Boolean)
  for (const t of txs) {
    const id = String(pick(t, 'TransactionId', 'Id') ?? '')
    if (id) { if (seen.has(id)) continue; seen.add(id) }
    const status = String(pick(t, 'StatusId') ?? '').toUpperCase()
    const type = Number(pick(t, 'TransactionTypeId') ?? 5)
    if (src.length && !src.includes(String(pick(t, 'SourceCode') ?? ''))) continue
    if (term.length && !term.includes(String(pick(t, 'TerminalId') ?? ''))) continue
    const ts = parseInsDate(String(pick(t, 'InsDate', 'Created', 'Date') ?? ''))
    if (ts == null) continue
    const day = businessDay(ts, f.cutoffHour ?? 4)
    const amt = Math.abs(num(pick(t, 'Amount')))
    const d = out.get(day) || { day, amount: 0, tip: 0, refunds: 0, n: 0 }
    if (REFUND.has(type)) {
      if (status !== 'F') continue
      d.amount = r2(d.amount - amt); d.refunds = r2(d.refunds + amt)
    } else if (!NOT_CHARGE.has(type)) {
      // F = thành công; R = đã hoàn (một phần) - bản hoàn là giao dịch riêng, nên giao dịch gốc vẫn tính
      if (status !== 'F' && status !== 'R') continue
      d.amount = r2(d.amount + amt); d.tip = r2(d.tip + Math.abs(num(pick(t, 'TipAmount', 'Tip'))))
      d.n++
    } else continue
    out.set(day, d)
  }
  return out
}

/** Các ngày cần hỏi Viva cho khoảng ngày kinh doanh [from, to]: thêm 1 ngày sau vì ca tối qua nửa đêm + giờ Athens sớm hơn 1 tiếng */
export function fetchDates(from: string, to: string) {
  const out: string[] = []
  const d = new Date(from + 'T12:00:00Z'), end = new Date(to + 'T12:00:00Z')
  end.setUTCDate(end.getUTCDate() + 1)
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}

export function daysBetween(from: string, to: string) {
  const out: string[] = []
  for (const d = new Date(from + 'T12:00:00Z'), end = new Date(to + 'T12:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
