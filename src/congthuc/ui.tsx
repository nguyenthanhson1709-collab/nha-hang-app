import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { canManage, useApp, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { Top, useRestaurant } from '../components/ui'
import { ALLERGENS, STATUS, type Status } from './rc'
import { uploadPhoto } from './api'
import './congthuc.css'

/** Chữ theo ngôn ngữ giao diện: L('tiếng Việt', 'Deutsch') */
export function useL() {
  const { lang } = useLang()
  const de = lang === 'de'
  return Object.assign((vi: string, d: string) => (de ? d : vi), { de })
}

/** Quyền trong module: chủ sửa tất cả, phụ trách sửa món của quán mình, nhân viên chỉ xem */
export function useRcPerm() {
  const { rid } = useParams()
  const { profile, roles, restaurants } = useApp()
  const role = useRole(rid)
  const anyManager = profile.is_owner || Object.values(roles).includes('manager')
  const manageable = profile.is_owner ? restaurants.map((r) => r.id) : Object.entries(roles).filter(([, v]) => v === 'manager').map(([k]) => k)
  const canEdit = (rids: string[]) => profile.is_owner || (!rids.length ? anyManager : rids.some((x) => manageable.includes(x)))
  return { owner: profile.is_owner, manager: canManage(role), anyManager, manageable, canEdit }
}

export function RcShell({ title, children, back, tabs = true, right }: { title?: string; children: ReactNode; back?: string; tabs?: boolean; right?: ReactNode }) {
  const { rid } = useParams()
  const r = useRestaurant(rid)
  const L = useL()
  const { anyManager } = useRcPerm()
  const base = `/r/${rid}/rc`
  const items: [string, string][] = [
    [base, L('Món ăn', 'Gerichte')],
    [`${base}/concepts`, 'Concepts'],
    ...(anyManager ? [[`${base}/ing`, L('Nguyên liệu & giá', 'Zutaten & Preise')] as [string, string]] : []),
  ]
  return (
    <>
      <Top title={title || L('Concept & Công thức', 'Konzepte & Rezepte')} sub={r?.name} back={back || `/r/${rid}`} right={right} />
      <div className="page rc">
        {tabs && (
          <nav className="inv-tabs rc-tabs">
            {items.map(([to, label]) => <NavLink key={to} to={to} end>{label}</NavLink>)}
          </nav>
        )}
        {children}
      </div>
    </>
  )
}

export function StatusBadge({ s }: { s: Status }) {
  const L = useL()
  return <span className={`rc-badge st-${s}`}>{L(STATUS[s].vi, STATUS[s].de)}</span>
}

export function AllergenChips({ codes, long }: { codes: string[]; long?: boolean }) {
  const L = useL()
  if (!codes.length) return <span className="muted small">{L('Không có chất gây dị ứng chính', 'Keine Hauptallergene')}</span>
  return (
    <span className="rc-allg">
      {codes.map((c) => {
        const a = ALLERGENS.find((x) => x.c === c)
        return <span key={c} className="rc-al" title={a ? L(a.vi, a.de) : c}><b>{c}</b>{long && a && <> {L(a.vi, a.de)}</>}</span>
      })}
    </span>
  )
}

export function AllergenPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const L = useL()
  return (
    <div className="rc-alpick">
      {ALLERGENS.map((a) => {
        const on = value.includes(a.c)
        return (
          <button type="button" key={a.c} className={on ? 'sel' : ''} onClick={() => onChange(on ? value.filter((x) => x !== a.c) : [...value, a.c])}>
            <b>{a.c}</b> {L(a.vi, a.de)}
          </button>
        )
      })}
    </div>
  )
}

/** Ô ảnh: bấm để chọn/chụp, có nút xoá */
export function PhotoInput({ path, url, onChange, label, small }: { path: string | null; url?: string; onChange: (p: string | null) => void; label: string; small?: boolean }) {
  const L = useL()
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true); setErr('')
    try { onChange(await uploadPhoto(f)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className={`rc-photo-in${small ? ' small' : ''}`}>
      <button type="button" className={small && !path ? 'small' : 'rc-photo-btn'} onClick={() => ref.current?.click()} disabled={busy}>
        {path && url ? <img src={url} alt="" /> : <span className="muted small">{busy ? L('Đang tải…', 'Lädt…') : `+ ${label}`}</span>}
      </button>
      {path && <button type="button" className="ghost small" onClick={() => onChange(null)}>{L('Bỏ ảnh', 'Foto entfernen')}</button>}
      {err && <div className="err-t small">{err}</div>}
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

/** Bảng sắp xếp bằng cách bấm tiêu đề cột (người dùng thích kiểu này) */
export function useSort<K extends string>(init: K, dir: 1 | -1 = 1) {
  const [s, setS] = useState<{ k: K; d: 1 | -1 }>({ k: init, d: dir })
  const th = (k: K, label: ReactNode, cls = '') => (
    <th className={`rc-th ${cls}`} onClick={() => setS((o) => ({ k, d: o.k === k ? (o.d === 1 ? -1 : 1) : 1 }))}>
      {label}{s.k === k ? (s.d === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )
  return { key: s.k, dir: s.d, th }
}

/** Ô nhập số kiểu Đức: gõ được dấu phẩy (1,5). Giữ nguyên chữ đang gõ, chỉ đổi thành số khi gửi lên. */
export function NumInput({ value, onChange, className, placeholder, numeric }: { value: number | null | undefined; onChange: (n: number | null) => void; className?: string; placeholder?: string; numeric?: boolean }) {
  const fmt = (n: number | null | undefined) => (n == null || isNaN(Number(n)) ? '' : String(Number(n)).replace('.', ','))
  const [s, setS] = useState(fmt(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setS(fmt(value)) }, [value, focus])
  return (
    <input className={className} inputMode={numeric ? 'numeric' : 'decimal'} placeholder={placeholder} value={s}
      onFocus={(e) => { setFocus(true); const el = e.currentTarget; setTimeout(() => el.select(), 0) }}
      onBlur={() => { setFocus(false); setS(fmt(value)) }}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.,-]/g, '')
        setS(v)
        const t = v.replace(/\./g, '').replace(',', '.')
        const n = Number(t.includes('.') ? t : v.replace(',', '.'))
        onChange(v.trim() === '' || isNaN(n) ? null : n)
      }} />
  )
}
