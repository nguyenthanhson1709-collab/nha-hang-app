// Trinkgeld: Datenzugriff (Supabase). Firmendaten kommen aus den Unternehmenseinstellungen (nh_inv_company), keine Kopie.
import { supabase } from '../lib/supabase'
import { EMP_TYPES, POSITIONS, type Employee } from '../lib/hr'
import type { Shift } from '../lib/hrTime'
import type { Company } from '../hoadon/types'
import { belegNo, distribute, ermittlung, lastDay, monthMinutes, toCents, type Absence, type FileKind, type Kind, type PayMethod, type Rounding, type Status } from './calc'

export const TG_BUCKET = 'nh-trinkgeld'

export interface TgSettings {
  restaurant_id: string; rounding: Rounding; betriebsstaette: string | null
  konto_trinkgeld: string | null; konto_kasse: string | null; kassenbuch: boolean
}
export interface Settlement {
  id: string; restaurant_id: string; period: string; beleg_no: string; kind: Kind; ref_id: string | null; status: Status
  betriebsstaette: string; period_from: string; period_to: string; stichtag: string; created_on: string
  tip_source: 'differenz' | 'pos'; terminal_cents: number; z_cents: number; pos_tip_cents: number | null; z_from: string | null; z_to: string | null
  cash_tip_cents: number; carry_in_cents: number; correction_cents: number; correction_reason: string | null; remarks: string | null
  tip_confirmed: boolean; rounding: Rounding; available_cents: number; total_minutes: number; payout_cents: number; rest_cents: number
  data_source: string | null; created_by: string | null; created_at: string; checked_by: string | null; checked_at: string | null
  locked_by: string | null; locked_at: string | null; updated_by: string | null; updated_at: string; cancel_reason: string | null
}
export interface Line {
  id: string; settlement_id: string; restaurant_id: string; employee_id: string | null
  personnel_no: string | null; first_name: string; last_name: string; emp_type: string | null; department: string | null; exit_date: string | null
  minutes_auto: number; minutes: number; edit_reason: string | null; participates: boolean; amount_cents: number; sort: number
}
export interface Payment {
  id: string; settlement_id: string; line_id: string; restaurant_id: string; employee_id: string | null; amount_cents: number; paid_on: string
  method: PayMethod; receipt_no: string | null; booking_ref: string | null; paid_by: string | null; remarks: string | null; files: string[]
  cash_move_id: string | null; cancelled_at: string | null; cancel_reason: string | null; created_by: string | null; created_at: string
}
export interface TgFile { id: string; settlement_id: string; restaurant_id: string; kind: FileKind; path: string; name: string; payment_id: string | null; created_at: string; created_by: string | null }
export interface Audit { id: number; settlement_id: string | null; tbl: string; row_id: string | null; action: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; reason: string | null; by_user: string | null; at: string }

const num = <T extends object>(o: T): T => {
  const r = { ...o } as Record<string, unknown>
  for (const k of Object.keys(r)) if (/_cents$|minutes|^sort$/.test(k) && r[k] != null) r[k] = Number(r[k])
  return r as T
}
const check = <T,>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data }

/** Fehlermeldungen der Datenbank (NH_TG_…) lesbar machen */
export function tgErr(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  const hit = m.match(/NH_TG_[A-Z]+:?\s*(.*)/)
  if (hit) return hit[1] || m
  if (/nh_tg_one_official|duplicate key.*beleg/i.test(m)) return 'Für diesen Monat und diese Betriebsstätte besteht bereits eine gültige Abrechnung (Beleg-Nr. vergeben).'
  if (/nh_tg_one_correction/.test(m)) return 'Zu diesem Beleg gibt es bereits einen offenen Korrektur- oder Stornobeleg.'
  return m
}

