// Xếp lịch (Dienstplan): bảng tổng hợp từng tháng và bảng ca theo ngày, lấy từ giờ làm đã ghi
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { fullName, type Employee, type HrSettings } from '../lib/hr'
import { hhmm, holidayOf, monthDates, monthLabel, monthStat, noSurcharge, shiftClass, tShort, vacDays, weekday, WD_DE, WD_VI, type Shift, type Vacation } from '../lib/hrTime'
import { dienstplanPdf } from '../lib/hrTimePdf'
import { Spinner, Top, useRestaurant } from '../components/ui'
import { LangSwitch } from '../components/LangSwitch'
import PdfSheet from '../components/PdfSheet'
import StaffMonth from '../components/StaffMonth'
import { useFollowMonth } from '../lib/useMonthParam'

type Emp = Employee & { id: string }
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export default function Plan() {
  const { rid } = useParams()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const de = useLang().lang === 'de'
  const T = (vi: string, g: string) => (de ? g : vi)
  const [emps, setEmps] = useState<Emp[]>([])
  const [hs, setHs] = useState<HrSettings | null>(null)
  const [range, setRange] = useState<[string, string] | null>(null)
  const [ym, setYm] = useState<string | null>(null)
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [abs, setAbs] = useState<Vacation[]>([])
  const [view, setView] = useState<'sum' | 'grid' | 'list'>('sum')
  const [pdf, setPdf] = useState<Blob | null>(null)
  const [tick, setTick] = useState(0)
  const pm = useFollowMonth(setYm)

  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('xwide'); return () => el?.classList.remove('xwide') }, [])
  useEffect(() => {
    if (!rid) return
    supabase.from('nh_employees').select('*').eq('restaurant_id', rid).then(({ data }) => setEmps((data || []) as Emp[]))
    supabase.from('nh_hr_settings').select('*').eq('restaurant_id', rid).maybeSingle().then(({ data }) => setHs(data as HrSettings | null))
    Promise.all([
      supabase.from('nh_shifts').select('shift_date').eq('restaurant_id', rid).order('shift_date').limit(1),
      supabase.from('nh_shifts').select('shift_date').eq('restaurant_id', rid).order('shift_date', { ascending: false }).limit(1),
    ]).then(([a, b]) => {
      const lo = a.data?.[0]?.shift_date?.slice(0, 7), hi = b.data?.[0]?.shift_date?.slice(0, 7)
      const now = ymOf(new Date())
      setRange([lo || now, hi || now]); setYm(pm || hi || now)
    })
  }, [rid])
  useEffect(() => {
    if (!rid || !ym) return
    setShifts(null)
    const to = monthDates(ym).at(-1)!
    Promise.all([
      supabase.from('nh_shifts').select('id,employee_id,shift_date,start_time,end_time,break_min,note').eq('restaurant_id', rid).gte('shift_date', `${ym}-01`).lte('shift_date', to).limit(5000),
      supabase.from('nh_absences').select('employee_id,from_date,to_date,kind,note').eq('restaurant_id', rid).lte('from_date', to).gte('to_date', `${ym}-01`).limit(5000),
    ]).then(([s, a]) => { setShifts((s.data || []) as Shift[]); setAbs((a.data || []) as Vacation[]) })
  }, [rid, ym, tick])

  const months = useMemo(() => {
    if (!range) return []
    const out: string[] = []
    // Cho chọn trước 6 tháng tới để lên lịch, kể cả khi chưa có ca
    const ahead = new Date(); ahead.setDate(1); ahead.setMonth(ahead.getMonth() + 6)
    const end = range[1] > ymOf(ahead) ? range[1] : ymOf(ahead)
    for (let d = new Date(`${range[0]}-01T12:00:00`); ymOf(d) <= end; d.setMonth(d.getMonth() + 1)) out.push(ymOf(d))
    return out.reverse()
  }, [range])

  // Nhân viên có ca hoặc phép trong tháng, theo mã nhân viên
  const rows = useMemo(() => {
    if (!shifts || !ym) return []
    return emps.map((e) => {
      const sh = shifts.filter((s) => s.employee_id === e.id).sort((a, b) => a.shift_date.localeCompare(b.shift_date))
      const vac = vacDays(abs.filter((a) => a.employee_id === e.id), ym)
      const contract = e.work_days != null && e.daily_hours != null ? `${String(e.work_days).replace('.', ',')} × ${String(e.daily_hours).replace('.', ',')} h` : ''
      return { e, sh, vac, st: monthStat(sh, vac, noSurcharge(e)), contract }
    }).filter((x) => x.sh.length || x.vac.length).sort((a, b) => (a.e.personnel_no || '').localeCompare(b.e.personnel_no || ''))
  }, [emps, shifts, abs, ym])
  const tot = rows.reduce((t, x) => ({ days: t.days + x.st.days, ist: t.ist + x.st.ist, night: t.night + x.st.night, sun: t.sun + x.st.sun, hol: t.hol + x.st.hol, vac: t.vac + x.st.vac }), { days: 0, ist: 0, night: 0, sun: 0, hol: 0, vac: 0 })

  if (!r || !canManage(role)) return null
  const company = hs?.company_name || r.name
  const dates = ym ? monthDates(ym) : []
  const pnr = (e: Emp) => (e.personnel_no || '').replace(/^0+(?=\d{4})/, '')
  return (
    <>
      <Top title={T('Xếp lịch', 'Dienstplan')} sub={company} back={`/r/${rid}/hr`} right={<LangSwitch />} />
      <div className="st">
        <div className="pl-ctrl">
          <select value={ym || ''} onChange={(ev) => setYm(ev.target.value)} aria-label={T('Tháng', 'Monat')}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m, de)}</option>)}
          </select>
          <div className="seg">
            <button className={view === 'sum' ? 'sel' : ''} onClick={() => setView('sum')}>{T('Tổng hợp', 'Zusammenfassung')}</button>
            <button className={view === 'grid' ? 'sel' : ''} onClick={() => setView('grid')}>{T('Lịch theo ngày', 'Monatsübersicht')}</button>
            <button className={view === 'list' ? 'sel' : ''} onClick={() => setView('list')}>{T('Lịch làm nhân viên', 'Mitarbeiterliste')}</button>
          </div>
          {view !== 'list' && <button className="st-btn" disabled={!rows.length} onClick={() => setPdf(dienstplanPdf({ company, ym: ym!, rows: rows.map((x) => ({ name: `${x.e.last_name}, ${x.e.first_name}`, pnr: pnr(x.e), contract: x.contract, shifts: x.sh, vac: x.vac, noZ: noSurcharge(x.e) })) }))}>PDF</button>}
        </div>

        {!shifts ? <Spinner /> : view === 'list' ? <StaffMonth rid={rid!} ym={ym!} emps={emps} shifts={shifts} abs={abs} company={company} de={de} onSaved={() => setTick((x) => x + 1)} /> : !rows.length ? <div className="card muted">{T('Tháng này chưa có lịch làm việc', 'Für diesen Monat ist kein Dienstplan erfasst')}</div> : view === 'sum' ? (
          <>
            <div className="st-stats pl-kpi">
              <div className="st-stat"><span>{T('Nhân viên', 'Mitarbeiter')}</span><b>{rows.length}</b></div>
              <div className="st-stat"><span>{T('Tổng giờ', 'Ist gesamt')}</span><b>{hhmm(tot.ist)}</b></div>
              <div className="st-stat"><span>{T('Ngày phép', 'Urlaubstage')}</span><b>{tot.vac}</b></div>
            </div>
            <div className="pl-scroll">
              <table className="pl-sum">
                <thead><tr><th>{T('Mã NV', 'PNR')}</th><th className="l">{T('Họ và tên', 'Name')}</th><th>{T('Hợp đồng', 'Vertrag')}</th><th>{T('Ngày', 'Tage')}</th><th>Ist</th><th>{T('Đêm', 'Nacht')}</th><th>{T('Chủ nhật', 'Sonntag')}</th><th>{T('Lễ', 'Feiertag')}</th><th>{T('Phép', 'Urlaub')}</th></tr></thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.e.id} onClick={() => nav(`/r/${rid}/hr/${x.e.id}`)}>
                      <td className="m">{pnr(x.e)}</td><td className="l">{fullName(x.e)}</td><td className="m">{x.contract || '—'}</td>
                      <td>{x.st.days}</td><td className="b">{hhmm(x.st.ist)}</td><td>{hhmm(x.st.night)}</td><td>{hhmm(x.st.sun)}</td><td>{hhmm(x.st.hol)}</td>
                      <td className={x.st.vac ? 'v' : ''}>{x.st.vac || ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3} className="l">{T('Tổng cộng', 'Gesamt')}</td><td>{tot.days}</td><td className="b">{hhmm(tot.ist)}</td><td>{hhmm(tot.night)}</td><td>{hhmm(tot.sun)}</td><td>{hhmm(tot.hol)}</td><td>{tot.vac}</td></tr></tfoot>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="pl-legend">
              <span><i className="frueh" />{T('Ca sáng', 'Früh')}</span><span><i className="spaet" />{T('Ca chiều/tối', 'Spät')}</span>
              <span><i className="so" />{T('Chủ nhật', 'Sonntag')}</span><span><i className="ft" />{T('Ngày lễ', 'Feiertag')}</span><span><i className="u" />{T('Nghỉ phép', 'Urlaub')}</span>
            </div>
            <div className="pl-scroll">
              <table className="pl-grid">
                <thead><tr><th className="l sticky">{T('Nhân viên', 'Mitarbeiter')}</th>
                  {dates.map((d) => { const w = weekday(d); return <th key={d} className={w === 0 ? 'so' : holidayOf(d) ? 'ft' : ''}>{d.slice(8)}<br /><small>{(de ? WD_DE : WD_VI)[w]}</small></th> })}
                  <th>Σ</th></tr></thead>
                <tbody>
                  {rows.map((x) => {
                    const by = new Map(x.sh.map((s) => [s.shift_date, s]))
                    return (
                      <tr key={x.e.id}>
                        <td className="l sticky" onClick={() => nav(`/r/${rid}/hr/${x.e.id}`)}><span className="m">{pnr(x.e)}</span> {fullName(x.e)}</td>
                        {dates.map((d) => { const s = by.get(d); return s ? <td key={d} className={shiftClass(s)}>{tShort(s.start_time.slice(0, 5))}–{tShort(s.end_time.slice(0, 5))}</td> : x.vac.includes(d) ? <td key={d} className="u">U</td> : <td key={d} className="off" /> })}
                        <td className="b">{hhmm(x.st.ist)}</td>
                      </tr>
                    )
                  })}
                  <tr className="cnt"><td className="l sticky">{T('Số người / ngày', 'Mitarbeiter / Tag')}</td>{dates.map((d) => <td key={d}>{rows.filter((x) => x.sh.some((s) => s.shift_date === d)).length}</td>)}<td /></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {pdf && ym && <PdfSheet pdf={pdf} title={`Dienstplan ${monthLabel(ym, true)}`} onClose={() => setPdf(null)} actions={[{ label: T('Tải PDF', 'PDF laden'), primary: true, onClick: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(pdf); a.download = `Dienstplan_${ym}.pdf`; a.click() } }]} />}
    </>
  )
}
