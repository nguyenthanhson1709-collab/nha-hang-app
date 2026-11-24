// Duyệt nhanh: xem tóm tắt từng hoá đơn chờ kiểm tra, bấm ✓ để duyệt mà không cần mở.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, errMsg, type Doc } from '../lib/supabase'
import { useLang, useT } from '../lib/i18n'
import { dmy, eur } from '../lib/format'
import { autoProblems } from '../lib/autocheck'
import { deleteDoc } from '../lib/data'
import { PayTag, toast } from './ui'

const P: Record<string, [string, string]> = {
  date: ['ngày', 'Datum'], supplier: ['nhà cung cấp', 'Lieferant'], invoice_no: ['số HĐ', 'Rechnungsnr.'], gross: ['số tiền', 'Betrag'],
  payment: ['cách trả', 'Zahlart'], tax_id: ['mã số thuế', 'USt-IdNr'], taxes: ['thuế', 'MwSt'], tax_row: ['thuế lệch', 'MwSt-Abweichung'],
  tax_rate: ['% thuế lệch', 'Steuersatz'], tax_sum: ['tổng thuế lệch', 'Summe MwSt'], lines: ['dòng hàng', 'Positionen'], lines_sum: ['tổng dòng lệch', 'Summe Positionen'],
}
const FLAG: Record<string, string> = { tax_row: 'sum_mismatch', tax_sum: 'sum_mismatch', lines_sum: 'lines_mismatch', tax_id: 'missing_tax_id' }

function check(d: Doc) {
  const taxes = (d.nh_document_taxes || []).map((x) => ({ rate: Number(x.rate), net: Number(x.net), tax: Number(x.tax), gross: Number(x.gross) }))
  const raw = (d.nh_document_lines || []).map((l) => ({ ...l, total: Number(l.total), unit_price: l.unit_price == null ? null : Number(l.unit_price), rate: l.rate == null ? null : Number(l.rate) }))
  const lines = raw
  const pay = d.nh_document_payments || []
  const problems = autoProblems({ doc_date: d.doc_date, supplier: d.supplier, invoice_no: d.invoice_no, seller_tax_id: d.seller_tax_id, gross: Number(d.gross), taxes, payment: null, lines },
    pay.length ? pay[0].method : null)
  return { lines, problems, canApprove: pay.length > 0 && !!d.doc_date && Number(d.gross) > 0 }
}

export function QuickReview({ docs, rid, onDone }: { docs: Doc[]; rid: string; onDone: () => void }) {
  const t = useT()
  const { lang } = useLang()
  const [busy, setBusy] = useState<string | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const rows = useMemo(() => docs.filter((d) => !gone.has(d.id)).map((d) => ({ d, ...check(d) })), [docs, gone])
  const clean = rows.filter((x) => x.canApprove && !x.problems.length)

  async function approve(x: (typeof rows)[number]) {
    const flags = [...new Set(x.problems.map((p) => FLAG[p]).filter(Boolean))]
    const { error } = await supabase.from('nh_documents').update({ status: 'reviewed', flags }).eq('id', x.d.id)
    if (error) throw error
    setGone((s) => new Set(s).add(x.d.id))
  }
  async function one(x: (typeof rows)[number]) {
    if (x.problems.length && !confirm(`${x.d.supplier || ''}: ${x.problems.map((p) => P[p]?.[lang === 'de' ? 1 : 0] || p).join(', ')}\n\n${t('quickAnyway')}`)) return
    setBusy(x.d.id)
    try { await approve(x) } catch (e) { toast(errMsg(e)) }
    setBusy(null); onDone()
  }
  async function all() {
    if (!confirm(t('quickAllConfirm', { n: String(clean.length) }))) return
    setBusy('all')
    try { for (const x of clean) await approve(x); toast(`✓ ${clean.length}`) } catch (e) { toast(errMsg(e)) }
    setBusy(null); onDone()
  }

  return (
    <>
      {clean.length > 0 && <button className="primary block" disabled={!!busy} style={{ marginBottom: 10 }} onClick={all}>✓ {t('quickAll', { n: String(clean.length) })}</button>}
      <div className="list">
        {rows.map((x) => (
          <div className="it" key={x.d.id}>
            <Link className="grow" style={{ minWidth: 0, color: 'inherit', textDecoration: 'none' }} to={`/r/${rid}/doc/${x.d.id}`}>
              <div className="t">{x.d.supplier || '—'}</div>
              <div className="small muted">{dmy(x.d.doc_date)}{x.d.invoice_no && ` · Nr. ${x.d.invoice_no}`}</div>
              <div className="small" style={{ marginTop: 2 }}>
                {(x.d.nh_document_taxes || []).map((tx) => <span key={tx.rate} className="muted" style={{ marginRight: 8 }}>{Number(tx.rate)}%: {eur(Number(tx.gross))}</span>)}
              </div>
              {x.problems.length > 0
                ? <div style={{ marginTop: 4 }}>{x.problems.map((p) => <span key={p} className="tag warn" style={{ marginRight: 4 }}>{P[p]?.[lang === 'de' ? 1 : 0] || p}</span>)}</div>
                : <div style={{ marginTop: 4 }}><span className="tag">✓ OK</span></div>}
            </Link>
            <div className="right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div className="num">{eur(x.d.gross)}</div>
              <div>{(x.d.nh_document_payments || []).map((p) => <PayTag key={p.method} m={p.method} />)}</div>
              {x.canApprove
                ? <button className={x.problems.length ? '' : 'primary'} disabled={!!busy} style={{ minHeight: 36, padding: '6px 12px' }} onClick={() => one(x)}>{busy === x.d.id ? '…' : `✓ ${t('quickOk')}`}</button>
                : <Link className="btn" style={{ minHeight: 36, padding: '6px 12px' }} to={`/r/${rid}/doc/${x.d.id}`}>{t('open')} →</Link>}
              <button className="ghost small" disabled={!!busy} title={t('delete')} onClick={async () => {
                if (!confirm(`${t('confirmDelete')}\n${x.d.supplier || '—'} · ${dmy(x.d.doc_date)} · ${eur(x.d.gross)}`)) return
                try { await deleteDoc(x.d); setGone((s) => new Set(s).add(x.d.id)); toast(t('deleted')); onDone() } catch (e) { toast(errMsg(e)) }
              }}>🗑 {t('delete')}</button>
            </div>
          </div>
        ))}
        {!rows.length && <div className="it muted">{t('noData')}</div>}
      </div>
    </>
  )
}