export async function loadSettings(rid: string): Promise<TgSettings> {
  const row = check(await supabase.from('nh_tg_settings').select('*').eq('restaurant_id', rid).maybeSingle()) as TgSettings | null
  return row || { restaurant_id: rid, rounding: 'euro', betriebsstaette: null, konto_trinkgeld: null, konto_kasse: null, kassenbuch: true }
}
export async function saveSettings(s: TgSettings) {
  check(await supabase.from('nh_tg_settings').upsert({ ...s, updated_at: new Date().toISOString() }))
}
export async function loadCompany(rid: string): Promise<Company | null> {
  return check(await supabase.from('nh_inv_company').select('*').eq('restaurant_id', rid).maybeSingle()) as Company | null
}

export async function listSettlements(rid: string): Promise<Settlement[]> {
  const rows = check(await supabase.from('nh_tg_settlements').select('*').eq('restaurant_id', rid).order('period', { ascending: false }).order('created_at')) as Settlement[]
  return rows.map(num)
}
export async function loadDetail(id: string) {
  const [s, l, p, f] = await Promise.all([
    supabase.from('nh_tg_settlements').select('*').eq('id', id).single(),
    supabase.from('nh_tg_lines').select('*').eq('settlement_id', id).order('sort'),
    supabase.from('nh_tg_payments').select('*').eq('settlement_id', id).order('paid_on').order('created_at'),
    supabase.from('nh_tg_files').select('*').eq('settlement_id', id).order('created_at'),
  ])
  return { s: num(check(s) as Settlement), lines: (check(l) as Line[]).map(num), payments: (check(p) as Payment[]).map(num), files: check(f) as TgFile[] }
}
/** Zahlungen der ganzen Belegkette (Ursprungsbeleg + Korrekturen) */
export async function chainPayments(s: Settlement): Promise<Payment[]> {
  const root = s.ref_id || s.id
  const ids = check(await supabase.from('nh_tg_settlements').select('id').or(`id.eq.${root},ref_id.eq.${root}`)) as { id: string }[]
  const rows = check(await supabase.from('nh_tg_payments').select('*').in('settlement_id', ids.map((x) => x.id)).order('paid_on')) as Payment[]
  return rows.map(num)
}
export async function loadAudit(id: string): Promise<Audit[]> {
  return check(await supabase.from('nh_tg_audit').select('*').eq('settlement_id', id).order('at', { ascending: false }).limit(300)) as Audit[]
}
/** Namen der Benutzer für das Protokoll */
export async function userNames(): Promise<Record<string, string>> {
  const { data } = await supabase.from('nh_profiles').select('id, full_name, email')
  const out: Record<string, string> = {}
  for (const p of (data || []) as { id: string; full_name?: string | null; email?: string | null }[]) out[p.id] = p.full_name || p.email || p.id.slice(0, 8)
  return out
}

