// Ghi chú xếp lịch của tháng: ai nghỉ phép, ốm, xin nghỉ ngày nào. Lưu vào nh_absences để bộ xếp lịch,
// Tổng hợp và hồ sơ nhân viên cùng dùng. Urlaub/Krank/Unbezahlt tính vào số ngày của tuần; Wunschfrei chỉ không xếp ca.
// Ca cố định (nh_plan_fixed): ai làm ngày nào giờ nào, kể cả ngày đóng cửa. Khung chat: gõ tự nhiên, AI (nh-plan-chat) đổi thành ghi chú, người dùng bấm Lưu.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from './ui'
import { dmy } from '../lib/format'
import { monthDates, type Vacation } from '../lib/hrTime'
import type { Employee } from '../lib/hr'

type Emp = Employee & { id: string }
const KINDS: { k: string; de: string; vi: string }[] = [
  { k: 'vacation', de: 'Urlaub', vi: 'Nghỉ phép (Urlaub)' },
  { k: 'sick', de: 'Krank', vi: 'Ốm (Krank)' },
  { k: 'other', de: 'Wunschfrei', vi: 'Xin nghỉ ngày đó (Wunschfrei)' },
  { k: 'unpaid', de: 'Unbezahlt', vi: 'Nghỉ không lương' },
]
type Form = { id?: string; employee_id: string; kind: string; from: string; to: string; note: string }
type Fixed = { id: string; employee_id: string; day: string; start_time: string; end_time: string; note: string | null }
type Proposal = {
  reply: string
  absences: { employee_id: string; kind: string; from: string; to: string; note: string | null }[]
  closed_add: { day: string; note: string | null }[]
  closed_remove: string[]
  special_add: { day: string; from: string; to: string; note: string | null }[]
  special_remove: string[]
  fixed: { employee_id: string; day: string; start: string; end: string; note: string | null }[]
  delete_absence_ids: string[]
  delete_fixed_ids: string[]
}
type Msg = { role: 'user' | 'assistant'; text: string; p?: Proposal; done?: boolean }
const isDate = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x)
const isTime = (x: string) => /^([01]?\d|2[0-4]):[0-5]\d$/.test(x)
const t5 = (x: string) => x.slice(0, 5).replace(/^00:00$/, '24:00')

