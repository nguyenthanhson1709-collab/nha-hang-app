import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DateField } from '../components/PeriodBar'
import { goBack } from '../lib/nav'
import { supabase, errMsg, signedUrl, BUCKET, type Doc, type Line, type PayMethod, type TaxRow } from '../lib/supabase'
import { canManage, catName, useApp, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { dmy, eur, monthLabel, normName, r2 } from '../lib/format'
import { deleteDoc, findDuplicate, folderParts, getDoc, lockedPeriods, saveChildren } from '../lib/data'
import { guessCategory, loadMemory, remember } from '../lib/categorize'
import { linesBasis, linesToNet } from '../lib/lines'
import { docPdf } from '../lib/pdf'
import { aiReadInvoice } from '../lib/ai'
import { Money, PayTag, Sheet, Spinner, Top, toast, useRestaurant, ComboInput } from '../components/ui'
import { PdfPreview } from '../components/PdfPreview'

type PayMode = PayMethod | 'mixed' | null

export default function DocReview() {
  const { rid, id } = useParams()
  const t = useT()
  const { lang } = useLang()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const m = canManage(role)
  const { categories } = useApp()
  const subs = categories.filter((c) => c.parent_id)
  const tops = categories.filter((c) => !c.parent_id)

  const [doc, setDoc] = useState<Doc | null>(null)
  const [urls, setUrls] = useState<{ path: string; url: string; pdf: boolean }[]>([])
  const [locked, setLocked] = useState(false)
  const [f, setF] = useState({ supplier: '', doc_date: '', invoice_no: '', seller_tax_id: '', note: '', gross: 0, kind: 'purchase' as 'purchase' | 'sales' })
  const [taxes, setTaxes] = useState<TaxRow[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [openLines, setOpenLines] = useState(false)
  const [payMode, setPayMode] = useState<PayMode>(null)
  const [mix, setMix] = useState({ cash: 0, other: 0, otherMethod: 'card' as PayMethod })
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [dupId, setDupId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rereading, setRereading] = useState(false)
  const [remembered, setRemembered] = useState<Set<number>>(new Set())
  const [hist, setHist] = useState<{ at: string; action: string; user_id: string; name?: string }[] | null>(null)

  useEffect(() => {
    (async () => {
      const d = await getDoc(id!)
      setDoc(d)
      setF({ supplier: d.supplier || '', doc_date: d.doc_date, invoice_no: d.invoice_no || '', seller_tax_id: d.seller_tax_id || '', note: d.note || '', gross: Number(d.gross), kind: d.kind })
      setTaxes((d.nh_document_taxes || []).map((x) => ({ rate: Number(x.rate), net: Number(x.net), tax: Number(x.tax), gross: Number(x.gross) })))
      const mem = await loadMemory()
      const rem = new Set<number>()
      const raw = (d.nh_document_lines || []).map((l, i) => {
        let cid = l.category_id
        if (!cid) { const g = guessCategory(l.name, categories, mem); cid = g.id; if (g.remembered) rem.add(i) }
        else if (mem.get(normName(l.name)) === cid) rem.add(i)
        return { ...l, qty: l.qty == null ? null : Number(l.qty), total: Number(l.total), rate: l.rate == null ? null : Number(l.rate), unit_price: l.unit_price == null ? null : Number(l.unit_price), category_id: cid }
      })
      setLines(raw) // giữ giá dòng như in trên hoá đơn (Netto hoặc Brutto)
      setRemembered(rem)
      const pays = d.nh_document_payments || []
      if (pays.length === 1) setPayMode(pays[0].method)
      else if (pays.length > 1) {
        const cash = pays.find((p) => p.method === 'cash'), other = pays.find((p) => p.method !== 'cash')
        setPayMode('mixed'); setMix({ cash: Number(cash?.amount || 0), other: Number(other?.amount || 0), otherMethod: other?.method || 'card' })
      }
      setLocked((await lockedPeriods(d.restaurant_id)).has(d.period))
      setUrls(await Promise.all(d.files.map(async (p) => ({ path: p, url: await signedUrl(p), pdf: /\.pdf$/i.test(p) }))))
      const { data: s } = await supabase.from('nh_suppliers').select('name').order('name')
      setSuppliers((s || []).map((x) => x.name))
    })().catch((e) => toast(errMsg(e)))
  }, [id]) // eslint-disable-line

  const readOnly = !m || locked
  const taxSum = r2(taxes.reduce((s, x) => s + x.gross, 0))
  const lineSum = r2(lines.reduce((s, x) => s + x.total, 0))
  const taxBad = taxes.some((x) => Math.abs(x.net + x.tax - x.gross) > 0.02) || (taxes.length > 0 && Math.abs(taxSum - f.gross) > 0.02)
  const basis = lines.length ? linesBasis(lines, taxes, f.gross) : 'gross'
  const linesBad = !basis
  const noCat = lines.filter((l) => !l.category_id).length
  const netSum = r2(taxes.reduce((s, x) => s + x.net, 0)), vatSum = r2(taxes.reduce((s, x) => s + x.tax, 0))
  const over250 = f.kind === 'purchase' && f.gross > 250 && !f.seller_tax_id.trim()
  const payments = useMemo(() => {
    if (!payMode) return []
    if (payMode === 'mixed') return [{ method: 'cash' as PayMethod, amount: mix.cash }, { method: mix.otherMethod, amount: mix.other }]
    return [{ method: payMode, amount: f.gross }]
  }, [payMode, mix, f.gross])
  const payBad = payMode === 'mixed' && Math.abs(mix.cash + mix.other - f.gross) > 0.02

  function setTax(i: number, k: 'net' | 'tax' | 'gross' | 'rate', v: number) {
    setTaxes((ts) => ts.map((x, j) => {
      if (j !== i) return x
      const y = { ...x, [k]: v }
      const q = y.rate / 100
      if (k === 'gross') { y.net = r2(v / (1 + q)); y.tax = r2(v - y.net) }
      if (k === 'net') { y.tax = r2(v * q); y.gross = r2(v + y.tax) }
      if (k === 'tax') { y.gross = r2(y.net + v) }
      if (k === 'rate') { y.net = r2(y.gross / (1 + q)); y.tax = r2(y.gross - y.net) }
      return y
    }))
  }
  function setLine(i: number, patch: Partial<Line>) { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))) }

  async function save(force = false) {
    if (!doc) return
    if (!payMode) { toast(t('mustChoosePayment')); return }
    if (payBad) { toast(t('paymentSumMismatch')); return }
    if (!force) {
      const dup = await findDuplicate(doc.restaurant_id, f.supplier, f.doc_date, f.gross, doc.id, f.invoice_no)
      if (dup) { setDupId(dup); return }
    }
    setBusy(true)
    try {
      const flags = [taxBad && 'sum_mismatch', linesBad && 'lines_mismatch', over250 && 'missing_tax_id'].filter(Boolean) as string[]
      const { error } = await supabase.from('nh_documents').update({
        supplier: f.supplier || null, doc_date: f.doc_date, period: f.doc_date.slice(0, 7), invoice_no: f.invoice_no || null, seller_tax_id: f.seller_tax_id || null,
        note: f.note || null, gross: f.gross, kind: f.kind, status: 'reviewed', flags,
      }).eq('id', doc.id)
      if (error) throw error
      await saveChildren(doc.id, payments, taxes, lines, true)
      for (const l of lines) if (l.category_id && l.name) await remember(l.name, l.category_id)
      if (f.supplier.trim() && !suppliers.some((x) => x.toLowerCase() === f.supplier.trim().toLowerCase())) await supabase.from('nh_suppliers').insert({ name: f.supplier.trim(), tax_id: f.seller_tax_id || null })
      toast(t('saved'))
      goBack(nav, `/r/${rid}`)
    } catch (e) { toast(errMsg(e)) }
    setBusy(false)
  }

  // Đọc lại dòng hàng bằng AI (lấy đủ số lượng, đơn vị, giá/đơn vị như in trên hoá đơn). Giữ nhóm đã chọn theo tên hàng.
  async function rereadLines() {
    if (!doc || !rid) return
    if (lines.length && !confirm(lang === 'de' ? 'Positionen neu lesen? Die aktuellen Positionen werden ersetzt.' : 'Đọc lại dòng hàng từ ảnh hoá đơn? Các dòng hiện tại sẽ được thay.')) return
    setRereading(true)
    try {
      const files = await Promise.all(doc.files.map(async (p) => {
        const { data, error } = await supabase.storage.from(BUCKET).download(p)
        if (error || !data) throw error || new Error('download')
        return { blob: data, type: data.type || (/\.pdf$/i.test(p) ? 'application/pdf' : 'image/jpeg') }
      }))
      const pi = await aiReadInvoice(rid, files)
      if (!pi?.lines?.length) { toast(lang === 'de' ? 'Keine Positionen erkannt' : 'AI không đọc được dòng hàng'); return }
      const mem = await loadMemory()
      const old = new Map(lines.filter((l) => l.category_id).map((l) => [normName(l.name), l.category_id]))
      setLines(pi.lines.map((l, i) => ({
        pos: i, name: l.name, qty: l.qty, unit: l.unit || null, unit_price: l.unit_price, total: l.total, rate: l.rate,
        category_id: old.get(normName(l.name)) ?? guessCategory(l.name, categories, mem).id,
      })))
      setRemembered(new Set()); setOpenLines(true)
      toast(lang === 'de' ? 'Neu gelesen – bitte prüfen und Speichern' : 'Đã đọc lại, kiểm tra rồi bấm Lưu')
    } catch (e) { toast(errMsg(e)) } finally { setRereading(false) }
  }

  async function del() {
    if (!doc || !confirm(t('confirmDelete'))) return
    try { await deleteDoc(doc) } catch (e) { toast(errMsg(e)); return }
    toast(t('deleted')); goBack(nav, `/r/${rid}`)
  }

  async function showHistory() {
    const { data } = await supabase.from('nh_audit').select('at, action, user_id').eq('table_name', 'nh_documents').eq('row_id', id!).order('at')
    const ids = [...new Set((data || []).map((x) => x.user_id))]
    const { data: ps } = await supabase.from('nh_profiles').select('id, full_name, email').in('id', ids)
    setHist((data || []).map((x) => ({ ...x, name: ps?.find((p) => p.id === x.user_id)?.full_name || ps?.find((p) => p.id === x.user_id)?.email })))
  }

  if (!doc || !r) return <Spinner />
  const parts = folderParts({ ...doc, gross: f.gross, kind: f.kind, nh_document_payments: payments })

  return (
    <>
      <Top title={f.supplier || t('scanInvoice')} sub={`${dmy(f.doc_date)} · ${eur(f.gross)}`} back
        right={<button onClick={async () => { const b = await docPdf(await getDoc(doc.id), r, categories); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `Beleg_${doc.doc_date}_${(doc.supplier || '').replace(/\W+/g, '_')}.pdf`; a.click() }}>PDF</button>} />
      <div className="page review">
        <div className="img-col">
          {urls.map((u) => u.pdf
            ? <div key={u.path}><a className="btn block" href={u.url} target="_blank" rel="noreferrer">📄 PDF {t('original')}</a><PdfPreview url={u.url} /></div>
            : /\.xml$/i.test(u.path) ? <a key={u.path} className="btn block" href={u.url} target="_blank" rel="noreferrer">E-Rechnung (XML)</a>
            : <a key={u.path} href={u.url} target="_blank" rel="noreferrer"><img src={u.url} alt="" style={{ marginBottom: 8 }} /></a>)}
        </div>
        <div>
          {locked && <div className="alert warn">🔒 {t('locked')} ({monthLabel(doc.period)})</div>}
          {doc.period !== doc.doc_date.slice(0, 7) && <div className="alert warn">{t('bookedIn')} {monthLabel(doc.period)}</div>}
          {!m && <div className="alert ok">{t('staffNote')}</div>}
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="card">
              {m && (
                <div className="seg" style={{ marginBottom: 10 }}>
                  <button className={f.kind === 'purchase' ? 'sel' : ''} onClick={() => setF({ ...f, kind: 'purchase' })}>{t('scanInvoice')}</button>
                  <button className={f.kind === 'sales' ? 'sel' : ''} onClick={() => setF({ ...f, kind: 'sales' })}>{t('scanSales')}</button>
                </div>
              )}
              <div className="f"><span>{t('supplier')}</span>
                <ComboInput value={f.supplier} onChange={(v) => setF({ ...f, supplier: v })} options={suppliers} />
              </div>
              <div className="grid2">
                <div className="f"><span>{t('date')}</span><DateField value={f.doc_date} onChange={(d) => d && setF({ ...f, doc_date: d })} /></div>
                <label className="f"><span>{t('invoiceNo')}</span><input value={f.invoice_no} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} /></label>
              </div>
              <label className="f"><span>{t('sellerTaxId')}</span><input className={over250 ? 'err-field' : ''} value={f.seller_tax_id} onChange={(e) => setF({ ...f, seller_tax_id: e.target.value })} /></label>
              {over250 && <div className="alert warn">{t('over250')}</div>}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('taxRate')}</h3>
              {taxes.map((x, i) => (
                <div className="tax-row" key={i}>
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <select className="tax-rate" value={x.rate} onChange={(e) => setTax(i, 'rate', Number(e.target.value))}><option value={7}>MwSt 7 %</option><option value={19}>MwSt 19 %</option><option value={0}>0 %</option></select>
                    {!readOnly && <button className="ghost" onClick={() => setTaxes(taxes.filter((_, j) => j !== i))}>✕</button>}
                  </div>
                  <div className="grid3">
                    <label className="f"><span>{t('net')}</span><Money value={x.net} onChange={(v) => setTax(i, 'net', v)} /></label>
                    <label className="f"><span>{t('tax')}</span><Money value={x.tax} onChange={(v) => setTax(i, 'tax', v)} className={Math.abs(x.net + x.tax - x.gross) > 0.02 ? 'err-field' : ''} /></label>
                    <label className="f"><span>{t('gross')}</span><Money value={x.gross} onChange={(v) => setTax(i, 'gross', v)} className="li-sum" /></label>
                  </div>
                </div>
              ))}
              {taxes.length > 1 && (
                <div className="tax-sum grid3">
                  <div><span className="small muted">Σ {t('net')}</span><b>{eur(r2(taxes.reduce((s2, x) => s2 + x.net, 0)))}</b></div>
                  <div><span className="small muted">Σ {t('tax')}</span><b>{eur(r2(taxes.reduce((s2, x) => s2 + x.tax, 0)))}</b></div>
                  <div><span className="small muted">Σ {t('gross')}</span><b>{eur(r2(taxes.reduce((s2, x) => s2 + x.gross, 0)))}</b></div>
                </div>
              )}
              {!readOnly && <button onClick={() => setTaxes([...taxes, { rate: taxes.some((x) => x.rate === 7) ? 19 : 7, net: 0, tax: 0, gross: 0 }])}>+ {t('addRate')}</button>}
              <label className="f" style={{ marginTop: 12 }}><span>{t('gross')} · {t('total')}</span>
                <div className="row"><Money value={f.gross} onChange={(v) => setF({ ...f, gross: v })} className={taxBad ? 'err-field' : ''} />
                  {!readOnly && taxes.length > 0 && Math.abs(taxSum - f.gross) > 0.02 && <button onClick={() => setF({ ...f, gross: taxSum })}>= {eur(taxSum)}</button>}
                </div>
              </label>
              {taxBad && <div className="alert err">{t('mismatch')}</div>}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('payment')}</h3>
              <div className="seg">
                {(['cash', 'card', 'transfer', 'mixed'] as PayMode[]).map((x) => (
                  <button key={x!} className={payMode === x ? 'sel' : ''} onClick={() => { setPayMode(x); if (x === 'mixed' && !mix.cash && !mix.other) setMix({ ...mix, other: f.gross }) }}>{t(x as 'cash')}</button>
                ))}
              </div>
              {!payMode && <div className="alert warn">{t('choosePayment')}</div>}
              {payMode === 'mixed' && (
                <div className="grid2" style={{ marginTop: 10 }}>
                  <label className="f"><span>{t('cashPart')}</span><Money value={mix.cash} onChange={(v) => setMix({ ...mix, cash: v, other: r2(f.gross - v) })} /></label>
                  <label className="f"><span>
                    <select style={{ minHeight: 0, padding: 2, width: 'auto' }} value={mix.otherMethod} onChange={(e) => setMix({ ...mix, otherMethod: e.target.value as PayMethod })}>
                      <option value="card">{t('card')}</option><option value="transfer">{t('transfer')}</option></select></span>
                    <Money value={mix.other} onChange={(v) => setMix({ ...mix, other: v })} className={payBad ? 'err-field' : ''} /></label>
                </div>
              )}
              {payBad && <div className="alert err">{t('paymentSumMismatch')}</div>}
              <div className="small muted" style={{ marginTop: 6 }}>
                {t('folder')}: {parts.map((p, i) => <span key={i}>{i > 0 && ' + '}<b>{p.folder}</b> {eur(p.amount)}</span>)}
              </div>
            </div>

            <div className="card">
              <button type="button" className="ghost block" style={{ justifyContent: 'space-between', padding: 0, minHeight: 32 }} onClick={() => setOpenLines(!openLines)}>
                <h3 style={{ margin: 0 }}>{openLines ? '▾' : '▸'} {t('lines')} ({lines.length})</h3>
                {noCat > 0 && <span className="tag err" style={{ marginLeft: 'auto', marginRight: 8 }}>{noCat} {t('noCat')}</span>}
                <span className={`small ${linesBad ? 'kb-out' : 'muted'}`}>Σ {eur(lineSum)}{basis === 'net' && ' Netto'}</span></button>
              {basis === 'net' && <div className="small muted" style={{ marginTop: 4 }}>{t('linesNet')}: {eur(lineSum)} + MwSt {eur(vatSum)} = <b>{eur(r2(lineSum + vatSum))}</b> Brutto</div>}
              {!readOnly && doc.files.length > 0 && <button className="ghost small" style={{ minHeight: 30, marginTop: 4 }} disabled={rereading} onClick={rereadLines}>
                {rereading ? '… ' + t('reading') : `🔄 ${lang === 'de' ? 'Positionen neu lesen (Menge, Einheit, Preis)' : 'Đọc lại dòng hàng (số lượng, đơn vị, giá)'}`}</button>}
              {basis === 'gross' && !readOnly && taxes.some((x) => x.rate > 0) && lines.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>
                {t('linesGross')} <button className="ghost small" style={{ minHeight: 30 }} onClick={() => setLines(linesToNet(lines, taxes))}>{t('toNet')}</button></div>}
              {linesBad && <div className="alert warn">{t('linesMismatch')}<br /><span className="small">Σ {eur(lineSum)} ≠ Netto {eur(netSum)} / Brutto {eur(f.gross)}</span></div>}
              {openLines && lines.map((l, i) => (
                <div className={`line-item${l.category_id ? '' : ' no-cat'}`} key={i}>
                  <div className="row"><span className="li-no">{i + 1}</span><input className="li-name" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder={t('item')} />
                    {!readOnly && <button className="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <input style={{ width: 64 }} inputMode="decimal" placeholder={t('qty')} value={l.qty ?? ''} onChange={(e) => setLine(i, { qty: e.target.value ? Number(e.target.value.replace(',', '.')) : null })} />
                    <input style={{ width: 72 }} placeholder={t('unit')} value={l.unit ?? ''} onChange={(e) => setLine(i, { unit: e.target.value || null })} />
                    <span className="small muted">×</span>
                    <Money value={l.unit_price ?? 0} onChange={(v) => setLine(i, { unit_price: v || null })} />
                    <span className="small muted" style={{ whiteSpace: 'nowrap' }}>€/{l.unit || t('unitShort')}</span>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="small muted">=</span>
                    <Money className="li-sum" value={l.total} onChange={(v) => setLine(i, { total: v })} />
                    <select style={{ width: 80 }} value={l.rate ?? ''} onChange={(e) => setLine(i, { rate: e.target.value === '' ? null : Number(e.target.value) })}>
                      <option value="">–</option><option value={7}>7%</option><option value={19}>19%</option><option value={0}>0%</option></select>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <select className={l.category_id ? '' : 'cat-missing'} value={l.category_id || ''} onChange={(e) => { setLine(i, { category_id: e.target.value || null }); setRemembered((s) => { const n = new Set(s); n.delete(i); return n }) }}>
                      <option value="">— {t('category')} —</option>
                      {tops.map((tp) => (
                        <optgroup key={tp.id} label={catName(tp, lang)}>
                          {subs.filter((c) => c.parent_id === tp.id).map((c) => <option key={c.id} value={c.id}>{catName(c, lang)}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {remembered.has(i) && <span className="tag">{t('rememberedCategory')}</span>}
                  </div>
                </div>
              ))}
              {openLines && !readOnly && <button onClick={() => setLines([...lines, { pos: lines.length, name: '', qty: null, unit: null, unit_price: null, total: 0, rate: taxes[0]?.rate ?? null, category_id: null }])}>+ {t('addLine')}</button>}
            </div>

            <label className="f"><span>{t('note')}</span><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          </fieldset>

          {!readOnly && (
            <div className="row" style={{ marginBottom: 12 }}>
              <button className="danger" onClick={del}>{t('delete')}</button>
              <button className="primary grow" disabled={busy} onClick={() => save()}>✓ {t('approve')}</button>
            </div>
          )}
          <div className="row wrap small muted">
            {doc.nh_document_payments?.map((p) => <PayTag key={p.method} m={p.method} />)}
            <span>{t('status')}: {t(doc.status)}</span>
            {m && <button className="ghost small" onClick={showHistory}>{t('history')}</button>}
          </div>
        </div>
      </div>

      <Sheet open={!!dupId} onClose={() => setDupId(null)} title="⚠︎">
        <p>{t('duplicate')}</p>
        <div className="row">
          <button onClick={() => nav(`/r/${rid}/doc/${dupId}`)}>{t('open')}</button>
          <button className="primary grow" onClick={() => { setDupId(null); save(true) }}>{t('saveAnyway')}</button>
        </div>
      </Sheet>
      <Sheet open={!!hist} onClose={() => setHist(null)} title={t('history')}>
        <div className="list">{hist?.map((h, i) => <div className="it" key={i}><div className="grow">{h.name || h.user_id?.slice(0, 8)}</div><div className="small muted">{h.action} · {new Date(h.at).toLocaleString('de-DE')}</div></div>)}</div>
      </Sheet>
    </>
  )
}