/** Daten für eine neue Abrechnung: Z-Berichte, Viva-Terminal, Übertrag, Mitarbeiter mit Stunden */
export async function prefill(rid: string, period: string, cardSource: string | null) {
  const from = `${period}-01`, to = lastDay(period)
  const [zq, vq, prev, eq, sq, aq] = await Promise.all([
    supabase.from('nh_zbons').select('z_date, z_no, total, cash_revenue, tip, tip_card').eq('restaurant_id', rid).gte('z_date', from).lte('z_date', to).order('z_date'),
    supabase.from('nh_cash_moves').select('amount').eq('restaurant_id', rid).eq('channel', 'viva').gte('move_date', from).lte('move_date', to),
    supabase.from('nh_tg_settlements').select('period, rest_cents, status, kind').eq('restaurant_id', rid).lt('period', period).in('status', ['festgeschrieben', 'teilweise', 'ausgezahlt']).neq('kind', 'storno').order('period', { ascending: false }).order('created_at', { ascending: false }).limit(1),
    supabase.from('nh_employees').select('*').eq('restaurant_id', rid),
    supabase.from('nh_shifts').select('id, employee_id, shift_date, start_time, end_time, break_min, note').eq('restaurant_id', rid).gte('shift_date', from).lte('shift_date', to),
    supabase.from('nh_absences').select('employee_id, from_date, to_date, kind').eq('restaurant_id', rid).lte('from_date', to).gte('to_date', from),
  ])
  const zb = (check(zq) || []) as { z_date: string; z_no: string | null; total: number; cash_revenue: number; tip: number; tip_card: number }[]
  const zCard = zb.reduce((s, z) => s + Math.max(0, toCents(Number(z.total) - Number(z.cash_revenue))), 0)
  const posTip = zb.reduce((s, z) => s + toCents(Number(z.tip_card) > 0 ? Number(z.tip_card) : Number(z.tip) || 0), 0)
  const nos = zb.map((z) => z.z_no).filter(Boolean) as string[]
  const sortNo = (a: string, b: string) => (Number(a) && Number(b) ? Number(a) - Number(b) : a.localeCompare(b))
  nos.sort(sortNo)
  const viva = ((check(vq) || []) as { amount: number }[]).reduce((s, m) => s + toCents(Number(m.amount)), 0)
  const p0 = ((check(prev) || []) as { period: string; rest_cents: number }[])[0]
  const emps = (check(eq) || []) as (Employee & { id: string })[]
  const mins = monthMinutes((check(sq) || []) as Shift[], (check(aq) || []) as Absence[], period)
  // Alle, die im Monat beschäftigt waren oder Stunden haben (auch Austritt im Monat); Minijobber nicht ausgeschlossen
  const inMonth = emps.filter((e) => mins.has(e.id) || ((!e.entry_date || e.entry_date <= to) && (!e.exit_date || e.exit_date >= from)))
  inMonth.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || ''))
  const lines = inMonth.map((e, i) => {
    const m = mins.get(e.id)
    return {
      employee_id: e.id, personnel_no: e.personnel_no || null, first_name: e.first_name || '', last_name: e.last_name || '',
      emp_type: e.employment_type ? EMP_TYPES[e.employment_type]?.[1] || e.employment_type : null,
      department: e.position ? POSITIONS[e.position]?.[1] || e.position : null, exit_date: e.exit_date,
      minutes_auto: m?.minutes || 0, minutes: m?.minutes || 0, participates: true, amount_cents: 0, sort: i, edit_reason: null,
      skipped: m?.skipped || 0,
    }
  })
  const useViva = cardSource === 'viva' && viva > 0
  return {
    z: { count: zb.length, card: zCard, posTip, from: nos[0] || null, to: nos[nos.length - 1] || null },
    terminal: useViva ? viva : null, terminalSource: useViva ? 'Viva Wallet (im Kassenbuch erfasst)' : null,
    carryIn: p0 ? Number(p0.rest_cents) : 0, carryFrom: p0?.period || null, lines,
  }
}

/** Neue Abrechnung (Entwurf) mit Mitarbeiterzeilen anlegen */
export async function createSettlement(rid: string, input: Partial<Settlement> & { period: string; kind?: Kind; ref_id?: string | null },
  lines: Omit<Line, 'id' | 'settlement_id' | 'restaurant_id'>[]): Promise<string> {
  const taken = (check(await supabase.from('nh_tg_settlements').select('beleg_no').eq('restaurant_id', rid).eq('period', input.period)) as { beleg_no: string }[]).map((x) => x.beleg_no)
  const kind = input.kind || 'original'
  const row = { ...input, restaurant_id: rid, kind, beleg_no: belegNo(input.period, kind, taken) }
  const s = check(await supabase.from('nh_tg_settlements').insert(row).select('id').single()) as { id: string }
  if (lines.length) {
    const r = await supabase.from('nh_tg_lines').insert(lines.map((l, i) => ({ ...l, sort: i, settlement_id: s.id, restaurant_id: rid })))
    if (r.error) { await supabase.from('nh_tg_settlements').delete().eq('id', s.id); throw new Error(r.error.message) }
  }
  return s.id
}

