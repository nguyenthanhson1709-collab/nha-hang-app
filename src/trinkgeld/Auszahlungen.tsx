// Auszahlungen: nur tatsächliche Zahlungen (nie automatisch). Bar -> optional Kassenbuch-Eintrag mit Bestandsprüfung.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Money, Sheet, Spinner, toast } from '../components/ui'
import PdfSheet from '../components/PdfSheet'
import { dropProps } from '../lib/drop'
import { useApp } from '../lib/app'
import { todayIso } from '../lib/format'
import { useTg, StatusTag } from './TgApp'
import { usePicked, Picker } from './Verteilung'
import { ACCEPT, cancelPayment, chainPayments, loadDetail, okFile, pay, tgErr, tgFileUrl, uploadTgFile, type Line, type Payment, type Settlement, type TgFile, downloadBlob } from './api'
import { deMonth, dmy, fmtEur, PAY_STATE, payState, toCents, type PayMethod } from './calc'
import { renderReceipt } from './TgPdf'

interface Form { lines: string[]; amount: number; date: string; method: PayMethod; receipt: string; ref: string; by: string; remarks: string; kb: boolean }

export default function Auszahlungen() {
  const { rid, period, owner, settings, company, reload } = useTg()
  const { profile } = useApp()
  const pk = usePicked()
  const { cur } = pk
  const [s, setS] = useState<Settlement | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [files, setFiles] = useState<TgFile[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const [pdf, setPdf] = useState<{ blob: Blob; name: string } | null>(null)
  const [cancel, setCancel] = useState<{ p: Payment; reason: string } | null>(null)
  const [q, setQ] = useState('')

  async function load() {
    if (!cur) { setS(null); return }
    const d = await loadDetail(cur.id)
    setS(d.s); setLines(d.lines); setFiles(d.files); setPayments(await chainPayments(d.s)); setSel(new Set())
  }
  useEffect(() => { load().catch((e) => toast(tgErr(e))) }, [cur?.id]) // eslint-disable-line

  const rows = useMemo(() => lines.filter((l) => l.participates && l.amount_cents > 0).map((l) => {
    const ps = payments.filter((p) => !p.cancelled_at && (p.line_id === l.id || (l.employee_id && p.employee_id === l.employee_id)))
    const paid = ps.reduce((a, p) => a + p.amount_cents, 0)
    return { l, paid, open: Math.max(0, l.amount_cents - paid), st: payState(l.amount_cents, paid) }
  }), [lines, payments])
  if (!cur) return <p className="muted">Für {deMonth(period)} gibt es keine Abrechnung. <Link to={`/r/${rid}/tg/abrechnung?m=${period}&neu=1`}>Neue Abrechnung erstellen</Link></p>
  if (!s) return <Spinner />
  const canPay = ['festgeschrieben', 'teilweise', 'ausgezahlt'].includes(s.status)
  const tot = rows.reduce((a, x) => ({ amount: a.amount + x.l.amount_cents, paid: a.paid + x.paid, open: a.open + x.open }), { amount: 0, paid: 0, open: 0 })
  const lineOf = new Map(lines.map((l) => [l.id, l]))
  const nameOf = (l?: Line) => (l ? [l.first_name, l.last_name].filter(Boolean).join(' ') : '—')
  const shown = rows.filter((x) => !q || nameOf(x.l).toLowerCase().includes(q.toLowerCase()) || (x.l.personnel_no || '').includes(q))
  const newForm = (ids: string[], amount: number): Form => ({ lines: ids, amount: amount / 100, date: todayIso(), method: 'bar', receipt: '', ref: '', by: profile.full_name || profile.email || '', remarks: '', kb: settings.kassenbuch })

  async function submit() {
    if (!form) return
    if (!form.date) { toast('Tatsächliches Auszahlungsdatum angeben'); return }
    setBusy('pay')
    let ok = 0
    try {
      for (const id of form.lines) {
        const row = rows.find((x) => x.l.id === id)!
        const amt = form.lines.length > 1 ? row.open : toCents(form.amount)
        if (amt <= 0) continue
        await pay(id, amt, form.date, form.method, form.receipt, form.ref, form.by, form.remarks, form.method === 'bar' && form.kb)
        ok++
      }
      setForm(null)
      toast(`${ok} Auszahlung(en) erfasst${form.method === 'bar' && form.kb ? ' und im Kassenbuch gebucht' : ''}`)
    } catch (e) { toast(`${ok ? `${ok} erfasst, dann Fehler: ` : ''}${tgErr(e)}`) }
    await load(); await reload()
    setBusy('')
  }
  async function receipt(p: Payment) {
    if (!company) { toast('Firmendaten fehlen'); return }
    const l = lineOf.get(p.line_id) || lines.find((x) => x.employee_id && x.employee_id === p.employee_id)
    if (!l) return
    setBusy('pdf')
    try { setPdf({ blob: await renderReceipt({ company, s: s!, line: l, payment: p }), name: `${s!.beleg_no}_Auszahlungsbeleg_${l.last_name}_${dmy(p.paid_on)}.pdf` }) } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }
  async function uploadConfirm(p: Payment, fl: FileList | File[] | null) {
    const arr = Array.from(fl || []).filter((f) => { if (!okFile(f)) { toast(`Nur PDF, JPG oder PNG: ${f.name}`); return false } return true })
    if (!arr.length) return
    setBusy('up')
    try {
      const target = s!.id === p.settlement_id ? s! : { ...s!, id: p.settlement_id }
      for (const f of arr) await uploadTgFile(target, 'auszahlung', f, f.name, p.id)
      await load(); toast('Empfangsbestätigung gespeichert')
    } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }
  async function doCancel() {
    if (!cancel) return
    setBusy('cancel')
    try { await cancelPayment(cancel.p.id, cancel.reason); setCancel(null); await load(); await reload(); toast('Auszahlung storniert') } catch (e) { toast(tgErr(e)) }
    setBusy('')
  }
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <>
      <Picker {...pk} />
      <div className="row between wrap" style={{ margin: '4px 0 8px' }}><b>{s.beleg_no}</b><StatusTag s={s} /></div>
      {!canPay && <div className="alert warn">Auszahlungen können erst nach dem Festschreiben erfasst werden{s.status === 'korrigiert' ? ' (dieser Beleg wurde korrigiert, bitte den Korrekturbeleg verwenden)' : ''}.</div>}
      <div className="tg-sum">
        <div><span>Zu verteilen</span><b>{fmtEur(tot.amount)}</b></div>
        <div><span>Bereits ausgezahlt</span><b>{fmtEur(tot.paid)}</b></div>
        <div><span>Noch auszuzahlen</span><b>{fmtEur(tot.open)}</b></div>
      </div>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <input className="grow" style={{ minWidth: 180 }} placeholder="Mitarbeiter suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        {canPay && <button disabled={!sel.size} onClick={() => setForm(newForm([...sel], 0))}>Sammelauszahlung erfassen ({sel.size})</button>}
      </div>
      <div className="tbl-wrap"><table className="tg-tbl">
        <thead><tr>{canPay && <th><input type="checkbox" aria-label="Alle offenen wählen" checked={sel.size > 0 && sel.size === rows.filter((x) => x.open > 0).length} onChange={(e) => setSel(e.target.checked ? new Set(rows.filter((x) => x.open > 0).map((x) => x.l.id)) : new Set())} /></th>}
          <th>Mitarbeiter</th><th className="num">Betrag</th><th className="num">Ausgezahlt</th><th className="num">Offen</th><th>Status</th><th /></tr></thead>
        <tbody>{shown.map((x) => (
          <tr key={x.l.id}>
            {canPay && <td><input type="checkbox" disabled={!x.open} checked={sel.has(x.l.id)} onChange={() => toggle(x.l.id)} aria-label={`${nameOf(x.l)} wählen`} /></td>}
            <td>{nameOf(x.l)}{x.l.personnel_no && <div className="small muted">Pers.-Nr. {x.l.personnel_no}</div>}</td>
            <td className="num">{fmtEur(x.l.amount_cents)}</td><td className="num">{fmtEur(x.paid)}</td><td className="num"><b>{fmtEur(x.open)}</b></td>
            <td>{x.st && <span className={`tag ${x.st === 'ausgezahlt' ? 'ok' : x.st === 'teilweise' ? 'warn' : ''}`}>{PAY_STATE[x.st]}</span>}</td>
            <td>{canPay && x.open > 0 && <button className="tg-mini" onClick={() => setForm(newForm([x.l.id], x.open))}>Auszahlung erfassen</button>}</td>
          </tr>))}
        </tbody>
      </table></div>

      <h3>Erfasste Auszahlungen</h3>
      {payments.length === 0 ? <p className="small muted">Noch keine Auszahlungen erfasst. Es wird nichts automatisch als bezahlt markiert.</p> : (
        <div className="list">
          {payments.map((p) => {
            const l = lineOf.get(p.line_id) || lines.find((x) => x.employee_id && x.employee_id === p.employee_id)
            const conf = files.filter((f) => f.payment_id === p.id)
            return (
              <div key={p.id} className={`it tg-pay${p.cancelled_at ? ' tg-off' : ''}`}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t">{nameOf(l)} · {fmtEur(p.amount_cents)} · {dmy(p.paid_on)}</div>
                  <div className="small muted">
                    {p.method === 'bar' ? 'Barauszahlung' : 'Banküberweisung'}{p.cash_move_id ? ' · im Kassenbuch' : ''}{p.receipt_no ? ` · Kassenbeleg ${p.receipt_no}` : ''}{p.booking_ref ? ` · Ref. ${p.booking_ref}` : ''}{p.paid_by ? ` · durch ${p.paid_by}` : ''}{p.remarks ? ` · ${p.remarks}` : ''}
                    {p.cancelled_at ? ` · STORNIERT: ${p.cancel_reason}` : ''}
                  </div>
                  {conf.length > 0 && <div className="small">{conf.map((f) => <a key={f.id} href="#" onClick={async (e) => { e.preventDefault(); const u = await tgFileUrl(f.path); if (u) window.open(u, '_blank') }} style={{ marginRight: 8 }}>📎 {f.name}</a>)}</div>}
                </div>
                {!p.cancelled_at && <>
                  <button className="tg-mini" disabled={!!busy} onClick={() => receipt(p)}>Auszahlungsbeleg drucken</button>
                  <label className="btn tg-mini drop" {...dropProps((fl) => uploadConfirm(p, fl))}>Empfangsbestätigung hochladen<span className="drop-hint">oder hierher ziehen</span>
                    <input type="file" hidden accept={ACCEPT} multiple onChange={(e) => { uploadConfirm(p, e.target.files); e.target.value = '' }} /></label>
                  {owner && <button className="tg-mini ghost" onClick={() => setCancel({ p, reason: '' })}>Stornieren</button>}
                </>}
              </div>
            )
          })}
        </div>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form && form.lines.length > 1 ? `Sammelauszahlung (${form.lines.length} Mitarbeiter)` : `Auszahlung erfassen: ${nameOf(lineOf.get(form?.lines[0] || ''))}`}>
        {form && <>
          {form.lines.length > 1
            ? <p className="small">Jeweils der volle offene Betrag: gesamt <b>{fmtEur(form.lines.reduce((a, id) => a + (rows.find((x) => x.l.id === id)?.open || 0), 0))}</b></p>
            : <label className="f"><span>Auszahlungsbetrag (offen {fmtEur(rows.find((x) => x.l.id === form.lines[0])?.open || 0)})</span><Money value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></label>}
          <div className="grid2">
            <label className="f"><span>Tatsächliches Auszahlungsdatum</span><input type="date" max={todayIso()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <div className="f"><span>Auszahlungsart</span><div className="seg">
              <button className={form.method === 'bar' ? 'sel' : ''} onClick={() => setForm({ ...form, method: 'bar' })}>Bar</button>
              <button className={form.method === 'ueberweisung' ? 'sel' : ''} onClick={() => setForm({ ...form, method: 'ueberweisung' })}>Überweisung</button>
            </div></div>
            <label className="f"><span>Kassenbelegnummer</span><input value={form.receipt} onChange={(e) => setForm({ ...form, receipt: e.target.value })} /></label>
            <label className="f"><span>Buchungsreferenz</span><input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} /></label>
            <label className="f"><span>Ausgezahlt durch</span><input value={form.by} onChange={(e) => setForm({ ...form, by: e.target.value })} /></label>
            <label className="f"><span>Bemerkungen</span><input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
          </div>
          {form.method === 'bar' && <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={form.kb} onChange={(e) => setForm({ ...form, kb: e.target.checked })} />
            <span>Im Kassenbuch buchen: „Trinkgeld-Auszahlung {s.period.slice(5)}/{s.period.slice(0, 4)} – Name – {s.beleg_no}“ am Auszahlungsdatum (Kassenbestand wird geprüft)</span></label>}
          <p className="small muted">Bitte nur erfassen, wenn das Geld tatsächlich ausgezahlt wurde.</p>
          <button className="primary block" disabled={!!busy} onClick={submit}>{busy === 'pay' ? '…' : 'Auszahlung bestätigen'}</button>
        </>}
      </Sheet>
      <Sheet open={!!cancel} onClose={() => setCancel(null)} title="Auszahlung stornieren">
        {cancel && <>
          <p>Nur für falsch erfasste Auszahlungen. Der Eintrag bleibt als storniert im Protokoll; ein Kassenbuch-Eintrag wird entfernt (nicht möglich, wenn der Monat abgeschlossen ist).</p>
          <label className="f"><span>Grund</span><textarea value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} /></label>
          <button className="danger block" disabled={!!busy || !cancel.reason.trim()} onClick={doCancel}>Stornieren</button>
        </>}
      </Sheet>
      {pdf && <PdfSheet pdf={pdf.blob} title={pdf.name} onClose={() => setPdf(null)} actions={[{ label: 'PDF herunterladen', onClick: () => downloadBlob(pdf.blob, pdf.name), primary: true }]} />}
    </>
  )
}
