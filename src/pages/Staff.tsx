// Nhân sự: danh sách nhân viên (Đang làm / Đã nghỉ), thêm nhân viên mới, tên công ty (Firma) của quán
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { dmy } from '../lib/format'
import { EMP_TYPES, fullName, isActive, permitDaysLeft, PERMIT_WARN_DAYS, POSITIONS, type Employee, type HrSettings } from '../lib/hr'
import { Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'
import { TileIcon } from '../components/Icons'

type Row = Employee & { id: string }

export default function Staff() {
  const { rid } = useParams()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const de = useLang().lang === 'de'
  const li = de ? 1 : 0
  const [list, setList] = useState<Row[] | null>(null)
  const [hs, setHs] = useState<HrSettings | null>(null)
  const [tab, setTab] = useState<'active' | 'left'>('active')
  const [q, setQ] = useState('')
  const [editCo, setEditCo] = useState<string | null>(null)

  useEffect(() => {
    if (!rid) return
    supabase.from('nh_employees').select('*').eq('restaurant_id', rid).order('last_name').order('first_name')
      .then(({ data, error }) => { if (error) toast(errMsg(error)); setList((data || []) as Row[]) })
    supabase.from('nh_hr_settings').select('*').eq('restaurant_id', rid).maybeSingle().then(({ data }) => setHs(data as HrSettings | null))
  }, [rid])

  if (!r || !canManage(role)) return null
  const active = (list || []).filter((e) => isActive(e))
  const left = (list || []).filter((e) => !isActive(e))
  const shown = (tab === 'active' ? active : left).filter((e) => !q.trim() || fullName(e).toLowerCase().includes(q.trim().toLowerCase()))
  const expiring = active.filter((e) => { const d = permitDaysLeft(e.residence_permit_until); return d != null && d <= PERMIT_WARN_DAYS })

  async function saveCompany() {
    const { data, error } = await supabase.from('nh_hr_settings').upsert({ restaurant_id: rid, company_name: (editCo || '').trim() || null }).select().single()
    if (error) { toast(errMsg(error)); return }
    setHs(data as HrSettings); setEditCo(null); toast(de ? 'Gespeichert' : 'Đã lưu')
  }

  return (
    <>
      <Top title={de ? 'Personal' : 'Nhân sự'} sub={hs?.company_name ? `${r.name} · ${hs.company_name}` : r.name} back={`/r/${rid}`}
        right={<button className="btn" onClick={() => setEditCo(hs?.company_name || '')} aria-label="Firma">⚙︎</button>} />
      <div className="page">
        <div className="tiles">
          <button className="tile" onClick={() => nav(`/r/${rid}/hr/new`)}><TileIcon name="userAdd" /><span>{de ? 'Neuer Mitarbeiter' : 'Nhân viên mới'}</span></button>
          <button className="tile" onClick={() => toast(de ? 'Dienstplan kommt im nächsten Schritt' : 'Xếp lịch sẽ có ở bước tiếp theo')} style={{ opacity: 0.55 }}>
            <TileIcon name="calendar" /><span>{de ? 'Dienstplan' : 'Xếp lịch'}</span><span className="small muted">{de ? 'bald' : 'sắp có'}</span>
          </button>
        </div>

        {expiring.length > 0 && (
          <div className="alert warn">
            {de ? 'Aufenthaltstitel läuft bald ab:' : 'Giấy phép cư trú sắp hết hạn:'}{' '}
            {expiring.map((e, i) => { const d = permitDaysLeft(e.residence_permit_until)!; return <span key={e.id}>{i > 0 && ', '}<b>{fullName(e)}</b> ({dmy(e.residence_permit_until)}{d < 0 ? (de ? ', abgelaufen' : ', đã hết hạn') : ''})</span> })}
          </div>
        )}

        <h2>{de ? 'Personalakten' : 'Hồ sơ nhân viên'}</h2>
        <div className="seg" style={{ marginBottom: 8 }}>
          <button className={tab === 'active' ? 'sel' : ''} onClick={() => setTab('active')}>{de ? 'Aktiv' : 'Đang làm'} ({active.length})</button>
          <button className={tab === 'left' ? 'sel' : ''} onClick={() => setTab('left')}>{de ? 'Ausgeschieden' : 'Đã nghỉ'} ({left.length})</button>
        </div>
        {(list?.length || 0) > 8 && <input placeholder={de ? 'Name suchen…' : 'Tìm tên…'} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />}
        {!list ? <Spinner /> : (
          <div className="list">
            {shown.map((e) => {
              const d = permitDaysLeft(e.residence_permit_until)
              return (
                <button key={e.id} className="it" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav(`/r/${rid}/hr/${e.id}`)}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t">{fullName(e) || '—'}</div>
                    <div className="small muted">
                      {[e.position && POSITIONS[e.position][li], e.employment_type && EMP_TYPES[e.employment_type][li], e.job_title].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="right small">
                    {tab === 'active'
                      ? <>{e.entry_date && <div className="muted">{de ? 'seit' : 'từ'} {dmy(e.entry_date)}</div>}
                          {d != null && d <= PERMIT_WARN_DAYS && <span className={`tag ${d < 0 ? 'err' : 'warn'}`}>{de ? 'Aufenthalt' : 'Cư trú'} {dmy(e.residence_permit_until)}</span>}</>
                      : <div className="muted">{de ? 'bis' : 'đến'} {dmy(e.exit_date)}</div>}
                  </div>
                </button>
              )
            })}
            {!shown.length && <div className="it muted">{de ? 'Keine Einträge' : 'Chưa có nhân viên'}</div>}
          </div>
        )}
      </div>

      <Sheet open={editCo != null} onClose={() => setEditCo(null)} title={de ? 'Firma des Restaurants' : 'Công ty của nhà hàng'}>
        <label className="f"><span>{de ? 'Firma (erscheint im Personalbogen)' : 'Tên công ty (Firma), in trên giấy tờ nhân viên'}</span>
          <input value={editCo || ''} onChange={(e) => setEditCo(e.target.value)} placeholder="Vietbowl Mitte GmbH" /></label>
        <button className="primary block" onClick={saveCompany}>{de ? 'Speichern' : 'Lưu'}</button>
      </Sheet>
    </>
  )
}
