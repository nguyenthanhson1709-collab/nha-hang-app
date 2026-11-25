// Đọc bảng lương DATEV "Abrechnung der Brutto/Netto-Bezüge" từ chữ của PDF (vị trí x/y của pdfjs).
// Không phụ thuộc trình duyệt, để chạy được bài kiểm tra bằng Node.

export interface TextItem { x: number; y: number; s: string }
export interface Lohnart { la: string; name: string; unit: string | null; qty: number | null; factor: number | null; amount: number | null }
export interface Payslip {
  mandant: string | null; pnr: string; period: string; employer: string | null
  name: string; address: string | null
  birth: string | null; taxClass: number | null; svNo: string | null; health: string | null; pgrs: string | null
  entry: string | null; exit: string | null; taxId: string | null
  gross: number | null; net: number | null; payout: number | null; bank: string | null; ibanMasked: string | null
  lohnarten: Lohnart[]
}

const MONTHS: Record<string, number> = { Januar: 1, Februar: 2, 'März': 3, April: 4, Mai: 5, Juni: 6, Juli: 7, August: 8, September: 9, Oktober: 10, November: 11, Dezember: 12 }

/** "290102" (TTMMJJ) -> "2002-01-29"; JJ <= 40 là 20JJ */
export function d6(s: string | null | undefined): string | null {
  if (!s || !/^\d{6}$/.test(s)) return null
  const d = s.slice(0, 2), m = s.slice(2, 4), yy = Number(s.slice(4))
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
  return `${yy <= 40 ? 2000 + yy : 1900 + yy}-${m}-${d}`
}
/** "1.234,56" / "1.234,56-" -> number */
export function deNum(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.trim().match(/^(-?)([\d.]+,\d+)(-?)$/)
  if (!m) return null
  const v = Number(m[2].replace(/\./g, '').replace(',', '.'))
  return m[1] || m[3] ? -v : v
}
const MONEY = /^-?[\d.]+,\d\d-?$/

type Row = { y: number; items: TextItem[] }
function toRows(items: TextItem[]): Row[] {
  const rows: Row[] = []
  for (const it of [...items].filter((i) => i.s.trim()).sort((a, b) => b.y - a.y)) {
    const r = rows.find((x) => Math.abs(x.y - it.y) <= 2.5)
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] })
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x)
  return rows.sort((a, b) => b.y - a.y)
}
const text = (r: Row | undefined) => (r ? r.items.map((i) => i.s.trim()).join('  ') : '')

