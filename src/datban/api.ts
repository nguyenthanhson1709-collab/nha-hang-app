// Module Đặt bàn: đọc/ghi dữ liệu nh_bk_* (mọi thay đổi đơn đi qua hàm trên máy chủ, máy chủ kiểm tra lại luật)
import { supabase } from '../lib/supabase'

export type Status = 'pending' | 'confirmed' | 'seated' | 'noshow' | 'cancelled' | 'rejected'
export const ACTIVE: Status[] = ['pending', 'confirmed', 'seated']

export interface BkSettings {
  restaurant_id: string; slug: string | null; online_enabled: boolean
  auto_confirm: boolean; peak_enabled: boolean; duration_min: number; min_online: number; max_online: number
  slot_step: number; open_time: string; close_time: string; weekday_from: string | null; closed_days: string[]
  lead_hours: number; auto_arrive_min: number; contact_email: string | null; tz: string; google_review_url: string | null
}
export const DEFAULT_SETTINGS: Omit<BkSettings, 'restaurant_id'> = {
  slug: null, online_enabled: false, auto_confirm: true, peak_enabled: true, duration_min: 90, min_online: 4, max_online: 20,
  slot_step: 15, open_time: '11:30', close_time: '23:00', weekday_from: '14:00', closed_days: ['12-24', '12-25'],
  lead_hours: 4, auto_arrive_min: 20, contact_email: null, tz: 'Europe/Berlin', google_review_url: null,
}
export interface PeakRule { id: string; restaurant_id: string; days: number[]; start_time: string; end_time: string; max_guests: number; block_min: number; active: boolean }
export interface Area { restaurant_id: string; id: string; name: string; sort: number }
export interface Table { restaurant_id: string; id: string; label: string; area_id: string | null; x: number; y: number; w: number; h: number; rot: number; seats: number | null; flip: boolean; active: boolean }
export interface Booking {
  id: string; restaurant_id: string; code: string; day: string; slot: string; party: number; name: string
  phone: string | null; email: string | null; note: string | null; lang: string; status: Status
  source: 'online' | 'phone' | 'walkin'; channel: string | null; created_at: string; created_by_name: string | null
  auto_arrived: boolean; called: boolean; review_ok: boolean; tables: string[]
}
export interface LogRow { id: number; booking_id: string; at: string; staff_name: string | null; kind: 'status' | 'tables'; old_value: string | null; new_value: string | null }
export interface Review { booking_id: string; day: string; slot: string; party: number; name: string; tables: string | null; stars: number; comment: string | null; created_at: string }

const hm = (t: string) => t.slice(0, 5)
const norm = (s: BkSettings): BkSettings => ({ ...s, open_time: hm(s.open_time), close_time: hm(s.close_time), weekday_from: s.weekday_from ? hm(s.weekday_from) : null })

export async function loadSettings(rid: string): Promise<BkSettings> {
  const { data, error } = await supabase.from('nh_bk_settings').select('*').eq('restaurant_id', rid).maybeSingle()
  if (error) throw error
  return norm((data as BkSettings) || { ...DEFAULT_SETTINGS, restaurant_id: rid })
}
export async function saveSettings(s: BkSettings) {
  const { error } = await supabase.from('nh_bk_settings').upsert({ ...s, updated_at: new Date().toISOString() })
  if (error) throw error
}
export async function loadPlan(rid: string) {
  const [a, t] = await Promise.all([
    supabase.from('nh_bk_areas').select('*').eq('restaurant_id', rid).order('sort'),
    supabase.from('nh_bk_tables').select('*').eq('restaurant_id', rid).eq('active', true),
  ])
  if (a.error) throw a.error
  if (t.error) throw t.error
  const tables = (t.data as Table[]).map((x) => ({ ...x, x: +x.x, y: +x.y, w: +x.w, h: +x.h, rot: +x.rot || 0 }))
  return { areas: a.data as Area[], tables: tables.sort((p, q) => (parseFloat(p.label) - parseFloat(q.label)) || p.label.localeCompare(q.label)) }
}
export async function loadRules(rid: string): Promise<PeakRule[]> {
  const { data, error } = await supabase.from('nh_bk_peak_rules').select('*').eq('restaurant_id', rid).order('created_at')
  if (error) throw error
  return (data as PeakRule[]).map((r) => ({ ...r, start_time: hm(r.start_time), end_time: hm(r.end_time) }))
}
export async function loadDays(rid: string, from: string, to: string): Promise<Booking[]> {
  const { data, error } = await supabase.from('nh_bk_bookings').select('*, nh_bk_booking_tables(table_id)')
    .eq('restaurant_id', rid).gte('day', from).lte('day', to).order('day').order('slot')
  if (error) throw error
  return (data as (Booking & { nh_bk_booking_tables: { table_id: string }[] })[]).map(({ nh_bk_booking_tables: bt, ...b }) => ({ ...b, slot: hm(b.slot), tables: (bt || []).map((x) => x.table_id) }))
}
export async function loadNotes(rid: string): Promise<Record<string, string>> {
  const { data } = await supabase.from('nh_bk_guest_notes').select('guest_key, note').eq('restaurant_id', rid)
  return Object.fromEntries((data || []).map((x) => [x.guest_key, x.note]))
}
export async function saveNote(rid: string, key: string, note: string) {
  const q = note.trim()
    ? supabase.from('nh_bk_guest_notes').upsert({ restaurant_id: rid, guest_key: key, note: note.trim() })
    : supabase.from('nh_bk_guest_notes').delete().eq('restaurant_id', rid).eq('guest_key', key)
  const { error } = await q
  if (error) throw error
}
export const noteKey = (name: string) => name.trim().toLowerCase()

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
export const saveBooking = (rid: string, b: { id: string | null; day: string; slot: string; party: number; name: string; phone: string; email: string; note: string; source: string; tables: string[] | null }, override: boolean) =>
  rpc<string>('nh_bk_save_booking', { p_rid: rid, p_id: b.id, p_day: b.day, p_slot: b.slot, p_party: b.party, p_name: b.name, p_phone: b.phone, p_email: b.email, p_note: b.note, p_source: b.source, p_tables: b.tables, p_override: override })
