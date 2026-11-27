import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './ui'
import { dmy } from '../lib/format'
import { isActive, type Employee } from '../lib/hr'
import { monthDates, monthStat, noSurcharge, vacDays, type Shift, type Vacation } from '../lib/hrTime'
import PlanNotes from './PlanNotes'
import { buildSchedule, defaultSun, SUN_RULES, type SchedEmp, type SchedResult, type SunRule } from '../lib/scheduler'

/**
 * Lịch làm nhân viên (Mitarbeiterliste je Monat): bảng theo tháng giống file Excel gửi văn phòng lương.
 * Ô được tự điền từ hồ sơ nhân viên và lịch làm (ca, phép); ô nào cũng sửa được, giá trị sửa lưu riêng cho tháng
 * trong nh_staff_month.data (xoá trống = quay về giá trị tự tính). Anrede, Fahrgeld, Gutschein lấy lại từ tháng trước.
 */
type Emp = Employee & { id: string }
type St = ReturnType<typeof monthStat> & { rest: number | null }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
type Col = { k: string; de: string; vi: string; w?: number; num?: boolean; sticky?: boolean; check?: boolean; noXlsx?: boolean; mon?: boolean; opts?: string[]; auto?: (e: Emp, st: St) => string }
const n = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))
const h = (m: number) => (m ? n(Math.round((m / 60) * 100) / 100) : '')
const COLS: Col[] = [
  { k: 'pnr', de: 'Personal-Nr.', vi: 'Mã NV', w: 70, auto: (e) => (e.personnel_no || '').replace(/^0+(?=\d)/, '') },
  { k: 'anrede', de: 'Anrede', vi: 'Danh xưng', w: 80, sticky: true, opts: ['Herr', 'Frau'] },
  { k: 'name', de: 'Name', vi: 'Họ', w: 110, auto: (e) => e.last_name || '' },
  { k: 'vorname', de: 'Vorname', vi: 'Tên', w: 130, auto: (e) => e.first_name || '' },
  { k: 'tag', de: 'tägliche Arbeitszeit', vi: 'Giờ / ngày', w: 70, num: true, auto: (e) => n(e.daily_hours) },
  { k: 'tage', de: 'Arbeitstage pro Woche', vi: 'Ngày / tuần', w: 70, num: true, auto: (e) => n(e.work_days) },
  { k: 'woche', de: 'wöchentl. Std', vi: 'Giờ / tuần', w: 70, num: true, auto: (e) => n(e.weekly_hours) },
  { k: 'entgelt', de: 'Entgelt', vi: 'Lương', w: 80, num: true, auto: (e) => n(e.gross_monthly ?? e.hourly_wage) },
  { k: 'eintritt', de: 'Eintritt', vi: 'Ngày vào', w: 90, auto: (e) => (e.entry_date ? dmy(e.entry_date) : '') },
  { k: 'austritt', de: 'Austritt', vi: 'Ngày nghỉ', w: 90, auto: (e) => (e.exit_date ? dmy(e.exit_date) : '') },
  { k: 'nacht', mon: true, de: 'Nachtzuschlag (Std)', vi: 'Giờ đêm', w: 70, num: true, auto: (_e, s) => h(s.night) },
  { k: 'sonntag', mon: true, de: 'Sonntagszuschlag (Std)', vi: 'Giờ Chủ nhật', w: 70, num: true, auto: (_e, s) => h(s.sun) },
  { k: 'feiertag', mon: true, de: 'Feiertagszuschlag (Std)', vi: 'Giờ ngày lễ', w: 70, num: true, auto: (_e, s) => h(s.hol) },
  { k: 'fahrgeld', de: 'Fahrgeld', vi: 'Tiền đi lại', w: 70, sticky: true, opts: ['ja', 'nein'] },
  { k: 'urlaub', mon: true, de: 'Urlaubstage', vi: 'Ngày phép tháng', w: 70, num: true, auto: (_e, s) => (s.vac ? String(s.vac) : '') },
  { k: 'gutschein', mon: true, de: 'Gutschein 50€', vi: 'Gutschein 50€', w: 70, check: true },
  { k: 'bank', de: 'Bank', vi: 'Ngân hàng / IBAN', w: 210, auto: (e) => e.iban || e.bank_name || '' },
  { k: 'jahresurlaub', de: 'Jahresurlaub', vi: 'Phép năm', w: 70, num: true, auto: (e) => n(e.vacation_year) },
  { k: 'resturlaub', mon: true, de: 'Resturlaub', vi: 'Phép còn lại', w: 70, num: true, auto: (_e, s) => n(s.rest) },
  { k: 'anwesend', mon: true, de: 'Anwesenheitstage', vi: 'Ngày đi làm', w: 70, num: true, auto: (_e, s) => (s.days ? String(s.days) : '') },
  { k: 'ist', mon: true, de: 'Ist-Std gesamt', vi: 'Tổng giờ', w: 70, num: true, auto: (_e, s) => h(s.ist) },
  // Quy tắc Chủ nhật cho bộ xếp lịch: không hiện trong bảng, không xuất Excel (vẫn lưu theo tháng)
  { k: 'sonntagsregel', de: 'Sonntage', vi: 'Quy tắc Chủ nhật', w: 80, sticky: true, noXlsx: true, opts: SUN_RULES, auto: (e) => defaultSun(e.work_days) },
]
const XCOLS = COLS.filter((c) => !c.noXlsx)
const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
type Data = Record<string, string>

