import type { ReactNode } from 'react'
import { Navigate, NavLink, useParams } from 'react-router-dom'
import { canManage, useRole } from '../lib/app'
import { Top, useRestaurant } from '../components/ui'
import { useL } from '../hoadon/ui'
import type { Status } from './api'
import './datban.css'

export { useL }

export const STATUS_LABEL: Record<'vi' | 'de', Record<Status, string>> = {
  vi: { pending: 'Chờ duyệt', confirmed: 'Đã xác nhận', seated: 'Đã đến', noshow: 'Không đến', cancelled: 'Khách huỷ', rejected: 'Từ chối' },
  de: { pending: 'Anfrage', confirmed: 'Bestätigt', seated: 'Angekommen', noshow: 'Nicht erschienen', cancelled: 'Storniert', rejected: 'Abgelehnt' },
}
export const SOURCE_LABEL = {
  vi: { online: 'Online', phone: 'Điện thoại', walkin: 'Khách vãng lai' },
  de: { online: 'Online', phone: 'Telefon', walkin: 'Laufkundschaft' },
}
export const DAY_NAMES = {
  vi: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
}
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
export const LOCALE = { vi: 'vi-VN', de: 'de-DE' }

export function errText(e: unknown, L: ReturnType<typeof useL>) {
  const m = String((e as Error)?.message || e)
  if (/full/.test(m)) return L('Vượt giới hạn khách giờ cao điểm.', 'Spitzenzeit-Limit überschritten.')
  if (/forbidden/.test(m)) return L('Bạn không có quyền làm việc này.', 'Keine Berechtigung.')
  if (/cancelled/.test(m)) return L('Đơn đã huỷ / từ chối, không đổi được.', 'Storniert / abgelehnt, nicht änderbar.')
  if (/name/.test(m)) return L('Cần có tên khách.', 'Name fehlt.')
  return m
}

/** Khung chung: tiêu đề + thanh mục (Đặt bàn, Sơ đồ bàn, Đánh giá, Cài đặt) */
export function BkShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { rid } = useParams()
  const r = useRestaurant(rid)
  const L = useL()
  const role = useRole(rid)
  const base = `/r/${rid}/bk`
  const items: [string, string][] = [
    [base, L('Đặt bàn', 'Reservierungen')], [`${base}/floor`, L('Sơ đồ bàn', 'Tischplan')],
    [`${base}/reviews`, L('Đánh giá', 'Bewertungen')], [`${base}/settings`, L('Cài đặt', 'Einstellungen')],
  ]
  if (!canManage(role)) return <Navigate to={`/r/${rid}`} replace />
  return (
    <>
      <Top title={L('Bàn đặt', 'Reservierungen')} sub={r?.name} back={`/r/${rid}`} />
      <div className={`page bk${wide ? ' bk-wide' : ''}`}>
        <nav className="inv-tabs">
          {items.map(([to, label]) => <NavLink key={to} to={to} end>{label}</NavLink>)}
        </nav>
        {children}
      </div>
    </>
  )
}

export function StatusPill({ s }: { s: Status }) {
  const L = useL()
  return <span className={`bk-pill st-${s}`}>{STATUS_LABEL[L.lang][s]}</span>
}

/** Lịch tháng: chấm màu theo tổng khách/ngày */
export function MonthCal({ month, value, onPick, onMonth, pax, closed }: {
  month: string; value: string; onPick: (d: string) => void; onMonth: (m: string) => void
  pax?: (d: string) => number; closed?: (d: string) => boolean
}) {
  const L = useL()
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1), off = (first.getDay() + 6) % 7, n = new Date(y, m, 0).getDate()
  const t = new Date(); const T = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  const title = first.toLocaleDateString(LOCALE[L.lang], { month: 'long', year: 'numeric' })
  const shift = (k: number) => { const d = new Date(y, m - 1 + k, 1); onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
  const cells: ReactNode[] = []
  for (let i = 0; i < off; i++) cells.push(<span key={`e${i}`} />)
  for (let d = 1; d <= n; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`
    const p = pax?.(ds) || 0
    const lv = p > 80 ? 'r' : p > 40 ? 'y' : 'g'
    cells.push(
      <button key={ds} type="button" className={`bk-cd${ds === T ? ' today' : ''}${ds < T ? ' past' : ''}${closed?.(ds) ? ' closed' : ''}${ds === value ? ' on' : ''}`} onClick={() => onPick(ds)}>
        {d}{p > 0 && <i className={`dot ${lv}`} title={String(p)} />}
      </button>,
    )
  }
  return (
    <div className="bk-cal">
      <div className="bk-cal-h"><button type="button" className="ghost" onClick={() => shift(-1)}>‹</button><b>{title}</b><button type="button" className="ghost" onClick={() => shift(1)}>›</button></div>
      <div className="bk-cal-w">{DAY_ORDER.map((i) => <span key={i}>{DAY_NAMES[L.lang][i]}</span>)}</div>
      <div className="bk-cal-g">{cells}</div>
      {pax && <div className="bk-cal-leg"><span><i className="dot g" />0–40</span><span><i className="dot y" />41–80</span><span><i className="dot r" />81+ {L('khách', 'Gäste')}</span></div>}
    </div>
  )
}
