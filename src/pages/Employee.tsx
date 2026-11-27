// Hồ sơ nhân viên: form Meldungsbogen PERSONAL (nhân viên mới); hồ sơ đã có xem theo tab, mỗi nhóm một nút Sửa
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { dmy, eur, parseNum, todayIso } from '../lib/format'
import { dropProps } from '../lib/drop'
import { download } from '../lib/pdf'
import {
  DOC_KINDS, EMP_TYPES, guessKind, JOBS, jobInfo, NATIONS, PERMITS, permitInfo, emptyEmployee, fullName, hrSignedUrl, HR_BUCKET, isActive, openHrFile, permitDaysLeft, PERMIT_WARN_DAYS, POSITIONS,
  uploadHrFile, validIban, validTaxId, type DocKind, type EmpContract, type EmpDoc, type EmpType, type Employee, type HrSettings,
} from '../lib/hr'
import { personalbogenPdf } from '../lib/hrPdf'
import { arbeitgeberbestaetigungPdf, bestaetigungMissing, type Anrede } from '../lib/hrLetter'
import { arbeitsvertrag, contractMissing, guessDays, legalMinVacation } from '../lib/hrContract'
import { readPayslips } from '../lib/payslipImport'
import { baseSalary, empTypeOf, hourlyOf, splitName } from '../lib/payslip'
import { DateField } from '../components/PeriodBar'
import { ComboInput, Money, Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'
import PdfSheet from '../components/PdfSheet'
import WorkTime from '../components/WorkTime'
import { MOBILE_Q, useMedia } from '../lib/useMedia'

type K = keyof Employee
type GroupId = 'personal' | 'work' | 'residence' | 'pay' | 'tax' | 'bank' | 'leave' | 'note'
type Tab = 'overview' | 'personal' | 'work' | 'residence' | 'pay' | 'leave' | 'docs'
type Absence = { id: string; kind: string; from_date: string; to_date: string; note: string | null }

/** Biểu tượng nét mảnh cho các nhóm thông tin */
const GI = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  work: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M16 15h2" /></>,
  bank: <><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  note: <><path d="M5 4h14v16H5z" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  eye: <><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></>,
  pen: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  more: <><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></>,
  chev: <path d="M6 9l6 6 6-6" />,
}
type GKey = keyof typeof GI
function GIcon({ k }: { k: GKey }) {
  return <svg className="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{GI[k]}</svg>
}
/** Một nhóm thông tin (card) có tiêu đề, nút hành động góc phải và chân (Lưu / Hủy) */
function Group({ icon, title, action, foot, children, open, onToggle, flat }: {
  icon: ReactNode; title: string; action?: ReactNode; foot?: ReactNode; children: ReactNode
  /** Accordion (điện thoại): có onToggle thì bấm tiêu đề để mở / thu gọn */
  open?: boolean; onToggle?: () => void
  /** Nhóm con nằm trong một accordion: không có khung riêng */
  flat?: boolean
}) {
  const acc = !!onToggle
  const shut = acc && !open
  return (
    <section className={`pcard${acc ? ' acc' : ''}${shut ? ' shut' : ''}${flat ? ' flat' : ''}`}>
      <header className="pcard-h">
        {acc
          ? <button type="button" className="acc-t" aria-expanded={!!open} onClick={onToggle}><span className="pcard-ic">{icon}</span><h3>{title}</h3></button>
          : <><span className="pcard-ic">{icon}</span><h3>{title}</h3></>}
        {!shut && action}
        {acc && <button type="button" className="acc-chev" aria-label={open ? 'thu gọn' : 'mở'} aria-expanded={!!open} onClick={onToggle}><GIcon k="chev" /></button>}
      </header>
      {!shut && children}
      {!shut && foot}
    </section>
  )
}

/** Ô nhập có nhãn (khai báo ngoài component để ô không bị mất focus khi gõ) */
function F({ l, children }: { l: string; children: ReactNode }) { return <div className="f"><span>{l}</span>{children}</div> }

type Pending = { file: File | Blob; name: string; kind: DocKind; period?: string }
const emptyContract = (e: Employee): EmpContract => ({
  employment_type: e.employment_type, start_date: e.entry_date || todayIso(), end_date: null, probation_until: null,
  weekly_hours: e.weekly_hours, gross_monthly: e.gross_monthly, hourly_wage: e.hourly_wage, vacation_days: e.vacation_days, terminated_on: null, note: null, files: [],
})

