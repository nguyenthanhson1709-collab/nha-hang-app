import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { canManage, useRole } from '../lib/app'
import { Top, useRestaurant } from '../components/ui'
import { useL } from '../hoadon/ui'
import { supabase } from '../lib/supabase'
import './datban.css'

/**
 * Ô Bàn đặt: mở chính trang nhân viên đặt bàn (public/dat-ban/staff.html, giống potsdamerplatz.vietbowl.de/mitarbeiter)
 * ở chế độ inapp=1. Cùng địa chỉ web nên dùng chung phiên đăng nhập của app: chủ/phụ trách vào thẳng, không nhập lại.
 * Sửa giao diện đặt bàn = sửa public/dat-ban (và web/ trong kho vietbowl-booking).
 */
export default function BkApp() {
  const { rid } = useParams()
  const r = useRestaurant(rid)
  const L = useL()
  const role = useRole(rid)
  // chỉ quán đã có cài đặt đặt bàn (hiện chỉ Vietbowl Mitte) mới dùng module này; kiểm tra song song, khung mở ngay
  const [has, setHas] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    supabase.from('nh_bk_settings').select('restaurant_id').eq('restaurant_id', rid!).maybeSingle().then(({ data }) => { if (live) setHas(!!data) })
    return () => { live = false }
  }, [rid])
  // khung cao đúng phần còn lại của màn hình (dưới thanh tiêu đề)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const fit = () => { const f = frame.current; if (f) f.style.height = `${Math.max(400, window.innerHeight - f.getBoundingClientRect().top - window.scrollY)}px` }
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [has])
  if (!canManage(role) || has === false) return <Navigate to={`/r/${rid}`} replace />
  return (
    <>
      <Top title={L('Bàn đặt', 'Reservierungen')} sub={r?.name} back={`/r/${rid}`} />
      <iframe ref={frame} className="bk-frame" title={L('Bàn đặt', 'Reservierungen')} src={`dat-ban/staff.html?inapp=1&lang=${L.lang}`} />
    </>
  )
}
