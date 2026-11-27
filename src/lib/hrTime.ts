// Giờ làm (nh_shifts) và ngày phép (nh_absences): tính Ist, Nacht, Sonntag, Feiertag theo quy ước của quán
// Zuschläge nach § 3b EStG: Nacht +25 % 20–24 Uhr (Mo–Sa và ngày lễ, không cộng vào Chủ nhật thường) · So 50 % ·
// Feiertag 125 % (cả Silvester từ 14 Uhr) · 150 % cho Heiligabend từ 14 Uhr, 25./26.12 và 1.5 · Pause đã trừ trong Ist

export type Shift = { id: string; employee_id: string; shift_date: string; start_time: string; end_time: string; break_min: number; note: string | null }
export type Vacation = { id?: string; employee_id: string; from_date: string; to_date: string; kind: string; note: string | null }

export const WD_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
export const WD_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
export const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Ngày Chủ nhật Phục sinh (thuật toán Gauss / Meeus) */
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(y, mo - 1, da)
}
const cache: Record<number, Record<string, string>> = {}
/** Ngày lễ theo luật ở Berlin */
export function holidaysBerlin(y: number): Record<string, string> {
  if (cache[y]) return cache[y]
  const e = easter(y), add = (n: number) => iso(new Date(e.getFullYear(), e.getMonth(), e.getDate() + n))
  return (cache[y] = {
    [`${y}-01-01`]: 'Neujahr', [`${y}-03-08`]: 'Frauentag', [add(-2)]: 'Karfreitag', [add(1)]: 'Ostermontag', [`${y}-05-01`]: 'Tag der Arbeit',
    [add(39)]: 'Christi Himmelfahrt', [add(50)]: 'Pfingstmontag', [`${y}-10-03`]: 'Tag der Deutschen Einheit', [`${y}-12-25`]: '1. Weihnachtstag', [`${y}-12-26`]: '2. Weihnachtstag',
  })
}
export const holidayOf = (date: string) => holidaysBerlin(Number(date.slice(0, 4)))[date] || null
export const weekday = (date: string) => new Date(`${date}T12:00:00`).getDay()

const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`
export const tShort = (t: string) => { const [h, m] = t.split(':'); const hh = h === '00' ? '24' : String(Number(h)); return m === '00' ? hh : `${hh}:${m}` }
export const tFull = (t: string) => { const [h, m] = t.split(':'); return `${h === '00' ? '24' : h}:${m}` }

export type Calc = { ist: number; night: number; sun: number; hol: number; hol150: number; holiday: string | null; sunday: boolean }
/** Phụ cấp lễ theo § 3b EStG: từ phút nào trong ngày, mức bao nhiêu % */
export function feiertagZone(date: string): { from: number; pct: 125 | 150; name: string } | null {
  const md = date.slice(5)
  if (md === '12-24') return { from: 14 * 60, pct: 150, name: 'Heiligabend ab 14 Uhr' }
  if (md === '12-31') return { from: 14 * 60, pct: 125, name: 'Silvester ab 14 Uhr' }
  const h = holidayOf(date)
  if (!h) return null
  return { from: 0, pct: md === '12-25' || md === '12-26' || md === '05-01' ? 150 : 125, name: h }
}
const overlap = (a: number, b: number, x: number, y: number) => Math.max(0, Math.min(b, y) - Math.max(a, x))
export function calc(s: Shift): Calc {
  const a = mins(s.start_time)
  let b = mins(s.end_time); if (b <= a) b += 24 * 60
  const ist = Math.max(0, b - a - (s.break_min || 0))
  const sunday = weekday(s.shift_date) === 0, z = feiertagZone(s.shift_date)
  // Giờ lễ: phần ca trong khung lễ (Pause tính vào phần ngoài khung lễ trước)
  const fz = z ? Math.min(ist, overlap(a, b, z.from, 24 * 60)) : 0
  const holiday = fz > 0 ? z!.name : null
  // Giờ đêm 20–24: ngày thường và ngày lễ (cộng dồn với phụ cấp lễ), không tính Chủ nhật thường
  const night = !sunday || fz > 0 ? overlap(a, b, 20 * 60, 24 * 60) : 0
  return { ist, night, sun: sunday ? ist - fz : 0, hol: z?.pct === 125 ? fz : 0, hol150: z?.pct === 150 ? fz : 0, holiday, sunday }
}

/** Ghi chú phụ cấp của một ca: lễ (125/150 %), Chủ nhật, đêm */
export function zNote(c: Calc, de: boolean): string[] {
  const o: string[] = []
  if (c.hol || c.hol150) o.push(`${c.holiday}: ${hhmm(c.hol + c.hol150)} (${c.hol150 ? 150 : 125} %)`)
  if (c.sun) o.push(`${de ? 'So' : 'CN'}: ${hhmm(c.sun)}`)
  if (c.night) o.push(`${de ? 'Nacht' : 'Đêm'}: ${hhmm(c.night)}`)
  return o
}
export type MonthStat = { days: number; ist: number; night: number; sun: number; hol: number; hol150: number; vac: number }
/** Không có phụ cấp (đêm / Chủ nhật / lễ) khi giờ làm theo hợp đồng ≤ 10 giờ/tuần (quy tắc quán) */
export const noSurcharge = (e: { weekly_hours?: number | string | null; work_days?: number | string | null; daily_hours?: number | string | null; surcharge_eligible?: boolean | null }) => {
  if (e.surcharge_eligible === false) return true
  if (e.surcharge_eligible === true) return false
  const w = e.weekly_hours != null ? Number(e.weekly_hours) : e.work_days != null && e.daily_hours != null ? Number(e.work_days) * Number(e.daily_hours) : NaN
  return Number.isFinite(w) && w > 0 && w <= 10
}
export function monthStat(shifts: Shift[], vacDates: string[], noZ = false): MonthStat {
  const r = { days: 0, ist: 0, night: 0, sun: 0, hol: 0, hol150: 0, vac: vacDates.length }
  for (const s of shifts) { const c = calc(s); r.days++; r.ist += c.ist; r.night += c.night; r.sun += c.sun; r.hol += c.hol; r.hol150 += c.hol150 }
  if (noZ) { r.night = 0; r.sun = 0; r.hol = 0; r.hol150 = 0 }
  return r
}
/** Danh sách ngày phép (YYYY-MM-DD) trong tháng từ các khoảng nghỉ phép */
export function vacDays(abs: Vacation[], ym: string): string[] {
  const out: string[] = []
  for (const a of abs) {
    if (a.kind !== 'vacation') continue
    for (let d = new Date(`${a.from_date}T12:00:00`); iso(d) <= a.to_date; d.setDate(d.getDate() + 1)) if (iso(d).startsWith(ym)) out.push(iso(d))
  }
  return [...new Set(out)].sort()
}
export const daysInMonth = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()
export const monthDates = (ym: string) => Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
export const monthLabel = (ym: string, de: boolean) => (de ? `${MONTHS_DE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : `Tháng ${ym.slice(5, 7)}/${ym.slice(0, 4)}`)
/** Loại ca để tô màu: lễ, Chủ nhật, sáng (bắt đầu trước 14 giờ), chiều/tối */
export function shiftClass(s: Shift) {
  const c = calc(s)
  return c.holiday ? 'ft' : c.sunday ? 'so' : mins(s.start_time) < 14 * 60 ? 'frueh' : 'spaet'
}
