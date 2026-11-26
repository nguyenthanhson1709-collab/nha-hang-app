import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listArticles, saveArticle } from '../api'
import type { Article } from '../types'
import { fmt, fmtEur, parseNum, round2 } from '../money'
import { InvShell, useL } from '../ui'

const blank: Partial<Article> = { number: '', name: '', description: '', unit: 'Stück', tax_rate: 7, price_gross: 0, price_net: 0, is_lunch: false, archived: false }

export default function Articles() {
  const { rid } = useParams()
  const L = useL()
  const [rows, setRows] = useState<Article[]>([])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'normal' | 'lunch'>('normal')
  const [edit, setEdit] = useState<Partial<Article> | null>(null)
  const [priceText, setPriceText] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(() => listArticles(rid!, true).then(setRows).catch((e) => setErr(e.message)), [rid])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows
      .filter((r) => (kind === 'all' || (kind === 'lunch') === r.is_lunch) && (!t || r.number === t || `${r.number} ${r.name}`.toLowerCase().includes(t)))
      .sort((a, b) => (parseInt(a.number) || 99999) - (parseInt(b.number) || 99999) || a.name.localeCompare(b.name))
  }, [rows, q, kind])

  function open(a: Partial<Article>) { setEdit(a); setPriceText(fmt(a.price_gross ?? 0)); setErr('') }
  async function save() {
    if (!edit?.name?.trim()) { setErr(L('Cần có tên.', 'Name fehlt.')); return }
    const gross = round2(parseNum(priceText))
    const rate = Number(edit.tax_rate ?? 7)
    try {
      await saveArticle(rid!, { ...edit, price_gross: gross, price_net: round2(gross / (1 + rate / 100)), tax_rate: rate })
      setEdit(null); load()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <InvShell>
      <div className="toolbar">
        <h1 className="ititle grow">{L('Món ăn & dịch vụ', 'Artikel & Leistungen')}</h1>
        <button className="primary" onClick={() => open({ ...blank })}>+ {L('Món mới', 'Neuer Artikel')}</button>
      </div>
      {err && !edit && <div className="err">{err}</div>}
      <div className="toolbar">
        <input className="grow" placeholder={L('Tìm số món hoặc tên…', 'Nummer oder Name…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={{ width: 'auto' }}>
          <option value="normal">{L('Giá thường', 'Normalpreis')}</option>
          <option value="lunch">{L('Giá trưa (Mittag)', 'Mittagspreis')}</option>
          <option value="all">{L('Tất cả', 'Alle')}</option>
        </select>
      </div>
      <p className="sum">{shown.length} {L('mục', 'Einträge')}</p>
      {shown.length > 0 && (
        <div className="tcard">
          <table className="itab">
            <thead><tr><th>{L('Số', 'Nr.')}</th><th>{L('Tên', 'Name')}</th><th className="hide-m">USt</th><th className="n hide-m">Netto</th><th className="n">Brutto</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => open(r)} style={r.archived ? { opacity: .5 } : undefined}>
                  <td>{r.number}</td>
                  <td>{r.name}{r.is_lunch && <span className="ibadge plain" style={{ marginLeft: 6 }}>Mittag</span>}{r.description && <div className="muted small">{r.description}</div>}</td>
                  <td className="hide-m">{fmt(r.tax_rate).replace(',00', '')}%</td>
                  <td className="n hide-m">{fmtEur(r.price_net)}</td>
                  <td className="n">{fmtEur(r.price_gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <div className="inv-modal-bg" onClick={() => setEdit(null)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{edit.id ? L('Sửa món', 'Artikel bearbeiten') : L('Món mới', 'Neuer Artikel')}</h2>
            {err && <div className="err">{err}</div>}
            <div className="frow">
              <div style={{ flex: '0 1 110px' }}><span className="lbl">{L('Số món', 'Nr.')}</span><input value={edit.number ?? ''} onChange={(e) => setEdit((x) => ({ ...x, number: e.target.value }))} /></div>
              <div><span className="lbl">{L('Tên', 'Name')}</span><input value={edit.name ?? ''} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} /></div>
            </div>
            <div className="mt"><span className="lbl">{L('Mô tả', 'Beschreibung')}</span>
              <textarea value={edit.description ?? ''} onChange={(e) => setEdit((x) => ({ ...x, description: e.target.value }))} /></div>
            <div className="frow mt">
              <div><span className="lbl">{L('Giá (gồm USt) €', 'Preis brutto €')}</span><input inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} /></div>
              <div><span className="lbl">USt</span>
                <select value={edit.tax_rate ?? 7} onChange={(e) => setEdit((x) => ({ ...x, tax_rate: Number(e.target.value) }))}>
                  <option value={7}>7% {L('(đồ ăn)', '(Speisen)')}</option><option value={19}>19% {L('(đồ uống, dịch vụ)', '(Getränke, Leistungen)')}</option><option value={0}>0%</option>
                </select></div>
              <div><span className="lbl">{L('Đơn vị', 'Einheit')}</span><input value={edit.unit ?? ''} onChange={(e) => setEdit((x) => ({ ...x, unit: e.target.value }))} /></div>
            </div>
            <p className="muted small">Netto: {fmtEur(round2(parseNum(priceText) / (1 + Number(edit.tax_rate ?? 7) / 100)))}</p>
            <label className="chk"><input type="checkbox" checked={Boolean(edit.is_lunch)} onChange={(e) => setEdit((x) => ({ ...x, is_lunch: e.target.checked }))} /> {L('Giá trưa (Mittag)', 'Mittagspreis')}</label>
            <label className="chk mt"><input type="checkbox" checked={Boolean(edit.archived)} onChange={(e) => setEdit((x) => ({ ...x, archived: e.target.checked }))} /> {L('Lưu trữ (ẩn khi tạo hoá đơn)', 'Archivieren (nicht mehr zur Auswahl)')}</label>
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 14, marginBottom: 0 }}>
              <button onClick={() => setEdit(null)}>{L('Thôi', 'Abbrechen')}</button>
              <button className="primary" onClick={save}>{L('Lưu', 'Speichern')}</button>
            </div>
          </div>
        </div>
      )}
    </InvShell>
  )
}
