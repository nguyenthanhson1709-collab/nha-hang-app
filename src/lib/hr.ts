// Module Nhân sự (Personal): kiểu dữ liệu, nhãn song ngữ, kho file riêng tư nh-personal
import { supabase } from './supabase'
import { todayIso } from './format'

export const HR_BUCKET = 'nh-personal'

export type Position = 'kitchen' | 'service' | 'bar' | 'dish' | 'other'
export type EmpType = 'vollzeit' | 'teilzeit' | 'minijob' | 'werkstudent' | 'aushilfe'
export type DocKind = 'passport' | 'residence' | 'work_permit' | 'id_card' | 'contract' | 'payslip' | 'sv' | 'tax' | 'health' | 'certificate' | 'other'

export interface Employee {
  id?: string; restaurant_id?: string
  last_name: string; first_name: string; address: string | null; birth_date: string | null; birth_place: string | null; nationality: string | null
  phone: string | null; email: string | null; photo: string | null
  residence_permit: string | null; residence_permit_until: string | null; work_permitted: boolean | null
  company: string | null; entry_date: string | null; exit_date: string | null; exit_reason: string | null
  job_title: string | null; position: Position | null; employment_type: EmpType | null
  gross_monthly: number | null; hourly_wage: number | null; weekly_hours: number | null; vacation_days: number | null
  work_days?: number | null; daily_hours?: number | null
  vacation_year?: number | null; vacation_left?: number | null; vacation_as_of?: string | null
  multiple_employment: boolean | null; tax_class: number | null; pension_no: string | null; health_insurance: string | null
  tax_id: string | null; iban: string | null; bic: string | null; bank_name: string | null; note: string | null
  personnel_no?: string | null
}
export interface EmpDoc { id: string; employee_id: string; kind: DocKind; title: string | null; path: string; valid_until: string | null; period: string | null; created_at: string }
export interface EmpContract {
  id?: string; employment_type: EmpType | null; start_date: string; end_date: string | null; probation_until: string | null
  weekly_hours: number | null; gross_monthly: number | null; hourly_wage: number | null; vacation_days: number | null
  terminated_on: string | null; note: string | null; files: string[]
}
export interface HrSettings { restaurant_id: string; company_name: string | null; minijob_limit: number }

// [Tiếng Việt, Deutsch]
export const POSITIONS: Record<Position, [string, string]> = {
  kitchen: ['Bếp', 'Küche'], service: ['Phục vụ', 'Service'], bar: ['Quầy', 'Theke'], dish: ['Rửa bát', 'Spülküche'], other: ['Khác', 'Sonstiges'],
}
export const EMP_TYPES: Record<EmpType, [string, string]> = {
  vollzeit: ['Toàn thời gian', 'Vollzeit'], teilzeit: ['Bán thời gian', 'Teilzeit'], minijob: ['Minijob', 'Minijob'],
  werkstudent: ['Sinh viên làm thêm', 'Werkstudent'], aushilfe: ['Thời vụ ngắn hạn', 'Kurzfristige Aushilfe'],
}
export const DOC_KINDS: Record<DocKind, [string, string]> = {
  passport: ['Hộ chiếu', 'Reisepass'], residence: ['Giấy cư trú', 'Aufenthaltstitel'], work_permit: ['Giấy phép lao động', 'Arbeitserlaubnis'],
  id_card: ['CMND / Personalausweis', 'Personalausweis'], contract: ['Hợp đồng lao động', 'Arbeitsvertrag'], payslip: ['Bảng lương', 'Lohnabrechnung'],
  sv: ['Thẻ bảo hiểm xã hội', 'SV-Ausweis'], tax: ['Giấy tờ thuế', 'Steuerunterlagen'], health: ['Bảo hiểm y tế / Gesundheitszeugnis', 'Krankenkasse / Gesundheitszeugnis'],
  certificate: ['Bằng cấp / chứng chỉ', 'Zeugnis / Bescheinigung'], other: ['Khác', 'Sonstiges'],
}

