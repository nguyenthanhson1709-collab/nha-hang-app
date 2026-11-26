import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listInvoices, setInvoiceStatus } from '../api'
import type { Invoice, InvoiceStatus } from '../types'
import { fmtDate, fmtEur, todayIso } from '../money'
import { InvShell, StatusBadge, useL } from '../ui'

type Filter = 'all' | InvoiceStatus | 'overdue'

export default function Invoices({ docType = 'invoice' }: { docType?: 'invoice' | 'quote' }) {
  const { rid } = useParams()
  const L = useL()
  const quote = docType === 'quote'
  const base = `/r/${rid}/inv`
  const [rows, setRows] = useState<Invoice[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const nav = useNavigate()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function togglePaid(r: Invoice) {
    const next = r.status === 'paid' ? 'open' : 'paid'
    setBusyId(r.id); setErr('')
    try {
      await setInvoiceStatus(r.id, next)
      setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, status: next, paid_at: next === 'paid' ? todayIso() : null } : x))
    } catch (e) { setErr((e as Error).message) } finally { setBusyId(null) }
  }

  useEffect(() => {
    setLoading(true); setFilter('all')
    listInvoices(rid!, docType).then(setRows).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }, [rid, docType])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const today = todayIso()
    return rows.filter((r) => {
      if (filter === 'overdue' ? !(r.status === 'open' && r.due_date && r.due_date < today) : filter !== 'all' && r.status !== filter) return false
      if (!t) return true
      return (r.invoice_number ?? '').toLowerCase().includes(t) || (r.customer_snapshot?.name ?? '').toLowerCase().includes(t)
    })
  }, [rows, q, filter])

  const openSum = rows.filter((r) => r.status === 'open').reduce((s, r) => s + Number(r.total_gross), 0)

  return (
    <InvShell>
      <div className="toolbar">
        <h1 className="ititle grow">{quote ? L('Angebot (báo giá)', 'Angebote') : L('Hoá đơn', 'Rechnungen')}</h1>
        {quote ? <Link to={`${base}/quotes/new`} className="btn primary">+ {L('Angebot mới', 'Neues Angebot')}</Link> : <>
          <Link to={`${base}/quotes/new`} className="btn">+ Angebot</Link>
          <Link to={`${base}/new`} className="btn primary">+ {L('Hoá đơn mới', 'Neue Rechnung')}</Link>
        </>}
      </div>
      {err && <div className="err">{err}</div>}
      <div className="toolbar">
        <input className="grow" placeholder={L('Tìm số hoá đơn hoặc tên khách…', 'Nummer oder Kunde suchen…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ width: 'auto' }}>
          <option value="all">{L('Tất cả', 'Alle')}</option>
          <option value="draft">{L('Nháp', 'Entwurf')}</option>
          {quote ? <>
            <option value="open">{L('Đang chờ', 'Offen')}</option>
            <option value="overdue">{L('Hết hạn', 'Abgelaufen')}</option>
            <option value="accepted">{L('Đã chuyển hoá đơn', 'Angenommen')}</option>
            <option value="cancelled">{L('Bị từ chối', 'Abgelehnt')}</option>
          </> : <>
            <option value="open">{L('Chưa thanh toán', 'Offen')}</option>
            <option value="overdue">{L('Quá hạn', 'Überfällig')}</option>
            <option value="paid">{L('Đã thanh toán', 'Bezahlt')}</option>
            <option value="cancelled">{L('Đã huỷ', 'Storniert')}</option>
          </>}
        </select>
      </div>
      <p className="sum">{quote ? L('Đang chờ', 'Offen') : L('Chưa thanh toán', 'Offen')}: <b>{fmtEur(openSum)}</b></p>
      {loading ? <div className="center" style={{ minHeight: 160 }}><div className="spinner" /></div> : shown.length === 0 ? <div className="card muted">{quote ? L('Chưa có Angebot nào.', 'Noch keine Angebote.') : L('Chưa có hoá đơn nào.', 'Noch keine Rechnungen.')}</div> : (
        <div className="tcard">
          <table className="itab">
            <thead><tr><th>{L('Số', 'Nr.')}</th><th className="hide-m">{L('Ngày', 'Datum')}</th><th>{L('Khách hàng', 'Kunde')}</th><th>{L('Trạng thái', 'Status')}</th><th className="n">{L('Tổng', 'Betrag')}</th>{!quote && <th className="n">{L('Thanh toán', 'Bezahlt')}</th>}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`${base}/${quote ? 'quotes/' : ''}${r.id}`)}>
                  <td>{r.invoice_number ?? <span className="muted">—</span>}</td>
                  <td className="hide-m">{fmtDate(r.invoice_date)}</td>
                  <td>{r.customer_snapshot?.name || <span className="muted">{L('(chưa có khách)', '(ohne Kunde)')}</span>}</td>
                  <td><StatusBadge inv={r} /></td>
                  <td className="n">{fmtEur(r.total_gross)}</td>
                  {!quote && <td className="n" onClick={(e) => e.stopPropagation()}>
                    {(r.status === 'open' || r.status === 'paid') && (
                      <label className={`paid-toggle${r.status === 'paid' ? ' on' : ''}`}>
                        <input type="checkbox" checked={r.status === 'paid'} disabled={busyId === r.id} onChange={() => togglePaid(r)} />
                        <span>{L('Đã thanh toán', 'Bezahlt')}</span>
                      </label>
                    )}
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </InvShell>
  )
}