export default function PlanNotes({ rid, ym, emps, abs, de, onChanged }: {
  rid: string; ym: string; emps: Emp[]; abs: Vacation[]; de: boolean; onChanged?: () => void
}) {
  const T = (vi: string, g: string) => (de ? g : vi)
  const first = `${ym}-01`
  const blank = (): Form => ({ employee_id: '', kind: 'vacation', from: first, to: first, note: '' })
  const [f, setF] = useState<Form>(blank)
  const [busy, setBusy] = useState(false)
  // Ngày quán đóng cửa trong tháng
  const [closed, setClosed] = useState<{ day: string; note: string | null }[]>([])
  const [cd, setCd] = useState({ day: first, note: '' })
  const [tick, setTick] = useState(0)
  const [fixed, setFixed] = useState<Fixed[]>([])
  const [special, setSpecial] = useState<{ day: string; open_from: string; open_to: string; note: string | null }[]>([])
  const [sp, setSp] = useState({ day: first, from: '11:00', to: '17:00', note: '' })
  const blankFx = () => ({ employee_id: '', day: first, start: '11:00', end: '21:00', note: '' })
  const [fx, setFx] = useState(blankFx)
  useEffect(() => {
    const last = monthDates(ym).at(-1)!
    supabase.from('nh_closed_days').select('day,note').eq('restaurant_id', rid).gte('day', `${ym}-01`).lte('day', last).order('day')
      .then(({ data }) => setClosed((data || []) as { day: string; note: string | null }[]))
    supabase.from('nh_plan_fixed').select('id,employee_id,day,start_time,end_time,note').eq('restaurant_id', rid).gte('day', `${ym}-01`).lte('day', last).order('day').order('start_time')
      .then(({ data }) => setFixed((data || []) as Fixed[]))
    supabase.from('nh_special_hours').select('day,open_from,open_to,note').eq('restaurant_id', rid).gte('day', `${ym}-01`).lte('day', last).order('day')
      .then(({ data }) => setSpecial((data || []) as typeof special))
  }, [rid, ym, tick])
  async function addFixed() {
    if (!fx.employee_id) { toast(T('Chọn nhân viên', 'Mitarbeiter wählen')); return }
    if (!fx.day || !isTime(fx.start) || !isTime(fx.end)) { toast(T('Nhập ngày và giờ', 'Datum und Uhrzeit eingeben')); return }
    setBusy(true)
    const { error } = await supabase.from('nh_plan_fixed').upsert({ restaurant_id: rid, employee_id: fx.employee_id, day: fx.day, start_time: fx.start, end_time: fx.end, note: fx.note.trim() || null }, { onConflict: 'employee_id,day' })
    setBusy(false)
    if (error) { toast(error.message); return }
    setFx({ ...blankFx(), day: fx.day, start: fx.start, end: fx.end }); setTick((x) => x + 1)
  }
  async function addSpecial() {
    if (!sp.day || !isTime(sp.from) || !isTime(sp.to)) { toast(T('Nhập ngày và giờ', 'Datum und Uhrzeit eingeben')); return }
    setBusy(true)
    const { error } = await supabase.from('nh_special_hours').upsert({ restaurant_id: rid, day: sp.day, open_from: sp.from, open_to: sp.to, note: sp.note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message); return }
    setSp({ ...sp, note: '' }); setTick((x) => x + 1)
  }
  async function delSpecial(day: string) {
    setBusy(true)
    const { error } = await supabase.from('nh_special_hours').delete().eq('restaurant_id', rid).eq('day', day)
    setBusy(false)
    if (error) { toast(error.message); return }
    setTick((x) => x + 1)
  }
  async function delFixed(id: string) {
    setBusy(true)
    const { error } = await supabase.from('nh_plan_fixed').delete().eq('id', id).eq('restaurant_id', rid)
    setBusy(false)
    if (error) { toast(error.message); return }
    setTick((x) => x + 1)
  }

  // Khung chat
  const [chat, setChat] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [chat])
  async function ask() {
    const text = q.trim()
    if (!text || asking) return
    const hist = chat.map((m) => ({ role: m.role, text: m.text }))
    setChat((c) => [...c, { role: 'user', text }]); setQ(''); setAsking(true)
    const { data, error } = await supabase.functions.invoke('nh-plan-chat', {
      body: {
        text, lang: de ? 'de' : 'vi', today: new Date().toISOString().slice(0, 10), month: ym, history: hist,
        employees: emps.map((e) => ({ id: e.id, pnr: (e.personnel_no || '').replace(/^0+(?=\d)/, '') || null, name: `${e.first_name || ''} ${e.last_name || ''}`.trim(), hours: e.daily_hours ?? null, days: e.work_days ?? null })),
        absences: abs.filter((a) => a.id).map((a) => ({ id: a.id, employee_id: a.employee_id, kind: a.kind, from: a.from_date, to: a.to_date, note: a.note })),
        closed, special: special.map((x) => ({ day: x.day, from: t5(x.open_from), to: t5(x.open_to), note: x.note })), fixed: fixed.map((f) => ({ id: f.id, employee_id: f.employee_id, day: f.day, start: t5(f.start_time), end: t5(f.end_time), note: f.note })),
      },
    })
    setAsking(false)
    const p = (data as { result?: Proposal } | null)?.result
    if (error || !p) { setChat((c) => [...c, { role: 'assistant', text: T('Chưa hiểu được, anh/chị thử viết lại hoặc nhập bằng ô bên dưới.', 'Das hat nicht geklappt. Bitte anders formulieren oder unten eintragen.') }]); return }
    // Chỉ giữ mục hợp lệ (đúng nhân viên, đúng định dạng ngày giờ, xoá đúng mục đang có)
    const ids = new Set(emps.map((e) => e.id))
    const clean: Proposal = {
      reply: p.reply || '',
      absences: (p.absences || []).filter((a) => ids.has(a.employee_id) && KINDS.some((k) => k.k === a.kind) && isDate(a.from) && isDate(a.to) && a.to >= a.from),
      closed_add: (p.closed_add || []).filter((c) => isDate(c.day)),
      closed_remove: (p.closed_remove || []).filter((d) => closed.some((c) => c.day === d)),
      special_add: (p.special_add || []).filter((x) => isDate(x.day) && isTime(x.from) && isTime(x.to)),
      special_remove: (p.special_remove || []).filter((d) => special.some((x) => x.day === d)),
      fixed: (p.fixed || []).filter((f) => ids.has(f.employee_id) && isDate(f.day) && isTime(f.start) && isTime(f.end)),
      delete_absence_ids: (p.delete_absence_ids || []).filter((id) => abs.some((a) => a.id === id)),
      delete_fixed_ids: (p.delete_fixed_ids || []).filter((id) => fixed.some((f) => f.id === id)),
    }
    setChat((c) => [...c, { role: 'assistant', text: clean.reply, p: clean }])
  }
  const count = (p: Proposal) => p.absences.length + p.closed_add.length + p.closed_remove.length + p.special_add.length + p.special_remove.length + p.fixed.length + p.delete_absence_ids.length + p.delete_fixed_ids.length
  async function apply(i: number) {
    const p = chat[i].p!
    setBusy(true)
    const steps = [
      p.delete_absence_ids.length ? supabase.from('nh_absences').delete().eq('restaurant_id', rid).in('id', p.delete_absence_ids) : null,
      p.delete_fixed_ids.length ? supabase.from('nh_plan_fixed').delete().eq('restaurant_id', rid).in('id', p.delete_fixed_ids) : null,
      p.absences.length ? supabase.from('nh_absences').insert(p.absences.map((a) => ({ restaurant_id: rid, employee_id: a.employee_id, kind: a.kind, from_date: a.from, to_date: a.to, note: a.note }))) : null,
      p.closed_add.length ? supabase.from('nh_closed_days').upsert(p.closed_add.map((c) => ({ restaurant_id: rid, day: c.day, note: c.note }))) : null,
      p.closed_remove.length ? supabase.from('nh_closed_days').delete().eq('restaurant_id', rid).in('day', p.closed_remove) : null,
      p.special_add.length ? supabase.from('nh_special_hours').upsert(p.special_add.map((x) => ({ restaurant_id: rid, day: x.day, open_from: x.from, open_to: x.to, note: x.note }))) : null,
      p.special_remove.length ? supabase.from('nh_special_hours').delete().eq('restaurant_id', rid).in('day', p.special_remove) : null,
      p.fixed.length ? supabase.from('nh_plan_fixed').upsert(p.fixed.map((f) => ({ restaurant_id: rid, employee_id: f.employee_id, day: f.day, start_time: f.start, end_time: f.end, note: f.note })), { onConflict: 'employee_id,day' }) : null,
    ]
    for (const st of steps) { if (!st) continue; const { error } = await st; if (error) { setBusy(false); toast(error.message); return } }
    setBusy(false)
    setChat((c) => c.map((m, j) => (j === i ? { ...m, done: true } : m)))
    setTick((x) => x + 1); onChanged?.()
    toast(T('Đã lưu ghi chú', 'Hinweise gespeichert'))
  }
  const absName = (id: string) => { const a = abs.find((x) => x.id === id); return a ? `${name(a.employee_id)} · ${kindLabel(a.kind)} ${dmy(a.from_date)}–${dmy(a.to_date)}` : id }
  const fxName = (id: string) => { const f = fixed.find((x) => x.id === id); return f ? `${name(f.employee_id)} · ${dmy(f.day)} ${t5(f.start_time)}–${t5(f.end_time)}` : id }
  async function addClosed() {
    if (!cd.day) return
    setBusy(true)
    const { error } = await supabase.from('nh_closed_days').upsert({ restaurant_id: rid, day: cd.day, note: cd.note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message); return }
    setCd({ day: cd.day, note: '' }); setTick((x) => x + 1)
  }
  async function delClosed(day: string) {
    setBusy(true)
    const { error } = await supabase.from('nh_closed_days').delete().eq('restaurant_id', rid).eq('day', day)
    setBusy(false)
    if (error) { toast(error.message); return }
    setTick((x) => x + 1)
  }
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
      <div className="pn-chat">
        {chat.map((m, i) => (
          <div key={i} className={`pn-msg ${m.role}`}>
            <div className="pn-bub">{m.text}</div>
            {m.p && count(m.p) > 0 && (
              <div className="pn-prop">
                <ul>
                  {m.p.absences.map((a, j) => <li key={`a${j}`}>+ {name(a.employee_id)} · <span className={`pn-k ${a.kind}`}>{kindLabel(a.kind)}</span> {dmy(a.from)}{a.to !== a.from ? `–${dmy(a.to)}` : ''}{a.note ? ` · ${a.note}` : ''}</li>)}
                  {m.p.fixed.map((f, j) => <li key={`f${j}`}>+ {name(f.employee_id)} · {T('làm', 'arbeitet')} {dmy(f.day)} {f.start}–{f.end}{f.note ? ` · ${f.note}` : ''}</li>)}
                  {m.p.closed_add.map((c, j) => <li key={`c${j}`}>+ {T('Đóng cửa', 'Ruhetag')} {dmy(c.day)}{c.note ? ` · ${c.note}` : ''}</li>)}
                  {m.p.special_add.map((x, j) => <li key={`s${j}`}>+ {T('Mở ngắn', 'Kurz geöffnet')} {dmy(x.day)} {x.from}–{x.to}{x.note ? ` · ${x.note}` : ''}</li>)}
                  {m.p.special_remove.map((d) => <li key={`sr${d}`}>− {T('Bỏ giờ mở ngắn', 'Sonderöffnung entfernen')} {dmy(d)}</li>)}
                  {m.p.closed_remove.map((d) => <li key={`o${d}`}>− {T('Bỏ ngày đóng cửa', 'Ruhetag entfernen')} {dmy(d)}</li>)}
                  {m.p.delete_absence_ids.map((id) => <li key={`da${id}`}>− {absName(id)}</li>)}
                  {m.p.delete_fixed_ids.map((id) => <li key={`df${id}`}>− {fxName(id)}</li>)}
                </ul>
                {m.done ? <span className="small muted">✓ {T('Đã lưu', 'Gespeichert')}</span> : (
                  <div className="pn-prop-b">
                    <button className="st-btn primary" disabled={busy} onClick={() => apply(i)}>{T('Lưu', 'Speichern')}</button>
                    <button className="st-btn" disabled={busy} onClick={() => setChat((c) => c.map((x, k) => (k === i ? { ...x, p: undefined } : x)))}>{T('Bỏ', 'Verwerfen')}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {asking && <div className="pn-msg assistant"><div className="pn-bub muted">…</div></div>}
        <div ref={endRef} />
        <div className="pn-ask">
          <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} disabled={asking}
            placeholder={T('Gõ ghi chú, ví dụ: 25/12 Lan và Minh làm 11–20, Hùng ốm 3–5/12, Mai xin nghỉ thứ 7 ngày 12', 'Hinweis eingeben, z. B.: 25.12 arbeiten Lan und Minh 11–20, Hung krank 3.–5.12., Mai am 12.12. frei')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }} />
          <button className="st-btn primary" disabled={asking || !q.trim()} onClick={ask}>{T('Gửi', 'Senden')}</button>
        </div>
      </div>
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
      <h4 className="pn-h">{T('Ca cố định', 'Feste Dienste')}</h4>
      <p className="small muted">{T('Ai phải làm ngày nào, giờ nào. Bộ xếp lịch đặt các ca này trước, kể cả vào ngày quán đóng cửa (ví dụ 25/12 chỉ mở với vài người).',
        'Wer an welchem Tag zu welcher Zeit arbeitet. Diese Dienste werden zuerst eingeplant, auch an Ruhetagen (z. B. 25.12. mit wenigen Leuten).')}</p>
      {fixed.length > 0 && (
        <div className="pn-chips">{fixed.map((f) => (
          <span key={f.id} className="pn-chip fx">{dmy(f.day)} {t5(f.start_time)}–{t5(f.end_time)} · {name(f.employee_id)}{f.note ? ` · ${f.note}` : ''}
            <button className="pn-del" disabled={busy} aria-label={T('Xoá', 'Löschen')} onClick={() => delFixed(f.id)}>✕</button></span>))}
        </div>
      )}
      <div className="pn-form">
        <select value={fx.employee_id} onChange={(e) => setFx({ ...fx, employee_id: e.target.value })} aria-label={T('Nhân viên', 'Mitarbeiter')}>
          <option value="">{T('— Nhân viên —', '— Mitarbeiter —')}</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{name(e.id)}</option>)}
        </select>
        <label><span>{T('Ngày', 'Datum')}</span><input type="date" value={fx.day} onChange={(e) => setFx({ ...fx, day: e.target.value })} /></label>
        <label><span>{T('Từ', 'Von')}</span><input type="time" value={fx.start} onChange={(e) => setFx({ ...fx, start: e.target.value })} /></label>
        <label><span>{T('Đến', 'Bis')}</span><input type="time" value={fx.end === '24:00' ? '00:00' : fx.end} onChange={(e) => setFx({ ...fx, end: e.target.value === '00:00' ? '24:00' : e.target.value })} /></label>
        <input className="pn-note" placeholder={T('Ghi chú (tuỳ chọn)', 'Notiz (optional)')} value={fx.note} onChange={(e) => setFx({ ...fx, note: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addFixed() }} />
        <button className="st-btn primary" disabled={busy} onClick={addFixed}>{T('Thêm ca', 'Dienst hinzufügen')}</button>
      </div>
      <h4 className="pn-h">{T('Ngày quán đóng cửa', 'Betriebsruhe')}</h4>
      <p className="small muted">{T('Những ngày này không xếp ca cho ai.', 'An diesen Tagen werden keine Schichten geplant.')}</p>
      {closed.length > 0 && (
        <div className="pn-chips">{closed.map((c) => (
          <span key={c.day} className="pn-chip">{dmy(c.day)}{c.note ? ` · ${c.note}` : ''}
            <button className="pn-del" disabled={busy} aria-label={T('Xoá', 'Löschen')} onClick={() => delClosed(c.day)}>✕</button></span>))}
        </div>
      )}
      <div className="pn-form">
        <label><span>{T('Ngày', 'Datum')}</span><input type="date" value={cd.day} onChange={(e) => setCd({ ...cd, day: e.target.value })} /></label>
        <input className="pn-note" placeholder={T('Lý do (tuỳ chọn), ví dụ Weihnachten', 'Grund (optional), z. B. Weihnachten')} value={cd.note} onChange={(e) => setCd({ ...cd, note: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addClosed() }} />
        <button className="st-btn primary" disabled={busy} onClick={addClosed}>{T('Thêm ngày đóng cửa', 'Ruhetag hinzufügen')}</button>
      </div>
      <h4 className="pn-h">{T('Ngày mở cửa ngắn', 'Verkürzte Öffnungszeit')}</h4>
      <p className="small muted">{T('Ví dụ 26/12 chỉ bán 11–17 giờ: chỉ xếp ca trong khung giờ này, đủ người thì thôi.', 'Z. B. 26.12. nur 11–17 Uhr: Schichten nur in diesem Zeitraum, nur so viele wie nötig.')}</p>
      {special.length > 0 && (
        <div className="pn-chips">{special.map((x) => (
          <span key={x.day} className="pn-chip sp">{dmy(x.day)} {t5(x.open_from)}–{t5(x.open_to)}{x.note ? ` · ${x.note}` : ''}
            <button className="pn-del" disabled={busy} aria-label={T('Xoá', 'Löschen')} onClick={() => delSpecial(x.day)}>✕</button></span>))}
        </div>
      )}
      <div className="pn-form">
        <label><span>{T('Ngày', 'Datum')}</span><input type="date" value={sp.day} onChange={(e) => setSp({ ...sp, day: e.target.value })} /></label>
        <label><span>{T('Mở', 'Von')}</span><input type="time" value={sp.from} onChange={(e) => setSp({ ...sp, from: e.target.value })} /></label>
        <label><span>{T('Đóng', 'Bis')}</span><input type="time" value={sp.to === '24:00' ? '00:00' : sp.to} onChange={(e) => setSp({ ...sp, to: e.target.value === '00:00' ? '24:00' : e.target.value })} /></label>
        <input className="pn-note" placeholder={T('Lý do (tuỳ chọn)', 'Grund (optional)')} value={sp.note} onChange={(e) => setSp({ ...sp, note: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addSpecial() }} />
        <button className="st-btn primary" disabled={busy} onClick={addSpecial}>{T('Thêm giờ mở ngắn', 'Öffnungszeit hinzufügen')}</button>
      </div>
    </div>
  )
}