/** Các loại giấy phép cư trú ở Đức: [tên Đức (lưu và in ra), giải thích tiếng Việt, được làm việc?, không thời hạn?] */
export const PERMITS: [string, string, boolean | null, boolean][] = [
  ['Deutsche Staatsangehörigkeit', 'Quốc tịch Đức, không cần giấy phép', true, true],
  ['EU/EWR/Schweiz – Freizügigkeit', 'Công dân EU / EWR / Thuỵ Sĩ, được làm việc tự do', true, true],
  ['Niederlassungserlaubnis (§ 9 AufenthG)', 'Định cư vĩnh viễn, được làm mọi việc', true, true],
  ['Erlaubnis zum Daueraufenthalt-EU (§ 9a AufenthG)', 'Cư trú dài hạn EU, được làm mọi việc', true, true],
  ['Aufenthaltserlaubnis – Familiennachzug (§§ 27–36 AufenthG)', 'Cư trú theo diện đoàn tụ gia đình (vợ/chồng/con), thường được làm việc', true, false],
  ['Aufenthaltserlaubnis – Beschäftigung (§§ 18a, 18b, 19c AufenthG)', 'Cư trú để làm việc, chỉ làm đúng công việc ghi trên giấy', null, false],
  ['Aufenthaltserlaubnis – Ausbildung (§ 16a AufenthG)', 'Cư trú để học nghề (Ausbildung)', null, false],
  ['Aufenthaltserlaubnis – Studium (§ 16b AufenthG)', 'Du học: tối đa 140 ngày (hoặc 280 nửa ngày) / năm', true, false],
  ['Aufenthaltserlaubnis – Sprachkurs (§ 16f AufenthG)', 'Học tiếng: thường không được làm việc', false, false],
  ['Aufenthaltserlaubnis – humanitäre Gründe (§§ 22–25 AufenthG)', 'Cư trú vì lý do nhân đạo, xem ghi chú trên giấy', null, false],
  ['Blaue Karte EU (§ 18g AufenthG)', 'Thẻ xanh EU (lao động trình độ cao)', true, false],
  ['Chancenkarte (§ 20a AufenthG)', 'Thẻ cơ hội: tối đa 20 giờ / tuần', true, false],
  ['Fiktionsbescheinigung (§ 81 Abs. 4 AufenthG)', 'Giấy tạm khi đang gia hạn, giữ quyền của giấy cũ', null, false],
  ['Aufenthaltsgestattung (Asylverfahren)', 'Đang xin tị nạn: cần Sở Ngoại kiều cho phép làm việc', null, false],
  ['Duldung (§ 60a AufenthG)', 'Tạm hoãn trục xuất: cần Sở Ngoại kiều cho phép làm việc', null, false],
  ['Nationales Visum (D-Visum)', 'Visa quốc gia, xem ghi chú trên visa', null, false],
]
export const permitInfo = (v: string | null) => PERMITS.find((p) => p[0] === v)

/** Công việc (Tätigkeit): [tên Đức (lưu và in ra), tiếng Việt, khu vực dùng khi xếp lịch] */
/** Quốc tịch hay gặp (ghi tiếng Đức vì in lên giấy tờ); vẫn gõ được quốc tịch khác */
export const NATIONS = ['vietnamesisch', 'deutsch', 'deutsch, vietnamesisch']