/** Trả null nếu trang không phải bảng lương DATEV */
export function parsePayslip(items: TextItem[]): Payslip | null {
  const all = items.map((i) => i.s).join(' ')
  if (!/Abrechnung der Brutto\/Netto-Bez/.test(all)) return null
  const rows = toRows(items)
  const find = (re: RegExp) => rows.find((r) => r.items.some((i) => re.test(i.s)))
  const findItem = (re: RegExp) => items.find((i) => re.test(i.s))
  /** dòng ngay dưới dòng tiêu đề (y nhỏ hơn) có chữ ở vùng x cho trước */
  const below = (hdr: Row | undefined, xMin: number, xMax: number) => {
    if (!hdr) return undefined
    return rows.find((r) => r.y < hdr.y - 3 && r.y > hdr.y - 22 && r.items.some((i) => i.x >= xMin && i.x <= xMax && !/^\d$/.test(i.s.trim())))
  }

  let mandant: string | null = null, pnr = ''
  const mn = all.match(/73884\/(\d+)(?:\/(\d+))?/) || all.match(/\b\d{4,6}\/(\d{4,6})\/(\d{3,6})\b/)
  if (mn) { mandant = mn[1]; pnr = mn[2] || '' }
  const pm = all.match(/\*Pers\.-Nr\.\s*(\d+)\*/)
  if (pm) pnr = pm[1]
  const per = all.match(/für\s+(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})/)
  if (!pnr || !per) return null
  const period = `${per[2]}-${String(MONTHS[per[1]]).padStart(2, '0')}`

  // Personal-Nr. / Geburtsdatum / StKl
  const pHdr = find(/^Personal-Nr\./)
  const pRow = below(pHdr, 40, 60)
  const pTok = text(pRow).split(/\s+/)
  const birth = d6(pTok[1])
  const taxClass = pTok[2] && /^[1-6]$/.test(pTok[2]) ? Number(pTok[2]) : null

  // SV-Nummer / Krankenkasse / PGRS
  const sHdr = find(/^SV-Nummer/)
  const sRow = below(sHdr, 40, 60)
  let svNo: string | null = null, health: string | null = null, pgrs: string | null = null
  if (sRow) {
    // Tên Krankenkasse dài có thể dính vào cột số ("AOK Rheinland/Hamburg Die Ges 1789101 1111 1 30")
    const all2 = sRow.items.map((i) => i.s.trim()).join(' ')
    const m = all2.match(/^(\d{8}[A-Z]\d{3})?\s*([^\d\s].*?)?(?=\s\d{3,}|$)(.*)$/)
    if (m) { svNo = m[1] || null; health = m[2]?.trim() || null }
    const g = (m ? m[3] : all2).match(/(\d{3}) (\d{4})/)
    pgrs = g ? g[1] : null
  }

  // Eintritt / Austritt
  const eHdr = find(/^Eintritt$/)
  const eRow = below(eHdr, 300, 420)
  const ds = (eRow?.items.filter((i) => i.x >= 300 && i.x < 420) || []).flatMap((i) => i.s.trim().split(/\s+/)).filter((x) => /^\d{6}$/.test(x))
  const entry = d6(ds[0]), exit = d6(ds[1])

  // Steuer-ID
  const tHdr = find(/^Steuer-ID$/)
  const tRow = below(tHdr, 300, 420)
  const taxId = (text(tRow).match(/\b(\d{11})\b/) || [])[1] || null

  // Arbeitgeber: "Vietbowl Mitte GmbH*Straße*PLZ Ort"
  const emp = findItem(/^[^*]+\*[^*]+\*/)
  const employer = emp ? emp.s.split('*')[0].trim() : null

  // Tên + địa chỉ: các dòng bên trái giữa "*Pers.-Nr.*" và "Brutto-Bezüge"
  const persY = findItem(/\*Pers\.-Nr\./)?.y ?? 680
  const bruttoY = findItem(/^Brutto-Bezüge$/)?.y ?? 560
  const addr = rows.filter((r) => r.y < persY - 3 && r.y > bruttoY + 3)
    .map((r) => r.items.filter((i) => i.x < 240 && !i.s.includes('*')).map((i) => i.s.trim()).join(' ').trim())
    .filter(Boolean)
  const name = addr[0] || ''

  // Lohnarten
  const lohnarten: Lohnart[] = []
  const gesY = findItem(/^Steuer\/Sozialversicherung$/)?.y ?? 360
  for (const r of rows) {
    if (r.y >= bruttoY - 8 || r.y <= gesY + 3) continue
    const first = r.items[0]
    const m = first?.s.trim().match(/^(\d{4})\s+(.+)$/)
    if (!m || first.x > 60) continue
    const at = (a: number, b: number) => r.items.find((i) => i !== first && i.x >= a && i.x < b)?.s.trim() || null
    lohnarten.push({ la: m[1], name: m[2].trim(), unit: at(250, 290), qty: deNum(at(290, 340)), factor: deNum(at(340, 385)), amount: deNum(r.items.filter((i) => i.x >= 480 && MONEY.test(i.s.trim())).pop()?.s) })
  }

  const moneyRight = (r: Row | undefined) => deNum(r?.items.filter((i) => i.x >= 470 && MONEY.test(i.s.trim())).pop()?.s)
  const gross = moneyRight(rows.find((r) => Math.abs(r.y - gesY) <= 3))
  const nHdr = find(/^Netto-Verdienst$/)
  const net = moneyRight(nHdr && rows.find((r) => r.y < nHdr.y - 3 && r.y > nHdr.y - 16 && r.items.some((i) => i.x >= 470 && MONEY.test(i.s.trim()))))
  const bRow = rows.find((r) => r.items[0]?.s.trim() === 'Bank')
  const kRow = rows.find((r) => r.items[0]?.s.trim() === 'Konto')
  const bank = bRow?.items.filter((i) => i.x > 60 && i.x < 290).map((i) => i.s.trim()).join(' ').trim() || null
  const iban = kRow?.items.filter((i) => i.x > 60 && i.x < 290).map((i) => i.s.trim()).join(' ').trim() || null
  const payout = moneyRight(kRow)

  return {
    mandant, pnr, period, employer, name, address: addr.slice(1).join(', ') || null,
    birth, taxClass, svNo, health, pgrs, entry, exit, taxId,
    gross, net, payout, bank, ibanMasked: iban && /^[A-Z]{2}\d{2}/.test(iban) ? iban : null, lohnarten,
  }
}

/** "Thanh Son Nguyen" -> Vorname "Thanh Son", Name "Nguyen" (bảng lương in Vorname trước) */
export function splitName(full: string): { first_name: string; last_name: string } {
  const p = full.trim().split(/\s+/)
  if (p.length < 2) return { first_name: '', last_name: p[0] || '' }
  return { first_name: p.slice(0, -1).join(' '), last_name: p[p.length - 1] }
}
export const nameKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ')

/** Personengruppe -> loại hợp đồng */
export function empTypeOf(p: Payslip): { employment_type: 'vollzeit' | 'teilzeit' | 'minijob' | 'werkstudent' | 'aushilfe' | null; job_title: string | null } {
  switch (p.pgrs) {
    case '109': return { employment_type: 'minijob', job_title: null }
    case '110': return { employment_type: 'aushilfe', job_title: null }
    case '106': return { employment_type: 'werkstudent', job_title: null }
    case '900': case '190': return { employment_type: null, job_title: 'Geschäftsführer/in' }
  }
  const base = baseSalary(p)
  if (p.pgrs === '101' || p.pgrs === '102' || p.pgrs === '105') return { employment_type: base != null && base >= 2000 ? 'vollzeit' : base != null ? 'teilzeit' : null, job_title: null }
  return { employment_type: null, job_title: null }
}
/** Lương cố định trong tháng (Gehalt / Festlohn / Aushilfslohn / GF-Gehalt) */
export function baseSalary(p: Payslip): number | null {
  const l = p.lohnarten.filter((x) => /^(Gehalt|Geschäftsführergehalt|Festlohn|Aushilfslohn|Stundenlohn|Monatslohn)/.test(x.name) && x.amount != null)
  return l.length ? l.reduce((a, x) => a + (x.amount || 0), 0) : null
}
/** Lương giờ: Faktor của dòng Zuschlag (Nacht/Sonntag/Feiertag) hoặc dòng Stundenlohn */
export function hourlyOf(p: Payslip): number | null {
  const l = p.lohnarten.find((x) => /zuschlag|Stundenlohn/i.test(x.name) && x.factor != null && x.factor > 5)
  return l?.factor ?? null
}
/** Ngày cuối tháng của "YYYY-MM" */
export function monthEnd(period: string) {
  const [y, m] = period.split('-').map(Number)
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
