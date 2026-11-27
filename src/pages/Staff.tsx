// Nhân sự: thống kê (Tổng / Đang làm / Đã nghỉ, bấm để lọc), tìm kiếm, lọc loại hợp đồng, sắp xếp, bảng nhân viên
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { dmy } from '../lib/format'
import { EMP_TYPES, fullName, HR_BUCKET, isActive, permitDaysLeft, PERMIT_WARN_DAYS, type EmpType, type Employee, type HrSettings } from '../lib/hr'
import { Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'
import { LangSwitch } from '../components/LangSwitch'
import { dropProps } from '../lib/drop'
import type { SlipResult } from '../lib/payslipImport'

type Row = Employee & { id: string }
type Filter = 'all' | 'active' | 'left'
type Sort = 'pnr' | 'name' | 'ct' | 'date'
const CT_ORDER: Record<string, number> = { vollzeit: 0, teilzeit: 1, minijob: 2, werkstudent: 3, aushilfe: 4 }

const SI = {
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.8" /><path d="M16.5 14.6c2.8.2 5 1.9 5 5" /></>,
  active: <><circle cx="10" cy="8" r="4" /><path d="M3 20c0-3.8 3.2-6 7-6 1.4 0 2.7.3 3.8.8M15.5 18l2 2 4-4.5" /></>,
  left: <><circle cx="10" cy="8" r="4" /><path d="M3 20c0-3.8 3.2-6 7-6 1.4 0 2.7.3 3.8.8M16 18h6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  chev: <path d="M9 6l6 6-6 6" />,
  upload: <><path d="M12 15V4M7 9l5-5 5 5" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></>,
}
function SIcon({ k }: { k: keyof typeof SI }) {
  return <svg className="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{SI[k]}</svg>
}

export default function Staff() {
  const { rid } = useParams()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const de = useLang().lang === 'de'
  const li = de ? 1 : 0
  const T = (vi: string, g: string) => (de ? g : vi)
  const [list, setList] = useState<Row[] | null>(null)
  const [hs, setHs] = useState<HrSettings | null>(null)
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>('active')
  const [ctype, setCtype] = useState<'' | EmpType>('')
  const [sort, setSort] = useState<{ k: Sort; asc: boolean }>({ k: 'pnr', asc: false })
  const [q, setQ] = useState('')
  const [editCo, setEditCo] = useState<string | null>(null)
  const [imp, setImp] = useState<{ busy: boolean; prog: string; res: SlipResult[] | null } | null>(null)
  const [stickTop, setStickTop] = useState(0)

  const load = () => {
    supabase.from('nh_employees').select('*').eq('restaurant_id', rid).order('last_name').order('first_name')
      .then(async ({ data, error }) => {
        if (error) toast(errMsg(error))
        const rows = (data || []) as Row[]
        setList(rows)
        // Ảnh chân dung nằm trong bucket riêng tư: lấy link tạm cho cả danh sách một lần
        const withPhoto = rows.filter((e) => e.photo)
        if (withPhoto.length) {
          const { data: s } = await supabase.storage.from(HR_BUCKET).createSignedUrls(withPhoto.map((e) => e.photo!), 3600)
          const m: Record<string, string> = {}
          withPhoto.forEach((e, i) => { const u = s?.[i]?.signedUrl; if (u) m[e.id] = u })
          setPhotos(m)
        }
      })
    supabase.from('nh_hr_settings').select('*').eq('restaurant_id', rid).maybeSingle().then(({ data }) => setHs(data as HrSettings | null))
  }
  useEffect(() => { if (rid) load() }, [rid]) // eslint-disable-line
  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('xwide'); return () => el?.classList.remove('xwide') }, [])
  // Thanh tìm kiếm dính ngay dưới thanh tiêu đề khi cuộn
  useLayoutEffect(() => {
    const top = document.querySelector('.top') as HTMLElement | null
    if (!top) return
    const upd = () => setStickTop(top.offsetHeight)
    upd()
    const ro = new ResizeObserver(upd); ro.observe(top)
    return () => ro.disconnect()
  }, [r])

  const all = useMemo(() => list || [], [list])
  const active = useMemo(() => all.filter((e) => isActive(e)), [all])
  const left = all.length - active.length
  const pnrNum = (e: Row) => (e.personnel_no && /^\d+$/.test(e.personnel_no) ? Number(e.personnel_no) : -1)
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all
      .filter((e) => (filter === 'all' ? true : filter === 'active' ? isActive(e) : !isActive(e)))
      .filter((e) => !ctype || e.employment_type === ctype)
      .filter((e) => !s || fullName(e).toLowerCase().includes(s) || `${e.first_name} ${e.last_name}`.toLowerCase().includes(s) || (e.personnel_no || '').includes(s))
      .sort((a, b) => {
        const dk = (e: Row) => (filter === 'left' ? e.exit_date : e.entry_date) || ''
        const c = sort.k === 'pnr' ? pnrNum(a) - pnrNum(b)
          : sort.k === 'date' ? dk(a).localeCompare(dk(b))
          : sort.k === 'ct' ? (CT_ORDER[a.employment_type || ''] ?? 9) - (CT_ORDER[b.employment_type || ''] ?? 9) || pnrNum(b) - pnrNum(a)
          : fullName(a).localeCompare(fullName(b), 'de')
        return sort.asc ? c : -c
      })
  }, [all, filter, ctype, sort, q])
  const sortHead = (k: Sort, label: string) => {
    const on = sort.k === k
    return (
      <span role="columnheader" aria-sort={on ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`st-sort${on ? ' on' : ''}`} onClick={() => setSort(on ? { k, asc: !sort.asc } : { k, asc: k === 'name' || k === 'ct' })}>
          {label}<svg className="st-arr" viewBox="0 0 10 14" aria-hidden>{(!on || sort.asc) && <path d="M5 1 9 6H1z" />}{(!on || !sort.asc) && <path d="M5 13 1 8h8z" />}</svg>
        </button>
      </span>
    )
  }
  const base = filter === 'all' ? all.length : filter === 'active' ? active.length : left
  const expiring = active.filter((e) => { const d = permitDaysLeft(e.residence_permit_until); return d != null && d <= PERMIT_WARN_DAYS })

  if (!r || !canManage(role)) return null

  async function saveCompany() {
    const { data, error } = await supabase.from('nh_hr_settings').upsert({ restaurant_id: rid, company_name: (editCo || '').trim() || null }).select().single()
    if (error) { toast(errMsg(error)); return }
    setHs(data as HrSettings); setEditCo(null); toast(de ? 'Gespeichert' : 'Đã lưu')
  }

  async function importSlips(fl: FileList | File[]) {
    const files = Array.from(fl)
    if (!files.length) return
    setImp({ busy: true, prog: T('Đang đọc bảng lương…', 'Lohnabrechnungen werden gelesen…'), res: null })
    try {
      const { importMonthlyPayslips } = await import('../lib/payslipImport')
      const res = await importMonthlyPayslips(rid!, all, files, (d, n) => setImp({ busy: true, prog: `${d} / ${n}`, res: null }))
      setImp({ busy: false, prog: '', res })
    } catch (x) { toast(errMsg(x)); setImp({ busy: false, prog: '', res: null }) }
  }
  const initials = (e: Row) => [e.first_name, e.last_name].map((x) => (x || '').trim()[0] || '').join('').toUpperCase() || '?'
  const stat = (k: Filter, icon: keyof typeof SI, n: number, l: string) => (
    <button className={`st-stat ${k}${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>
      <SIcon k={icon} /><b>{list ? n : '–'}</b><span>{l}</span>
    </button>
  )

  return (
    <>
      <Top title={T('Nhân viên', 'Mitarbeiter')} sub={hs?.company_name || r.name} back={`/r/${rid}/hr`}
        right={<div className="hd-right"><LangSwitch /><button className="btn st-gear" onClick={() => setEditCo(hs?.company_name || '')} aria-label={T('Cài đặt', 'Einstellungen')} title={T('Cài đặt', 'Einstellungen')}><SIcon k="gear" /></button></div>} />
      <div className="page st">
        <div className="st-stats">
          {stat('all', 'users', all.length, T('Tổng nhân viên', 'Mitarbeiter gesamt'))}
          {stat('active', 'active', active.length, T('Đang làm', 'Aktiv'))}
          {stat('left', 'left', left, T('Đã nghỉ', 'Ausgeschieden'))}
        </div>
        <div className="st-types">
          {(['vollzeit', 'teilzeit', 'minijob'] as EmpType[]).map((k) => (
            <button key={k} className={`st-type${filter === 'active' && ctype === k ? ' on' : ''}`} onClick={() => { const on = filter === 'active' && ctype === k; setFilter('active'); setCtype(on ? '' : k) }}
              title={T('Nhân viên đang làm theo loại hợp đồng', 'Aktive Mitarbeiter nach Beschäftigungsart')}>
              <span className={`dot ct-${k}`} /><span className="st-type-l">{EMP_TYPES[k][li]}</span><b className={`ct ct-${k}`}>{list ? active.filter((e) => e.employment_type === k).length : '–'}</b>
            </button>
          ))}
        </div>

        {expiring.length > 0 && (
          <div className="alert warn" style={{ margin: 0 }}>
            {T('Giấy phép cư trú sắp hết hạn:', 'Aufenthaltstitel läuft bald ab:')}{' '}
            {expiring.map((e, i) => { const d = permitDaysLeft(e.residence_permit_until)!; return <span key={e.id}>{i > 0 && ', '}<b>{fullName(e)}</b> ({dmy(e.residence_permit_until)}{d < 0 ? T(', đã hết hạn', ', abgelaufen') : ''})</span> })}
          </div>
        )}

        <div className="st-ctrl" style={{ top: stickTop }}>
          <div className="st-head">
            <h2>{T('Hồ sơ nhân viên', 'Personalakten')}</h2>
            <button className="st-btn" onClick={() => setImp({ busy: false, prog: '', res: null })}><SIcon k="upload" /><span>{T('Tải bảng lương', 'Lohnabrechnungen')}</span></button>
            <button className="st-btn primary" onClick={() => nav(`/r/${rid}/hr/new`)}><SIcon k="plus" /><span>{T('Thêm nhân viên', 'Neuer Mitarbeiter')}</span></button>
          </div>
          <div className="st-search">
            <SIcon k="search" />
            <input type="search" placeholder={T('Tìm họ tên hoặc mã nhân viên…', 'Name oder Personal-Nr. suchen…')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {!list ? <Spinner /> : (
          <div className="st-table" role="table">
            <div className="st-tr st-th" role="row">
              {sortHead('pnr', T('Mã NV', 'Pers.-Nr.'))}
              {sortHead('name', T('Họ và tên', 'Name'))}
              {sortHead('ct', T('Hợp đồng', 'Beschäftigung'))}
              {sortHead('date', filter === 'left' ? T('Ngày nghỉ', 'Austritt') : T('Ngày vào làm', 'Eintritt'))}
              <span />
            </div>
            {shown.map((e) => {
              const on = isActive(e)
              const d = permitDaysLeft(e.residence_permit_until)
              const ct = e.employment_type
              const date = filter === 'left' ? e.exit_date : e.entry_date
              return (
                <button key={e.id} className="st-tr" role="row" onClick={() => nav(`/r/${rid}/hr/${e.id}`)}>
                  <span className="st-pnr">{e.personnel_no || '—'}</span>
                  <span className="st-name">
                    <span className="st-av">{photos[e.id] ? <img src={photos[e.id]} alt="" /> : initials(e)}</span>
                    <span className="st-nm">
                      <b>{fullName(e) || '—'}</b>
                      {!on && filter !== 'left' && <span className="tag err">{T('Đã nghỉ', 'Ausgeschieden')}</span>}
                      {on && d != null && d <= PERMIT_WARN_DAYS && <span className={`tag ${d < 0 ? 'err' : 'warn'}`}>{T('Cư trú', 'Aufenthalt')} {dmy(e.residence_permit_until)}</span>}
                      <span className="st-m">
                        <span className="st-pnr">{e.personnel_no || '—'}</span>
                        <span className={`ct ct-${ct || 'none'}`}>{ct ? EMP_TYPES[ct][li] : T('Chưa rõ hợp đồng', 'Ohne Angabe')}</span>
                        <span className="st-md">{date ? dmy(date) : ''}</span>
                      </span>
                    </span>
                  </span>
                  <span className={`st-ct ct ct-${ct || 'none'}`}>{ct ? EMP_TYPES[ct][li] : '—'}</span>
                  <span className="st-date">{date ? dmy(date) : '—'}</span>
                  <span className="st-chev"><SIcon k="chev" /></span>
                </button>
              )
            })}
            {!shown.length && <div className="st-empty">{all.length ? T('Không có nhân viên phù hợp', 'Keine passenden Einträge') : T('Chưa có nhân viên', 'Noch keine Mitarbeiter')}</div>}
          </div>
        )}
        {list && <div className="st-foot">{T('Hiển thị', 'Angezeigt:')} {shown.length} / {base} {T('nhân viên', 'Mitarbeiter')}</div>}
      </div>

      <Sheet open={imp != null} onClose={() => !imp?.busy && setImp(null)} title={T('Tải bảng lương hằng tháng', 'Monatliche Lohnabrechnungen')}>
        {imp && <>
          <p className="small muted" style={{ marginTop: 0 }}>{T('Chọn file PDF hoặc ZIP bảng lương DATEV (một hoặc nhiều tháng, nhiều nhân viên). Mỗi phiếu tự lưu vào giấy tờ của đúng nhân viên theo mã nhân viên (Personal-Nr.). Phiếu đã có sẽ bỏ qua.', 'DATEV-Lohnabrechnungen als PDF oder ZIP. Jede Abrechnung wird anhand der Personal-Nr. dem Mitarbeiter zugeordnet. Bereits vorhandene werden übersprungen.')}</p>
          <label className={`btn block drop${imp.busy ? ' disabled' : ''}`} {...dropProps((fl) => importSlips(fl), imp.busy)}>
            {imp.busy ? imp.prog : T('Chọn file bảng lương (PDF / ZIP)', 'Dateien wählen (PDF / ZIP)')}
            <span className="drop-hint">{T('hoặc kéo thả file vào đây', 'oder Dateien hierher ziehen')}</span>
            <input type="file" accept="application/pdf,.pdf,.zip" multiple hidden disabled={imp.busy} onChange={(ev) => { importSlips(ev.target.files || []); ev.target.value = '' }} />
          </label>
          {imp.res && (() => {
            const c = (st: SlipResult['status']) => imp.res!.filter((x) => x.status === st)
            const saved = c('saved'), exists = c('exists'), nomatch = c('nomatch'), errs = c('error')
            const mm = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`
            return <div style={{ marginTop: 12 }}>
              {!imp.res.length && <div className="alert warn">{T('Không tìm thấy bảng lương DATEV trong file.', 'Keine DATEV-Lohnabrechnung gefunden.')}</div>}
              {saved.length > 0 && <div className="alert ok">{T(`Đã lưu ${saved.length} bảng lương`, `${saved.length} Abrechnungen gespeichert`)}</div>}
              {exists.length > 0 && <div className="small muted" style={{ marginBottom: 8 }}>{T(`${exists.length} phiếu đã có, bỏ qua.`, `${exists.length} bereits vorhanden, übersprungen.`)}</div>}
              {(nomatch.length > 0 || errs.length > 0) && <div className="alert warn">{T('Chưa lưu được:', 'Nicht gespeichert:')}</div>}
              <div className="list">
                {[...nomatch, ...errs, ...saved].map((x, i) => (
                  <div key={i} className="it">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t">{x.employee || x.name || '—'}</div>
                      <div className="small muted">{mm(x.period)} · Pers.-Nr. {x.pnr}{x.status === 'nomatch' ? ` · ${T('không có hồ sơ nhân viên này, hãy thêm nhân viên rồi tải lại', 'keine Personalakte, bitte erst anlegen')}` : x.msg ? ` · ${x.msg}` : ''}</div>
                    </div>
                    <span className={`tag ${x.status === 'saved' ? 'ok' : 'warn'}`}>{x.status === 'saved' ? T('đã lưu', 'gespeichert') : x.status === 'nomatch' ? T('không khớp', 'keine Zuordnung') : T('lỗi', 'Fehler')}</span>
                  </div>
                ))}
              </div>
            </div>
          })()}
        </>}
      </Sheet>

      <Sheet open={editCo != null} onClose={() => setEditCo(null)} title={T('Công ty của nhà hàng', 'Firma des Restaurants')}>
        <label className="f"><span>{T('Tên công ty (Firma), in trên giấy tờ nhân viên', 'Firma (erscheint im Personalbogen)')}</span>
          <input value={editCo || ''} onChange={(e) => setEditCo(e.target.value)} placeholder="Vietbowl Mitte GmbH" /></label>
        <button className="primary block" onClick={saveCompany}>{T('Lưu', 'Speichern')}</button>
      </Sheet>
    </>
  )
}