export const setStatus = (id: string, status: Status) => rpc('nh_bk_set_status', { p_id: id, p_status: status })
export const setTables = (id: string, tables: string[]) => rpc('nh_bk_set_tables', { p_id: id, p_tables: tables })
export const setCalled = (id: string, called: boolean) => rpc('nh_bk_set_called', { p_id: id, p_called: called })
export const deleteBooking = (id: string) => rpc('nh_bk_delete_booking', { p_id: id })
export const listReviews = (rid: string, days = 365) => rpc<Review[]>('nh_bk_reviews_list', { p_rid: rid, p_days: days })
export async function loadLog(id: string): Promise<LogRow[]> {
  const { data } = await supabase.from('nh_bk_log').select('*').eq('booking_id', id).order('at')
  return (data || []) as LogRow[]
}

// ---------- tính toán trên máy (giống máy chủ, để hiện trước) ----------
export const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
export const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const parseD = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (s: string, n: number) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d) }
export const today = () => ymd(new Date())
export const isClosed = (s: BkSettings, day: string) => s.closed_days.includes(day.slice(5))

/** Các giờ trong ngày cho nhân viên chọn (từ giờ mở tới giờ ngồi cuối) */
export function staffSlots(s: BkSettings) {
  const out: string[] = []
  for (let m = toMin(s.open_time); m <= toMin(s.close_time) - 15; m += 15) out.push(toHM(m))
  return out
}
/** Khung cao điểm chật nhất chứa giờ này */
export function peakCheck(s: BkSettings, rules: PeakRule[], bookings: Booking[], day: string, slot: string, party: number, exclude?: string | null) {
  if (!s.peak_enabled) return null
  const wd = parseD(day).getDay(), m = toMin(slot)
  let worst: { from: string; to: string; used: number; max: number; left: number; ok: boolean } | null = null
  for (const r of rules) {
    if (!r.active || !r.days.includes(wd) || m < toMin(r.start_time) || m >= toMin(r.end_time)) continue
    const f = toMin(r.start_time), a = f + Math.floor((m - f) / r.block_min) * r.block_min, b = a + r.block_min
    const used = bookings.filter((x) => x.id !== exclude && x.day === day && ACTIVE.includes(x.status) && toMin(x.slot) >= a && toMin(x.slot) < b).reduce((n, x) => n + x.party, 0)
    const info = { from: toHM(a), to: toHM(b), used, max: r.max_guests, left: r.max_guests - used, ok: party <= r.max_guests - used }
    if (!worst || info.left < worst.left) worst = info
  }
  return worst
}
/** Bàn đang bận quanh giờ này (theo thời gian ngồi trung bình) */
export function busyTables(s: BkSettings, bookings: Booking[], day: string, slot: string, exclude?: string | null) {
  const m = toMin(slot), set = new Set<string>()
  for (const b of bookings) {
    if (b.id === exclude || b.day !== day || !ACTIVE.includes(b.status)) continue
    if (Math.abs(toMin(b.slot) - m) < s.duration_min) b.tables.forEach((t) => set.add(t))
  }
  return set
}
export function tableState(s: BkSettings, bookings: Booking[], tableId: string, day: string, slot: string) {
  const m = toMin(slot)
  let state: 'free' | 'reserved' | 'pending' | 'seated' = 'free', bk: Booking | null = null
  for (const b of bookings) {
    if (b.day !== day || !ACTIVE.includes(b.status) || !b.tables.includes(tableId)) continue
    const bm = toMin(b.slot)
    if (m >= bm - 30 && m < bm + s.duration_min) {
      const st = b.status === 'seated' ? 'seated' : b.status === 'pending' ? 'pending' : 'reserved'
      if (!bk || st === 'seated') { state = st; bk = b }
    }
  }
  return { state, bk }
}
/** Tên bàn gọn: bàn liền nhau theo thứ tự số hiện thành dải 41-44 */
export function tableNames(ids: string[], tables: Table[]) {
  const order = tables.map((t) => t.label)
  const pos = new Map(order.map((n, i) => [n, i]))
  const ns = ids.map((id) => tables.find((t) => t.id === id)?.label || id.replace(/^t/, '')).sort((p, q) => (pos.get(p) ?? 1e9) - (pos.get(q) ?? 1e9))
  const runs: string[][] = []
  for (const n of ns) { const r = runs[runs.length - 1]; if (r && pos.has(n) && pos.get(n) === (pos.get(r[r.length - 1]) ?? -9) + 1) r.push(n); else runs.push([n]) }
  return runs.map((r) => (r.length >= 3 ? `${r[0]}-${r[r.length - 1]}` : r.join(' + '))).join(', ')
}
export const CHANNEL: Record<string, string> = { web: 'Website', google: 'Google', instagram: 'Instagram', facebook: 'Facebook', qr: 'QR-Code' }
