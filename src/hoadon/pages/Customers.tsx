import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listCustomers, saveCustomer } from '../api'
import type { Customer } from '../types'
import { COUNTRIES } from '../countries'
import { EmailList, InvShell, useL } from '../ui'

const blank: Partial<Customer> = { kind: 'customer', name: '', street: '', supplement: '', supplement2: '', zip: '', city: '', country: 'DE', emails: '', phone: '', vat_id: '', note: '', archived: false }

export default function Customers() {
  const { rid } = useParams()
  const L = useL()
  const [rows, setRows] = useState<Customer[]>([])
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Partial<Customer> | null>(null)
  const [sup2, setSup2] = useState(false)
  useEffect(() => { if (!edit) setSup2(false) }, [edit])
  const [err, setErr] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(() => listCustomers(rid!, true).then(setRows).catch((e) => setErr(e.message)), [rid])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter((r) => (showArchived || !r.archived) && (!t || r.name.toLowerCase().includes(t) || String(r.customer_number ?? '').includes(t) || r.emails.toLowerCase().includes(t)))
  }, [rows, q, showArchived])

  async function save() {
    if (!edit?.name?.trim()) { setErr(L('Cần có tên.', 'Name fehlt.')); return }
    try { await saveCustomer(rid!, edit); setEdit(null); setErr(''); load() } catch (e) { setErr((e as Error).message) }
  }
  const f = (k: keyof Customer) => ({
    value: String(edit?.[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setEdit((x) => ({ ...x, [k]: e.target.value })),
  })

  return (
    <InvShell>
      <div className="toolbar">
        <h1 className="ititle grow">{L('Khách hàng', 'Kunden')}</h1>
        <button className="primary" onClick={() => { setErr(''); setEdit({ ...blank }) }}>+ {L('Khách hàng mới', 'Neuer Kunde')}</button>
      </div>
      {err && !edit && <div className="err">{err}</div>}
      <div className="toolbar">
        <input className="grow" placeholder={L('Tìm tên, mã khách, email…', 'Name, Kundennr., E-Mail…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="chk"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> {L('Hiện cả đã lưu trữ', 'Archivierte zeigen')}</label>
      </div>
      <p className="sum">{shown.length} {L('khách', 'Kunden')}</p>
      {shown.length > 0 && (
        <div className="tcard">
          <table className="itab">
            <thead><tr><th>{L('Mã', 'Nr.')}</th><th>{L('Tên', 'Name')}</th><th className="hide-m">{L('Địa chỉ', 'Adresse')}</th><th className="hide-m">E-Mail</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => { setErr(''); setEdit(r) }}>
                  <td>{r.customer_number}</td>
                  <td>{r.name}{r.kind === 'vendor' && <span className="ibadge plain" style={{ marginLeft: 6 }}>{L('Nhà cung cấp', 'Lieferant')}</span>}{r.archived && <span className="ibadge draft" style={{ marginLeft: 6 }}>{L('Lưu trữ', 'Archiv')}</span>}</td>
                  <td className="hide-m">{r.street}{r.street && ', '}{r.zip} {r.city}</td>
                  <td className="hide-m muted">{r.emails}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <div className="inv-modal-bg" onClick={() => setEdit(null)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{edit.id ? L('Sửa khách hàng', 'Kunde bearbeiten') : L('Khách hàng mới', 'Neuer Kunde')}</h2>
            {err && <div className="err">{err}</div>}
            <div className="frow">
              <div><span className="lbl">{L('Mã khách (để trống = tự động)', 'Kundennr. (leer = automatisch)')}</span><input inputMode="numeric" value={edit.customer_number ?? ''} onChange={(e) => setEdit((x) => ({ ...x, customer_number: e.target.value ? Number(e.target.value) : null }))} /></div>
              <div><span className="lbl">{L('Loại', 'Art')}</span><select {...f('kind')}><option value="customer">{L('Khách hàng', 'Kunde')}</option><option value="vendor">{L('Nhà cung cấp', 'Lieferant')}</option></select></div>
            </div>
            <div className="mt"><span className="lbl">{L('Tên công ty / người', 'Firma / Name')}</span><input {...f('name')} /></div>
            <div className="mt"><span className="lbl">{L('Người nhận / phòng ban (Adresszusatz)', 'Adresszusatz')}</span><input {...f('supplement')} />
              {edit.supplement2 || sup2
                ? <div className="mt email-row"><input placeholder="Adresszusatz 2" {...f('supplement2')} /><button type="button" className="sm" onClick={() => { setEdit((x) => ({ ...x, supplement2: '' })); setSup2(false) }}>✕</button></div>
                : <div className="mt"><button type="button" className="sm" onClick={() => setSup2(true)}>+ {L('Thêm dòng địa chỉ', 'Weitere Adresszeile')}</button></div>}</div>
            <div className="mt"><span className="lbl">{L('Đường, số nhà', 'Straße')}</span><input {...f('street')} /></div>
            <div className="frow mt">
              <div style={{ flex: '0 1 120px' }}><span className="lbl">PLZ</span><input {...f('zip')} /></div>
              <div><span className="lbl">{L('Thành phố', 'Ort')}</span><input {...f('city')} /></div>
              <div><span className="lbl">{L('Nước', 'Land')}</span>
                <select {...f('country')}>
                  {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  {edit.country && !COUNTRIES.some(([c]) => c === edit.country) && <option value={edit.country}>{edit.country}</option>}
                </select></div>
            </div>
            <div className="mt"><span className="lbl">{L('Email nhận hoá đơn', 'E-Mail für Rechnungen')}</span><EmailList value={edit.emails ?? ''} onChange={(v) => setEdit((x) => ({ ...x, emails: v }))} /></div>
            <div className="frow mt">
              <div><span className="lbl">{L('Điện thoại', 'Telefon')}</span><input {...f('phone')} /></div>
              <div><span className="lbl">USt-IdNr.</span><input {...f('vat_id')} /></div>
            </div>
            <div className="mt"><span className="lbl">{L('Ghi chú', 'Notiz')}</span><textarea {...f('note')} /></div>
            <label className="chk mt"><input type="checkbox" checked={Boolean(edit.archived)} onChange={(e) => setEdit((x) => ({ ...x, archived: e.target.checked }))} /> {L('Lưu trữ (ẩn khỏi danh sách chọn)', 'Archivieren (nicht mehr zur Auswahl)')}</label>
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 14, marginBottom: 0 }}>
              <button onClick={() => { setEdit(null); setErr('') }}>{L('Thôi', 'Abbrechen')}</button>
              <button className="primary" onClick={save}>{L('Lưu', 'Speichern')}</button>
            </div>
          </div>
        </div>
      )}
    </InvShell>
  )
}
