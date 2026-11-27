// Bộ xếp lịch tự động theo quy tắc của quán (regeln.json, Vietbowl Export Sync 27.11.2026):
// - Mỗi tuần Mo–So đúng tage_pro_woche ngày, mỗi ngày đúng std_pro_tag giờ làm (tuần lẻ tính theo tỉ lệ)
// - Pause: > 7 h → 2 h, 5–7 h → 1 h, < 5 h → 0 (không tính giờ làm). Ca ngắn kết thúc muộn nhất 20:00
// - Nghỉ giữa hai ca ≥ 11 h, tối đa 6 ngày liên tiếp (HĐ 6 ngày: 7)
// - Quy tắc Chủ nhật từng người; 24./25.12 đóng cửa; làm ngày lễ → tuần sau bớt 1 ngày (Ersatzruhetag)
// - Ngày phép là ngày làm (tính vào số ngày của tuần)
// - Mục tiêu nhân sự theo khung giờ (besetzung_ziel)
import { holidayOf, weekday } from './hrTime'

export type SunRule = 'keine' | 'jeden' | 'max. 1' | 'max. 2' | 'alle'
export const SUN_RULES: SunRule[] = ['keine', 'jeden', 'max. 1', 'max. 2', 'alle']
/** Mặc định khi chưa đặt: tối đa 2 Chủ nhật/tháng, người làm 2 ngày/tuần: 1 */
export const defaultSun = (days: number | null | undefined): SunRule => ((days || 0) <= 2 ? 'max. 1' : 'max. 2')
export type SchedEmp = { id: string; name: string; hours: number; days: number; entry: string | null; exit: string | null; sun: SunRule | null }
export type PrevShift = { employee_id: string; shift_date: string; start_time: string; end_time: string }
export type PlanShift = { employee_id: string; shift_date: string; start_time: string; end_time: string; break_min: number; note: string }
type Tpl = { code: string; a: number; b: number; pa?: number; pb?: number }

const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
/** Danh mục ca (schichten.csv). b = 1440 là 24:00 */
const CATALOG: Record<string, Tpl[]> = {
  '8': [['A1', '11:00', '21:00', '14:00', '16:00'], ['A2', '11:00', '21:00', '15:00', '17:00'], ['B1', '12:00', '22:00', '14:30', '16:30'], ['B2', '12:00', '22:00', '15:30', '17:30'],
    ['C1', '13:00', '23:00', '14:30', '16:30'], ['C2', '13:00', '23:00', '15:30', '17:30'], ['D1', '14:00', '24:00', '15:00', '17:00'], ['D2', '14:00', '24:00', '16:00', '18:00']]
    .map(([code, a, b, pa, pb]) => ({ code, a: t(a), b: t(b), pa: t(pa), pb: t(pb) })),
  '5': [['M1', '11:00', '17:00', '14:00', '15:00'], ['M2', '12:00', '18:00', '15:00', '16:00'], ['M3', '14:00', '20:00', '16:00', '17:00']]
    .map(([code, a, b, pa, pb]) => ({ code, a: t(a), b: t(b), pa: t(pa), pb: t(pb) })),
  '4.5': [['K1', '11:00', '15:30'], ['K2', '12:00', '16:30'], ['K3', '13:30', '18:00'], ['K4', '15:30', '20:00']].map(([code, a, b]) => ({ code, a: t(a), b: t(b) })),
  '4': [['N1', '11:00', '15:00'], ['N2', '16:00', '20:00']].map(([code, a, b]) => ({ code, a: t(a), b: t(b) })),
}
export const pauseMin = (hours: number) => (hours > 7 ? 120 : hours >= 5 ? 60 : 0)
/** Ca cho số giờ/ngày; giờ lạ: ca tự tạo bắt đầu 11/12/14 giờ, pause ở giữa */
export function shiftOptions(hours: number): Tpl[] {
  const c = CATALOG[String(hours)]
  if (c) return c
  const p = pauseMin(hours), len = Math.round(hours * 60) + p
  return [11, 12, 14].map((h, i) => ({ code: `X${i + 1}`, a: h * 60, b: Math.min(1440, h * 60 + len), ...(p ? { pa: h * 60 + Math.floor(len / 2) - p / 2, pb: h * 60 + Math.floor(len / 2) + p / 2 } : {}) }))
    .filter((x) => x.b - x.a === len)
}
export const CLOSED_MD = ['12-24', '12-25']
const isClosed = (d: string) => CLOSED_MD.includes(d.slice(5))
const isHoliday = (d: string) => !!holidayOf(d) && d.slice(5) !== '12-31'

