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
export type FixedShift = { employee_id: string; day: string; start: string; end: string; note?: string | null }
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

export type SchedResult = { shifts: PlanShift[]; perEmp: Record<string, { days: number; minutes: number; need: number }>; gapHours: number; warnings: string[]; autoVac: Record<string, string[]> }

/**
 * Xếp lịch cho tháng ym. vac: ngày phép / nghỉ (không xếp ca, nhưng ngày phép tính vào số ngày của tuần).
 * prev: ca giữ nguyên trước ngày from (2 tuần trước tháng và đầu tháng đã qua) để tính tuần lẻ, nghỉ 11 h, ngày liên tiếp.
 * o.from: ngày bắt đầu xếp (mặc định ngày 1; tháng đang chạy thì từ ngày mai).
 * o.off: ngày nhân viên xin nghỉ (Wunschfrei): không xếp ca nhưng không bớt số ngày của tuần.
 * o.closed: ngày quán đóng cửa (YYYY-MM-DD).
 * o.autoVac: số ngày phép còn lại cần xếp trong tháng cho từng người (chưa có ghi chú phép).
 * o.special: giờ mở cửa ngắn của ngày (vd 26.12 11–17): ca nằm gọn trong khung, ngoài khung không cần người.
 * o.fixed: ca cố định (Fester Dienst) đặt trước, kể cả ngày đóng cửa; tính vào số ngày của tuần.
 */
