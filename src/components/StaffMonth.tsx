import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './ui'
import { dmy } from '../lib/format'
import { isActive, type Employee } from '../lib/hr'
import { monthDates, monthStat, vacDays, type Shift, type Vacation } from '../lib/hrTime'

/**
 * Lịch làm nhân viên (Mitarbeiterliste je Monat): bảng theo tháng giống file Excel gửi văn phòng lương.
 * Ô được tự điền từ hồ sơ nhân viên và lịch làm (ca, phép); ô nào cũng sửa được, giá trị sửa lưu riêng cho tháng
 * trong nh_staff_month.data (xoá trống = quay về giá trị tự tính). Anrede, Fahrgeld, Gutschein lấy lại từ tháng trước.
 */
type Emp = Employee & { id: string }
type Col = { k: string; de: string; vi: string; w?: number; num?: boolean; sticky?: boolean; opts?: string[]; auto?: (e: Emp, st: ReturnType<typeof monthStat>) => string }
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
  { k: 'nacht', de: 'Nachtzuschlag (Std)', vi: 'Giờ đêm', w: 70, num: true, auto: (_e, s) => h(s.night) },
  { k: 'sonntag', de: 'Sonntagszuschlag (Std)', vi: 'Giờ Chủ nhật', w: 70, num: true, auto: (_e, s) => h(s.sun) },
  { k: 'feiertag', de: 'Feiertagszuschlag (Std)', vi: 'Giờ ngày lễ', w: 70, num: true, auto: (_e, s) => h(s.hol) },
  { k: 'fahrgeld', de: 'Fahrgeld', vi: 'Tiền đi lại', w: 70, sticky: true, opts: ['ja', 'nein'] },
  { k: 'urlaub', de: 'Urlaubstage', vi: 'Ngày phép tháng', w: 70, num: true, auto: (_e, s) => (s.vac ? String(s.vac) : '') },
  { k: 'gutschein', de: 'Gutschein 50€', vi: 'Gutschein 50€', w: 70, sticky: true },
  { k: 'bank', de: 'Bank', vi: 'Ngân hàng / IBAN', w: 210, auto: (e) => e.iban || e.bank_name || '' },
  { k: 'jahresurlaub', de: 'Jahresurlaub', vi: 'Phép năm', w: 70, num: true, auto: (e) => n(e.vacation_year) },
  { k: 'resturlaub', de: 'Resturlaub', vi: 'Phép còn lại', w: 70, num: true, auto: (e) => n(e.vacation_left) },
  { k: 'anwesend', de: 'Anwesenheitstage', vi: 'Ngày đi làm', w: 70, num: true, auto: (_e, s) => (s.days ? String(s.days) : '') },
  { k: 'ist', de: 'Ist-Std gesamt', vi: 'Tổng giờ', w: 70, num: true, auto: (_e, s) => h(s.ist) },
]
type Data = Record<string, string>