export default function StaffMonth({ rid, ym, emps, shifts, abs, company, de, onSaved }: {
  rid: string; ym: string; emps: Emp[]; shifts: Shift[]; abs: Vacation[]; company: string; de: boolean; onSaved?: () => void
}) {
  const T = (vi: string, g: string) => (de ? g : vi)
  const [saved, setSaved] = useState<Record<string, Data> | null>(null)
  const [prev, setPrev] = useState<Record<string, Data>>({})
  const [last, setLast] = useState<Record<string, Data>>({})   // dữ liệu tháng trước, để đánh dấu ô thay đổi
  const [showPay, setShowPay] = useState(false)
  const [edit, setEdit] = useState<{ id: string; k: string; v: string } | null>(null)
  const [plan, setPlan] = useState<(SchedResult & { from: string; replace: number }) | null>(null)
  const [busy, setBusy] = useState(false)
  // Ngày phép đã ghi (cả năm) để tính Phép còn lại đến hết tháng đang xem
  const [yv, setYv] = useState<{ employee_id: string; from_date: string; to_date: string }[]>([])
  useEffect(() => {
    const y = ym.slice(0, 4)
    supabase.from('nh_absences').select('employee_id,from_date,to_date').eq('restaurant_id', rid).eq('kind', 'vacation')
      .gte('to_date', `${Number(y) - 1}-12-01`).lte('from_date', `${Number(y) + 1}-01-31`).limit(5000)
      .then(({ data }) => setYv((data || []) as { employee_id: string; from_date: string; to_date: string }[]))
  }, [rid, ym, abs])

  // Bảng rộng: dùng hết chiều rộng màn hình máy tính
  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('xfull'); return () => el?.classList.remove('xfull') }, [])
  useEffect(() => {
    setSaved(null)
    supabase.from('nh_staff_month').select('employee_id,ym,data').eq('restaurant_id', rid).lte('ym', ym).order('ym').limit(5000).then(({ data, error }) => {
      if (error) { toast(error.message); setSaved({}); return }
      const cur: Record<string, Data> = {}, before: Record<string, Data> = {}, lm: Record<string, Data> = {}
      const pd = new Date(`${ym}-01T12:00:00`); pd.setMonth(pd.getMonth() - 1)
      const pym = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`
      for (const r of (data || []) as { employee_id: string; ym: string; data: Data }[]) {
        if (r.ym === pym) lm[r.employee_id] = r.data || {}
        if (r.ym === ym) cur[r.employee_id] = r.data || {}
        // Anrede / Fahrgeld / Gutschein: giá trị gần nhất của các tháng trước
        else for (const c of COLS) if (c.sticky && r.data?.[c.k] != null) (before[r.employee_id] ||= {})[c.k] = r.data[c.k]
      }
      setSaved(cur); setPrev(before); setLast(lm)
    })
  }, [rid, ym])

  const rows = useMemo(() => {
    const dates = monthDates(ym), first = dates[0], last = dates.at(-1)!
    return emps
      .filter((e) => shifts.some((s) => s.employee_id === e.id) || ((!e.entry_date || e.entry_date <= last) && isActive(e, first)))
      .map((e) => {
        const sh = shifts.filter((s) => s.employee_id === e.id)
        // Resturlaub = Resturlaub trong hồ sơ (tính đến hết tháng vacation_as_of) − ngày phép sau đó đến hết tháng này
        // (tháng trước tháng hồ sơ: cộng lại ngày phép từ sau tháng này đến tháng hồ sơ)
        let rest: number | null = e.vacation_left == null ? null : Number(e.vacation_left)
        if (rest != null) {
          const a0 = e.vacation_as_of ? monthDates(e.vacation_as_of).at(-1)! : last
          const lo = a0 < last ? a0 : last, hi = a0 < last ? last : a0, sign = a0 < last ? -1 : 1
          const ds = new Set<string>()
          for (const v of yv) if (v.employee_id === e.id) for (let d = new Date(`${v.from_date}T12:00:00`); iso(d) <= v.to_date; d.setDate(d.getDate() + 1)) { const k = iso(d); if (k > lo && k <= hi) ds.add(k) }
          rest += sign * ds.size
        }
        return { e, st: { ...monthStat(sh, vacDays(abs.filter((a) => a.employee_id === e.id), ym), noSurcharge(e)), rest } }
      })
      .sort((a, b) => (a.e.personnel_no || '').localeCompare(b.e.personnel_no || ''))
  }, [emps, shifts, abs, ym, yv])

  const val = (e: Emp, st: St, c: Col) => {
    const o = saved?.[e.id]?.[c.k]
    if (o != null) return { v: o, own: true }
    if (c.sticky) return { v: prev[e.id]?.[c.k] ?? (c.auto ? c.auto(e, st) : ''), own: false }
    return { v: c.auto ? c.auto(e, st) : '', own: false }
  }

  // So với tháng trước: ô khác giá trị tháng trước được tô nền; nhân viên vào làm trong tháng này tô cả dòng
  const changed = (e: Emp, st: St, c: Col, v: string) => {
    if (c.mon || c.check || c.noXlsx) return false
    const was = c.sticky ? (prev[e.id]?.[c.k] ?? (c.auto ? c.auto(e, st) : '')) : (last[e.id]?.[c.k] ?? (c.auto ? c.auto(e, st) : ''))
    return v.trim() !== was.trim()
  }
  const isNew = (e: Emp) => !!e.entry_date && e.entry_date >= `${ym}-01`

  async function commit(e: Emp, st: St, c: Col, raw: string) {
    setEdit(null)
    const v = raw.trim()
    const base = c.sticky ? (prev[e.id]?.[c.k] ?? (c.auto ? c.auto(e, st) : '')) : c.auto ? c.auto(e, st) : ''
    const cur = { ...(saved?.[e.id] || {}) }
    if (v === base && !(c.sticky && v)) delete cur[c.k]; else cur[c.k] = v
    if (JSON.stringify(cur) === JSON.stringify(saved?.[e.id] || {})) return
    setSaved((s) => ({ ...(s || {}), [e.id]: cur }))
    const { error } = await supabase.from('nh_staff_month').upsert({ restaurant_id: rid, employee_id: e.id, ym, data: cur, updated_at: new Date().toISOString() })
    if (error) toast(error.message)
  }

  // Xếp lịch tự động: tháng tới xếp cả tháng, tháng đang chạy xếp từ ngày mai (ca trước đó giữ nguyên)
  const canPlan = ym >= ymNow()
  async function makePlan() {
    setBusy(true)
    const dates = monthDates(ym), first = dates[0], last = dates.at(-1)!
    const tm = new Date(); tm.setDate(tm.getDate() + 1)
    const from = isoDay(tm) > first ? isoDay(tm) : first
    if (from > last) { setBusy(false); return }
    const back = new Date(`${first}T12:00:00`); back.setDate(back.getDate() - 14)
    const [{ data, error }, cl] = await Promise.all([
      supabase.from('nh_shifts').select('employee_id,shift_date,start_time,end_time').eq('restaurant_id', rid).gte('shift_date', isoDay(back)).lt('shift_date', from).limit(5000),
      supabase.from('nh_closed_days').select('day').eq('restaurant_id', rid).gte('day', first).lte('day', last),
    ])
    setBusy(false)
    if (error || cl.error) { toast((error || cl.error)!.message); return }
    const closed = (cl.data || []).map((x: { day: string }) => x.day)
    const vac: Record<string, Set<string>> = {}
    // Urlaub / Krank / Unbezahlt: tính vào số ngày của tuần; Wunschfrei (other): chỉ không xếp ca
    const off: Record<string, Set<string>> = {}
    for (const a of abs) for (const d of dates) if (d >= a.from_date && d <= a.to_date) ((a.kind === 'other' ? off : vac)[a.employee_id] ||= new Set()).add(d)
    // Lấy đúng số trong bảng (giờ/ngày, ngày/tuần, ngày vào, ngày nghỉ); ô đã sửa trong tháng được ưu tiên hơn hồ sơ
    const col = (k: string) => COLS.find((c) => c.k === k)!
    const num = (x: string) => { const v = Number(x.replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : 0 }
    const isoOf = (x: string) => { const m = x.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(x.trim()) ? x.trim() : null }
    const list: SchedEmp[] = [], missing: string[] = []
    for (const { e, st } of rows) {
      const hours = num(val(e, st, col('tag')).v), days = num(val(e, st, col('tage')).v)
      const name = `${(e.personnel_no || '').replace(/^0+(?=\d)/, '')} ${e.first_name || ''} ${e.last_name || ''}`.trim()
      if (!hours || !days) { missing.push(name); continue }
      list.push({ id: e.id, name, hours, days, entry: isoOf(val(e, st, col('eintritt')).v), exit: isoOf(val(e, st, col('austritt')).v),
        sun: (val(e, st, col('sonntagsregel')).v || defaultSun(days)) as SunRule })
    }
    // Phép còn lại chưa ghi chú = cột Resturlaub (đã trừ phép ghi đến hết tháng này).
    // Tháng 12 hoặc tháng nghỉ việc: xếp hết; tháng khác: chia đều cho các tháng còn lại trong năm.
    const autoVac: Record<string, number> = {}
    for (const se of list) {
      const x = rows.find((r0) => r0.e.id === se.id)!
      const rest = Math.floor(Number(val(x.e, x.st, col('resturlaub')).v.replace(',', '.')))
      if (!Number.isFinite(rest) || rest <= 0) continue
      const mo = Number(ym.slice(5, 7)), exitHere = !!se.exit && se.exit <= last
      autoVac[se.id] = mo === 12 || exitHere ? rest : Math.round(rest / (13 - mo))
    }
    const r = buildSchedule(ym, list, vac, (data || []) as never, { from, off, closed, autoVac })
    if (missing.length) r.warnings.unshift(T(`Chưa có giờ/ngày hoặc ngày/tuần, không xếp: ${missing.join(', ')}`, `Ohne Std./Tag oder Tage/Woche, nicht eingeplant: ${missing.join(', ')}`))
    setPlan({ ...r, from, replace: shifts.filter((s) => s.shift_date >= from).length })
  }
  async function savePlan() {
    if (!plan) return
    setBusy(true)
    const last = monthDates(ym).at(-1)!
    const del = await supabase.from('nh_shifts').delete().eq('restaurant_id', rid).gte('shift_date', plan.from).lte('shift_date', last)
    if (del.error) { setBusy(false); toast(del.error.message); return }
    // Phép tự xếp: ghi vào nh_absences (gộp các ngày liền nhau)
    const absIns: { restaurant_id: string; employee_id: string; kind: string; from_date: string; to_date: string; note: string }[] = []
    for (const [eid, ds] of Object.entries(plan.autoVac)) for (const d of ds) {
      const prevRow = absIns.at(-1), y = new Date(`${d}T12:00:00`); y.setDate(y.getDate() - 1)
      if (prevRow && prevRow.employee_id === eid && prevRow.to_date === isoDay(y)) prevRow.to_date = d
      else absIns.push({ restaurant_id: rid, employee_id: eid, kind: 'vacation', from_date: d, to_date: d, note: 'Urlaub (automatisch geplant)' })
    }
    if (absIns.length) { const { error } = await supabase.from('nh_absences').insert(absIns); if (error) { setBusy(false); toast(error.message); return } }
    const rowsIns = plan.shifts.map((s) => ({ restaurant_id: rid, ...s }))
    for (let i = 0; i < rowsIns.length; i += 500) {
      const { error } = await supabase.from('nh_shifts').insert(rowsIns.slice(i, i + 500))
      if (error) { setBusy(false); toast(error.message); return }
    }
    setBusy(false); setPlan(null)
    toast(T(`Đã lưu ${rowsIns.length} ca`, `${rowsIns.length} Schichten gespeichert`))
    onSaved?.()
  }

  async function exportXlsx() {
    // xlsx-js-style: bản SheetJS ghi được màu nền. Dòng có thay đổi so với tháng trước: nền cam (ô thay đổi đậm hơn);
    // nhân viên mới: nền xanh cả dòng
    const XLSX = (await import('xlsx-js-style')).default
    const title = `${company} ${ym.slice(5, 7)}/${ym.slice(2, 4)}`
    const aoa: (string | number)[][] = [[title], XCOLS.map((c) => c.de)]
    const marks: { row: 'new' | 'chg' | null; cells: boolean[] }[] = []
    for (const { e, st } of rows) {
      const cells = XCOLS.map((c) => !isNew(e) && changed(e, st, c, val(e, st, c).v))
      marks.push({ row: isNew(e) ? 'new' : cells.some(Boolean) ? 'chg' : null, cells })
      aoa.push(XCOLS.map((c) => { const { v } = val(e, st, c); const x = c.num && v ? Number(v.replace(',', '.')) : NaN; return Number.isFinite(x) ? x : v }))
    }
    if (marks.some((m) => m.row)) aoa.push([], ['Orange: Änderung gegenüber Vormonat · Grün: neuer Mitarbeiter'])
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const fill = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } })
    const thin = { style: 'thin', color: { rgb: 'BFBFBF' } }
    const border = { top: thin, bottom: thin, left: thin, right: thin }
    XCOLS.forEach((_c, ci) => { const h = ws[XLSX.utils.encode_cell({ r: 1, c: ci })]; if (h) h.s = { font: { bold: true }, alignment: { wrapText: true, vertical: 'center' }, border, fill: fill('EDEDED') } })
    const t = ws[XLSX.utils.encode_cell({ r: 0, c: 0 })]; if (t) t.s = { font: { bold: true, sz: 13 } }
    marks.forEach((m, ri) => XCOLS.forEach((_c, ci) => {
      const ref = XLSX.utils.encode_cell({ r: ri + 2, c: ci })
      const cell = ws[ref] || (ws[ref] = { t: 's', v: '' })
      cell.s = { border, ...(m.row === 'new' ? { fill: fill('C6EFCE') } : m.row === 'chg' ? { fill: fill(m.cells[ci] ? 'FFC000' : 'FFE5B4'), font: { bold: m.cells[ci] } } : {}) }
    }))
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: XCOLS.length - 1 } }]
    ws['!cols'] = XCOLS.map((c) => ({ wch: Math.max(8, Math.round((c.w || 70) / 7)) }))
    ws['!rows'] = [{ hpt: 20 }, { hpt: 42 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `${ym.slice(5, 7)}-${ym.slice(2, 4)}`)
    XLSX.writeFile(wb, `Mitarbeiterliste_${ym.slice(5, 7)}-${ym.slice(0, 4)}.xlsx`)
  }


  if (!saved) return <div className="card muted">…</div>
  return (
    <>
      <div className="sm-bar">
        {canPlan && <button className="st-btn primary" disabled={busy || !rows.length} onClick={makePlan}>{busy && !plan ? '…' : T('Xếp lịch', 'Dienstplan erstellen')}</button>}
        <span className="small muted">{T('Ô tự điền từ hồ sơ và lịch làm. Bấm vào ô để sửa; ô đã sửa có vạch cam bên trái, xoá trống để quay về giá trị tự tính. Nền cam: khác tháng trước; dòng nền xanh: nhân viên mới.', 'Felder werden aus Personalakte und Dienstplan übernommen. Zum Ändern anklicken; geänderte Felder sind orange markiert, leeren = automatischer Wert. Orange hinterlegt: anders als Vormonat; grüne Zeile: neuer Mitarbeiter.')}</span>
        <button className="st-btn" disabled={!rows.length} onClick={exportXlsx}>Excel</button>
      </div>
      {!rows.length ? <div className="card muted">{T('Tháng này chưa có nhân viên', 'Keine Mitarbeiter in diesem Monat')}</div> : (
        <div className="pl-scroll">
          <table className="pl-sum sm-tab">
            <thead><tr>{XCOLS.map((c) => c.k === 'entgelt' ? (
              // Bấm tiêu đề Entgelt để hiện / làm mờ lương
              <th key={c.k} lang="de" className="sm-pay" role="button" tabIndex={0} title={showPay ? T('Làm mờ lương', 'Entgelt ausblenden') : T('Hiện lương', 'Entgelt anzeigen')}
                onClick={() => setShowPay(!showPay)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setShowPay(!showPay) } }}>
                {c.de} <span aria-hidden>{showPay ? '🙈' : '👁'}</span>{!de && <small>{c.vi}</small>}</th>
            ) : <th key={c.k} lang="de" className={c.num ? '' : 'l'} style={{ minWidth: c.num ? undefined : Math.round((c.w || 70) * 0.8) }}>{c.de}{!de && <small>{c.vi}</small>}</th>)}</tr></thead>
            <tbody>
              {rows.map(({ e, st }) => (
                <tr key={e.id} className={isNew(e) ? 'new' : XCOLS.some((c) => changed(e, st, c, val(e, st, c).v)) ? 'chgrow' : ''}>
                  {XCOLS.map((c) => {
                    const { v, own } = val(e, st, c)
                    const editing = edit?.id === e.id && edit.k === c.k
                    const cls = `${c.num ? '' : 'l'}${own ? ' own' : ''}${!isNew(e) && changed(e, st, c, v) ? ' chg' : ''}`
                    if (editing) return (
                      <td key={c.k} className={`${cls} ed`}>
                        {c.opts ? (
                          <select autoFocus value={edit.v} onChange={(ev) => commit(e, st, c, ev.target.value)} onBlur={() => setEdit(null)}>
                            <option value="">—</option>{c.opts.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input autoFocus inputMode={c.num ? 'decimal' : undefined} value={edit.v} onChange={(ev) => setEdit({ ...edit, v: ev.target.value })}
                            onBlur={() => commit(e, st, c, edit.v)} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setEdit(null) }} />
                        )}
                      </td>)
                    // Gutschein: ô tích, mỗi tháng bắt đầu trống; tích = V
                    if (c.check) return (
                      <td key={c.k} className="sm-chk" onClick={() => commit(e, st, c, v ? '' : 'V')}>
                        <span className={`pick-box${v ? ' on' : ''}`} role="checkbox" aria-checked={!!v} aria-label={c.de}>{v && '✓'}</span>
                      </td>)
                    return (
                      <td key={c.k} className={cls} onClick={() => setEdit({ id: e.id, k: c.k, v })}>
                        <span className={c.k === 'entgelt' && v && !showPay ? 'masked' : ''}>{c.k === 'bank' && /^[A-Z]{2}\d/.test(v) ? v.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() : v}</span>
                      </td>)
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PlanNotes rid={rid} ym={ym} emps={rows.map((x) => x.e)} abs={abs} de={de} onChanged={onSaved} />
      {plan && (
        <div className="sheet-bg" onClick={(ev) => { if (ev.target === ev.currentTarget && !busy) setPlan(null) }}>
          <div className="sheet sched">
            <h3>{T('Lịch tự xếp', 'Dienstplan-Vorschlag')} · {ym.slice(5, 7)}/{ym.slice(0, 4)}</h3>
            <p className="small muted">{T(`Từ ${plan.from.slice(8)}.${plan.from.slice(5, 7)}: ${plan.shifts.length} ca. Chưa đủ người so với mục tiêu: ${String(plan.gapHours).replace('.', ',')} giờ-người.`,
              `Ab ${plan.from.slice(8)}.${plan.from.slice(5, 7)}: ${plan.shifts.length} Schichten. Unterbesetzung gegenüber Ziel: ${String(plan.gapHours).replace('.', ',')} Personenstunden.`)}</p>
            {plan.replace > 0 && <p className="small warn">{T(`${plan.replace} ca đã có trong khoảng này sẽ được thay bằng lịch mới.`, `${plan.replace} vorhandene Schichten in diesem Zeitraum werden ersetzt.`)}</p>}
            {plan.warnings.length > 0 && <ul className="small warn">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            <table className="pl-sum">
              <thead><tr><th className="l">{T('Nhân viên', 'Mitarbeiter')}</th><th>{T('Ngày', 'Tage')}</th><th>{T('Giờ', 'Std')}</th><th>{T('Phép tự xếp', 'Urlaub geplant')}</th></tr></thead>
              <tbody>{rows.filter(({ e }) => plan.perEmp[e.id]).map(({ e }) => { const p = plan.perEmp[e.id]; return (
                <tr key={e.id}><td className="l">{(e.personnel_no || '').replace(/^0+(?=\d)/, '')} {e.first_name} {e.last_name}</td>
                  <td className={p.days < p.need ? 'warn' : ''}>{p.days}{p.days < p.need ? ` / ${p.need}` : ''}</td><td>{n(Math.round(p.minutes / 6) / 10)}</td>
                  <td className="l small">{(plan.autoVac[e.id] || []).length ? `${plan.autoVac[e.id].length}: ${plan.autoVac[e.id].map((d) => d.slice(8)).join(', ')}.${ym.slice(5, 7)}` : ''}</td></tr>) })}</tbody>
            </table>
            <div className="sched-f">
              <button className="st-btn" disabled={busy} onClick={() => setPlan(null)}>{T('Huỷ', 'Abbrechen')}</button>
              <button className="st-btn primary" disabled={busy || !plan.shifts.length} onClick={savePlan}>{busy ? '…' : T('Lưu vào lịch', 'In Dienstplan übernehmen')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