/** Mục tiêu nhân sự theo khung 30 phút từ 11:00 đến 24:00 (26 ô) */
const SLOT0 = 11 * 60, SLOTS = 26
function target(slot: number, wd: number) {
  const m = SLOT0 + slot * 30
  const frsa = wd === 5 || wd === 6, frsaso = frsa || wd === 0
  if (m < 14 * 60) return frsaso ? 8 : 7
  if (m < 17 * 60) return 4
  if (m < 23 * 60) return frsa ? 8 : 7
  return 3
}
const covers = (s: Tpl, slot: number) => { const m = SLOT0 + slot * 30; return m >= s.a && m < s.b && !(s.pa != null && m >= s.pa && m < s.pb!) }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x) }

export type SchedResult = { shifts: PlanShift[]; perEmp: Record<string, { days: number; minutes: number; need: number }>; gapHours: number; warnings: string[] }

/**
 * Xếp lịch cho tháng ym. vac: ngày phép / nghỉ (không xếp ca, nhưng ngày phép tính vào số ngày của tuần).
 * prev: ca giữ nguyên trước ngày from (2 tuần trước tháng và đầu tháng đã qua) để tính tuần lẻ, nghỉ 11 h, ngày liên tiếp.
 * off: ngày nhân viên xin nghỉ (Wunschfrei): không xếp ca nhưng không bớt số ngày của tuần.
 * from: ngày bắt đầu xếp (mặc định ngày 1; tháng đang chạy thì từ ngày mai).
 */
