import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, NavLink, useParams } from 'react-router-dom'
import { canManage, useRole } from '../lib/app'
import { useLang } from '../lib/i18n'
import { Top, useRestaurant } from '../components/ui'
import type { Invoice } from './types'
import { QUOTE_STATUS_LABEL, STATUS_LABEL } from './types'
import { todayIso } from './money'
import './hoadon.css'

/** Chữ theo ngôn ngữ giao diện: L('tiếng Việt', 'Deutsch') */
export function useL() {
  const { lang } = useLang()
  const de = lang === 'de'
  return Object.assign((vi: string, d: string) => (de ? d : vi), { de, lang: (de ? 'de' : 'vi') as 'vi' | 'de' })
}

export function StatusBadge({ inv }: { inv: Invoice }) {
  const L = useL()
  const quote = inv.doc_type === 'quote'
  const overdue = inv.status === 'open' && inv.due_date && inv.due_date < todayIso()
  if (quote) return <span className={`ibadge ${inv.status === 'accepted' ? 'paid' : inv.status}`}>{overdue ? L('Hết hạn', 'Abgelaufen') : QUOTE_STATUS_LABEL[L.lang][inv.status]}</span>
  return <span className={`ibadge ${overdue ? 'overdue' : inv.status}`}>{overdue ? L('Quá hạn', 'Überfällig') : STATUS_LABEL[L.lang][inv.status]}</span>
}

/** Khung chung của module: tiêu đề + thanh mục (Hoá đơn, Angebot, Khách hàng, Món, Cài đặt) */
export function InvShell({ title, children, back, tabs = true }: { title?: string; children: ReactNode; back?: string; tabs?: boolean }) {
  const { rid } = useParams()
  const r = useRestaurant(rid)
  const L = useL()
  const role = useRole(rid)
  const base = `/r/${rid}/inv`
  const items: [string, string][] = [
    [base, L('Hoá đơn', 'Rechnungen')], [`${base}/quotes`, 'Angebote'], [`${base}/customers`, L('Khách hàng', 'Kunden')],
    [`${base}/articles`, L('Món & dịch vụ', 'Artikel')], [`${base}/settings`, L('Cài đặt', 'Einstellungen')],
  ]
  // Chỉ chủ + người phụ trách viết hoá đơn
  if (!canManage(role)) return <Navigate to={`/r/${rid}`} replace />
  return (
    <>
      <Top title={title || L('Viết hoá đơn', 'Rechnungen schreiben')} sub={r?.name} back={back || `/r/${rid}`} />
      <div className="page inv">
        {tabs && (
          <nav className="inv-tabs">
            {items.map(([to, label]) => <NavLink key={to} to={to} end>{label}</NavLink>)}
          </nav>
        )}
        {children}
      </div>
    </>
  )
}

export const splitEmails = (v: string | null | undefined) => (v ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)

/** Danh sách email: mỗi email một ô, nút thêm / xoá. Giá trị lưu dạng "a@x.de, b@y.de". */
export function EmailList({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const L = useL()
  const [rows, setRows] = useState<string[]>(() => { const r = splitEmails(value); return r.length ? r : [''] })
  useEffect(() => {
    if (splitEmails(rows.join(',')).join(', ') !== splitEmails(value).join(', ')) {
      const r = splitEmails(value); setRows(r.length ? r : [''])
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: string[]) => { setRows(next); onChange(splitEmails(next.join(',')).join(', ')) }
  return (
    <div className="email-list">
      {rows.map((r, i) => (
        <div key={i} className="email-row">
          <input type="email" inputMode="email" autoComplete="off" placeholder={placeholder} value={r}
            onChange={(e) => set(rows.map((x, j) => (j === i ? e.target.value : x)))}
            onPaste={(e) => {
              const parts = splitEmails(e.clipboardData.getData('text'))
              if (parts.length > 1) { e.preventDefault(); set([...rows.slice(0, i), ...parts, ...rows.slice(i + 1)].filter(Boolean)) }
            }} />
          {(rows.length > 1 || r) && <button type="button" className="sm" title={L('Xoá email này', 'E-Mail entfernen')} onClick={() => set(rows.length > 1 ? rows.filter((_, j) => j !== i) : [''])}>✕</button>}
        </div>
      ))}
      <button type="button" className="sm" onClick={() => setRows([...rows, ''])}>+ {L('Thêm email', 'E-Mail hinzufügen')}</button>
    </div>
  )
}
