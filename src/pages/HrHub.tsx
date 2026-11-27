import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { Top, useRestaurant } from '../components/ui'
import { LangSwitch } from '../components/LangSwitch'
import { Lucide } from './Home'
import { isActive, type Employee } from '../lib/hr'

/** Trang Nhân sự: hai ô riêng, Nhân viên (danh sách hồ sơ) và Xếp lịch */
export default function HrHub() {
  const { rid } = useParams()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const de = useLang().lang === 'de'
  const T = (vi: string, g: string) => (de ? g : vi)
  const [n, setN] = useState<number | null>(null)
  const [company, setCompany] = useState<string | null>(null)
  useEffect(() => { const el = document.getElementById('root'); el?.classList.add('xwide'); return () => el?.classList.remove('xwide') }, [])
  useEffect(() => {
    if (!rid) return
    supabase.from('nh_employees').select('exit_date').eq('restaurant_id', rid)
      .then(({ data }) => setN((data || []).filter((e) => isActive(e as Employee)).length))
    supabase.from('nh_hr_settings').select('company_name').eq('restaurant_id', rid).maybeSingle()
      .then(({ data }) => setCompany((data as { company_name: string | null } | null)?.company_name || null))
  }, [rid])
  if (!r || !canManage(role)) return null
  const tiles = [
    { icon: 'people', label: T('Nhân viên', 'Mitarbeiter'), desc: n != null ? T(`${n} đang làm · hồ sơ, hợp đồng, bảng lương`, `${n} aktiv · Akten, Verträge, Lohnabrechnungen`) : T('Hồ sơ, hợp đồng, bảng lương', 'Akten, Verträge, Lohnabrechnungen'), to: `/r/${rid}/hr/list` },
    { icon: 'calendar', label: T('Xếp lịch', 'Dienstplan'), desc: T('Lịch làm việc và giờ làm theo tháng', 'Dienstplan und Arbeitszeiten je Monat'), to: `/r/${rid}/plan` },
  ]
  return (
    <>
      <Top title={T('Nhân sự', 'Personal')} sub={company || r.name} back={`/r/${rid}`} right={<LangSwitch />} />
      <div className="page dash">
        <div className="dash-grid">
          {tiles.map((x) => (
            <button key={x.to} className="dcard" onClick={() => nav(x.to)}>
              <span className="dcard-top">
                <span className="dcard-ic"><Lucide k={x.icon} /></span>
                <span className="dcard-go"><Lucide k="arrow" /></span>
              </span>
              <span className="dcard-t">{x.label}</span>
              <span className="dcard-d">{x.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