/** Summen neu berechnen und zusammen mit den Zeilen speichern (nur Entwurf / Geprüft) */
export function recompute(s: Settlement, lines: Line[]) {
  const e = ermittlung(s)
  const d = distribute(e.available, lines, s.rounding)
  const nl = lines.map((l, i) => ({ ...l, amount_cents: d.amounts[i] }))
  return { s: { ...s, available_cents: e.available, total_minutes: d.totalMinutes, payout_cents: d.payout, rest_cents: d.rest }, lines: nl, e, d }
}
export async function saveSettlement(s: Settlement, lines: Line[], before: Line[]) {
  const { s: ns, lines: nl } = recompute(s, lines)
  const { id, restaurant_id, kind, ref_id, beleg_no, status, created_by, created_at, checked_by, checked_at, locked_by, locked_at, updated_by, updated_at, ...rest } = ns
  void restaurant_id; void kind; void ref_id; void beleg_no; void status; void created_by; void created_at; void checked_by; void checked_at; void locked_by; void locked_at; void updated_by; void updated_at
  const old = new Map(before.map((l) => [l.id, l]))
  for (const l of nl) {
    const o = old.get(l.id)
    if (o && o.minutes === l.minutes && o.participates === l.participates && o.amount_cents === l.amount_cents && (o.edit_reason || '') === (l.edit_reason || '')) continue
    check(await supabase.from('nh_tg_lines').update({ minutes: l.minutes, participates: l.participates, amount_cents: l.amount_cents, edit_reason: l.edit_reason }).eq('id', l.id))
  }
  check(await supabase.from('nh_tg_settlements').update(rest).eq('id', id))
}
export async function setStatus(id: string, status: Status, extra: Partial<Settlement> = {}) {
  check(await supabase.from('nh_tg_settlements').update({ status, ...extra }).eq('id', id))
}

export async function pay(lineId: string, amountCents: number, date: string, method: PayMethod, receipt: string, ref: string, by: string, remarks: string, kassenbuch: boolean): Promise<string> {
  return check(await supabase.rpc('nh_tg_pay', { p_line: lineId, p_amount: amountCents, p_date: date, p_method: method, p_receipt: receipt, p_ref: ref, p_by: by, p_remarks: remarks, p_kassenbuch: kassenbuch })) as string
}
export async function cancelPayment(id: string, reason: string) {
  check(await supabase.rpc('nh_tg_cancel_payment', { p_id: id, p_reason: reason }))
}

export async function uploadTgFile(s: Settlement, kind: FileKind, f: Blob, name: string, paymentId: string | null = null): Promise<TgFile> {
  const ext = (name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
  const path = `${s.restaurant_id}/${s.id}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(TG_BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false })
  if (up.error) throw up.error
  const row = check(await supabase.from('nh_tg_files').insert({ settlement_id: s.id, restaurant_id: s.restaurant_id, kind, path, name, payment_id: paymentId }).select('*').single()) as TgFile
  if (paymentId) {
    const p = check(await supabase.from('nh_tg_payments').select('files').eq('id', paymentId).single()) as { files: string[] }
    await supabase.from('nh_tg_payments').update({ files: [...(p.files || []), path] }).eq('id', paymentId)
  }
  return row
}
export async function deleteTgFile(f: TgFile) {
  check(await supabase.from('nh_tg_files').delete().eq('id', f.id))
  await supabase.storage.from(TG_BUCKET).remove([f.path])
}
export async function tgFileBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(TG_BUCKET).download(path)
  if (error || !data) throw error || new Error('Datei nicht gefunden')
  return data
}
export async function tgFileUrl(path: string) {
  const { data } = await supabase.storage.from(TG_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl || ''
}

/** Gültige Abrechnung eines Monats: offene Korrektur vor Original, ohne stornierte / korrigierte */
export function activeOf(list: Settlement[], period: string): Settlement | null {
  const ms = list.filter((s) => s.period === period && s.kind !== 'storno' && s.status !== 'storniert' && s.status !== 'korrigiert')
  return ms.find((s) => s.kind === 'korrektur') || ms[0] || null
}
export const ACCEPT = 'application/pdf,image/jpeg,image/png'
export const okFile = (f: File) => /^(application\/pdf|image\/(jpeg|png))$/.test(f.type) || /\.(pdf|jpe?g|png)$/i.test(f.name)

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
