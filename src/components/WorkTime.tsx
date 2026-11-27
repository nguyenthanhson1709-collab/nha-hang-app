// Hồ sơ nhân viên: Giờ làm và nghỉ phép – mỗi tháng một thư mục, xem chi tiết từng ngày theo cùng một mẫu
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dmy } from '../lib/format'
import { calc, hhmm, holidayOf, monthDates, monthLabel, monthStat, shiftClass, tFull, vacDays, weekday, WD_DE, WD_VI, zNote, type Shift, type Vacation } from '../lib/hrTime'
import { stundenzettelPdf } from '../lib/hrTimePdf'
import PdfSheet from './PdfSheet'
import { Spinner } from './ui'

export default function WorkTime({ eid, name, pnr, company, contract, de, download, noZ = false }: {
  eid: string; name: string; pnr: string | null; company: string; contract: string | null; de: boolean; download: (b: Blob, n: string) => void; noZ?: boolean
}) {
  const T = (vi: string, g: string) => (de ? g : vi)
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [abs, setAbs] = useState<Vacation[]>([])
  const [ym, setYm] = useState<string | null>(null)
  const [pdf, setPdf] = useState<Blob | null>(null)
  useEffect(() => {
    let off = false
    Promise.all([
      supabase.from('nh_shifts').select('id,employee_id,shift_date,start_time,end_time,break_min,note').eq('employee_id', eid).order('shift_date').limit(5000),
      supabase.from('nh_absences').select('employee_id,from_date,to_date,kind,note').eq('employee_id', eid).limit(5000),
    ]).then(([s, a]) => { if (!off) { setShifts((s.data || []) as Shift[]); setAbs((a.data || []) as Vacation[]) } })
    return () => { off = true }
  }, [eid])

  // Các tháng có ca làm hoặc ngày phép, mới nhất trước
  const months = useMemo(() => {
    const set = new Set<string>((shifts || []).map((s) => s.shift_date.slice(0, 7)))
    for (const a of abs) if (a.kind === 'vacation') { set.add(a.from_date.slice(0, 7)); set.add(a.to_date.slice(0, 7)) }
    return [...set].sort().reverse()
  }, [shifts, abs])
  const ofMonth = (m: string) => (shifts || []).filter((s) => s.shift_date.startsWith(m))

  if (!shifts) return <Spinner />
  if (!months.length) return <div className="kv-v empty">{T('Chưa có giờ làm nào được ghi', 'Keine Arbeitszeiten erfasst')}</div>

  if (!ym) return (
    <div className="list">
      {months.map((m) => {
        const st = monthStat(ofMonth(m), vacDays(abs, m), noZ)
        return (
          <button key={m} className="it wt-month" onClick={() => setYm(m)}>
            <span className="wt-ic" aria-hidden>📁</span>
            <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
              <div className="t">{monthLabel(m, de)}</div>
              <div className="small muted">{st.days} {T('ngày làm', 'Arbeitstage')}{st.vac ? ` · ${st.vac} ${T('ngày phép', 'Urlaubstage')}` : ''}</div>
            </div>
            <div className="num">{hhmm(st.ist)} h</div>
          </button>
        )
      })}
    </div>
  )

  const list = ofMonth(ym), vac = vacDays(abs, ym), st = monthStat(list, vac, noZ), by = new Map(list.map((s) => [s.shift_date, s]))
  const makePdf = () => stundenzettelPdf({ name, pnr, company, ym, contract, shifts: list, vac, noZ })
  const fileName = `Stundenzettel_${ym}_${name}`.replace(/\s+/g, '_') + '.pdf'
  return (
    <div className="wt">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => setYm(null)}>‹ {T('Các tháng', 'Monate')}</button>
        <b className="grow" style={{ fontSize: '1.05rem' }}>{monthLabel(ym, de)}</b>
        <button className="btn" onClick={() => setPdf(makePdf())}>{T('Xem PDF', 'PDF ansehen')}</button>
      </div>
      <div className="wt-stats">
        <div><span>{T('Ngày làm', 'Anwesenheit')}</span><b>{st.days}</b></div>
        <div><span>{T('Tổng giờ', 'Ist')}</span><b>{hhmm(st.ist)}</b></div>
        <div><span>{T('Giờ đêm', 'Nacht')}</span><b>{hhmm(st.night)}</b></div>
        <div><span>{T('Chủ nhật', 'Sonntag')}</span><b>{hhmm(st.sun)}</b></div>
        <div><span>{T('Lễ 125 %', 'Feiertag 125 %')}</span><b>{hhmm(st.hol)}</b></div>
        {st.hol150 > 0 && <div><span>{T('Lễ 150 %', 'Feiertag 150 %')}</span><b>{hhmm(st.hol150)}</b></div>}
        <div><span>{T('Nghỉ phép', 'Urlaub')}</span><b>{st.vac} {T('ngày', 'Tage')}</b></div>
      </div>
      <div className="wt-table" role="table">
        <div className="wt-tr wt-th" role="row"><span>{T('Ngày', 'Datum')}</span><span>{T('Kommt', 'Kommt')}</span><span>Pause</span><span>{T('Geht', 'Geht')}</span><span>Ist</span><span>{T('Ghi chú', 'Bemerkung')}</span></div>
        {monthDates(ym).map((d) => {
          const s = by.get(d), wd = weekday(d), hol = holidayOf(d), u = vac.includes(d)
          const c = s ? calc(s) : null
          const note = s ? [s.note, ...zNote(c!, de)].filter(Boolean).join(' · ')
            : u ? T('Nghỉ phép', 'Urlaub') : hol ? `${hol}` : T('Nghỉ', 'frei')
          return (
            <div key={d} className={`wt-tr ${s ? `on ${shiftClass(s)}` : u ? 'u' : 'off'}`} role="row">
              <span><b>{(de ? WD_DE : WD_VI)[wd]}</b> {dmy(d).slice(0, 5)}</span>
              <span>{s ? tFull(s.start_time.slice(0, 5)) : ''}</span>
              <span>{s ? hhmm(s.break_min || 0) : ''}</span>
              <span>{s ? tFull(s.end_time.slice(0, 5)) : ''}</span>
              <span className="ist">{c ? hhmm(c.ist) : ''}</span>
              <span className="nt">{note}</span>
            </div>
          )
        })}
      </div>
      {pdf && <PdfSheet pdf={pdf} title={`Stundenzettel ${monthLabel(ym, true)}`} onClose={() => setPdf(null)}
        actions={[{ label: T('Tải PDF', 'PDF laden'), primary: true, onClick: () => download(pdf, fileName) }]} />}
    </div>
  )
}
