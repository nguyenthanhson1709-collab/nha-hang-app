// Trinkgeld: Berechnung in ganzen Cent (Beträge) und Minuten (Stunden), ohne Gleitkomma-Rundungsfehler.
// Reine Funktionen, getestet in tests/trinkgeld.mts.
import { calc as shiftCalc, MONTHS_DE, type Shift } from '../lib/hrTime'

export type Rounding = 'cent' | 'euro' | 'euro5'
export type Status = 'entwurf' | 'geprueft' | 'festgeschrieben' | 'teilweise' | 'ausgezahlt' | 'korrigiert' | 'storniert'
export type Kind = 'original' | 'korrektur' | 'storno'
export type PayMethod = 'bar' | 'ueberweisung'
export type FileKind = 'terminal' | 'zbericht' | 'abstimmung' | 'arbeitszeit' | 'sonstige' | 'abrechnung' | 'signiert' | 'auszahlung' | 'korrektur'

export const ROUNDING: Record<Rounding, string> = {
  cent: 'Centgenau', euro: 'Auf volle Euro abrunden', euro5: 'Auf volle 5 Euro abrunden',
}
const STEP: Record<Rounding, number> = { cent: 1, euro: 100, euro5: 500 }

export const STATUS: Record<Status, string> = {
  entwurf: 'Entwurf', geprueft: 'Geprüft', festgeschrieben: 'Festgeschrieben', teilweise: 'Teilweise ausgezahlt',
  ausgezahlt: 'Vollständig ausgezahlt', korrigiert: 'Korrigiert', storniert: 'Storniert',
}
export const STATUS_TAG: Record<Status, string> = {
  entwurf: '', geprueft: 'card', festgeschrieben: 'warn', teilweise: 'warn', ausgezahlt: 'ok', korrigiert: 'err', storniert: 'err',
}
export const isFinal = (s: Status) => ['festgeschrieben', 'teilweise', 'ausgezahlt', 'korrigiert', 'storniert'].includes(s)
export const FILE_KINDS: Record<FileKind, string> = {
  terminal: 'Terminalabrechnungen', zbericht: 'Z-Berichte', abstimmung: 'Abstimmungsnachweise', arbeitszeit: 'Arbeitszeitnachweise',
  sonstige: 'Sonstige Belege', abrechnung: 'Trinkgeldabrechnung', signiert: 'Trinkgeldabrechnung (unterschrieben)',
  auszahlung: 'Auszahlungsnachweise', korrektur: 'Korrekturbelege',
}
/** Archiv-Unterordner je Dateiart */
export const ARCHIVE_DIR: Record<FileKind, string> = {
  terminal: 'Terminalabrechnungen', zbericht: 'Z-Berichte', abstimmung: 'Terminalabrechnungen', arbeitszeit: 'Arbeitszeitnachweise',
  sonstige: 'Trinkgeldabrechnung', abrechnung: 'Trinkgeldabrechnung', signiert: 'Trinkgeldabrechnung', auszahlung: 'Auszahlungsnachweise', korrektur: 'Korrekturbelege',
}
export const ARCHIVE_DIRS = ['Trinkgeldabrechnung', 'Terminalabrechnungen', 'Z-Berichte', 'Arbeitszeitnachweise', 'Auszahlungsnachweise', 'Korrekturbelege']