export default function StaffMonth({ rid, ym, emps, shifts, abs, company, de }: {
  rid: string; ym: string; emps: Emp[]; shifts: Shift[]; abs: Vacation[]; company: string; de: boolean
}) {
  const T = (vi: string, g: string) => (de ? g : vi)
  const [saved, setSaved] = useState<Record<string, Data> | null>(null)
  const [prev, setPrev] = useState<Record<string, Data>>({})
  const [showPay, setShowPay] = useState(false)
  const [edit, setEdit] = useState<{ id: string; k: string; v: string } | null>(null)

  // Bảng rộng: dùng hết chiều rộng màn hình máy tính
  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('xfull'); return () => el?.classList.remove('xfull') }, [])
  useEffect(() => {
    setSaved(null)
    supabase.from('nh_staff_month').select('employee_id,ym,data').eq('restaurant_id', rid).lte('ym', ym).order('ym').limit(5000).then(({ data, error }) => {
      if (error) { toast(error.message); setSaved({}); return }
      const cur: Record<string, Data> = {}, before: Record<string, Data> = {}
      for (const r of (data || []) as { employee_id: string; ym: string; data: Data }[]) {
        if (r.ym === ym) cur[r.employee_id] = r.data || {}
        // Anrede / Fahrgeld / Gutschein: giá trị gần nhất của các tháng trước
        else for (const c of COLS) if (c.sticky && r.data?.[c.k] != null) (before[r.employee_id] ||= {})[c.k] = r.data[c.k]
      }
      setSaved(cur); setPrev(before)
    })
  }, [rid, ym])

  const rows = useMemo(() => {
    const dates = monthDates(ym), first = dates[0], last = dates.at(-1)!
    return emps
      .filter((e) => shifts.some((s) => s.employee_id === e.id) || ((!e.entry_date || e.entry_date <= last) && isActive(e, first)))
      .map((e) => {
        const sh = shifts.filter((s) => s.employee_id === e.id)
        return { e, st: monthStat(sh, vacDays(abs.filter((a) => a.employee_id === e.id), ym)) }
      })
      .sort((a, b) => (a.e.personnel_no || '').localeCompare(b.e.personnel_no || ''))
  }, [emps, shifts, abs, ym])

  const val = (e: Emp, st: ReturnType<typeof monthStat>, c: Col) => {
    const o = saved?.[e.id]?.[c.k]
    if (o != null) return { v: o, own: true }
    if (c.sticky) return { v: prev[e.id]?.[c.k] ?? '', own: false }
    return { v: c.auto ? c.auto(e, st) : '', own: false }
  }

  async function commit(e: Emp, st: ReturnType<typeof monthStat>, c: Col, raw: string) {
    setEdit(null)
    const v = raw.trim()
    const base = c.sticky ? (prev[e.id]?.[c.k] ?? '') : c.auto ? c.auto(e, st) : ''
    const cur = { ...(saved?.[e.id] || {}) }
    if (v === base && !(c.sticky && v)) delete cur[c.k]; else cur[c.k] = v
    if (JSON.stringify(cur) === JSON.stringify(saved?.[e.id] || {})) return
    setSaved((s) => ({ ...(s || {}), [e.id]: cur }))
    const { error } = await supabase.from('nh_staff_month').upsert({ restaurant_id: rid, employee_id: e.id, ym, data: cur, updated_at: new Date().toISOString() })
    if (error) toast(error.message)
  }

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const title = `${company} ${ym.slice(5, 7)}/${ym.slice(2, 4)}`
    const aoa: (string | number)[][] = [[title], COLS.map((c) => c.de)]
    for (const { e, st } of rows) aoa.push(COLS.map((c) => { const { v } = val(e, st, c); const x = c.num && v ? Number(v.replace(',', '.')) : NaN; return Number.isFinite(x) ? x : v }))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: COLS.length - 1 } }]
    ws['!cols'] = COLS.map((c) => ({ wch: Math.max(8, Math.round((c.w || 70) / 7)) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `${ym.slice(5, 7)}-${ym.slice(2, 4)}`)
    XLSX.writeFile(wb, `Mitarbeiterliste_${ym.slice(5, 7)}-${ym.slice(0, 4)}.xlsx`)
  }

  if (!saved) return <div className="card muted">…</div>
  return (
    <>
      <div className="sm-bar">
        <span className="small muted">{T('Ô tự điền từ hồ sơ và lịch làm. Bấm vào ô để sửa; ô đã sửa có vạch cam bên trái, xoá trống để quay về giá trị tự tính.', 'Felder werden aus Personalakte und Dienstplan übernommen. Zum Ändern anklicken; geänderte Felder sind orange markiert, leeren = automatischer Wert.')}</span>
        <button className="st-btn" onClick={() => setShowPay(!showPay)}>{showPay ? T('Ẩn lương', 'Entgelt ausblenden') : T('Xem lương', 'Entgelt anzeigen')}</button>
        <button className="st-btn" disabled={!rows.length} onClick={exportXlsx}>Excel</button>
      </div>
      {!rows.length ? <div className="card muted">{T('Tháng này chưa có nhân viên', 'Keine Mitarbeiter in diesem Monat')}</div> : (
        <div className="pl-scroll">
          <table className="pl-sum sm-tab">
            <thead><tr>{COLS.map((c) => <th key={c.k} lang="de" className={c.num ? '' : 'l'} style={{ minWidth: c.num ? undefined : Math.round((c.w || 70) * 0.8) }}>{c.de}{!de && <small>{c.vi}</small>}</th>)}</tr></thead>
            <tbody>
              {rows.map(({ e, st }) => (
                <tr key={e.id}>
                  {COLS.map((c) => {
                    const { v, own } = val(e, st, c)
                    const editing = edit?.id === e.id && edit.k === c.k
                    const cls = `${c.num ? '' : 'l'}${own ? ' own' : ''}`
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
    </>
  )
}