export function buildSchedule(ym: string, emps: SchedEmp[], vac: Record<string, Set<string>>, prev: PrevShift[],
  o: { from?: string; off?: Record<string, Set<string>>; closed?: string[]; autoVac?: Record<string, number>; fixed?: FixedShift[]; special?: Record<string, { from: string; to: string }> } = {}): SchedResult {
  const from = o.from, off = o.off || {}, closedSet = new Set(o.closed || [])
  const isClosed = (d: string) => closedSet.has(d)
  // Giờ mở cửa ngắn: khung [a, b] phút
  const win: Record<string, { a: number; b: number }> = {}
  for (const [d, h] of Object.entries(o.special || {})) { const a = t(h.from); let b = t(h.to); if (b <= a) b += 1440; win[d] = { a, b: Math.min(1440, b) } }
  const tgt = (d: string, i: number) => { const w = win[d], m = SLOT0 + i * 30; return w && (m < w.a || m >= w.b) ? 0 : target(i, weekday(d)) }
  /** Ca cho ngày d: ngày mở ngắn thì ca nằm trong khung (ngắn hơn khung: đầu hoặc cuối khung; dài hơn: cả khung, pause theo quy tắc) */
  const optsFor = (d: string, base: Tpl[], hours: number): Tpl[] => {
    const w = win[d]
    if (!w) return base
    const p = pauseMin(hours), len = Math.round(hours * 60) + p, mk = (a: number, b: number, pp: number): Tpl => {
      const mid = a + Math.floor((b - a) / 2)
      return { code: 'Kurz', a, b, ...(pp ? { pa: mid - pp / 2, pb: mid + pp / 2 } : {}) }
    }
    if (len <= w.b - w.a) return [mk(w.a, w.a + len, p), mk(w.b - len, w.b, p)]
    const span = w.b - w.a, pp = span - 120 > 420 ? 120 : span - 60 >= 300 ? 60 : 0
    return [mk(w.a, w.b, pp)]
  }
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
  // Ca cố định: đặt trước cho đúng người, đúng giờ (pause theo quy tắc, ở giữa ca)
  const fixedDays: Record<string, Set<string>> = {}
  for (const f of o.fixed || []) {
    if (!work[f.employee_id] || f.day < start || f.day > last) continue
    const a = t(f.start); let b = t(f.end); if (b <= a) b += 1440
    const span = b - a, p = span - 120 > 420 ? 120 : span - 60 >= 300 ? 60 : 0
    const mid = a + Math.floor(span / 2)
    const s: Tpl = { code: 'Fest', a, b, ...(p ? { pa: mid - p / 2, pb: mid + p / 2 } : {}) }
    work[f.employee_id].set(f.day, s); (fixedDays[f.employee_id] ||= new Set()).add(f.day)
    for (let i = 0; i < SLOTS; i++) if (covers(s, i)) cov[f.day][i]++
    out.push({ employee_id: f.employee_id, shift_date: f.day, start_time: hm(a), end_time: b >= 1440 ? '24:00' : hm(b), break_min: p, note: f.note ? `Fest: ${f.note}` : 'Fest' })
    const pe = (perEmp[f.employee_id] ||= { days: 0, minutes: 0, need: 0 }); pe.days++; pe.minutes += span - p
    if (weekday(f.day) === 0) sunCount[f.employee_id] = (sunCount[f.employee_id] || 0) + 1
  }

  // Tự xếp phép (regeln.json urlaub): khối trọn tuần Mo–So (tối đa 3), ngày lẻ liền kề; không tuần có ngày đóng cửa / lễ.
  // Mỗi tuần phép = số ngày/tuần (người làm mọi Chủ nhật: bớt 1, Chủ nhật vẫn làm). Rải tuần để ít người nghỉ cùng lúc.
  const autoVac: Record<string, string[]> = {}
  const freeWeek = (w: string[]) => w.every((d) => d >= start && d <= last && !isClosed(d) && !isHoliday(d))
  const load = new Map<string, number>()
  for (const e of [...emps].sort((a, b) => (o.autoVac?.[b.id] || 0) - (o.autoVac?.[a.id] || 0))) {
    let n = Math.floor(o.autoVac?.[e.id] || 0)
    if (n <= 0) continue
    const V = (vac[e.id] ||= new Set()), O = off[e.id] || new Set<string>()
    const active = (d: string) => (!e.entry || d >= e.entry) && (!e.exit || d <= e.exit)
    const okDay = (d: string) => d >= start && d <= last && active(d) && !isClosed(d) && !isHoliday(d) && weekday(d) !== 0 && !V.has(d) && !O.has(d) && !fixedDays[e.id]?.has(d)
    const k = Math.max(1, Math.min(6, e.sun === 'jeden' ? e.days - 1 : e.days))
    const elig = weeks.map((w, i) => ({ w, i })).filter(({ w }) => freeWeek(w) && w.every(active) && !w.some((d) => V.has(d) || O.has(d) || fixedDays[e.id]?.has(d)))
    const take: string[] = []
    const mark = (ds: string[]) => { for (const d of ds) { V.add(d); take.push(d) } }
    const wk = (w: string[]) => w.filter(okDay)
    let blocks = Math.min(3, Math.floor(n / k), elig.length), lo = -1, hi = -1
    // dãy tuần liên tiếp ít người nghỉ nhất
    while (blocks > 0 && lo < 0) {
      let best = Infinity
      for (let s0 = 0; s0 + blocks <= elig.length; s0++) {
        const run = elig.slice(s0, s0 + blocks)
        if (run.some((x, j) => j && x.i !== run[j - 1].i + 1)) continue
        const l = run.reduce((t, x) => t + (load.get(x.w[0]) || 0), 0)
        if (l < best) { best = l; lo = run[0].i; hi = run[blocks - 1].i }
      }
      if (lo < 0) blocks--
    }
    if (lo >= 0) for (let i = lo; i <= hi; i++) { mark(wk(weeks[i]).slice(0, k)); load.set(weeks[i][0], (load.get(weeks[i][0]) || 0) + 1) }
    n -= take.length
    const r = Math.min(n, k - 1 > 0 ? k - 1 : 1)
    if (r > 0) {
      if (lo >= 0) {
        // ngày lẻ liền kề: đầu tuần sau khối, nếu không được thì cuối tuần trước khối
        const after = hi + 1 < weeks.length ? wk(weeks[hi + 1]).slice(0, r) : []
        const before = lo > 0 ? wk(weeks[lo - 1]).slice(-r) : []
        mark(after.length >= before.length ? after : before)
      } else {
        // ít hơn một tuần: tuần ít người nghỉ nhất còn đủ ngày
        const cand = weeks.map((w) => ({ w, ds: wk(w) })).filter((x) => x.ds.length >= r)
          .sort((a, b) => (load.get(a.w[0]) || 0) - (load.get(b.w[0]) || 0))[0]
        if (cand) { mark(cand.ds.slice(0, r)); load.set(cand.w[0], (load.get(cand.w[0]) || 0) + 1) }
      }
    }
    if (take.length) autoVac[e.id] = take.sort()
    const miss = Math.floor(o.autoVac?.[e.id] || 0) - take.length
    if (miss > 0) warnings.push(`${e.name}: còn ${miss} ngày phép chưa xếp được trong tháng`)
  }

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
    let g = 0
    for (let i = 0; i < SLOTS; i++) if (covers(s, i)) g += Math.max(0, tgt(d, i) - cov[d][i]) + 0.01
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
      // Ca cố định trong tuần: ngày thường tính vào số ngày; ngày lễ → tuần sau bớt 1 ngày (như ca lễ khác)
      const F = fixedDays[e.id]
      const fx = F ? inMonth.filter((d) => F.has(d)) : []
      need -= fx.filter((d) => !isHoliday(d)).length
      for (const d of fx) if (isHoliday(d)) nextErsatz[e.id] = (nextErsatz[e.id] || 0) + 1
      const pool = inMonth.filter((d) => active(d) && !V.has(d) && !O.has(d) && !isClosed(d))
      need = Math.max(0, Math.min(need, pool.length))
      perEmp[e.id] ||= { days: 0, minutes: 0, need: 0 }
      perEmp[e.id].need += need + fx.length
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
          const best = optsFor(su, opts, e.hours).filter((s) => restOk(e, su, s)).sort((a, b) => gain(su, b) - gain(su, a))[0]
          if (best) { place(su, best); left-- }
        }
      }
      while (left > 0) {
        let pick: [string, Tpl, number] | null = null
        for (const d of pool) {
          if (W.has(d)) continue
          if (weekday(d) === 0 && (sunCount[e.id] || 0) >= sunMax) continue
          if (!runOk(e, d)) continue
          for (const s of optsFor(d, opts, e.hours)) {
            if (!restOk(e, d, s)) continue
            const g = gain(d, s)
            if (win[d] && g < 1) continue // ngày mở ngắn: không xếp thêm khi đã đủ người
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
  for (const d of dates) { if (isClosed(d) || d < start) continue; for (let i = 0; i < SLOTS; i++) gap += Math.max(0, tgt(d, i) - cov[d][i]) * 0.5 }
  out.sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time))
  return { shifts: out, perEmp, gapHours: gap, warnings, autoVac }
}