export const JOBS: [string, string, Position][] = [
  ['Koch / Köchin', 'Đầu bếp', 'kitchen'],
  ['Beikoch / Beiköchin', 'Phụ bếp', 'kitchen'],
  ['Sushi-Koch / Sushi-Köchin', 'Đầu bếp sushi', 'kitchen'],
  ['Küchenhilfe', 'Phụ việc bếp', 'kitchen'],
  ['Servicekraft', 'Phục vụ', 'service'],
  ['Restaurantleiter/in', 'Quản lý nhà hàng', 'service'],
  ['Schichtleiter/in', 'Trưởng ca', 'service'],
  ['Thekenkraft / Barkeeper', 'Quầy / pha chế', 'bar'],
  ['Kassierer/in', 'Thu ngân', 'bar'],
  ['Spülkraft', 'Rửa bát', 'dish'],
  ['Reinigungskraft', 'Dọn vệ sinh', 'other'],
  ['Lieferfahrer/in', 'Giao hàng', 'other'],
  ['Bürokraft', 'Văn phòng', 'other'],
  ['Geschäftsführer/in', 'Giám đốc', 'other'],
]
export const jobInfo = (v: string | null) => JOBS.find((j) => j[0] === v)

/** Đoán loại giấy tờ theo tên file (không cần chọn tay) */
export function guessKind(name: string): DocKind {
  const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/lohn|gehalt|abrechnung|luong/.test(n)) return 'payslip'
  if (/arbeitsvertrag|vertrag|hop ?dong|contract/.test(n)) return 'contract'
  if (/aufenthalt|eat|cu tru|residence/.test(n)) return 'residence'
  if (/arbeitserlaubnis|work.?permit/.test(n)) return 'work_permit'
  if (/reisepass|passport|ho chieu|\bpass\b/.test(n)) return 'passport'
  if (/sv.?ausweis|sozialversicherung/.test(n)) return 'sv'
  if (/ausweis|id.?card|cmnd|cccd/.test(n)) return 'id_card'
  if (/gesundheit|krankenkasse|infektionsschutz/.test(n)) return 'health'
  if (/steuer|tax/.test(n)) return 'tax'
  return 'other'
}

export const emptyEmployee = (company: string | null): Employee => ({
  last_name: '', first_name: '', address: null, birth_date: null, birth_place: null, nationality: null, phone: null, email: null, photo: null,
  residence_permit: null, residence_permit_until: null, work_permitted: null, company, entry_date: todayIso(), exit_date: null, exit_reason: null,
  job_title: null, position: null, employment_type: null, gross_monthly: null, hourly_wage: null, weekly_hours: null, vacation_days: null, work_days: null, daily_hours: null,
  multiple_employment: null, tax_class: null, pension_no: null, health_insurance: null, tax_id: null, iban: null, bic: null, bank_name: null, note: null,
})

export const fullName = (e: Pick<Employee, 'first_name' | 'last_name'>) => [e.last_name, e.first_name].filter(Boolean).join(', ')
/** Đang làm = chưa có ngày nghỉ hoặc ngày nghỉ chưa tới */
export const isActive = (e: Pick<Employee, 'exit_date'>, today = todayIso()) => !e.exit_date || e.exit_date >= today

/** Số ngày tới khi giấy phép cư trú hết hạn (âm = đã hết hạn), null nếu không có */
export function permitDaysLeft(until: string | null, today = todayIso()): number | null {
  if (!until) return null
  return Math.round((Date.parse(until + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)
}
export const PERMIT_WARN_DAYS = 90

export async function uploadHrFile(rid: string, eid: string, f: Blob, name: string): Promise<string> {
  const ext = (name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${rid}/${eid}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(HR_BUCKET).upload(path, f, { contentType: f.type || undefined })
  if (error) throw error
  return path
}
export async function hrSignedUrl(path: string) {
  const { data } = await supabase.storage.from(HR_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl || ''
}
export async function openHrFile(path: string) {
  const w = window.open('', '_blank')
  const u = await hrSignedUrl(path)
  if (w) { if (u) w.location.href = u; else w.close() }
}

/** IBAN kiểm tra số dư mod 97 */
export function validIban(s: string | null): boolean {
  if (!s) return true
  const v = s.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false
  const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let m = 0
  for (const ch of r) m = (m * 10 + Number(ch)) % 97
  return m === 1
}
/** Steuer-ID: 11 chữ số */
export const validTaxId = (s: string | null) => !s || /^\d{11}$/.test(s.replace(/\s+/g, ''))
