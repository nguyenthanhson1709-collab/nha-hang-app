// Hồ sơ nhân viên: form Meldungsbogen PERSONAL, giấy tờ, hợp đồng lao động, nghỉ việc
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { dmy, eur, parseNum, todayIso } from '../lib/format'
import { dropProps } from '../lib/drop'
import { download } from '../lib/pdf'
import {
  DOC_KINDS, EMP_TYPES, guessKind, JOBS, jobInfo, PERMITS, permitInfo, emptyEmployee, fullName, hrSignedUrl, HR_BUCKET, isActive, openHrFile, permitDaysLeft, PERMIT_WARN_DAYS, POSITIONS,
  uploadHrFile, validIban, validTaxId, type DocKind, type EmpContract, type EmpDoc, type EmpType, type Employee, type HrSettings,
} from '../lib/hr'
import { personalbogenPdf } from '../lib/hrPdf'
import { readPayslips } from '../lib/payslipImport'
import { baseSalary, empTypeOf, hourlyOf, splitName } from '../lib/payslip'
import { DateField } from '../components/PeriodBar'
import { ComboInput, Money, Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'

/** Một dòng thông tin trong hồ sơ; có onEdit thì hiện nút ✎ */
function InfoRow({ l, v, onEdit, add }: { l: string; v: string; onEdit?: () => void; add: string }) {
  return (
    <div className="info-row">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small muted">{l}</div>
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v || <span className="muted">—</span>}</div>
      </div>
      {onEdit && <button className="ghost" onClick={onEdit} aria-label="edit" title={v ? '' : add} style={{ color: 'var(--brand)' }}>✎</button>}
    </div>
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
  const L = (vi: string, g: string) => (de ? g : `${vi} (${g})`)
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
  const [ed, setEd] = useState<{ keys: (keyof Employee)[]; draft: Partial<Employee> } | null>(null)
  const [exitF, setExitF] = useState<{ date: string | null; reason: string } | null>(null)

  async function loadChildren() {
    if (isNew) return
    const [d, c] = await Promise.all([
      supabase.from('nh_employee_docs').select('*').eq('employee_id', eid!).order('created_at', { ascending: false }),
      supabase.from('nh_employment_contracts').select('*').eq('employee_id', eid!).order('start_date', { ascending: false }),
    ])
    setDocs((d.data || []) as EmpDoc[]); setContracts((c.data || []) as never)
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

  // ===== Hồ sơ đã có: chỉ xem; mục thay đổi được có nút ✎ (mục cố định chỉ bổ sung khi còn trống)
  type K = keyof Employee
  const show = (k: K): string => {
    const v = e[k]
    if (v == null || v === '') return ''
    if (k === 'birth_date' || k === 'entry_date' || k === 'residence_permit_until') return dmy(v as string)
    if (k === 'gross_monthly' || k === 'hourly_wage') return eur(Number(v))
    if (k === 'employment_type') return EMP_TYPES[v as EmpType][li]
    if (k === 'work_permitted' || k === 'multiple_employment') return v ? T('Có', 'Ja') : T('Không', 'Nein')
    if (k === 'job_title') return de ? String(v) : `${jobInfo(String(v))?.[1] || ''}${jobInfo(String(v)) ? ' · ' : ''}${v}`
    if (k === 'weekly_hours') return `${String(v).replace('.', ',')} ${T('giờ', 'Std.')}`
    return String(v)
  }
  const fixedRow = (l: string, k: K) => <InfoRow l={l} v={show(k)} onEdit={e[k] == null || e[k] === '' ? () => setEd({ keys: [k], draft: {} }) : undefined} add={T('Bổ sung', 'Ergänzen')} />
  const editRow = (l: string, keys: K[], v?: string) => <InfoRow l={l} v={v ?? show(keys[0])} onEdit={() => setEd({ keys, draft: Object.fromEntries(keys.map((k) => [k, e[k]])) as Partial<Employee> })} add={T('Bổ sung', 'Ergänzen')} />
  const profileView = () => (
    <>
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          {photoUrl ? <img src={photoUrl} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--brand-2)' }} />}
          <label className="btn">{T('Ảnh chân dung', 'Foto')}<input type="file" accept="image/*" hidden onChange={(ev) => { uploadPhoto(ev.target.files?.[0]); ev.target.value = '' }} /></label>
        </div>
        <h3>{T('Cá nhân', 'Persönliche Angaben')}</h3>
        <div className="info">
          {fixedRow(L('Họ', 'Name'), 'last_name')}
          {fixedRow(L('Tên', 'Vorname'), 'first_name')}
          {fixedRow(L('Ngày sinh', 'Geburtsdatum'), 'birth_date')}
          {fixedRow(L('Nơi sinh', 'Geburtsort'), 'birth_place')}
          {fixedRow(L('Quốc tịch', 'Nationalität'), 'nationality')}
          {editRow(L('Địa chỉ', 'Anschrift'), ['address'])}
          {editRow(L('Điện thoại', 'Telefon'), ['phone'])}
          {editRow('E-Mail', ['email'])}
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{T('Cư trú và lao động', 'Aufenthalt und Erwerbstätigkeit')}</h3>
        <div className="info">
          {editRow(L('Giấy phép cư trú', 'Aufenthaltstitel'), ['residence_permit', 'residence_permit_until', 'work_permitted'], [e.residence_permit, e.residence_permit_until && `${T('đến', 'bis')} ${dmy(e.residence_permit_until)}`].filter(Boolean).join(' · '))}
          {fixedRow(L('Được phép làm việc', 'Erwerbstätigkeit gestattet'), 'work_permitted')}
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{T('Công việc', 'Beschäftigung')}</h3>
        <div className="info">
          {fixedRow(L('Công ty', 'Firma'), 'company')}
          {fixedRow(L('Mã nhân viên', 'Personal-Nr.'), 'personnel_no')}
          {fixedRow(L('Ngày bắt đầu làm', 'Eintrittsdatum'), 'entry_date')}
          {editRow(L('Công việc', 'Tätigkeit'), ['job_title'])}
          {editRow(L('Loại hợp đồng', 'Beschäftigungsart'), ['employment_type', 'weekly_hours', 'gross_monthly', 'hourly_wage', 'vacation_days'],
            [show('employment_type'), show('weekly_hours') && `${show('weekly_hours')}/${T('tuần', 'Woche')}`, show('gross_monthly') && `${show('gross_monthly')}/${T('tháng', 'Monat')}`, show('hourly_wage') && `${show('hourly_wage')}/${T('giờ', 'Std.')}`, e.vacation_days != null && `${String(e.vacation_days).replace('.', ',')} ${T('ngày phép', 'Urlaubstage')}`].filter(Boolean).join(' · '))}
          {editRow(L('Làm thêm nơi khác', 'Mehrfachbeschäftigung'), ['multiple_employment'])}
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{T('Thuế và bảo hiểm', 'Steuer und Sozialversicherung')}</h3>
        <div className="info">
          {fixedRow(L('Số Steuer-ID', 'Steuer-ID'), 'tax_id')}
          {fixedRow(L('Số bảo hiểm hưu trí', 'Rentenversicherungsnr.'), 'pension_no')}
          {editRow(L('Bậc thuế lương', 'Steuerklasse'), ['tax_class'])}
          {editRow(L('Hãng bảo hiểm y tế', 'Krankenkasse'), ['health_insurance'])}
          {editRow(L('Ngân hàng', 'Bankverbindung'), ['iban', 'bic', 'bank_name'], [e.iban, e.bic, e.bank_name].filter(Boolean).join(' · '))}
          {editRow(T('Ghi chú', 'Notiz'), ['note'])}
        </div>
      </div>
    </>
  )
  async function saveEd() {
    if (!ed) return
    const patch = { ...ed.draft }
    if ('iban' in patch && patch.iban) patch.iban = patch.iban.replace(/\s+/g, '').toUpperCase()
    if ('iban' in patch && !validIban(patch.iban ?? null)) { toast(T('IBAN có vẻ sai', 'IBAN ungültig')); return }
    if ('tax_id' in patch && !validTaxId(patch.tax_id ?? null)) { toast(T('Steuer-ID phải có 11 chữ số', 'Steuer-ID muss 11 Ziffern haben')); return }
    if ('job_title' in patch) { const j = jobInfo(patch.job_title ?? null); if (j) patch.position = j[2] }
    const { error } = await supabase.from('nh_employees').update(patch).eq('id', eid!)
    if (error) { toast(/nh_employees_pnr|duplicate key/.test(errMsg(error)) ? T('Mã nhân viên này đã có ở hồ sơ khác', 'Personal-Nr. bereits vergeben') : errMsg(error)); return }
    set(patch); setEd(null); toast(T('Đã lưu', 'Gespeichert'))
  }
  const labelOf: Partial<Record<K, string>> = {
    last_name: L('Họ', 'Name'), first_name: L('Tên', 'Vorname'), birth_date: L('Ngày sinh', 'Geburtsdatum'), birth_place: L('Nơi sinh', 'Geburtsort'),
    nationality: L('Quốc tịch', 'Nationalität'), address: L('Địa chỉ', 'Anschrift'), phone: L('Điện thoại', 'Telefon'), email: 'E-Mail',
    residence_permit: L('Giấy phép cư trú', 'Aufenthaltstitel'), residence_permit_until: L('Hết hạn ngày', 'gültig bis'), work_permitted: L('Được phép làm việc?', 'Erwerbstätigkeit gestattet'),
    company: L('Công ty', 'Firma'), personnel_no: L('Mã nhân viên', 'Personal-Nr.'), entry_date: L('Ngày bắt đầu làm', 'Eintrittsdatum'), job_title: L('Công việc', 'Tätigkeit'),
    employment_type: L('Loại hợp đồng', 'Beschäftigungsart'), weekly_hours: L('Giờ / tuần', 'Std./Woche'), gross_monthly: L('Lương brutto / tháng', 'Monatl. Bruttolohn'),
    hourly_wage: L('Lương / giờ', 'Stundenlohn'), vacation_days: L('Ngày phép / năm', 'Urlaubstage'), multiple_employment: L('Có làm việc ở nơi khác không?', 'Mehrfachbeschäftigung'),
    tax_id: L('Số Steuer-ID', 'Steuer-ID'), pension_no: L('Số bảo hiểm hưu trí', 'Rentenversicherungsnr.'), tax_class: L('Bậc thuế lương', 'Steuerklasse'),
    health_insurance: L('Hãng bảo hiểm y tế', 'Krankenkasse'), iban: 'IBAN', bic: 'BIC', bank_name: L('Ngân hàng', 'Bank'), note: T('Ghi chú', 'Notiz'),
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
      case 'weekly_hours': case 'vacation_days': return <input inputMode="decimal" value={v == null ? '' : String(v).replace('.', ',')} onChange={(ev) => up({ [k]: ev.target.value.trim() ? parseNum(ev.target.value) : null } as Partial<Employee>)} />
      case 'address': case 'note': return <textarea value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)} />
      default: return <input value={(v as string) || ''} onChange={(ev) => sv(ev.target.value)} />
    }
  }

  return (
    <>
      <Top title={isNew ? T('Nhân viên mới', 'Neuer Mitarbeiter') : fullName(e)} sub={isNew ? r.name : `${r.name}${active ? '' : ' · ' + T('Đã nghỉ', 'Ausgeschieden')}`} back={`/r/${rid}/hr`}
        right={!isNew && <button className="btn" title="PDF" onClick={() => download(personalbogenPdf(e, r, hs?.company_name || null), `Personalbogen_${e.last_name}_${e.first_name}.pdf`.replace(/\s+/g, '_'))}>PDF</button>} />
      <div className="page">
        {!active && <div className="alert warn">{T('Đã nghỉ việc từ', 'Ausgeschieden zum')} {dmy(e.exit_date)}{e.exit_reason && ` · ${e.exit_reason}`}</div>}
        {warns.map((w) => <div key={w} className="alert warn">{w}</div>)}
        {isNew ? (<>
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
              <label className="btn">{T('Ảnh chân dung', 'Foto')}<input type="file" accept="image/*" hidden onChange={(ev) => { uploadPhoto(ev.target.files?.[0]); ev.target.value = '' }} /></label>
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
          <F l={L('Quốc tịch', 'Nationalität')}><input {...txt('nationality')} placeholder="vietnamesisch, deutsch…" /></F>
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
        </>) : profileView()}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{T('Giấy tờ', 'Dokumente')}</h3>
          <label className="btn block drop" {...dropProps((fl) => addFiles(fl))}>📄 {T('Tải giấy tờ lên (PDF / ảnh)', 'Dokument hochladen (PDF / Foto)')}<span className="drop-hint">{T('hoặc kéo thả file vào đây', 'oder Datei hierher ziehen')}</span>
            <input type="file" accept="application/pdf,.pdf,image/*" multiple hidden disabled={busy} onChange={(ev) => { addFiles(ev.target.files || []); ev.target.value = '' }} />
          </label>
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
          {(() => {
            const slips = docs.filter((d) => d.kind === 'payslip').sort((a, b) => (b.period || b.created_at).localeCompare(a.period || a.created_at))
            const personal = docs.filter((d) => d.kind !== 'payslip')
            const row = (d: EmpDoc) => {
              const dl = permitDaysLeft(d.valid_until)
              const slip = d.kind === 'payslip' && d.period
              return (
                <div key={d.id} className="it">
                  <button className="ghost grow" style={{ justifyContent: 'flex-start', textAlign: 'left', minWidth: 0, padding: 0 }} onClick={() => openHrFile(d.path)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="t">📎 {slip ? `${T('Bảng lương', 'Lohnabrechnung')} ${d.period!.slice(5, 7)}/${d.period!.slice(0, 4)}` : d.kind === 'other' ? d.title : DOC_KINDS[d.kind][li]}</div>
                      <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slip ? '' : `${d.title} · `}{T('tải lên', 'hochgeladen')} {dmy(d.created_at)}</div>
                    </div>
                  </button>
                  {!['payslip', 'contract', 'tax', 'certificate'].includes(d.kind) && (
                    <div style={{ width: 130 }} title={T('Hết hạn', 'gültig bis')}>
                      <DateField allowEmpty value={d.valid_until} onChange={(v) => setDocValid(d, v)} />
                      {dl != null && dl <= PERMIT_WARN_DAYS && <span className={`tag ${dl < 0 ? 'err' : 'warn'}`}>{dl < 0 ? T('hết hạn', 'abgelaufen') : `${dl} ${T('ngày', 'Tage')}`}</span>}
                    </div>
                  )}
                  <button className="ghost" onClick={() => delDoc(d)} aria-label="delete">✕</button>
                </div>
              )
            }
            const folder = (title: string, list: EmpDoc[], open: boolean) => (
              <details className="folder" open={open}>
                <summary>📁 {title} <span className="muted">({list.length})</span></summary>
                {list.length ? <div className="list">{list.map(row)}</div> : <div className="small muted" style={{ padding: '6px 4px' }}>{T('Chưa có', 'Leer')}</div>}
              </details>
            )
            return docs.length > 0 && <>
              {folder(T('Giấy tờ cá nhân', 'Persönliche Dokumente'), personal, true)}
              {folder(T('Bảng lương', 'Lohnabrechnungen'), slips, false)}
            </>
          })()}
        </div>

        {!isNew && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{T('Hợp đồng lao động', 'Arbeitsverträge')}</h3>
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
            <button className="block" onClick={() => { setCt(emptyContract(e)); setCtFiles([]) }}>+ {T('Thêm hợp đồng', 'Vertrag hinzufügen')}</button>
          </div>
        )}

        {isNew && <button className="primary block" disabled={busy} onClick={save}>{busy ? '…' : T('Lưu', 'Speichern')}</button>}
        {!isNew && (
          <div className="row" style={{ marginTop: 10 }}>
            {active
              ? <button className="grow" onClick={() => setExitF({ date: todayIso(), reason: '' })}>{T('Nghỉ việc / huỷ hợp đồng', 'Austritt / Kündigung')}</button>
              : <button className="grow" onClick={() => saveExit(null, null)}>{T('Đi làm lại', 'Wieder aktiv')}</button>}
            <button className="danger" onClick={delEmployee}>{T('Xoá hồ sơ', 'Akte löschen')}</button>
          </div>
        )}
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
                <button className="ghost grow" style={{ justifyContent: 'flex-start' }} onClick={() => openHrFile(p)}>📎 {T('File', 'Datei')} {i + 1}</button>
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

      <Sheet open={!!ed} onClose={() => setEd(null)} title={ed ? labelOf[ed.keys[0]] : ''}>
        {ed && <>
          {ed.keys.map((k) => (k !== 'residence_permit_until' || !permitInfo(ed.draft.residence_permit ?? null)?.[3]) && <F key={k} l={labelOf[k] || k}>{edInput(k)}</F>)}
          <button className="primary block" onClick={saveEd}>{T('Lưu', 'Speichern')}</button>
        </>}
      </Sheet>

      <Sheet open={!!exitF} onClose={() => setExitF(null)} title={T('Nghỉ việc / huỷ hợp đồng', 'Austritt / Kündigung')}>
        {exitF && <>
          <F l={L('Ngày làm việc cuối', 'Austrittsdatum')}><DateField value={exitF.date} onChange={(d) => setExitF({ ...exitF, date: d })} /></F>
          <F l={L('Lý do', 'Grund')}><input value={exitF.reason} onChange={(ev) => setExitF({ ...exitF, reason: ev.target.value })} placeholder={T('Nhân viên xin nghỉ, hết hạn hợp đồng…', 'Eigenkündigung, Befristung…')} /></F>
          <p className="small muted">{T('Sau ngày này nhân viên chuyển sang mục "Đã nghỉ". Hồ sơ và giấy tờ vẫn được giữ.', 'Danach erscheint die Person unter „Ausgeschieden". Akte und Dokumente bleiben erhalten.')}</p>
          <button className="primary block" onClick={() => saveExit(exitF.date, exitF.reason.trim() || null)}>{T('Lưu', 'Speichern')}</button>
        </>}
      </Sheet>
    </>
  )
}