// ---------- Formate (deutsch) ----------
/** 887806 -> "8.878,06 €" */
export function fmtEur(cents: number, sym = true) {
  const neg = cents < 0, a = Math.abs(Math.round(cents))
  const s = `${neg ? '−' : ''}${Math.floor(a / 100).toLocaleString('de-DE')},${String(a % 100).padStart(2, '0')}`
  return sym ? `${s} €` : s
}
/** 12480 Minuten -> "208,00 h" */
export function fmtH(minutes: number, sym = true) {
  const s = (minutes / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return sym ? `${s} h` : s
}
/** "208,5" / "208.5" -> 12510 Minuten */
export function parseHours(s: string): number | null {
  const t = s.trim().replace(/\s|h/gi, '').replace(',', '.')
  if (!t) return null
  if (/^\d+:\d{1,2}$/.test(t)) { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const v = Number(t)
  return isFinite(v) && v >= 0 ? Math.round(v * 60) : null
}
export const toCents = (euro: number) => Math.round(euro * 100)
export const deMonth = (p: string) => `${MONTHS_DE[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
export const mmYYYY = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`
export const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')
export const lastDay = (p: string) => `${p}-${String(new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0).getDate()).padStart(2, '0')}`

// ---------- Trinkgeld-Ermittlung ----------
export interface Ermittlung {
  tip_source: 'differenz' | 'pos'
  terminal_cents: number; z_cents: number; pos_tip_cents: number | null
  correction_cents: number; cash_tip_cents: number; carry_in_cents: number
}
export function ermittlung(s: Ermittlung) {
  const differenz = s.terminal_cents - s.z_cents
  const base = s.tip_source === 'pos' && s.pos_tip_cents != null ? s.pos_tip_cents : differenz
  const karten = base + s.correction_cents
  const available = karten + s.cash_tip_cents + s.carry_in_cents
  // Abweichung POS-Trinkgeld vs. Terminal-Differenz (zur Abstimmung)
  const posMismatch = s.pos_tip_cents != null ? s.pos_tip_cents - differenz : 0
  return { differenz, karten, available, posMismatch }
}

// ---------- Verteilung ----------
export interface DistLine { minutes: number; participates: boolean }
export interface Dist { amounts: number[]; totalMinutes: number; payout: number; rest: number; perHourCents: number }
/**
 * Verteilung nach Stunden: Betrag_i = abrunden(verfügbar × Minuten_i / Gesamtminuten) auf Cent / Euro / 5 Euro.
 * Gerundet wird nur der Endbetrag je Mitarbeiter, nie der Stundensatz. Summe ≤ verfügbar, Rest = Übertrag.
 */
export function distribute(availableCents: number, lines: DistLine[], rounding: Rounding): Dist {
  const totalMinutes = lines.reduce((s, l) => s + (l.participates ? Math.max(0, Math.round(l.minutes)) : 0), 0)
  const avail = Math.max(0, Math.round(availableCents))
  if (totalMinutes <= 0 || avail <= 0) return { amounts: lines.map(() => 0), totalMinutes, payout: 0, rest: avail, perHourCents: 0 }
  const step = BigInt(STEP[rounding]), A = BigInt(avail), T = BigInt(totalMinutes)
  const amounts = lines.map((l) => {
    if (!l.participates || l.minutes <= 0) return 0
    const exact = (A * BigInt(Math.round(l.minutes))) / T // abgerundet auf Cent (BigInt-Division)
    return Number((exact / step) * step)
  })
  const payout = amounts.reduce((s, a) => s + a, 0)
  return { amounts, totalMinutes, payout, rest: avail - payout, perHourCents: (avail * 60) / totalMinutes }
}

// ---------- Stunden aus der Zeiterfassung ----------
export interface Absence { employee_id: string; from_date: string; to_date: string; kind: string }
/**
 * Tatsächlich geleistete Minuten im Monat (Pause abgezogen). Tage mit Urlaub / Krankheit / sonstiger Abwesenheit
 * zählen nicht; Feiertage ohne Schicht ergeben keine Stunden. Schichten an Abwesenheitstagen werden gemeldet.
 */
export function monthMinutes(shifts: Shift[], absences: Absence[], period: string) {
  const out = new Map<string, { minutes: number; days: number; skipped: number }>()
  const absent = (eid: string, d: string) => absences.some((a) => a.employee_id === eid && a.from_date <= d && a.to_date >= d)
  for (const s of shifts) {
    if (!s.shift_date.startsWith(period)) continue
    const r = out.get(s.employee_id) || { minutes: 0, days: 0, skipped: 0 }
    if (absent(s.employee_id, s.shift_date)) r.skipped++
    else { r.minutes += shiftCalc(s).ist; r.days++ }
    out.set(s.employee_id, r)
  }
  return out
}

// ---------- Belegnummern ----------
/** TG-YYYY-MM; Korrektur -K1, Storno -S1; neue Abrechnung nach Storno -2, -3 … */
export function belegNo(period: string, kind: Kind, taken: string[]): string {
  const base = `TG-${period}`
  if (kind === 'original' && !taken.includes(base)) return base
  const pre = kind === 'korrektur' ? `${base}-K` : kind === 'storno' ? `${base}-S` : `${base}-`
  for (let i = kind === 'original' ? 2 : 1; ; i++) if (!taken.includes(pre + i)) return pre + i
}
export const fileSafe = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const pdfName = (beleg: string, company: string, what = 'Trinkgeldabrechnung') => `${beleg}_${fileSafe(company)}_${what}.pdf`
export const archiveDir = (period: string) => `Trinkgeld/${period.slice(0, 4)}/${period.slice(5, 7)}-${MONTHS_DE[Number(period.slice(5, 7)) - 1]}`

// ---------- Auszahlungsstatus je Mitarbeiter ----------
export type PayState = 'offen' | 'teilweise' | 'ausgezahlt'
export const PAY_STATE: Record<PayState, string> = { offen: 'Offen', teilweise: 'Teilweise ausgezahlt', ausgezahlt: 'Ausgezahlt' }
/** null = nichts auszuzahlen */
export function payState(amount: number, paid: number): PayState | null {
  if (amount <= 0 && paid <= 0) return null
  if (paid <= 0) return 'offen'
  return paid >= amount ? 'ausgezahlt' : 'teilweise'
}
