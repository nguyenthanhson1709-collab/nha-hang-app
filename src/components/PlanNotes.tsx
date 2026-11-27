// Ghi chú xếp lịch của tháng: ai nghỉ phép, ốm, xin nghỉ ngày nào. Lưu vào nh_absences để bộ xếp lịch,
// Tổng hợp và hồ sơ nhân viên cùng dùng. Urlaub/Krank/Unbezahlt tính vào số ngày của tuần; Wunschfrei chỉ không xếp ca.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './ui'
import { dmy } from '../lib/format'
import type { Vacation } from '../lib/hrTime'
import type { Employee } from '../lib/hr'

type Emp = Employee & { id: string }
const KINDS: { k: string; de: string; vi: string }[] = [
  { k: 'vacation', de: 'Urlaub', vi: 'Nghỉ phép (Urlaub)' },
  { k: 'sick', de: 'Krank', vi: 'Ốm (Krank)' },
  { k: 'other', de: 'Wunschfrei', vi: 'Xin nghỉ ngày đó (Wunschfrei)' },
  { k: 'unpaid', de: 'Unbezahlt', vi: 'Nghỉ không lương' },
]
type Form = { id?: string; employee_id: string; kind: string; from: string; to: string; note: string }

export default function PlanNotes({ rid, ym, emps, abs, de, onChanged }: {
  rid: string; ym: string; emps: Emp[]; abs: Vacation[]; de: boolean; onChanged?: () => void
}) {
  const T = (vi: string, g: string) => (de ? g : vi)
  const first = `${ym}-01`
  const blank = (): Form => ({ employee_id: '', kind: 'vacation', from: first, to: first, note: '' })
  const [f, setF] = useState<Form>(blank)
  const [busy, setBusy] = useState(false)
  const name = (id: string) => { const e = emps.find((x) => x.id === id); return e ? `${(e.personnel_no || '').replace(/^0+(?=\d)/, '')} ${e.first_name || ''} ${e.last_name || ''}`.trim() : '—' }
  const kindLabel = (k: string) => { const x = KINDS.find((y) => y.k === k); return x ? (de ? x.de : x.vi) : k }
  const list = [...abs].filter((a) => a.id).sort((a, b) => a.from_date.localeCompare(b.from_date) || name(a.employee_id).localeCompare(name(b.employee_id)))

  async function save() {
    if (!f.employee_id) { toast(T('Chọn nhân viên', 'Mitarbeiter wählen')); return }
    if (!f.from || !f.to || f.to < f.from) { toast(T('Ngày đến phải sau ngày bắt đầu', 'Bis-Datum muss nach dem Von-Datum liegen')); return }
    setBusy(true)
    const row = { employee_id: f.employee_id, kind: f.kind, from_date: f.from, to_date: f.to, note: f.note.trim() || null }
    const { error } = f.id
      ? await supabase.from('nh_absences').update(row).eq('id', f.id).eq('restaurant_id', rid)
      : await supabase.from('nh_absences').insert({ restaurant_id: rid, ...row })
    setBusy(false)
    if (error) { toast(error.message); return }
    setF(blank()); onChanged?.()
  }
  async function remove(id: string) {
    setBusy(true)
    const { error } = await supabase.from('nh_absences').delete().eq('id', id).eq('restaurant_id', rid)
    setBusy(false)
    if (error) { toast(error.message); return }
    if (f.id === id) setF(blank())
    onChanged?.()
  }

  return (
    <div className="card pn">
      <h3>{T('Ghi chú xếp lịch', 'Hinweise für den Dienstplan')} · {ym.slice(5, 7)}/{ym.slice(0, 4)}</h3>
      <p className="small muted">{T('Ghi ai nghỉ phép, ốm hoặc xin nghỉ ngày nào. Khi bấm Xếp lịch, những ngày này không bị xếp ca. Phép và ốm vẫn tính vào số ngày làm của tuần.',
        'Urlaub, Krankheit oder Wunschfrei eintragen. Beim Erstellen des Dienstplans werden diese Tage nicht verplant; Urlaub und Krankheit zählen als Arbeitstage der Woche.')}</p>
      {list.length > 0 && (
        <div className="pl-scroll"><table className="pl-sum pn-tab">
          <thead><tr><th className="l">{T('Nhân viên', 'Mitarbeiter')}</th><th className="l">{T('Loại', 'Art')}</th><th className="l">{T('Từ', 'Von')}</th><th className="l">{T('Đến', 'Bis')}</th><th className="l">{T('Ghi chú', 'Notiz')}</th><th /></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id} className={f.id === a.id ? 'sel' : ''} onClick={() => setF({ id: a.id, employee_id: a.employee_id, kind: a.kind, from: a.from_date, to: a.to_date, note: a.note || '' })}>
              <td className="l">{name(a.employee_id)}</td><td className={`l pn-k ${a.kind}`}>{kindLabel(a.kind)}</td>
              <td className="l">{dmy(a.from_date)}</td><td className="l">{dmy(a.to_date)}</td><td className="l">{a.note || ''}</td>
              <td><button className="pn-del" disabled={busy} aria-label={T('Xoá', 'Löschen')} onClick={(ev) => { ev.stopPropagation(); remove(a.id!) }}>✕</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="pn-form">
        <select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} aria-label={T('Nhân viên', 'Mitarbeiter')}>
          <option value="">{T('— Nhân viên —', '— Mitarbeiter —')}</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{name(e.id)}</option>)}
        </select>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label={T('Loại', 'Art')}>
          {KINDS.map((k) => <option key={k.k} value={k.k}>{de ? k.de : k.vi}</option>)}
        </select>
        <label><span>{T('Từ', 'Von')}</span><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} /></label>
        <label><span>{T('Đến', 'Bis')}</span><input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <input className="pn-note" placeholder={T('Ghi chú (tuỳ chọn)', 'Notiz (optional)')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        <button className="st-btn primary" disabled={busy} onClick={save}>{f.id ? T('Lưu', 'Speichern') : T('Thêm', 'Hinzufügen')}</button>
        {f.id && <button className="st-btn" disabled={busy} onClick={() => setF(blank())}>{T('Huỷ', 'Abbrechen')}</button>}
      </div>
    </div>
  )
}
