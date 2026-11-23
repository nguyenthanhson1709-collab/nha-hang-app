import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { canManage, useApp, useRole } from '../lib/app'
import { parseNum } from '../lib/format'

export function Spinner() { return <div className="center"><div className="spinner" /></div> }

export function Top({ title, sub, back, right }: { title: string; sub?: string; back?: string | boolean; right?: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="top">
      {back && <button className="ghost" aria-label="back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>←</button>}
      <div className="grow">
        <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

const I = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  scan: <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M4 12h16" />,
  book: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
}
const Icon = ({ k }: { k: keyof typeof I }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{I[k]}</svg>
)

export function BottomNav({ rid }: { rid: string }) {
  const t = useT()
  const role = useRole(rid)
  const m = canManage(role)
  return (
    <nav className="nav"><div className="in">
      <NavLink to={`/r/${rid}`} end><Icon k="home" />{t('home')}</NavLink>
      <NavLink to={`/r/${rid}/scan`}><Icon k="scan" />{t('scan')}</NavLink>
      {m && <NavLink to={`/r/${rid}/kb`}><Icon k="book" />{t('kassenbuch')}</NavLink>}
      {m && <NavLink to={`/r/${rid}/archive`}><Icon k="folder" />{t('archive')}</NavLink>}
      {m && <NavLink to={`/r/${rid}/reports`}><Icon k="chart" />{t('reports')}</NavLink>}
    </div></nav>
  )
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  if (!open) return null
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

let toastSet: ((s: string) => void) | null = null
export function toast(s: string) { toastSet?.(s) }
export function Toaster() {
  const [msg, setMsg] = useState('')
  useEffect(() => { toastSet = setMsg; return () => { toastSet = null } }, [])
  useEffect(() => { if (msg) { const id = setTimeout(() => setMsg(''), 2600); return () => clearTimeout(id) } }, [msg])
  return msg ? <div className="toast">{msg}</div> : null
}

/** Ô nhập tiền kiểu Đức (dấu phẩy) */
export function Money({ value, onChange, className, placeholder, disabled }: { value: number | null; onChange: (n: number) => void; className?: string; placeholder?: string; disabled?: boolean }) {
  const fmt = (n: number | null) => (n == null || isNaN(n) ? '' : n.toFixed(2).replace('.', ','))
  const [s, setS] = useState(fmt(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setS(fmt(value)) }, [value, focus])
  return (
    <input inputMode="decimal" className={className} placeholder={placeholder} disabled={disabled} value={s}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); setS(fmt(parseNum(s))) }}
      onChange={(e) => { setS(e.target.value); onChange(parseNum(e.target.value)) }} />
  )
}

export function PayTag({ m }: { m: string }) {
  const t = useT()
  return <span className={`tag ${m}`}>{t(m as 'cash')}</span>
}

export function useRestaurant(rid: string | undefined) {
  const { restaurants } = useApp()
  return restaurants.find((r) => r.id === rid)
}

/** Ô chọn có danh sách cuộn + gõ tay giá trị mới (thay datalist, iPhone hiển thị kém) */
export function ComboInput({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const q = value.trim().toLowerCase()
  const exact = options.some((o) => o.toLowerCase() === q)
  const shown = (q && !exact ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, 200)
  return (
    <div className="combo">
      <div className="row" style={{ gap: 6 }}>
        <input value={value} placeholder={placeholder} onChange={(e) => { onChange(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} style={{ flex: 1 }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)} style={{ minWidth: 44 }}>▾</button>
      </div>
      {open && (shown.length > 0 || (q && !exact)) && (
        <div className="combo-list">
          {q && !exact && <div className="combo-it muted small">+ „{value.trim()}"</div>}
          {shown.map((o) => (
            <div key={o} className={`combo-it ${o === value ? 'sel' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o); setOpen(false) }}>{o}</div>
          ))}
        </div>
      )}
    </div>
  )
}