export function buildSchedule(ym: string, emps: SchedEmp[], vac: Record<string, Set<string>>, prev: PrevShift[], from?: string, off: Record<string, Set<string>> = {}): SchedResult {
  const first = `${ym}-01`
  const last = iso(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0))
  const dates: string[] = []; for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d)
  const start = from && from > first ? from : first
  // Tuần Mo–So chạm vào tháng
  const weeks: string[][] = []
  let mon = addDays(first, -((weekday(first) + 6) % 7))
  while (mon <= last) { const w: string[] = []; for (let i = 0; i < 7; i++) w.push(addDays(mon, i)); weeks.push(w); mon = addDays(mon, 7) }

  const cov: Record<string, number[]> = Object.fromEntries(dates.map((d) => [d, Array(SLOTS).fill(0)]))
  const work: Record<string, Map<string, Tpl>> = {}       // employee -> date -> ca
  for (const e of emps) work[e.id] = new Map()
  for (const s of prev) {
    if (!work[s.employee_id]) continue
    let b = t(s.end_time); const a = t(s.start_time); if (b <= a) b += 1440
    const p: Tpl = { code: 'prev', a, b }
    work[s.employee_id].set(s.shift_date, p)
    if (cov[s.shift_date]) for (let i = 0; i < SLOTS; i++) if (covers(p, i)) cov[s.shift_date][i]++
  }
  const out: PlanShift[] = [], warnings: string[] = []
  const perEmp: SchedResult['perEmp'] = {}
  const sunCount: Record<string, number> = {}
  for (const s of prev) if (s.shift_date >= first && s.shift_date <= last && weekday(s.shift_date) === 0) sunCount[s.employee_id] = (sunCount[s.employee_id] || 0) + 1

  const runOk = (e: SchedEmp, d: string) => {
    const max = e.days >= 6 ? 7 : 6, w = work[e.id]
    let n = 1
    for (let x = addDays(d, -1); w.has(x); x = addDays(x, -1)) n++
    for (let x = addDays(d, 1); w.has(x); x = addDays(x, 1)) n++
    return n <= max
  }
  const restOk = (e: SchedEmp, d: string, s: Tpl) => {
    const w = work[e.id], p = w.get(addDays(d, -1)), n = w.get(addDays(d, 1))
    if (p && s.a + 1440 - p.b < 660) return false
    if (n && n.a + 1440 - s.b < 660) return false
    return true
  }
  const gain = (d: string, s: Tpl) => {
    const wd = weekday(d); let g = 0
    for (let i = 0; i < SLOTS; i++) if (covers(s, i)) g += Math.max(0, target(i, wd) - cov[d][i]) + 0.01
    return g
  }

  // Người khó xếp trước: nhiều ngày, giờ dài, quy tắc "jeden Sonntag"
  const order = [...emps].sort((a, b) => (b.sun === 'jeden' ? 1 : 0) - (a.sun === 'jeden' ? 1 : 0) || b.days - a.days || b.hours - a.hours)
  let ersatz: Record<string, number> = {}
  for (const w of weeks) {
    const nextErsatz: Record<string, number> = {}
    for (const e of order) {
      const W = work[e.id], V = vac[e.id] || new Set<string>(), O = off[e.id] || new Set<string>()
      const inMonth = w.filter((d) => d >= start && d <= last)
      const before = w.filter((d) => d < start)
      const active = (d: string) => (!e.entry || d >= e.entry) && (!e.exit || d <= e.exit)
      if (!inMonth.some(active)) continue
      // Số ngày cần trong tuần theo hợp đồng; tuần lẻ (vào/nghỉ giữa tuần, tuần sang tháng sau) và ngày lễ tính theo tỉ lệ
      // (khớp lịch mẫu 12/2026: tuần có 26.12 → HĐ 4 ngày làm 3, 5 → 4, 6 → 5, 2/3 ngày giữ nguyên)
      const counted = w.filter((d) => d <= last && active(d) && !isHoliday(d)).length
      let need = Math.round((e.days * counted) / 7 + 1e-9)
      need -= before.filter((d) => W.has(d) || V.has(d)).length
      need -= inMonth.filter((d) => V.has(d) && active(d) && !isClosed(d)).length
      need -= ersatz[e.id] || 0
      const pool = inMonth.filter((d) => active(d) && !V.has(d) && !O.has(d) && !isClosed(d))
      need = Math.max(0, Math.min(need, pool.length))
      perEmp[e.id] ||= { days: 0, minutes: 0, need: 0 }
      perEmp[e.id].need += need
      const opts = shiftOptions(e.hours)
      if (!opts.length) { warnings.push(`${e.name}: không có ca cho ${e.hours} giờ/ngày`); continue }
      const sunMax = e.sun === 'keine' ? 0 : e.sun === 'max. 1' ? 1 : e.sun === 'max. 2' ? 2 : 99
      const place = (d: string, s: Tpl) => {
        W.set(d, s); for (let i = 0; i < SLOTS; i++) if (covers(s, i)) cov[d][i]++
        const ist = s.b - s.a - (s.pa != null ? s.pb! - s.pa : 0)
        out.push({ employee_id: e.id, shift_date: d, start_time: hm(s.a), end_time: s.b >= 1440 ? '24:00' : hm(s.b), break_min: s.pa != null ? s.pb! - s.pa : 0, note: s.code })
        perEmp[e.id].days++; perEmp[e.id].minutes += ist
        if (weekday(d) === 0) sunCount[e.id] = (sunCount[e.id] || 0) + 1
        if (isHoliday(d)) nextErsatz[e.id] = (nextErsatz[e.id] || 0) + 1
      }
      let left = need
      // "jeden Sonntag": Chủ nhật trước
      if (e.sun === 'jeden') {
        const su = pool.find((d) => weekday(d) === 0)
        if (su && left > 0 && runOk(e, su)) {
          const best = opts.filter((s) => restOk(e, su, s)).sort((a, b) => gain(su, b) - gain(su, a))[0]
          if (best) { place(su, best); left-- }
        }
      }
      while (left > 0) {
        let pick: [string, Tpl, number] | null = null
        for (const d of pool) {
          if (W.has(d)) continue
          if (weekday(d) === 0 && (sunCount[e.id] || 0) >= sunMax) continue
          if (!runOk(e, d)) continue
          for (const s of opts) {
            if (!restOk(e, d, s)) continue
            const g = gain(d, s)
            if (!pick || g > pick[2]) pick = [d, s, g]
          }
        }
        if (!pick) { warnings.push(`${e.name}: tuần ${w[0].slice(8)}.${w[0].slice(5, 7)} chỉ xếp được ${need - left}/${need} ngày`); break }
        place(pick[0], pick[1]); left--
      }
    }
    ersatz = nextErsatz
  }
  let gap = 0
  for (const d of dates) { if (isClosed(d) || d < start) continue; const wd = weekday(d); for (let i = 0; i < SLOTS; i++) gap += Math.max(0, target(i, wd) - cov[d][i]) * 0.5 }
  out.sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time))
  return { shifts: out, perEmp, gapHours: gap, warnings }
}
