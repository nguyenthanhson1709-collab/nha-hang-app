import { useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Spinner, toast } from '../../components/ui'
import { dmy } from '../../lib/format'
import { BASE_PRICE_LABEL, fmtEur, fmtPct, guessPack, ingPrice, priceRise, RISE_WARN, usedIn, type BaseUnit, type Ingredient } from '../rc'
import { deleteIngredient, findLines, priceHistory, refreshPrices, saveIngredient, useRc, type FoundLine, type PricePoint } from '../api'
import { AllergenChips, AllergenPicker, RcShell, useL, useRcPerm, useSort } from '../ui'

const parse = (v: string) => { const n = Number(v.replace(',', '.')); return v.trim() === '' || isNaN(n) ? null : n }
const show = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

export default function Ingredients() {
  const { rid } = useParams()
  const L = useL()
  const perm = useRcPerm()
  const { s, err, reload } = useRc()
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'rise' | 'noprice' | 'nolink'>('all')
  const [edit, setEdit] = useState<Partial<Ingredient> | null>(null)
  const [busy, setBusy] = useState(false)
  const sort = useSort<'name' | 'price' | 'rise' | 'date' | 'used'>('name')

  const rows = useMemo(() => {
    if (!s) return []
    const t = q.trim().toLowerCase()
    const xs = s.ingList
      .filter((i) => !t || `${i.name} ${i.name_de || ''} ${i.match_name || ''}`.toLowerCase().includes(t))
      .map((i) => ({ i, p: ingPrice(i), rise: priceRise(i), used: usedIn(i.id, s).length }))
      .filter((x) => only === 'all' || (only === 'rise' ? (x.rise ?? 0) >= RISE_WARN : only === 'noprice' ? x.p == null : !x.i.match_name))
    const k = sort.key, d = sort.dir
    const v = (x: typeof xs[number]) => (k === 'name' ? x.i.name.toLowerCase() : k === 'price' ? x.p ?? -1 : k === 'rise' ? x.rise ?? -999 : k === 'date' ? x.i.price_date || '' : x.used)
    return xs.sort((a, b) => (v(a) < v(b) ? -d : v(a) > v(b) ? d : 0))
  }, [s, q, only, sort.key, sort.dir])

  if (!perm.anyManager) return <Navigate to={`/r/${rid}/rc`} replace />
  if (err) return <RcShell><div className="err-box">{err}</div></RcShell>
  if (!s) return <RcShell><Spinner /></RcShell>

  async function refresh() {
    setBusy(true)
    try { const n = await refreshPrices(); await reload(); toast(n ? L(`Đã cập nhật ${n} giá`, `${n} Preise aktualisiert`) : L('Giá đã mới nhất', 'Preise aktuell')) }
    catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  const nRise = s.ingList.filter((i) => (priceRise(i) ?? 0) >= RISE_WARN).length

  return (
    <RcShell>
      <div className="rc-toolbar">
        <input className="grow" placeholder={L('Tìm nguyên liệu…', 'Zutat suchen…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={refresh} disabled={busy}>↻ {L('Cập nhật giá từ hoá đơn', 'Preise aus Rechnungen')}</button>
        <button className="primary" onClick={() => setEdit({ name: '', unit: 'g', allergens: [], rate: 7, yield_pct: 100 })}>+ {L('Nguyên liệu', 'Zutat')}</button>
      </div>
      <div className="rc-chips">
        {([['all', L('Tất cả', 'Alle')], ['rise', `${L('Giá tăng', 'Preis gestiegen')}${nRise ? ` (${nRise})` : ''}`], ['noprice', L('Chưa có giá', 'Ohne Preis')], ['nolink', L('Chưa nối hoá đơn', 'Nicht verknüpft')]] as const).map(([k, l]) => (
          <button key={k} className={only === k ? 'sel' : ''} onClick={() => setOnly(k)}>{l}</button>
        ))}
      </div>
      <p className="muted small">{L('Giá Netto lấy từ dòng hàng mới nhất trên hoá đơn đã scan (Metro, Frucht & Feld…). Nối mỗi nguyên liệu với tên hàng trên hoá đơn một lần, sau đó giá tự cập nhật.', 'Nettopreise aus der letzten gescannten Rechnungszeile. Einmal verknüpfen, danach automatisch aktuell.')}</p>
      <div className="rc-tcard">
        <table className="rc-tab">
          <thead><tr>
            {sort.th('name', L('Nguyên liệu', 'Zutat'))}
            {sort.th('price', L('Giá Netto', 'Netto'), 'n')}
            {sort.th('rise', L('Thay đổi', 'Änderung'), 'n hide-m')}
            {sort.th('date', L('Nguồn', 'Quelle'), 'hide-m')}
            {sort.th('used', L('Món', 'Rezepte'), 'n hide-m')}
          </tr></thead>
          <tbody>
            {rows.map(({ i, p, rise, used }) => (
              <tr key={i.id} className="click" onClick={() => setEdit(i)}>
                <td>
                  <div>{i.name}{i.name_de && <span className="muted small"> · {i.name_de}</span>}</div>
                  {i.allergens.length > 0 && <AllergenChips codes={i.allergens} />}
                </td>
                <td className="n">{p != null ? <>{fmtEur(p)}<span className="muted small"> {BASE_PRICE_LABEL[i.unit].de.replace('€', '')}</span></> : <span className="muted">—</span>}</td>
                <td className="n hide-m">{rise != null && Math.abs(rise) >= 0.5 ? <span className={rise >= RISE_WARN ? 'bad' : rise < 0 ? 'good' : ''}>{rise > 0 ? '+' : ''}{fmtPct(rise)}</span> : <span className="muted">—</span>}</td>
                <td className="hide-m small">{i.match_name ? (i.price_date ? <>{i.price_supplier || ''} · {dmy(i.price_date)}</> : <span className="muted">{L('đã nối, chưa thấy hoá đơn', 'verknüpft, keine Rechnung')}</span>) : i.price_manual != null ? <span className="muted">{L('nhập tay', 'manuell')}</span> : ''}</td>
                <td className="n hide-m">{used || ''}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="muted">{L('Chưa có nguyên liệu', 'Keine Zutaten')}</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <IngEditor ing={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await refreshPrices().catch(() => 0); await reload() }} usedBy={edit.id ? usedIn(edit.id, s).map((r) => r.name) : []} />}
    </RcShell>
  )
}

function IngEditor({ ing, onClose, onSaved, usedBy }: { ing: Partial<Ingredient>; onClose: () => void; onSaved: () => void; usedBy: string[] }) {
  const L = useL()
  const [x, setX] = useState<Partial<Ingredient>>(ing)
  const [err, setErr] = useState('')
  const [lq, setLq] = useState(ing.match_name ? '' : ing.name || '')
  const [found, setFound] = useState<FoundLine[] | null>(null)
  const [hist, setHist] = useState<PricePoint[] | null>(null)
  const set = <K extends keyof Ingredient>(k: K, v: Ingredient[K] | null) => setX((o) => ({ ...o, [k]: v }))

  useEffect(() => { if (ing.id && ing.match_name) priceHistory(ing.id).then(setHist).catch(() => setHist([])) }, [ing.id, ing.match_name])
  useEffect(() => {
    if (lq.trim().length < 2) { setFound(null); return }
    const h = setTimeout(() => findLines(lq.trim()).then(setFound).catch((e) => setErr(e.message)), 300)
    return () => clearTimeout(h)
  }, [lq])

  function link(f: FoundLine) {
    const g = guessPack(f.name, f.unit)
    setX((o) => ({ ...o, match_name: f.name, match_supplier: null, pack_size: g?.size ?? o.pack_size ?? null, unit: g?.unit ?? o.unit }))
    setFound(null); setLq('')
  }
  async function save() {
    if (!x.name?.trim()) { setErr(L('Cần có tên.', 'Name fehlt.')); return }
    if (x.match_name && !x.pack_size) { setErr(L('Nhập quy cách: 1 đơn vị trên hoá đơn bằng bao nhiêu g / ml / cái.', 'Packungsgröße angeben.')); return }
    try {
      const { id, name, name_de, unit, allergens, rate, yield_pct, match_name, match_supplier, pack_size, price_manual, note } = x
      const linkChanged = ing.match_name !== match_name || ing.match_supplier !== match_supplier || ing.pack_size !== pack_size || ing.unit !== unit
      await saveIngredient({
        id, name: name!.trim(), name_de: name_de?.trim() || null, unit, allergens, rate, yield_pct, note,
        match_name: match_name?.trim() || null, match_supplier: match_supplier?.trim() || null, pack_size, price_manual,
        // Đổi cách nối -> tính lại từ đầu, không coi là tăng giá
        ...(linkChanged ? { price: null, price_prev: null, price_date: null, price_supplier: null, price_source: match_name ? null : (price_manual != null ? 'manual' : null) } : {}),
      })
      onSaved()
    } catch (e) { setErr((e as Error).message) }
  }
  async function del() {
    if (!x.id || !confirm(L(`Xoá nguyên liệu "${x.name}"?`, `„${x.name}" löschen?`))) return
    try { await deleteIngredient(x.id); onSaved() } catch (e) { setErr(/foreign key|violates/i.test((e as Error).message) ? L('Nguyên liệu đang được dùng trong món.', 'Zutat wird in Rezepten verwendet.') : (e as Error).message) }
  }
  const u = (x.unit || 'g') as BaseUnit
  const uName = u === 'g' ? 'g' : u === 'ml' ? 'ml' : L('cái', 'Stk.')

  return (
    <div className="inv-modal-bg rc-modal-bg" onClick={onClose}>
      <div className="rc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2 style={{ margin: 0 }}>{x.id ? L('Sửa nguyên liệu', 'Zutat bearbeiten') : L('Nguyên liệu mới', 'Neue Zutat')}</h2><button className="ghost" onClick={onClose}>✕</button></div>
        {err && <div className="err-box">{err}</div>}
        <div className="rc-frow">
          <label className="f"><span>{L('Tên', 'Name')} *</span><input value={x.name || ''} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="f"><span>{L('Tên tiếng Đức', 'Name (Deutsch)')}</span><input value={x.name_de || ''} onChange={(e) => set('name_de', e.target.value)} /></label>
        </div>
        <div className="rc-frow">
          <label className="f"><span>{L('Tính theo', 'Basiseinheit')}</span>
            <select value={u} onChange={(e) => set('unit', e.target.value as BaseUnit)}><option value="g">{L('Khối lượng (g / kg)', 'Gewicht (g/kg)')}</option><option value="ml">{L('Thể tích (ml / l)', 'Volumen (ml/l)')}</option><option value="pcs">{L('Cái / quả', 'Stück')}</option></select>
          </label>
          <label className="f"><span>{L('Tỉ lệ dùng được sau sơ chế (%)', 'Ausbeute nach Putzen (%)')}</span><input inputMode="decimal" value={show(x.yield_pct)} onChange={(e) => set('yield_pct', Math.min(100, Math.max(1, parse(e.target.value) ?? 100)))} /></label>
        </div>

        <h3>{L('Giá từ hoá đơn scan', 'Preis aus gescannten Rechnungen')}</h3>
        {x.match_name ? (
          <div className="rc-link">
            <div className="row between wrap">
              <div><span className="muted small">{L('Tên trên hoá đơn', 'Name auf Rechnung')}</span><div><b>{x.match_name}</b></div></div>
              <button className="ghost small" onClick={() => { set('match_name', null); set('pack_size', null) }}>{L('Bỏ nối', 'Lösen')}</button>
            </div>
            <div className="rc-frow">
              <label className="f"><span>{L(`1 đơn vị trên hoá đơn = ? ${uName}`, `1 Rechnungseinheit = ? ${uName}`)} *</span><input inputMode="decimal" value={show(x.pack_size)} onChange={(e) => set('pack_size', parse(e.target.value))} placeholder="5000" /></label>
              <label className="f"><span>{L('Chỉ từ nhà cung cấp (tuỳ chọn)', 'Nur Lieferant (optional)')}</span><input value={x.match_supplier || ''} onChange={(e) => set('match_supplier', e.target.value)} placeholder="Metro" /></label>
            </div>
            <label className="f"><span>{L('Đổi mẫu tên (dấu * = bất kỳ, để gộp nhiều cách viết)', 'Namensmuster (* = beliebig)')}</span><input value={x.match_name} onChange={(e) => set('match_name', e.target.value)} /></label>
            {hist && hist.length > 0 && (
              <table className="rc-tab small">
                <thead><tr><th>{L('Ngày', 'Datum')}</th><th>{L('NCC', 'Lieferant')}</th><th className="n">{L('Đơn giá Netto', 'EP netto')}</th><th className="n">{BASE_PRICE_LABEL[u].de}</th></tr></thead>
                <tbody>{hist.slice(0, 8).map((h, i) => <tr key={i}><td>{dmy(h.doc_date)}</td><td>{h.supplier}</td><td className="n">{fmtEur(h.unit_net)}</td><td className="n">{h.base_price != null ? fmtEur(h.base_price) : '—'}</td></tr>)}</tbody>
              </table>
            )}
            {hist && !hist.length && <p className="muted small">{L('Chưa có hoá đơn khớp. Giá sẽ tự cập nhật khi có hoá đơn mới.', 'Noch keine passende Rechnung.')}</p>}
          </div>
        ) : (
          <div className="rc-link">
            <input placeholder={L('Tìm tên hàng trên hoá đơn đã scan…', 'Artikel in gescannten Rechnungen suchen…')} value={lq} onChange={(e) => setLq(e.target.value)} />
            {found && (
              <div className="rc-found">
                {found.map((f, i) => (
                  <button key={i} type="button" onClick={() => link(f)}>
                    <span className="grow" style={{ textAlign: 'left' }}><b>{f.name}</b><span className="muted small"> · {f.supplier} · {f.n}× · {dmy(f.last_date)}</span></span>
                    <span className="small">{fmtEur(f.last_unit_net)}{f.unit ? ` / ${f.unit}` : ''}</span>
                  </button>
                ))}
                {!found.length && <p className="muted small">{L('Không thấy. Có thể hoá đơn chưa có dòng hàng, hoặc nhập giá tay bên dưới.', 'Nichts gefunden. Preis unten manuell eintragen.')}</p>}
              </div>
            )}
          </div>
        )}
        <div className="rc-frow">
          <label className="f"><span>{L(`Giá nhập tay (Netto, ${BASE_PRICE_LABEL[u].vi})`, `Manueller Preis (netto, ${BASE_PRICE_LABEL[u].de})`)}</span><input inputMode="decimal" value={show(x.price_manual)} onChange={(e) => set('price_manual', parse(e.target.value))} placeholder={x.match_name ? L('dùng khi chưa có hoá đơn', 'falls keine Rechnung') : ''} /></label>
          <label className="f"><span>{L('Thuế mua vào', 'Vorsteuer')}</span><select value={x.rate ?? 7} onChange={(e) => set('rate', Number(e.target.value))}><option value={7}>7 %</option><option value={19}>19 %</option></select></label>
        </div>

        <h3>{L('Chất gây dị ứng', 'Allergene')}</h3>
        <AllergenPicker value={x.allergens || []} onChange={(v) => set('allergens', v)} />
        {usedBy.length > 0 && <p className="muted small" style={{ marginTop: 10 }}>{L('Dùng trong', 'Verwendet in')}: {usedBy.join(', ')}</p>}
        <div className="rc-actions">
          {x.id && <button className="danger" onClick={del}>{L('Xoá', 'Löschen')}</button>}
          <span className="grow" />
          <button onClick={onClose}>{L('Huỷ', 'Abbrechen')}</button>
          <button className="primary" onClick={save}>{L('Lưu', 'Speichern')}</button>
        </div>
      </div>
    </div>
  )
}