export default function EmployeePage() {
  const { rid, eid } = useParams()
  const isNew = eid === 'new'
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const de = useLang().lang === 'de'
  const li = de ? 1 : 0
  /** Nhãn: tiếng Việt kèm thuật ngữ Đức; giao diện Đức chỉ hiện tiếng Đức */
  const L = (vi: string, g: string) => (de ? g : `${vi} · ${g}`)
  const T = (vi: string, g: string) => (de ? g : vi)

  const [e, setE] = useState<Employee | null>(null)
  const [hs, setHs] = useState<HrSettings | null>(null)
  const [docs, setDocs] = useState<EmpDoc[]>([])
  const [contracts, setContracts] = useState<(EmpContract & { id: string })[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [photoUrl, setPhotoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [ct, setCt] = useState<EmpContract | null>(null)
  const [ctFiles, setCtFiles] = useState<File[]>([])
  const [ed, setEd] = useState<{ g: GroupId; draft: Partial<Employee> } | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const mobile = useMedia(MOBILE_Q)
  // Điện thoại: các nhóm dạng accordion, mặc định đóng hết
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState(false)
  const [abs, setAbs] = useState<Absence[]>([])
  const [cv, setCv] = useState<{ job: string; days: number } | null>(null)
  const [ab, setAb] = useState<{ anrede: Anrede; job: string; date: string } | null>(null)
  // Bản xem trước: chưa lưu gì cho tới khi bấm Lưu
  const [pv, setPv] = useState<{ title: string; pdf: Blob; docx?: Blob; base: string; kind: 'contract' | 'certificate'; miss?: string; saved?: boolean } | null>(null)
  /** Chọn nhiều bảng lương để gửi WhatsApp: path → File (tải sẵn khi chọn để bấm Gửi mở bảng chia sẻ ngay) */
  /** Tiền lương mặc định làm mờ, bấm con mắt (hoặc bấm vào số) để xem */
  const [showPay, setShowPay] = useState(false)
  const [pick, setPick] = useState<Record<string, File | null> | null>(null)
  const [fv, setFv] = useState<{ title: string; blob: Blob; name: string; slip?: boolean } | null>(null)
  const [exitF, setExitF] = useState<{ date: string | null; reason: string } | null>(null)

  async function loadChildren() {
    if (isNew) return
    const [d, c, a] = await Promise.all([
      supabase.from('nh_employee_docs').select('*').eq('employee_id', eid!).order('created_at', { ascending: false }),
      supabase.from('nh_employment_contracts').select('*').eq('employee_id', eid!).order('start_date', { ascending: false }),
      supabase.from('nh_absences').select('id,kind,from_date,to_date,note').eq('employee_id', eid!).order('from_date', { ascending: false }),
    ])
    setDocs((d.data || []) as EmpDoc[]); setContracts((c.data || []) as never); setAbs((a.data || []) as Absence[])
  }
  useEffect(() => {
    if (!rid) return
    ;(async () => {
      const { data: s } = await supabase.from('nh_hr_settings').select('*').eq('restaurant_id', rid).maybeSingle()
      setHs(s as HrSettings | null)
      if (isNew) { setE(emptyEmployee((s as HrSettings | null)?.company_name || null)); setDocs([]); setContracts([]); setPending([]); return }
      const { data, error } = await supabase.from('nh_employees').select('*').eq('id', eid!).maybeSingle()
      if (error || !data) { toast(error ? errMsg(error) : T('Không tìm thấy nhân viên', 'Mitarbeiter nicht gefunden')); nav(`/r/${rid}/hr`, { replace: true }); return }
      setE(data as Employee)
      loadChildren()
    })()
  }, [rid, eid]) // eslint-disable-line
  // Trang hồ sơ rộng hơn để lưới 3 cột trên máy tính
  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('xwide'); return () => el?.classList.remove('xwide') }, [])
  useEffect(() => { setEd(null); setTab('overview'); setOpenSec({}) }, [eid])
  useEffect(() => { if (e?.photo) hrSignedUrl(e.photo).then(setPhotoUrl); else setPhotoUrl('') }, [e?.photo])

  if (!r || !canManage(role)) return null
  if (!e) return <><Top title={T('Nhân viên', 'Mitarbeiter')} back={`/r/${rid}/hr`} /><Spinner /></>

  const set = (p: Partial<Employee>) => setE({ ...e, ...p })
  const txt = (k: keyof Employee) => ({ value: (e[k] as string | null) || '', onChange: (ev: { target: { value: string } }) => set({ [k]: ev.target.value || null } as Partial<Employee>) })
  const minijobLimit = Number(hs?.minijob_limit ?? 603)
  const warns: string[] = []
  if (!validIban(e.iban)) warns.push(T('IBAN có vẻ sai (kiểm tra lại các chữ số)', 'IBAN scheint ungültig zu sein'))
  if (!validTaxId(e.tax_id)) warns.push(T('Steuer-ID phải có 11 chữ số', 'Steuer-ID muss 11 Ziffern haben'))
  if (e.employment_type === 'minijob' && (e.gross_monthly || 0) > minijobLimit) warns.push(T(`Lương Minijob vượt giới hạn ${eur(minijobLimit)}/tháng`, `Minijob über der Grenze von ${eur(minijobLimit)}/Monat`))
  if (e.work_permitted === false) warns.push(T('Chưa có giấy phép lao động: không được cho đi làm', 'Keine Erwerbstätigkeit gestattet: Beschäftigung nicht zulässig'))
  const pd = permitDaysLeft(e.residence_permit_until)
  if (pd != null && pd <= PERMIT_WARN_DAYS) warns.push(pd < 0 ? T('Giấy phép cư trú đã hết hạn', 'Aufenthaltstitel ist abgelaufen') : T(`Giấy phép cư trú hết hạn sau ${pd} ngày`, `Aufenthaltstitel läuft in ${pd} Tagen ab`))

  async function save() {
    if (!e!.last_name.trim()) { toast(T('Nhập họ (Name)', 'Bitte Name eingeben')); return }
    setBusy(true)
    try {
      const row = { ...e!, restaurant_id: rid, last_name: e!.last_name.trim(), first_name: e!.first_name.trim(), iban: e!.iban ? e!.iban.replace(/\s+/g, '').toUpperCase() : null }
      delete (row as { id?: string }).id
      if (isNew) {
        const { data, error } = await supabase.from('nh_employees').insert(row).select('id').single()
        if (error) throw error
        const id = data.id as string
        for (const p of pending) {
          const path = await uploadHrFile(rid!, id, p.file, p.name)
          const { error: de2 } = await supabase.from('nh_employee_docs').insert({ restaurant_id: rid, employee_id: id, kind: p.kind, title: p.name, period: p.period || null, path })
          if (de2) throw de2
        }
        toast(T('Đã lưu nhân viên mới', 'Mitarbeiter angelegt'))
        nav(`/r/${rid}/hr/${id}`, { replace: true })
      } else {
        const { error } = await supabase.from('nh_employees').update(row).eq('id', eid!)
        if (error) throw error
        toast(T('Đã lưu', 'Gespeichert'))
      }
    } catch (x) { toast(/nh_employees_pnr|duplicate key/.test(errMsg(x)) ? T('Mã nhân viên (Personal-Nr.) này đã có ở hồ sơ khác', 'Personal-Nr. ist bereits vergeben') : errMsg(x)) }
    setBusy(false)
  }

  /** Đọc bảng lương cũ chỉ để tự điền vào form (không lưu file bảng lương) */
  async function fromPayslip(fl: FileList | File[]) {
    const files = Array.from(fl)
    if (!files.length || !e) return
    setBusy(true)
    try {
      const slips = await readPayslips(files)
      if (!slips.length) { toast(T('Không đọc được bảng lương (cần PDF bảng lương DATEV)', 'Keine DATEV-Lohnabrechnung erkannt')); setBusy(false); return }
      const p = slips[slips.length - 1].p
      const withBase = [...slips].reverse().find((s) => (baseSalary(s.p) || 0) > 0)?.p
      const typ = empTypeOf(withBase || p)
      const hourly = [...slips].reverse().map((s) => hourlyOf(s.p)).find((h) => h != null) ?? null
      const nm = splitName(p.name)
      const patch: Partial<Employee> = {
        ...(e.last_name.trim() ? {} : nm),
        personnel_no: p.pnr || e.personnel_no, address: p.address ?? e.address, birth_date: p.birth ?? e.birth_date, tax_class: p.taxClass ?? e.tax_class,
        pension_no: p.svNo ?? e.pension_no, health_insurance: p.health ?? e.health_insurance, tax_id: p.taxId ?? e.tax_id,
        bank_name: p.bank ?? e.bank_name, company: p.employer ?? e.company, entry_date: p.entry ?? e.entry_date,
        employment_type: e.employment_type ?? typ.employment_type, job_title: e.job_title ?? typ.job_title,
        gross_monthly: e.gross_monthly ?? (withBase ? baseSalary(withBase) : null), hourly_wage: e.hourly_wage ?? hourly,
        ...(p.exit ? { exit_date: p.exit } : {}),
        ...(!e.iban && p.ibanMasked && !(e.note || '').includes(p.ibanMasked) ? { note: [e.note, `IBAN lt. Lohnabrechnung: ${p.ibanMasked}`].filter(Boolean).join('\n') } : {}),
      }
      setE({ ...e, ...patch })
      toast(T(`Đã điền thông tin từ bảng lương ${p.period.slice(5)}/${p.period.slice(0, 4)}. Kiểm tra rồi bấm Lưu.`, `Daten aus Lohnabrechnung ${p.period.slice(5)}/${p.period.slice(0, 4)} übernommen. Bitte prüfen und speichern.`))
    } catch (x) { toast(errMsg(x)) }
    setBusy(false)
  }

  async function addFiles(fl: FileList | File[]) {
    const files = Array.from(fl)
    if (!files.length) return
    if (isNew) { setPending([...pending, ...files.map((file) => ({ file, name: file.name, kind: guessKind(file.name) }))]); return }
    setBusy(true)
    try {
      for (const f of files) {
        const path = await uploadHrFile(rid!, eid!, f, f.name)
        const { error } = await supabase.from('nh_employee_docs').insert({ restaurant_id: rid, employee_id: eid, kind: guessKind(f.name), title: f.name, path })
        if (error) throw error
      }
      toast(T('Đã tải lên', 'Hochgeladen')); loadChildren()
    } catch (x) { toast(errMsg(x)) }
    setBusy(false)
  }
  async function delDoc(d: EmpDoc) {
    if (!confirm(T('Xoá giấy tờ này?', 'Dokument löschen?'))) return
    const { error } = await supabase.from('nh_employee_docs').delete().eq('id', d.id)
    if (error) { toast(errMsg(error)); return }
    await supabase.storage.from(HR_BUCKET).remove([d.path])
    loadChildren()
  }
  async function setDocValid(d: EmpDoc, v: string | null) {
    const { error } = await supabase.from('nh_employee_docs').update({ valid_until: v }).eq('id', d.id)
    if (error) toast(errMsg(error)); else loadChildren()
  }
  const dropPhoto = dropProps((fl) => {
    const f = Array.from(fl).find((x) => x.type.startsWith('image/'))
    if (f) uploadPhoto(f); else toast(T('Chỉ nhận file ảnh', 'Nur Bilddateien'))
  })
  async function uploadPhoto(f: File | undefined) {
    if (!f || isNew) return
    try {
      const path = await uploadHrFile(rid!, eid!, f, f.name)
      const old = e!.photo
      const { error } = await supabase.from('nh_employees').update({ photo: path }).eq('id', eid!)
      if (error) throw error
      if (old) await supabase.storage.from(HR_BUCKET).remove([old])
      set({ photo: path })
    } catch (x) { toast(errMsg(x)) }
  }

  async function saveContract() {
    if (!ct || !ct.start_date) { toast(T('Chọn ngày bắt đầu', 'Beginn wählen')); return }
    setBusy(true)
    try {
      const add: string[] = []
      for (const f of ctFiles) add.push(await uploadHrFile(rid!, eid!, f, f.name))
      const row = { ...ct, restaurant_id: rid, employee_id: eid, files: [...ct.files, ...add] }
      delete (row as { id?: string }).id
      const { error } = ct.id ? await supabase.from('nh_employment_contracts').update(row).eq('id', ct.id) : await supabase.from('nh_employment_contracts').insert(row)
      if (error) throw error
      // Hợp đồng mới nhất: cập nhật luôn số liệu trong hồ sơ
      if (!contracts.some((c) => c.id !== ct.id && c.start_date > ct.start_date)) {
        const p = { employment_type: ct.employment_type, weekly_hours: ct.weekly_hours, gross_monthly: ct.gross_monthly, hourly_wage: ct.hourly_wage, vacation_days: ct.vacation_days }
        await supabase.from('nh_employees').update(p).eq('id', eid!)
        set(p)
      }
      setCt(null); setCtFiles([]); loadChildren(); toast(T('Đã lưu', 'Gespeichert'))
    } catch (x) { toast(errMsg(x)) }
    setBusy(false)
  }
  async function delContract() {
    if (!ct?.id || !confirm(T('Xoá hợp đồng này?', 'Vertrag löschen?'))) return
    const { error } = await supabase.from('nh_employment_contracts').delete().eq('id', ct.id)
    if (error) { toast(errMsg(error)); return }
    if (ct.files.length) await supabase.storage.from(HR_BUCKET).remove(ct.files)
    setCt(null); loadChildren()
  }

  async function saveExit(date: string | null, reason: string | null) {
    const { error } = await supabase.from('nh_employees').update({ exit_date: date, exit_reason: reason }).eq('id', eid!)
    if (error) { toast(errMsg(error)); return }
    // Ghi ngày huỷ vào hợp đồng đang chạy
    const cur = contracts.find((c) => !c.terminated_on)
    if (date && cur) await supabase.from('nh_employment_contracts').update({ terminated_on: date }).eq('id', cur.id)
    set({ exit_date: date, exit_reason: reason }); setExitF(null); loadChildren(); toast(T('Đã lưu', 'Gespeichert'))
  }
  async function delEmployee() {
    if (!confirm(T(`Xoá hẳn hồ sơ ${fullName(e!)} cùng toàn bộ giấy tờ, hợp đồng, ca làm? Nếu nhân viên chỉ nghỉ việc, hãy dùng "Nghỉ việc" để giữ hồ sơ.`, `Akte ${fullName(e!)} mit allen Dokumenten, Verträgen und Schichten endgültig löschen? Bei Austritt besser „Austritt" verwenden.`))) return
    const paths = [...docs.map((d) => d.path), ...contracts.flatMap((c) => c.files), ...(e!.photo ? [e!.photo] : [])]
    const { error } = await supabase.from('nh_employees').delete().eq('id', eid!)
    if (error) { toast(errMsg(error)); return }
    if (paths.length) await supabase.storage.from(HR_BUCKET).remove(paths)
    nav(`/r/${rid}/hr`, { replace: true })
  }

  const yn = (k: 'work_permitted' | 'multiple_employment') => (
    <div className="seg">
      <button className={e[k] === true ? 'sel' : ''} onClick={() => set({ [k]: e[k] === true ? null : true })}>{T('Có', 'Ja')}</button>
      <button className={e[k] === false ? 'sel' : ''} onClick={() => set({ [k]: e[k] === false ? null : false })}>{T('Không', 'Nein')}</button>
    </div>
  )
  const numIn = (k: 'weekly_hours' | 'vacation_days', ph: string) => (
    <input inputMode="decimal" placeholder={ph} value={e[k] == null ? '' : String(e[k]).replace('.', ',')} onChange={(ev) => set({ [k]: ev.target.value.trim() ? parseNum(ev.target.value) : null })} />
  )
  const active = isActive(e)

  // ===== Hồ sơ đã có: xem theo nhóm; mỗi nhóm một nút Sửa (Lưu / Hủy). Mọi mục đều sửa được.
  const show = (k: K): string => {
    const v = e[k]
    if (v == null || v === '') return ''
    if (k === 'birth_date' || k === 'entry_date' || k === 'residence_permit_until') return dmy(v as string)
    if (k === 'gross_monthly' || k === 'hourly_wage') return eur(Number(v))
    if (k === 'employment_type') return EMP_TYPES[v as EmpType][li]
    if (k === 'work_permitted' || k === 'multiple_employment') return v ? T('Có', 'Ja') : T('Không', 'Nein')
    if (k === 'job_title') return de || !jobInfo(String(v)) ? String(v) : `${jobInfo(String(v))![1]} · ${v}`
    if (k === 'weekly_hours') return `${String(v).replace('.', ',')} ${T('giờ / tuần', 'Std. / Woche')}`
    if (k === 'work_days') return `${String(v).replace('.', ',')} ${T('ngày / tuần', 'Tage / Woche')}`
    if (k === 'daily_hours') return `${String(v).replace('.', ',')} ${T('giờ / ngày', 'Std. / Tag')}`
    if (k === 'vacation_year') return `${String(v).replace('.', ',')} ${T('ngày', 'Tage')}`
    if (k === 'vacation_left') return `${String(v).replace('.', ',')} ${T('ngày', 'Tage')}${e.vacation_as_of ? ` · ${T('tính đến', 'Stand')} ${e.vacation_as_of.slice(5)}/${e.vacation_as_of.slice(0, 4)}` : ''}`
    if (k === 'vacation_days') return `${String(v).replace('.', ',')} ${T('ngày / năm', 'Tage / Jahr')}`
    return String(v)
  }
  const labelOf: Partial<Record<K, string>> = {
    last_name: L('Họ', 'Name'), first_name: L('Tên', 'Vorname'), birth_date: L('Ngày sinh', 'Geburtsdatum'), birth_place: L('Nơi sinh', 'Geburtsort'),
    nationality: L('Quốc tịch', 'Nationalität'), address: L('Địa chỉ', 'Anschrift'), phone: L('Điện thoại', 'Telefon'), email: 'E-Mail',
    residence_permit: L('Giấy phép cư trú', 'Aufenthaltstitel'), residence_permit_until: L('Hết hạn ngày', 'gültig bis'), work_permitted: L('Được phép làm việc', 'Erwerbstätigkeit gestattet'),
    company: L('Công ty', 'Firma'), personnel_no: L('Mã nhân viên', 'Personal-Nr.'), entry_date: L('Ngày vào làm', 'Eintrittsdatum'), job_title: L('Vị trí', 'Tätigkeit'),
    employment_type: L('Hợp đồng', 'Beschäftigungsart'), weekly_hours: L('Giờ làm', 'Arbeitszeit'), work_days: L('Ngày làm', 'Arbeitstage'), daily_hours: L('Giờ mỗi ngày', 'tägl. Arbeitszeit'), gross_monthly: L('Lương tháng', 'Monatslohn'),
    hourly_wage: L('Lương giờ', 'Stundenlohn'), vacation_days: L('Ngày phép', 'Urlaubsanspruch'), vacation_year: L('Phép năm nay', 'Jahresurlaub'), vacation_left: L('Phép còn lại', 'Resturlaub'), multiple_employment: L('Làm thêm nơi khác', 'Mehrfachbeschäftigung'),
    tax_id: L('Mã số thuế', 'Steuer-ID'), pension_no: L('Số BH hưu trí', 'RV-Nummer'), tax_class: L('Bậc thuế', 'Steuerklasse'),
    health_insurance: L('Bảo hiểm y tế', 'Krankenkasse'), iban: 'IBAN', bic: 'BIC', bank_name: L('Ngân hàng', 'Bank'), note: L('Ghi chú', 'Notiz'),
  }
  type FD = { k: K; fixed?: boolean; full?: boolean; mfull?: boolean }
  /** Điện thoại: thứ tự theo cặp (2 cột), thông tin dài chiếm cả hàng */
  const MOBILE_ORDER: Partial<Record<GroupId, FD[]>> = {
    work: [{ k: 'personnel_no', fixed: true }, { k: 'entry_date', fixed: true }, { k: 'job_title' }, { k: 'employment_type' }, { k: 'company', fixed: true, full: true }, { k: 'multiple_employment', full: true }],
  }
  /** Nhãn song ngữ: tiếng Việt, tiếng Đức nhỏ hơn (máy tính: cùng dòng, điện thoại: dòng dưới) */
  const lab = (s: string) => { const i = s.indexOf(' · '); return i < 0 ? <span>{s}</span> : <><span>{s.slice(0, i)}</span><small className="kv-de">{s.slice(i + 3)}</small></> }
  const GROUPS: Record<GroupId, { title: string; icon: GKey; fields: FD[] }> = {
    personal: { title: T('Thông tin cá nhân', 'Persönliche Angaben'), icon: 'user', fields: [
      { k: 'last_name', fixed: true }, { k: 'first_name', fixed: true }, { k: 'birth_date', fixed: true }, { k: 'birth_place', fixed: true },
      { k: 'nationality', fixed: true }, { k: 'phone' }, { k: 'email', mfull: true }, { k: 'address', full: true }] },
    work: { title: T('Thông tin công việc', 'Beschäftigung'), icon: 'work', fields: [
      { k: 'company', fixed: true }, { k: 'personnel_no', fixed: true }, { k: 'entry_date', fixed: true },
      { k: 'job_title' }, { k: 'employment_type' }, { k: 'multiple_employment' }] },
    residence: { title: T('Cư trú và lao động', 'Aufenthalt und Erwerbstätigkeit'), icon: 'shield', fields: [
      { k: 'residence_permit' }, { k: 'residence_permit_until' }, { k: 'work_permitted' }] },
    pay: { title: T('Lương và giờ làm', 'Vergütung und Arbeitszeit'), icon: 'wallet', fields: [
      { k: 'gross_monthly' }, { k: 'hourly_wage' }, { k: 'weekly_hours' }, { k: 'work_days' }, { k: 'daily_hours' }] },
    tax: { title: T('Thuế và bảo hiểm', 'Steuer und Sozialversicherung'), icon: 'shield', fields: [
      { k: 'tax_id', fixed: true }, { k: 'pension_no', fixed: true }, { k: 'tax_class' }, { k: 'health_insurance' }] },
    bank: { title: T('Tài khoản ngân hàng', 'Bankverbindung'), icon: 'bank', fields: [{ k: 'iban' }, { k: 'bic' }, { k: 'bank_name' }] },
    leave: { title: T('Phép năm', 'Urlaubsanspruch'), icon: 'calendar', fields: [{ k: 'vacation_days' }, { k: 'vacation_year' }, { k: 'vacation_left' }] },
    note: { title: T('Ghi chú', 'Notiz'), icon: 'note', fields: [{ k: 'note', full: true }] },
  }
  // Người dùng yêu cầu (26/11): bấm Sửa thì sửa được toàn bộ thông tin, không còn mục khoá
  const editable = (_f: FD) => true
  const PAY_K: K[] = ['gross_monthly', 'hourly_wage']
  const sub = (k: K) => (!de && k === 'residence_permit' && permitInfo(e.residence_permit) ? permitInfo(e.residence_permit)![1] : null)
  const group = (id: GroupId, o: { flat?: boolean; acc?: boolean; extra?: ReactNode } = {}) => {
    const G = GROUPS[id]
    const editing = ed?.g === id
    const fields = ((mobile && MOBILE_ORDER[id]) || G.fields).filter((f) => !(f.k === 'residence_permit_until' && permitInfo((editing ? ed!.draft.residence_permit : e.residence_permit) ?? null)?.[3]))
    return (
      <Group key={id} icon={<GIcon k={G.icon} />} title={G.title} flat={o.flat}
        {...(o.acc ? { open: !!openSec[id] || editing, onToggle: () => setOpenSec({ ...openSec, [id]: !openSec[id] }) } : {})}
        action={!editing && G.fields.some(editable) && (
          <button className="pc-edit" onClick={() => setEd({ g: id, draft: Object.fromEntries(G.fields.filter(editable).map((f) => [f.k, e[f.k]])) as Partial<Employee> })}>
            <GIcon k="pen" />{T('Sửa', 'Bearbeiten')}
          </button>)}
        foot={editing && (
          <div className="pc-foot">
            <button onClick={() => setEd(null)}>{T('Hủy', 'Abbrechen')}</button>
            <button className="primary" disabled={busy} onClick={saveEd}>{T('Lưu', 'Speichern')}</button>
          </div>)}>
        <div className={`kv${editing ? ' editing' : ''}`}>
          {fields.map((f) => {
            const v = show(f.k)
            return (
              <div key={f.k} className={`kv-i${f.full || (mobile && f.mfull) ? ' full' : ''}`}>
                <div className="kv-l">{lab(labelOf[f.k] || String(f.k))}{!editing && v && PAY_K.includes(f.k) && eyeBtn}{editing && !editable(f) && <span className="kv-lock" title={T('Cố định', 'Fest')}><GIcon k="lock" /></span>}</div>
                {editing && editable(f) ? edInput(f.k) : <>
                  {v && PAY_K.includes(f.k) ? <div className={`kv-v${showPay ? '' : ' masked'}`} onClick={() => setShowPay(!showPay)}>{v}</div>
                    : <div className={`kv-v${v ? '' : ' empty'}`}>{v || (mobile ? '—' : T('Chưa cập nhật', 'Nicht erfasst'))}</div>}
                  {v && sub(f.k) && <div className="kv-sub">{sub(f.k)}</div>}
                </>}
              </div>
            )
          })}
        </div>
        {o.extra}
      </Group>
    )
  }
  async function saveEd() {
    if (!ed) return
    const patch = { ...ed.draft }
    if ('last_name' in patch && !(patch.last_name || '').trim()) delete patch.last_name
    if ('first_name' in patch && patch.first_name == null) delete patch.first_name
    if ('iban' in patch && patch.iban) patch.iban = patch.iban.replace(/\s+/g, '').toUpperCase()
    if ('iban' in patch && !validIban(patch.iban ?? null)) { toast(T('IBAN có vẻ sai', 'IBAN ungültig')); return }
    if ('tax_id' in patch && !validTaxId(patch.tax_id ?? null)) { toast(T('Steuer-ID phải có 11 chữ số', 'Steuer-ID muss 11 Ziffern haben')); return }
    if ('job_title' in patch) { const j = jobInfo(patch.job_title ?? null); if (j) patch.position = j[2] }
    setBusy(true)
    const { error } = await supabase.from('nh_employees').update(patch).eq('id', eid!)
    setBusy(false)
    if (error) { toast(/nh_employees_pnr|duplicate key/.test(errMsg(error)) ? T('Mã nhân viên này đã có ở hồ sơ khác', 'Personal-Nr. bereits vergeben') : errMsg(error)); return }
    set(patch); setEd(null); toast(T('Đã lưu', 'Gespeichert'))
  }
  const edInput = (k: K) => {
    const d = ed!.draft, v = d[k]
    const up = (x: Partial<Employee>) => setEd({ ...ed!, draft: { ...d, ...x } })
    const sv = (x: string) => up({ [k]: x || null } as Partial<Employee>)
    switch (k) {
      case 'birth_date': return <input type="date" value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)} />
      case 'entry_date': case 'residence_permit_until': return <DateField allowEmpty value={(v as string) || null} onChange={(x) => up({ [k]: x } as Partial<Employee>)} />
      case 'work_permitted': case 'multiple_employment': return (
        <div className="seg">
          <button className={v === true ? 'sel' : ''} onClick={() => up({ [k]: v === true ? null : true } as Partial<Employee>)}>{T('Có', 'Ja')}</button>
          <button className={v === false ? 'sel' : ''} onClick={() => up({ [k]: v === false ? null : false } as Partial<Employee>)}>{T('Không', 'Nein')}</button>
        </div>)
      case 'residence_permit': return <ComboInput value={(v as string) || ''} options={PERMITS.map((p) => p[0])} onChange={(x) => { const pi = permitInfo(x); up({ residence_permit: x || null, ...(pi && pi[2] != null ? { work_permitted: pi[2] } : {}), ...(pi?.[3] ? { residence_permit_until: null } : {}) }) }} />
      case 'job_title': return <ComboInput value={(v as string) || ''} options={JOBS.map((j) => j[0])} onChange={sv} />
      case 'nationality': return <ComboInput value={(v as string) || ''} options={NATIONS} onChange={sv} placeholder={T('Chọn hoặc gõ', 'Auswählen oder eingeben')} />
      case 'employment_type': return (
        <select value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)}>
          <option value="">—</option>
          {(Object.keys(EMP_TYPES) as EmpType[]).map((x) => <option key={x} value={x}>{EMP_TYPES[x][li]}</option>)}
        </select>)
      case 'tax_class': return (
        <select value={(v as number) ?? ''} onChange={(ev) => up({ tax_class: ev.target.value ? Number(ev.target.value) : null })}>
          <option value="">—</option>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>)
      case 'gross_monthly': case 'hourly_wage': return <Money value={(v as number) ?? null} onChange={(x) => up({ [k]: x || null } as Partial<Employee>)} />
      case 'weekly_hours': case 'vacation_days': case 'work_days': case 'daily_hours': case 'vacation_year': case 'vacation_left': return <input inputMode="decimal" value={v == null ? '' : String(v).replace('.', ',')} onChange={(ev) => up({ [k]: ev.target.value.trim() ? parseNum(ev.target.value) : null } as Partial<Employee>)} />
      case 'address': case 'note': return <textarea rows={2} value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)} />
      case 'phone': return <input type="tel" value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)} />
      case 'email': return <input type="email" value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)} />
      default: return <input value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)} />
    }
  }

  // ===== Giấy tờ
  const slips = docs.filter((d) => d.kind === 'payslip').sort((a, b) => (b.period || b.created_at).localeCompare(a.period || a.created_at))
  const personalDocs = docs.filter((d) => d.kind !== 'payslip')
  const docTitle = (d: EmpDoc) => d.kind === 'payslip' && d.period ? `${T('Bảng lương', 'Lohnabrechnung')} ${d.period.slice(5, 7)}/${d.period.slice(0, 4)}` : d.kind === 'other' ? (d.title || '') : DOC_KINDS[d.kind][li]
  const viewFile = async (path: string, title: string, slip = false) => {
    setBusy(true)
    try {
      const { blob, name } = await loadFile(path, title, slip)
      setFv({ title, slip, blob, name })
    } catch { openHrFile(path) } finally { setBusy(false) }
  }
  const loadFile = async (path: string, title: string, slip: boolean) => {
      const { data, error } = await supabase.storage.from(HR_BUCKET).download(path)
      if (error || !data) throw error || new Error('download')
      const ext = (path.split('.').pop() || 'pdf').toLowerCase()
      const blob = data.type && data.type !== 'application/octet-stream' ? data : new Blob([data], { type: ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}` })
      // Bảng lương: tên file gọn để gửi cho nhân viên, vd. Lohnabrechnung_11-2026_Lina_Nguyen.pdf
      const asc = (x: string | null) => (x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      const per = title.match(/(\d{2})\/(\d{4})/)
      const name = slip ? [`Lohnabrechnung${per ? `_${per[1]}-${per[2]}` : ''}`, asc(e!.first_name), asc(e!.last_name)].filter(Boolean).join('_') + `.${ext}`
        : `${title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_')}.${ext}`
      return { blob, name }
  }
  /** Gửi bảng lương qua WhatsApp: gửi chính file PDF qua bảng chia sẻ của điện thoại (chọn WhatsApp, chọn người nhận).
   *  Trình duyệt không thể đưa file thẳng vào một chat WhatsApp; máy tính không chia sẻ được file nên tải file về
   *  và mở chat WhatsApp với số trong hồ sơ để đính kèm. */
  const sendWhatsApp = (f: { title: string; blob: Blob; name: string }) =>
    shareSlips([new File([f.blob], f.name, { type: f.blob.type || 'application/pdf' })], [f.title])
  /** Gửi một hay nhiều bảng lương cùng lúc (một lần chia sẻ, nhiều file) */
  const shareSlips = async (files: File[], titles: string[]) => {
    const per = titles.map((t) => t.match(/(\d{2}\/\d{4})/)?.[1]).filter(Boolean)
    const many = files.length > 1
    const text = `Hallo ${(e.first_name || '').trim()}, anbei ${many ? 'deine Lohnabrechnungen' : 'deine Lohnabrechnung'}${per.length ? ` ${per.join(', ')}` : ''}. Viele Grüße, ${hs?.company_name || e.company || r.name}`
    try {
      if (navigator.canShare?.({ files })) { await navigator.share({ files, text }); return true }
    } catch (x) { if ((x as Error)?.name === 'AbortError') return false }
    let ph = (e.phone || '').replace(/[^\d+]/g, '')
    if (ph.startsWith('+')) ph = ph.slice(1); else if (ph.startsWith('00')) ph = ph.slice(2); else if (ph.startsWith('0')) ph = `49${ph.slice(1)}`
    files.forEach((f) => download(f, f.name))
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    toast(T('Đã tải file. Đính kèm file vào WhatsApp rồi gửi.', 'Datei geladen. In WhatsApp anhängen und senden.'))
    return true
  }
  const togglePick = (d: EmpDoc) => {
    if (!pick) return
    if (d.path in pick) { const n = { ...pick }; delete n[d.path]; setPick(n); return }
    setPick({ ...pick, [d.path]: null }); fetchPick(d)
  }
  const pickAll = () => {
    if (!pick) return
    const miss = slips.filter((d) => !(d.path in pick))
    setPick({ ...pick, ...Object.fromEntries(miss.map((d) => [d.path, null])) }); miss.forEach(fetchPick)
  }
  const fetchPick = (d: EmpDoc) => {
    loadFile(d.path, docTitle(d), true)
      .then(({ blob, name }) => setPick((p) => (p && d.path in p ? { ...p, [d.path]: new File([blob], name, { type: blob.type || 'application/pdf' }) } : p)))
      .catch(() => { toast(T('Không tải được file', 'Datei nicht ladbar')); setPick((p) => { if (!p) return p; const n = { ...p }; delete n[d.path]; return n }) })
  }
  const sendPicked = async () => {
    if (!pick) return
    const sel = slips.filter((d) => d.path in pick)
    const files = sel.map((d) => pick[d.path]).filter((f): f is File => !!f)
    if (!files.length || files.length < sel.length) return
    if (await shareSlips(files, sel.map(docTitle))) setPick(null)
  }
  const docRow = (d: EmpDoc) => {
    const dl = permitDaysLeft(d.valid_until)
    const slip = d.kind === 'payslip' && d.period
    const picking = !!pick && d.kind === 'payslip'
    const on = picking && d.path in pick!
    return (
      <div key={d.id} className={`it${on ? ' picked' : ''}`}>
        <button className="ghost grow" style={{ justifyContent: 'flex-start', textAlign: 'left', minWidth: 0, padding: 0 }} onClick={() => (picking ? togglePick(d) : viewFile(d.path, docTitle(d), d.kind === 'payslip'))}>
          {picking ? <span className={`pick-box${on ? ' on' : ''}`} aria-checked={on} role="checkbox">{on && '✓'}</span> : <span className="doc-ic"><GIcon k="file" /></span>}
          <div style={{ minWidth: 0 }}>
            <div className="t">{docTitle(d)}</div>
            <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slip ? '' : `${d.title} · `}{T('tải lên', 'hochgeladen')} {dmy(d.created_at)}</div>
          </div>
        </button>
        {!['payslip', 'contract', 'tax', 'certificate'].includes(d.kind) && (
          <div style={{ width: 130 }} title={T('Hết hạn', 'gültig bis')}>
            <DateField allowEmpty value={d.valid_until} onChange={(v) => setDocValid(d, v)} />
            {dl != null && dl <= PERMIT_WARN_DAYS && <span className={`tag ${dl < 0 ? 'err' : 'warn'}`}>{dl < 0 ? T('hết hạn', 'abgelaufen') : `${dl} ${T('ngày', 'Tage')}`}</span>}
          </div>
        )}
        {!picking && <button className="ghost" onClick={() => delDoc(d)} aria-label="delete">✕</button>}
      </div>
    )
  }
  const nPick = pick ? Object.keys(pick).length : 0
  const pickReady = !!pick && nPick > 0 && Object.values(pick).every(Boolean)
  const folder = (title: string, list: EmpDoc[], open: boolean, slipBar = false) => (
    <details className="folder" open={open}>
      <summary><GIcon k="folder" /> {title} <span className="muted">({list.length})</span></summary>
      {slipBar && list.length > 0 && (
        <div className="pick-bar">
          {pick ? <>
            <button onClick={() => setPick(null)}>{T('Hủy', 'Abbrechen')}</button>
            <button onClick={() => (nPick === list.length ? setPick({}) : pickAll())}>{nPick === list.length ? T('Bỏ chọn', 'Keine') : T('Chọn tất cả', 'Alle')}</button>
            <button className="primary grow" disabled={!pickReady} onClick={sendPicked}>
              {nPick && !pickReady ? T('Đang chuẩn bị…', 'Wird vorbereitet…') : `${T('Gửi qua WhatsApp', 'Per WhatsApp senden')}${nPick ? ` (${nPick})` : ''}`}
            </button>
          </> : <button className="grow" onClick={() => setPick({})}>{T('Chọn nhiều bảng lương để gửi WhatsApp', 'Mehrere per WhatsApp senden')}</button>}
        </div>)}
      {list.length ? <div className="list">{list.map(docRow)}</div> : <div className="small muted" style={{ padding: '6px 12px 12px' }}>{T('Chưa có', 'Leer')}</div>}
    </details>
  )
  const uploadBox = (
    <label className="btn block drop" {...dropProps((fl) => addFiles(fl))}>{T('Tải giấy tờ lên (PDF / ảnh)', 'Dokument hochladen (PDF / Foto)')}<span className="drop-hint">{T('hoặc kéo thả file vào đây', 'oder Datei hierher ziehen')}</span>
      <input type="file" accept="application/pdf,.pdf,image/*" multiple hidden disabled={busy} onChange={(ev) => { addFiles(ev.target.files || []); ev.target.value = '' }} />
    </label>
  )

  if (isNew) return (
    <>
      <Top title={T('Nhân viên mới', 'Neuer Mitarbeiter')} sub={r.name} back={`/r/${rid}/hr`} />
      <div className="page">
        {warns.map((w) => <div key={w} className="alert warn">{w}</div>)}
        <label className="btn block drop" style={{ marginBottom: 12 }} {...dropProps((fl) => fromPayslip(fl))}>
          🧾 {T('Tải bảng lương cũ lên để tự điền thông tin', 'Alte Lohnabrechnung hochladen und Daten übernehmen')}
          <span className="drop-hint">{busy ? T('Đang đọc…', 'Wird gelesen…') : T('Tên, địa chỉ, ngày sinh, Steuer-ID, số BH hưu trí, Krankenkasse, Steuerklasse… (PDF DATEV)', 'Name, Anschrift, Geburtsdatum, Steuer-ID, RV-Nr., Krankenkasse, Steuerklasse… (DATEV-PDF)')}</span>
          <input type="file" accept="application/pdf,.pdf,.zip" multiple hidden disabled={busy} onChange={(ev) => { fromPayslip(ev.target.files || []); ev.target.value = '' }} />
        </label>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{T('Cá nhân', 'Persönliche Angaben')}</h3>
          {!isNew && (
            <div className="row" style={{ marginBottom: 10 }}>
              {photoUrl ? <img src={photoUrl} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--brand-2)' }} />}
              <label className="btn" {...dropPhoto}>{T('Ảnh chân dung', 'Foto')}<input type="file" accept="image/*" hidden onChange={(ev) => { uploadPhoto(ev.target.files?.[0]); ev.target.value = '' }} /></label>
            </div>
          )}
          <div className="grid2">
            <F l={L('Họ', 'Name')}><input value={e.last_name} onChange={(ev) => set({ last_name: ev.target.value })} /></F>
            <F l={L('Tên', 'Vorname')}><input value={e.first_name} onChange={(ev) => set({ first_name: ev.target.value })} /></F>
          </div>
          <F l={L('Địa chỉ', 'Anschrift')}><textarea {...txt('address')} placeholder="Straße Nr., PLZ Ort" style={{ minHeight: 50 }} /></F>
          <div className="grid2">
            <F l={L('Ngày sinh', 'Geburtsdatum')}><input type="date" value={e.birth_date || ''} onChange={(ev) => set({ birth_date: ev.target.value || null })} /></F>
            <F l={L('Nơi sinh', 'Geburtsort')}><input {...txt('birth_place')} /></F>
          </div>
          <F l={L('Quốc tịch', 'Nationalität')}><ComboInput value={e.nationality || ''} options={NATIONS} onChange={(v) => set({ nationality: v || null })} placeholder={T('Chọn hoặc gõ', 'Auswählen oder eingeben')} /></F>
          <div className="grid2">
            <F l={L('Điện thoại', 'Telefon')}><input type="tel" {...txt('phone')} /></F>
            <F l="E-Mail"><input type="email" {...txt('email')} /></F>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{T('Cư trú và lao động', 'Aufenthalt und Erwerbstätigkeit')}</h3>
          <F l={L('Giấy phép cư trú', 'Aufenthaltstitel')}>
            <ComboInput value={e.residence_permit || ''} options={PERMITS.map((p) => p[0])} placeholder={T('Chọn trong danh sách hoặc gõ', 'Auswählen oder eingeben')}
              onChange={(v) => { const pi = permitInfo(v); set({ residence_permit: v || null, ...(pi && pi[2] != null && e.work_permitted == null ? { work_permitted: pi[2] } : {}), ...(pi?.[3] ? { residence_permit_until: null } : {}) }) }} />
            {!de && permitInfo(e.residence_permit) && <div className="small muted" style={{ marginTop: 4 }}>{permitInfo(e.residence_permit)![1]}</div>}
          </F>
          {!permitInfo(e.residence_permit)?.[3] && <F l={L('Hết hạn ngày (app nhắc trước 90 ngày)', 'gültig bis')}><DateField allowEmpty value={e.residence_permit_until} onChange={(d) => set({ residence_permit_until: d })} /></F>}
          <F l={L('Được phép làm việc?', 'Erwerbstätigkeit gestattet')}>{yn('work_permitted')}</F>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{T('Công việc', 'Beschäftigung')}</h3>
          <F l={L('Công ty', 'Firma')}><input {...txt('company')} placeholder="Vietbowl Mitte GmbH" /></F>
          <div className="grid2">
            <F l={L('Ngày bắt đầu làm', 'Eintrittsdatum')}><DateField allowEmpty value={e.entry_date} onChange={(d) => set({ entry_date: d })} /></F>
            <F l={L('Mã nhân viên', 'Personal-Nr.')}><input inputMode="numeric" {...txt('personnel_no')} placeholder="00001" /></F>
          </div>
          <F l={L('Công việc', 'Tätigkeit')}>
            <ComboInput value={e.job_title || ''} options={JOBS.map((j) => j[0])} placeholder={T('Chọn trong danh sách hoặc gõ', 'Auswählen oder eingeben')}
              onChange={(v) => { const j = jobInfo(v); set({ job_title: v || null, ...(j ? { position: j[2] } : {}) }) }} />
            {!de && jobInfo(e.job_title) && <div className="small muted" style={{ marginTop: 4 }}>{jobInfo(e.job_title)![1]} · {POSITIONS[jobInfo(e.job_title)![2]][0]}</div>}
          </F>
          <F l={L('Loại hợp đồng', 'Beschäftigungsart')}>
            <select value={e.employment_type || ''} onChange={(ev) => set({ employment_type: (ev.target.value || null) as EmpType | null })}>
              <option value="">—</option>
              {(Object.keys(EMP_TYPES) as EmpType[]).map((k) => <option key={k} value={k}>{EMP_TYPES[k][li]}</option>)}
            </select>
          </F>
          <div className="grid2">
            <F l={L('Lương brutto / tháng', 'Monatl. Bruttolohn')}><Money value={e.gross_monthly} onChange={(v) => set({ gross_monthly: v || null })} /></F>
            <F l={L('Lương / giờ', 'Stundenlohn')}><Money value={e.hourly_wage} onChange={(v) => set({ hourly_wage: v || null })} /></F>
          </div>
          <div className="grid2">
            <F l={L('Giờ / tuần', 'Std./Woche')}>{numIn('weekly_hours', '40')}</F>
            <F l={L('Ngày phép / năm', 'Urlaubstage')}>{numIn('vacation_days', '24')}</F>
          </div>
          <F l={L('Có làm việc ở nơi khác không?', 'Mehrfachbeschäftigung')}>{yn('multiple_employment')}</F>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{T('Thuế và bảo hiểm', 'Steuer und Sozialversicherung')}</h3>
          <div className="grid2">
            <F l={L('Bậc thuế lương', 'Steuerklasse')}>
              <select value={e.tax_class ?? ''} onChange={(ev) => set({ tax_class: ev.target.value ? Number(ev.target.value) : null })}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </F>
            <F l={L('Số Steuer-ID', 'Steuer-ID')}><input inputMode="numeric" {...txt('tax_id')} placeholder="11 Ziffern" /></F>
          </div>
          <F l={L('Số bảo hiểm hưu trí', 'Rentenversicherungsnr.')}><input {...txt('pension_no')} placeholder="12 Zeichen" /></F>
          <F l={L('Hãng bảo hiểm y tế', 'Krankenkasse')}><input {...txt('health_insurance')} placeholder="AOK, TK, Barmer…" /></F>
          <F l={L('Tài khoản ngân hàng', 'IBAN')}><input {...txt('iban')} placeholder="DE.." autoCapitalize="characters" /></F>
          <div className="grid2">
            <F l="BIC"><input {...txt('bic')} /></F>
            <F l={L('Ngân hàng', 'Bank')}><input {...txt('bank_name')} /></F>
          </div>
          <F l={T('Ghi chú', 'Notiz')}><textarea {...txt('note')} /></F>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{T('Giấy tờ', 'Dokumente')}</h3>
          {uploadBox}
          {pending.length > 0 && (
            <div className="list" style={{ marginTop: 8 }}>
              {pending.map((p, i) => (
                <div key={i} className="it">
                  <div className="grow" style={{ minWidth: 0 }}><div className="t">{p.name}</div><div className="small muted">{T('lưu khi bấm Lưu', 'wird beim Speichern hochgeladen')}</div></div>
                  <button className="ghost" onClick={() => setPending(pending.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="primary block" disabled={busy} onClick={save}>{busy ? '…' : T('Lưu', 'Speichern')}</button>
      </div>
    </>
  )

  const CNAMES: Record<string, string> = { name: T('họ tên', 'Name'), address: T('địa chỉ', 'Anschrift'), entry_date: T('ngày vào làm', 'Eintritt'), gross_monthly: T('lương brutto', 'Bruttolohn'), weekly_hours: T('giờ/tuần', 'Wochenstunden'), vacation_days: T('ngày phép', 'Urlaubstage'), job: T('công việc', 'Tätigkeit') }
  function makeContract() {
    if (e!.employment_type === 'minijob') { toast(T('Hợp đồng Minijob dùng mẫu riêng. Gửi mẫu Minijob để thêm vào app.', 'Für Minijobs gibt es einen eigenen Vertrag (Vorlage fehlt noch).')); return }
    setCv({ job: e!.job_title || '', days: e!.work_days != null && Number(e!.work_days) >= 2 && Number(e!.work_days) <= 6 ? Number(e!.work_days) : guessDays(e!.weekly_hours != null ? Number(e!.weekly_hours) : null) })
  }
  async function doContract() {
    if (!cv) return
    const o = { job: cv.job.trim() || null, days: cv.days }
    const miss = contractMissing(e!, o)
    setBusy(true)
    try {
      const { docx, pdf } = await arbeitsvertrag(e!, o)
      const base = `Arbeitsvertrag_${e!.last_name}_${e!.first_name}_${todayIso()}`.replace(/\s+/g, '_')
      setCv(null)
      setPv({ title: T('Hợp đồng lao động', 'Arbeitsvertrag'), pdf, docx, base, kind: 'contract', miss: miss.length ? miss.map((k) => CNAMES[k]).join(', ') : undefined })
    } catch (x) { toast(errMsg(x)) }
    setBusy(false)
  }
  async function doBestaetigung() {
    if (!ab) return
    setBusy(true)
    try {
      const pdf = await arbeitgeberbestaetigungPdf(e!, { anrede: ab.anrede, job: ab.job.trim() || null, date: ab.date })
      const base = `Arbeitgeberbestaetigung_${e!.last_name}_${e!.first_name}_${ab.date}`.replace(/\s+/g, '_')
      setAb(null)
      setPv({ title: 'Arbeitgeberbestätigung', pdf, base, kind: 'certificate' })
    } catch (x) { toast(errMsg(x)) }
    setBusy(false)
  }
  /** Lưu bản PDF đang xem vào Tài liệu của nhân viên */
  async function savePreview() {
    if (!pv || pv.saved) return
    setBusy(true)
    try {
      const path = await uploadHrFile(rid!, eid!, pv.pdf, `${pv.base}.pdf`)
      const { error } = await supabase.from('nh_employee_docs').insert({ restaurant_id: rid, employee_id: eid, kind: pv.kind, title: `${pv.base}.pdf`, path })
      if (error) throw error
      setPv({ ...pv, saved: true }); loadChildren()
      toast(T('Đã lưu vào Tài liệu', 'In Dokumenten gespeichert'))
    } catch (x) { toast(errMsg(x)) }
    setBusy(false)
  }
  const initials = [e.first_name, e.last_name].map((x) => (x || '').trim()[0] || '').join('').toUpperCase()
  const eyeBtn = (
    <button type="button" className="eye-btn" onClick={() => setShowPay(!showPay)} aria-label={showPay ? T('Ẩn lương', 'Lohn ausblenden') : T('Xem lương', 'Lohn anzeigen')} title={showPay ? T('Ẩn', 'Ausblenden') : T('Xem', 'Anzeigen')}>
      <GIcon k={showPay ? 'eyeOff' : 'eye'} />
    </button>)
  const pay = e.gross_monthly != null ? eur(Number(e.gross_monthly)) : e.hourly_wage != null ? `${eur(Number(e.hourly_wage))} / ${T('giờ', 'Std.')}` : ''
  const ABS: Record<string, [string, string]> = { vacation: ['Nghỉ phép', 'Urlaub'], sick: ['Nghỉ ốm', 'Krank'], unpaid: ['Nghỉ không lương', 'Unbezahlt'], other: ['Khác', 'Sonstiges'] }
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1
  const TABS: [Tab, string][] = [
    ['overview', T('Tổng quan', 'Übersicht')], ['personal', T('Cá nhân', 'Persönlich')], ['work', T('Công việc', 'Beschäftigung')], ['residence', T('Cư trú', 'Aufenthalt')],
    ['pay', T('Lương và bảo hiểm', 'Lohn und Versicherung')], ['leave', T('Giờ làm và nghỉ phép', 'Arbeitszeit und Urlaub')], ['docs', `${T('Tài liệu', 'Dokumente')} (${docs.length})`],
  ]


  // Các khối nội dung dùng chung cho máy tính (tab) và điện thoại (accordion)
  const sec = (id: string) => ({ open: !!openSec[id], onToggle: () => setOpenSec({ ...openSec, [id]: !openSec[id] }) })
  const contractsCard = (o: { acc?: boolean } = {}) => (
    <Group icon={<GIcon k="file" />} title={T('Hợp đồng lao động', 'Arbeitsverträge')} {...(o.acc ? sec('contracts') : {})}
      action={<button className="pc-edit" onClick={() => { setCt(emptyContract(e)); setCtFiles([]) }}>+ {T('Thêm', 'Neu')}</button>}>
            <div className="list">
              {contracts.map((c) => (
                <button key={c.id} className="it" style={{ width: '100%', textAlign: 'left' }} onClick={() => { setCt({ ...c }); setCtFiles([]) }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t">{c.employment_type ? EMP_TYPES[c.employment_type][li] : T('Hợp đồng', 'Vertrag')}{c.weekly_hours != null && ` · ${String(c.weekly_hours).replace('.', ',')} ${T('giờ/tuần', 'Std./Woche')}`}</div>
                    <div className="small muted">
                      {dmy(c.start_date)} – {c.end_date ? dmy(c.end_date) : T('không thời hạn', 'unbefristet')}
                      {c.terminated_on && ` · ${T('huỷ', 'gekündigt')} ${dmy(c.terminated_on)}`}{c.files.length > 0 && ` · 📎 ${c.files.length}`}
                    </div>
                  </div>
                  {c.gross_monthly != null && <div className="num">{eur(Number(c.gross_monthly))}</div>}
                </button>
              ))}
              {!contracts.length && <div className="it muted">{T('Chưa có hợp đồng', 'Kein Vertrag erfasst')}</div>}
            </div>
    </Group>
  )
  const exitRow = (
    <div className="row wrap pf-exit">
            {active
              ? <button className="grow" onClick={() => setExitF({ date: todayIso(), reason: '' })}>{T('Nghỉ việc / huỷ hợp đồng', 'Austritt / Kündigung')}</button>
              : <button className="grow" onClick={() => saveExit(null, null)}>{T('Đi làm lại', 'Wieder aktiv')}</button>}
            <button className="danger" onClick={delEmployee}>{T('Xoá hồ sơ', 'Akte löschen')}</button>
    </div>
  )
  const resDocsList = (
    <>
            {(() => {
              const l = docs.filter((d) => ['passport', 'residence', 'work_permit', 'id_card'].includes(d.kind))
              return l.length ? <div className="list">{l.map(docRow)}</div> : <div className="kv-v empty">{T('Chưa có. Tải lên ở tab Tài liệu.', 'Keine. Upload unter Dokumente.')}</div>
            })()}
    </>
  )
  const slipsCard = (o: { flat?: boolean } = {}) => (
    <Group icon={<GIcon k="folder" />} title={T('Bảng lương gần nhất', 'Letzte Lohnabrechnungen')} flat={o.flat}
      action={slips.length > 3 && <button className="pc-edit" onClick={() => (mobile ? setOpenSec({ ...openSec, docs: true }) : setTab('docs'))}>{T('Xem tất cả', 'Alle')} ({slips.length})</button>}>
            {slips.length ? <div className="list">{slips.slice(0, 3).map(docRow)}</div> : <div className="kv-v empty">{T('Chưa có bảng lương', 'Keine Lohnabrechnungen')}</div>}
    </Group>
  )
  const workTimeCard = (o: { flat?: boolean } = {}) => (
    <Group icon={<GIcon k="calendar" />} title={T('Giờ làm theo tháng', 'Arbeitszeiten je Monat')} flat={o.flat}>
            <WorkTime eid={eid!} name={`${e.first_name} ${e.last_name}`.trim()} pnr={e.personnel_no || null} company={hs?.company_name || e.company || r.name} de={de} download={download}
              contract={e.work_days != null && e.daily_hours != null ? `${String(e.work_days).replace('.', ',')} Tage/Woche × ${String(e.daily_hours).replace('.', ',')} Std.` : null} />
    </Group>
  )
  const absCard = (o: { flat?: boolean } = {}) => abs.some((a) => a.kind !== 'vacation') && (
    <Group icon={<GIcon k="calendar" />} title={T('Nghỉ ốm và nghỉ khác', 'Krankheit und sonstige Abwesenheit')} flat={o.flat}>
            <div className="list">
              {abs.filter((a) => a.kind !== 'vacation').map((a) => (
                <div key={a.id} className="it">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t">{(ABS[a.kind] || ABS.other)[li]}</div>
                    <div className="small muted">{dmy(a.from_date)} – {dmy(a.to_date)}{a.note && ` · ${a.note}`}</div>
                  </div>
                  <div className="num">{days(a.from_date, a.to_date)} {T('ngày', 'Tage')}</div>
                </div>
              ))}
            </div>
    </Group>
  )
  const docsCard = (o: { acc?: boolean } = {}) => (
    <Group icon={<GIcon k="folder" />} title={`${T('Tài liệu', 'Dokumente')}${o.acc ? ` (${docs.length})` : ''}`} {...(o.acc ? sec('docs') : {})}>
      {uploadBox}
      {folder(T('Giấy tờ cá nhân', 'Persönliche Dokumente'), personalDocs, true)}
      {folder(T('Bảng lương', 'Lohnabrechnungen'), slips, false, true)}
    </Group>
  )
  // Các thao tác xuất tài liệu (máy tính: nút riêng, điện thoại: menu ⋯)
  const exportsList = [
    { k: 'contract', icon: 'file' as GKey, label: T('Hợp đồng lao động (Word)', 'Arbeitsvertrag (Word)'), short: T('Hợp đồng', 'Vertrag'), title: T('Hợp đồng lao động (Word), điền sẵn thông tin nhân viên', 'Arbeitsvertrag (Word) mit Mitarbeiterdaten'), run: makeContract },
    { k: 'ab', icon: 'file' as GKey, label: 'Arbeitgeberbestätigung', short: 'Arbeitgeberbestätigung', title: T('Giấy xác nhận đang làm việc (PDF)', 'Arbeitgeberbestätigung (PDF)'), run: () => setAb({ anrede: 'Herr', job: e.job_title || '', date: todayIso() }) },
    { k: 'pb', icon: 'download' as GKey, label: T('Tải Personalbogen (PDF)', 'Personalbogen herunterladen (PDF)'), short: 'PDF', title: 'Personalbogen PDF', run: () => download(personalbogenPdf(e, r, hs?.company_name || null), `Personalbogen_${e.last_name}_${e.first_name}.pdf`.replace(/\s+/g, '_')) },
  ]

  return (
    <>
      <Top title={T('Hồ sơ nhân viên', 'Personalakte')} sub={r.name} back={`/r/${rid}/hr`}
        className={mobile ? 'top-compact' : undefined}
        right={mobile
          ? <div className="pf-menu">
              <button className="pf-more" aria-label={T('Thêm thao tác', 'Weitere Aktionen')} aria-expanded={menu} onClick={() => setMenu(!menu)}><GIcon k="more" /></button>
              {menu && <>
                <div className="pf-menu-bg" onClick={() => setMenu(false)} />
                <div className="pf-menu-l" role="menu">
                  {exportsList.map((x) => <button key={x.k} role="menuitem" onClick={() => { setMenu(false); x.run() }}><GIcon k={x.icon} /><span>{x.label}</span></button>)}
                </div>
              </>}
            </div>
          : <div className="row" style={{ gap: 6 }}>
              {exportsList.map((x) => <button key={x.k} className="btn pdf-btn" title={x.title} onClick={x.run}><GIcon k={x.icon} /><span>{x.short}</span></button>)}
            </div>} />
      <div className="page pf">
        {mobile ? (
          <section className="phead ph-m">
            <label className="ph-av" title={T('Đổi ảnh chân dung', 'Foto ändern')} {...dropPhoto}>
              {photoUrl ? <img src={photoUrl} alt="" /> : <span>{initials || '?'}</span>}
              <span className="ph-cam"><GIcon k="camera" /></span>
              <input type="file" accept="image/*" hidden onChange={(ev) => { uploadPhoto(ev.target.files?.[0]); ev.target.value = '' }} />
            </label>
            <div className="ph-id">
              <h2>{fullName(e) || '—'}</h2>
              <div className="ph-pnr">{T('NV', 'Pers.-Nr.')} {e.personnel_no || '—'}</div>
              <div className="ph-st">
                <span className={`ph-dot ${active ? 'ok' : 'err'}`} />
                <span>{active ? T('Đang làm', 'Aktiv') : `${T('Đã nghỉ từ', 'Ausgeschieden zum')} ${dmy(e.exit_date)}`}</span>
                <span className="muted">·</span>
                <span>{e.employment_type ? EMP_TYPES[e.employment_type][li] : '—'}</span>
              </div>
            </div>
          </section>
        ) : (
        <section className="phead">
            <div className="ph-top">
              <label className="ph-av" title={T('Đổi ảnh chân dung', 'Foto ändern')} {...dropPhoto}>
                {photoUrl ? <img src={photoUrl} alt="" /> : <span>{initials || '?'}</span>}
                <span className="ph-cam"><GIcon k="camera" /></span>
                <input type="file" accept="image/*" hidden onChange={(ev) => { uploadPhoto(ev.target.files?.[0]); ev.target.value = '' }} />
              </label>
              <div className="ph-id">
                <h2>{fullName(e) || '—'}</h2>
                <div className="muted">{e.company || hs?.company_name || r.name}</div>
                <div className="ph-tags">
                  {e.employment_type && <span className="tag">{EMP_TYPES[e.employment_type][li]}</span>}
                  {active ? <span className="tag ok">{T('Đang làm', 'Aktiv')}</span> : <span className="tag err" title={e.exit_reason || ''}>{T('Đã nghỉ từ', 'Ausgeschieden zum')} {dmy(e.exit_date)}</span>}
                  {e.personnel_no && <span className="ph-pnr">Personal-Nr. {e.personnel_no}</span>}
                </div>
              </div>
            </div>
            <div className="ph-stats">
              <div><span>{L('Lương tháng', 'Monatslohn')}{pay && eyeBtn}</span><b className={pay ? `accent${showPay ? '' : ' masked'}` : 'empty'} onClick={pay ? () => setShowPay(!showPay) : undefined}>{pay || T('Chưa cập nhật', 'Nicht erfasst')}</b></div>
              <div><span>{L('Ngày vào làm', 'Eintritt')}</span><b className={e.entry_date ? '' : 'empty'}>{e.entry_date ? dmy(e.entry_date) : T('Chưa cập nhật', 'Nicht erfasst')}</b></div>
              <div><span>{L('Hợp đồng', 'Beschäftigung')}</span><b className={e.employment_type ? '' : 'empty'}>{e.employment_type ? EMP_TYPES[e.employment_type][li] : T('Chưa cập nhật', 'Nicht erfasst')}</b></div>
            </div>
          </section>
        )}

        {warns.length > 0 && <div className="pf-warns">{warns.map((w) => <div key={w} className="alert warn">{w}</div>)}</div>}

        {mobile ? <>
          {group('personal', { acc: true })}
          {group('work', { acc: true })}
          {group('residence', { acc: true, extra: <div className="pf-sub">{resDocsList}</div> })}
          <Group icon={<GIcon k="wallet" />} title={T('Lương và bảo hiểm', 'Lohn und Versicherung')} {...sec('pay')}>
            {group('pay', { flat: true })}{group('tax', { flat: true })}{group('bank', { flat: true })}{slipsCard({ flat: true })}
          </Group>
          <Group icon={<GIcon k="calendar" />} title={T('Giờ làm và nghỉ phép', 'Arbeitszeit und Urlaub')} {...sec('leave')}>
            {group('leave', { flat: true })}{workTimeCard({ flat: true })}{absCard({ flat: true })}
          </Group>
          {contractsCard({ acc: true })}
          {docsCard({ acc: true })}
          {group('note', { acc: true })}
          {exitRow}
        </> : <>
        <nav className="ptabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </nav>

        {tab === 'overview' && <>{group('personal')}{group('work')}{group('residence')}{e.note && group('note')}</>}
        {tab === 'personal' && <>{group('personal')}{group('note')}</>}
        {tab === 'work' && <>{group('work')}{contractsCard()}{exitRow}</>}
        {tab === 'residence' && <>
          {group('residence')}
          <Group icon={<GIcon k="folder" />} title={T('Giấy tờ cư trú', 'Ausweisdokumente')}>{resDocsList}</Group>
        </>}
        {tab === 'pay' && <>{group('pay')}{group('tax')}{group('bank')}{slipsCard()}</>}
        {tab === 'leave' && <>{group('leave')}{workTimeCard()}{absCard()}</>}
        {tab === 'docs' && docsCard()}
        </>}
      </div>

      <Sheet open={!!ct} onClose={() => setCt(null)} title={ct?.id ? T('Hợp đồng lao động', 'Arbeitsvertrag') : T('Thêm hợp đồng', 'Vertrag hinzufügen')}>
        {ct && <>
          <F l={L('Loại hợp đồng', 'Beschäftigungsart')}>
            <select value={ct.employment_type || ''} onChange={(ev) => setCt({ ...ct, employment_type: (ev.target.value || null) as EmpType | null })}>
              <option value="">—</option>
              {(Object.keys(EMP_TYPES) as EmpType[]).map((k) => <option key={k} value={k}>{EMP_TYPES[k][li]}</option>)}
            </select>
          </F>
          <div className="grid2">
            <F l={L('Bắt đầu', 'Beginn')}><DateField value={ct.start_date} onChange={(d) => setCt({ ...ct, start_date: d || todayIso() })} /></F>
            <F l={L('Kết thúc (nếu có thời hạn)', 'befristet bis')}><DateField allowEmpty value={ct.end_date} onChange={(d) => setCt({ ...ct, end_date: d })} /></F>
          </div>
          <F l={L('Thử việc đến', 'Probezeit bis')}><DateField allowEmpty value={ct.probation_until} onChange={(d) => setCt({ ...ct, probation_until: d })} /></F>
          <div className="grid2">
            <F l={L('Giờ / tuần', 'Std./Woche')}><input inputMode="decimal" value={ct.weekly_hours == null ? '' : String(ct.weekly_hours).replace('.', ',')} onChange={(ev) => setCt({ ...ct, weekly_hours: ev.target.value.trim() ? parseNum(ev.target.value) : null })} /></F>
            <F l={L('Ngày phép / năm', 'Urlaubstage')}><input inputMode="decimal" value={ct.vacation_days == null ? '' : String(ct.vacation_days).replace('.', ',')} onChange={(ev) => setCt({ ...ct, vacation_days: ev.target.value.trim() ? parseNum(ev.target.value) : null })} /></F>
          </div>
          <div className="grid2">
            <F l={L('Brutto / tháng', 'Brutto/Monat')}><Money value={ct.gross_monthly} onChange={(v) => setCt({ ...ct, gross_monthly: v || null })} /></F>
            <F l={L('Lương / giờ', 'Stundenlohn')}><Money value={ct.hourly_wage} onChange={(v) => setCt({ ...ct, hourly_wage: v || null })} /></F>
          </div>
          <F l={L('Ngày huỷ hợp đồng', 'gekündigt am')}><DateField allowEmpty value={ct.terminated_on} onChange={(d) => setCt({ ...ct, terminated_on: d })} /></F>
          <F l={T('Ghi chú', 'Notiz')}><textarea value={ct.note || ''} onChange={(ev) => setCt({ ...ct, note: ev.target.value || null })} /></F>
          <div className="f"><span>{T('File hợp đồng', 'Vertragsdatei')}</span>
            {ct.files.map((p, i) => (
              <div key={p} className="row" style={{ marginBottom: 4 }}>
                <button className="ghost grow" style={{ justifyContent: 'flex-start' }} onClick={() => viewFile(p, `${T('Hợp đồng', 'Vertrag')} ${i + 1}`)}>📎 {T('File', 'Datei')} {i + 1}</button>
                <button className="ghost" onClick={() => setCt({ ...ct, files: ct.files.filter((x) => x !== p) })}>✕</button>
              </div>
            ))}
            {ctFiles.map((f, i) => <div key={i} className="small">➕ {f.name} <button className="ghost" onClick={() => setCtFiles(ctFiles.filter((_, j) => j !== i))}>✕</button></div>)}
            <label className="btn block drop" style={{ marginTop: 4 }} {...dropProps((fl) => setCtFiles([...ctFiles, ...Array.from(fl)]))}>📄 {T('Tải file hợp đồng (PDF / ảnh)', 'Vertrag hochladen (PDF / Foto)')}
              <input type="file" accept="application/pdf,.pdf,image/*" multiple hidden onChange={(ev) => { setCtFiles([...ctFiles, ...Array.from(ev.target.files || [])]); ev.target.value = '' }} />
            </label>
          </div>
          <button className="primary block" disabled={busy} onClick={saveContract}>{busy ? '…' : T('Lưu', 'Speichern')}</button>
          {ct.id && <button className="danger block" style={{ marginTop: 8 }} onClick={delContract}>{T('Xoá', 'Löschen')}</button>}
        </>}
      </Sheet>

      <Sheet open={!!cv} onClose={() => setCv(null)} title={T('Tạo hợp đồng lao động', 'Arbeitsvertrag erstellen')}>
        {cv && (() => {
          const wk = e.weekly_hours != null ? Number(e.weekly_hours) : null
          const hpd = wk != null ? Math.round((wk / cv.days) * 100) / 100 : null
          const min = legalMinVacation(cv.days)
          const vac = e.vacation_days != null ? Number(e.vacation_days) : null
          const miss = contractMissing(e, { job: cv.job, days: cv.days })
          return <>
            <F l={L('Công việc', 'Tätigkeit')}><ComboInput value={cv.job} options={JOBS.map((j) => j[0])} onChange={(v) => setCv({ ...cv, job: v })} placeholder="Sushi-Koch, Servicekraft…" /></F>
            <F l={L('Số ngày làm / tuần', 'Arbeitstage pro Woche')}>
              <div className="seg">{[2, 3, 4, 5, 6].map((d) => <button key={d} className={cv.days === d ? 'sel' : ''} onClick={() => setCv({ ...cv, days: d })}>{d}</button>)}</div>
            </F>
            <div className="kv" style={{ marginBottom: 12 }}>
              <div className="kv-i"><div className="kv-l">{L('Giờ / tuần', 'Wochenstunden')}</div><div className={`kv-v${wk == null ? ' empty' : ''}`}>{wk != null ? String(wk).replace('.', ',') : T('Chưa cập nhật', 'Nicht erfasst')}</div></div>
              <div className="kv-i"><div className="kv-l">{L('Giờ / ngày', 'Stunden pro Tag')}</div><div className={`kv-v${hpd == null ? ' empty' : ''}`}>{hpd != null ? String(hpd).replace('.', ',') : '—'}</div></div>
              <div className="kv-i"><div className="kv-l">{L('Ngày phép', 'Urlaub')}</div><div className={`kv-v${vac == null ? ' empty' : ''}`}>{vac != null ? `${String(vac).replace('.', ',')} (${T('tối thiểu', 'mind.')} ${min})` : T('Chưa cập nhật', 'Nicht erfasst')}</div></div>
            </div>
            {vac != null && vac < min && <div className="alert warn">{T(`Ngày phép thấp hơn mức tối thiểu theo luật (${min} ngày khi làm ${cv.days} ngày/tuần).`, `Urlaub unter dem gesetzlichen Minimum (${min} Tage bei ${cv.days}-Tage-Woche).`)}</div>}
            {miss.length > 0 && <div className="alert warn">{T('Còn thiếu', 'Fehlt')}: {miss.map((k) => CNAMES[k]).join(', ')}. {T('Các chỗ này để dòng chấm để điền tay.', 'Diese Stellen bleiben frei.')}</div>}
            <p className="small muted">{T('Lương, giờ/tuần, ngày phép lấy từ hồ sơ. Muốn đổi thì sửa ở tab Lương và bảo hiểm / Nghỉ phép.', 'Lohn, Wochenstunden und Urlaub kommen aus der Akte.')}</p>
            <button className="primary block" disabled={busy} onClick={doContract}>{busy ? '…' : T('Xem trước hợp đồng', 'Vorschau anzeigen')}</button>
          </>
        })()}
      </Sheet>

      <Sheet open={!!ab} onClose={() => setAb(null)} title="Arbeitgeberbestätigung">
        {ab && (() => {
          const miss = bestaetigungMissing(e, ab.job)
          const MN: Record<string, string> = { name: T('họ tên', 'Name'), birth_date: T('ngày sinh', 'Geburtsdatum'), birth_place: T('nơi sinh', 'Geburtsort'), address: T('địa chỉ', 'Anschrift'), entry_date: T('ngày vào làm', 'Eintritt'), job: T('công việc', 'Tätigkeit') }
          return <>
            <F l={L('Xưng hô', 'Anrede')}>
              <div className="seg">{(['Herr', 'Frau'] as Anrede[]).map((a) => <button key={a} className={ab.anrede === a ? 'sel' : ''} onClick={() => setAb({ ...ab, anrede: a })}>{a}</button>)}</div>
            </F>
            <F l={L('Công việc', 'Tätigkeit')}><ComboInput value={ab.job} options={JOBS.map((j) => j[0])} onChange={(v) => setAb({ ...ab, job: v })} placeholder="Koch, Servicekraft…" /></F>
            <F l={L('Ngày viết', 'Datum')}><DateField value={ab.date} onChange={(d) => setAb({ ...ab, date: d || todayIso() })} /></F>
            {miss.length > 0 && <div className="alert warn">{T('Còn thiếu', 'Fehlt')}: {miss.map((k) => MN[k]).join(', ')}. {T('Các chỗ này để dòng chấm.', 'Diese Stellen bleiben frei.')}</div>}
            <p className="small muted">{T('Tên, ngày sinh, nơi sinh, địa chỉ, ngày vào làm lấy từ hồ sơ.', 'Name, Geburtsdatum, Geburtsort, Anschrift und Eintritt kommen aus der Akte.')}</p>
            <button className="primary block" disabled={busy} onClick={doBestaetigung}>{busy ? '…' : T('Xem trước', 'Vorschau')}</button>
          </>
        })()}
      </Sheet>

      <Sheet open={!!exitF} onClose={() => setExitF(null)} title={T('Nghỉ việc / huỷ hợp đồng', 'Austritt / Kündigung')}>
        {exitF && <>
          <F l={L('Ngày làm việc cuối', 'Austrittsdatum')}><DateField value={exitF.date} onChange={(d) => setExitF({ ...exitF, date: d })} /></F>
          <F l={L('Lý do', 'Grund')}><input value={exitF.reason} onChange={(ev) => setExitF({ ...exitF, reason: ev.target.value })} placeholder={T('Nhân viên xin nghỉ, hết hạn hợp đồng…', 'Eigenkündigung, Befristung…')} /></F>
          <p className="small muted">{T('Sau ngày này nhân viên chuyển sang mục "Đã nghỉ". Hồ sơ và giấy tờ vẫn được giữ.', 'Danach erscheint die Person unter „Ausgeschieden". Akte und Dokumente bleiben erhalten.')}</p>
          <button className="primary block" onClick={() => saveExit(exitF.date, exitF.reason.trim() || null)}>{T('Lưu', 'Speichern')}</button>
        </>}
      </Sheet>
      {pv && <PdfSheet pdf={pv.pdf} title={pv.title} onClose={() => setPv(null)} actions={[
        ...(pv.docx ? [{ label: T('Tải Word', 'Word laden'), onClick: () => download(pv.docx!, `${pv.base}.docx`) }] : []),
        { label: T('Tải PDF', 'PDF laden'), onClick: () => download(pv.pdf, `${pv.base}.pdf`) },
        { label: pv.saved ? T('Đã lưu ✓', 'Gespeichert ✓') : T('Lưu vào hồ sơ', 'In Akte speichern'), primary: true, disabled: busy || pv.saved, onClick: savePreview },
      ]} />}
      {fv && <PdfSheet pdf={fv.blob} title={fv.title} onClose={() => setFv(null)} actions={[
        ...(fv.slip ? [{ label: T('Gửi qua WhatsApp', 'Per WhatsApp senden'), onClick: () => sendWhatsApp(fv) }] : []),
        { label: T('Tải về', 'Herunterladen'), primary: true, onClick: () => download(fv.blob, fv.name) },
      ]} />}
      {pv?.miss && <div className="pv-miss">{T(`Hồ sơ còn thiếu: ${pv.miss}. Các chỗ này để dòng chấm để điền tay.`, `Fehlt: ${pv.miss}. Diese Stellen bleiben zum Ausfüllen frei.`)}</div>}
    </>
  )
}
