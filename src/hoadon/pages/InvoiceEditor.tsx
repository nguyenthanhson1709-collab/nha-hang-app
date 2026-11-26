import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  deleteDraft, finalizeInvoice, listArticles, listCustomers, loadCompany, loadInvoice,
  findInvoiceFromQuote, markSent, saveCustomer, saveDraft, saveTextPresets, sendInvoiceEmail, setInvoiceStatus, snapshotOf,
} from '../api'
import { DELIVERY_LABEL, isPeriod } from '../types'
import type { Article, Company, TextPresets, Customer, CustomerSnapshot, DeliveryType, Invoice, InvoiceItem } from '../types'
import { COUNTRIES } from '../countries'
import { addDays, computeTotals, fmt, fmtDate, fmtEur, grossOf, netOf, parseNum, round2, todayIso } from '../money'
import { fillTemplate } from '../template'
import { LANGS, companyText, type Lang } from '../pdfText'
import { pdfFilename } from '../docname'
import { EmailList, InvShell, StatusBadge, splitEmails, useL } from '../ui'
import { kasseDoubts, kasseImages, kasseToItems } from '../kasse'
import { aiReadKasse, lastAiError } from '../../lib/ai'
import PdfSheet from '../../components/PdfSheet'

// PDF tải lười (chunk riêng) vì @react-pdf/renderer khá nặng
const pdfLib = () => import('../pdf')

const emptyItem = (): InvoiceItem => ({
  position: 0, article_id: null, name: '', description: '', quantity: 1, unit: 'Stück',
  unit_price_gross: 0, tax_rate: 7, line_total_gross: 0,
})

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Ô tìm có danh sách gợi ý, dùng cho món */
function Picker<T>({ items, placeholder, render, match, onPick }: {
  items: T[]; placeholder: string
  render: (t: T) => React.ReactNode; match: (t: T, q: string) => boolean
  onPick: (t: T) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const shown = useMemo(() => {
    const t = norm(q.trim())
    return (t ? items.filter((i) => match(i, t)) : items).slice(0, 40)
  }, [items, q, match])
  const pick = (t: T) => { onPick(t); setQ(''); setOpen(false); setActive(0) }
  return (
    <div className="picker">
      <input
        value={q} placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); pick(shown[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && shown.length > 0 && (
        <div className="plist">
          {shown.map((t, i) => (
            <div key={i} className={`opt ${i === active ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(t) }}>{render(t)}</div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Ô tên khách: gõ tên mới hoặc chọn khách có sẵn */
function NameCombo({ value, customers, onType, onPick, label }: {
  value: string; customers: Customer[]; onType: (v: string) => void; onPick: (c: Customer) => void; label: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const shown = useMemo(() => {
    const t = norm(value.trim())
    if (!t) return customers.slice(0, 40)
    return customers.filter((c) => norm(c.name).includes(t) || String(c.customer_number ?? '').includes(t)).slice(0, 40)
  }, [customers, value])
  const pick = (c: Customer) => { onPick(c); setOpen(false); setActive(0) }
  return (
    <div className="picker">
      <span className="lbl">{label}</span>
      <input value={value} placeholder="Name des Kunden"
        onChange={(e) => { onType(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); pick(shown[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {open && shown.length > 0 && (
        <div className="plist">
          {shown.map((c, i) => (
            <div key={c.id} className={`opt ${i === active ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(c) }}>
              <span>{c.name}</span><span className="muted">{c.customer_number} · {c.city}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const sameAddress = (a: CustomerSnapshot, c: Customer) =>
  (a.name ?? '') === c.name && (a.supplement ?? '') === (c.supplement ?? '') && (a.street ?? '') === (c.street ?? '') &&
  (a.zip ?? '') === (c.zip ?? '') && (a.city ?? '') === (c.city ?? '') && (a.country ?? 'DE') === (c.country ?? 'DE')

export default function InvoiceEditor({ docType = 'invoice' }: { docType?: 'invoice' | 'quote' }) {
  const { rid, id } = useParams()
  const L = useL()
  const nav = useNavigate()
  const location = useLocation()
  // Vừa hoàn tất hoá đơn mới: mở PDF ngay khi tải xong
  const wantPreview = useRef(Boolean((location.state as { preview?: boolean } | null)?.preview))
  const [company, setCompany] = useState<Company | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [invoice, setInvoice] = useState<Partial<Invoice>>(() => docType === 'quote'
    ? { doc_type: 'quote', invoice_date: todayIso(), due_date: addDays(todayIso(), 14), status: 'draft', customer_snapshot: {}, delivery_type: 'none', delivery_date: null }
    : { doc_type: 'invoice', invoice_date: todayIso(), status: 'draft', customer_snapshot: {}, delivery_type: 'service_date', delivery_date: todayIso() })
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [lunch, setLunch] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [custEmail, setCustEmail] = useState('')
  const [mail, setMail] = useState<{ to: string; subject: string; body: string } | null>(null)
  const [preview, setPreview] = useState<Blob | null>(null)
  const loaded = useRef(false)
  // Thông báo nằm ở đầu trang: cuộn lên để người dùng thấy (nút Lưu ở cuối trang)
  useEffect(() => { if (err || ok) window.scrollTo({ top: 0, behavior: 'smooth' }) }, [err, ok])

  const locked = Boolean(invoice.invoice_number)
  const isQuote = invoice.doc_type === 'quote'
  const isNet = invoice.price_mode === 'net'
  const shownPrice = (it: InvoiceItem) => isNet ? round2(netOf(it.unit_price_gross, it.tax_rate)) : it.unit_price_gross
  const listBase = `/r/${rid}/inv${isQuote ? '/quotes' : ''}`
  const docName = isQuote ? 'Angebot' : L('hoá đơn', 'Rechnung')

  useEffect(() => {
    Promise.all([loadCompany(rid!), listCustomers(rid!), listArticles(rid!)])
      .then(([c, cs, as]) => { setCompany(c); setCustomers(cs); setArticles(as) })
      .catch((e) => setErr(e.message))
  }, [rid])

  useEffect(() => {
    if (!id || loaded.current) return
    loaded.current = true
    loadInvoice(id).then(({ invoice, items }) => { setInvoice(invoice); setItems(items) }).catch((e) => setErr(e.message))
  }, [id])

  useEffect(() => {
    if (!wantPreview.current || !company || !invoice.invoice_number || !items.length) return
    wantPreview.current = false
    pdfLib().then(({ renderInvoicePdf }) => renderInvoicePdf(company, invoice as Invoice, items)).then(setPreview).catch((e) => setErr(e.message))
  }, [company, invoice, items])

  const customer = customers.find((c) => c.id === invoice.customer_id) ?? null
  useEffect(() => { if (customer && !custEmail) setCustEmail(customer.emails ?? '') }, [customer]) // eslint-disable-line react-hooks/exhaustive-deps
  const addr = invoice.customer_snapshot ?? {}
  const totals = computeTotals(items, invoice.price_mode ?? 'gross')
  const articleList = useMemo(() => articles.filter((a) => a.is_lunch === lunch || !articles.some((b) => b.is_lunch !== a.is_lunch && b.number === a.number && b.number !== '' && b.name === a.name)), [articles, lunch])

  const presets: TextPresets = { intro: company?.text_presets?.intro ?? [], closing: company?.text_presets?.closing ?? [] }
  async function savePresets(next: TextPresets) {
    const prev = company
    setCompany((c) => (c ? { ...c, text_presets: next } : c))
    try { await saveTextPresets(rid!, next) } catch (e) { setCompany(prev); setErr((e as Error).message) }
  }
  function update<K extends keyof Invoice>(k: K, v: Invoice[K]) { setInvoice((i) => ({ ...i, [k]: v })); setDirty(true) }
  function updateItem(i: number, patch: Partial<InvoiceItem>) {
    setItems((list) => list.map((it, j) => j === i ? { ...it, ...patch } : it)); setDirty(true)
  }
  function addArticle(a: Article) {
    const label = a.number ? `${a.number} ${a.name}` : a.name
    setItems((list) => {
      const same = list.findIndex((it) => it.article_id === a.id)
      if (same >= 0) return list.map((it, j) => j === same ? { ...it, quantity: it.quantity + 1 } : it)
      return [...list, { ...emptyItem(), article_id: a.id, name: label, description: a.description, unit: a.unit, unit_price_gross: a.price_gross, tax_rate: a.tax_rate }]
    })
    setDirty(true)
  }
  /** Đọc hoá đơn in từ máy Kasse (PDF / ảnh) và điền món, giá, thuế, ngày */
  async function readKasse(files: File[]) {
    if (!files.length) return
    setErr(''); setOk(''); setReading(true)
    try {
      let imgs: { blob: Blob; type: string }[]
      try { imgs = await kasseImages(files) } catch { imgs = files.map((f) => ({ blob: f, type: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg') })) }
      const r = await aiReadKasse(rid!, imgs)
      if (!r || !r.lines?.length) throw new Error(L(`Không đọc được hoá đơn Kasse. ${lastAiError}`, `Kassenbon konnte nicht gelesen werden. ${lastAiError}`))
      const got = kasseToItems(r.lines, articles)
      setItems((list) => [...list, ...got].map((it, j) => ({ ...it, position: j + 1 })))
      if (r.doc_date && !isQuote) setInvoice((i) => ({ ...i, delivery_type: 'service_date', delivery_date: r.doc_date, delivery_end: null }))
      setDirty(true)
      const sum = round2(got.reduce((s, it) => s + it.quantity * it.unit_price_gross, 0))
      const match = Math.abs(sum - round2(r.gross || 0)) < 0.01
      const head = L(`Đã đọc ${r.lines.length} dòng từ hoá đơn Kasse${r.receipt_no ? ` ${r.receipt_no}` : ''}${r.doc_date ? ` (${fmtDate(r.doc_date)})` : ''}, gộp thành ${got.length} món.`,
        `${r.lines.length} Positionen vom Kassenbon${r.receipt_no ? ` ${r.receipt_no}` : ''}${r.doc_date ? ` (${fmtDate(r.doc_date)})` : ''} übernommen, zusammengefasst zu ${got.length}.`)
      if (match) setOk(`${head} ${L(`Tổng ${fmtEur(sum)} khớp với Kasse.`, `Summe ${fmtEur(sum)} stimmt mit der Kasse überein.`)}`)
      else {
        const base = items.length
        const doubt = kasseDoubts(got, articles).map(({ item, prices }) => L(
          `dòng ${base + item.position} "${item.name}" giá ${fmtEur(item.unit_price_gross)} (danh mục: ${prices.map(fmtEur).join(' / ')})`,
          `Pos. ${base + item.position} „${item.name}" ${fmtEur(item.unit_price_gross)} (Artikel: ${prices.map(fmtEur).join(' / ')})`))
        setErr(`${head} ${L(`Tổng các món ${fmtEur(sum)} KHÁC tổng trên Kasse ${fmtEur(r.gross)} (lệch ${fmtEur(round2((r.gross || 0) - sum))}): hãy so lại từng dòng.`, `Summe ${fmtEur(sum)} weicht vom Kassenbon ${fmtEur(r.gross)} ab (Differenz ${fmtEur(round2((r.gross || 0) - sum))}): bitte Positionen prüfen.`)}`
          + (doubt.length ? ` ${L('Nên xem trước: ', 'Zuerst prüfen: ')}${doubt.join('; ')}.` : ''))
      }
    } catch (e) { setErr((e as Error).message) } finally { setReading(false) }
  }
  function pickCustomer(c: Customer) {
    setInvoice((i) => ({ ...i, customer_id: c.id, customer_snapshot: snapshotOf(c) })); setCustEmail(c.emails ?? ''); setDirty(true)
  }
  function updateAddr(patch: Partial<CustomerSnapshot>) {
    setInvoice((i) => ({ ...i, customer_snapshot: { ...i.customer_snapshot, ...patch } })); setDirty(true)
  }
  async function saveAsCustomer(asNew: boolean) {
    const a = invoice.customer_snapshot ?? {}
    if (!a.name?.trim()) { setErr(L('Hãy nhập tên khách hàng.', 'Bitte Kundennamen eingeben.')); return }
    setBusy(true); setErr('')
    try {
      const fields = { name: a.name.trim(), supplement: a.supplement ?? '', street: a.street ?? '', zip: a.zip ?? '', city: a.city ?? '', country: a.country || 'DE', emails: custEmail }
      const saved = await saveCustomer(rid!, asNew || !customer ? { kind: 'customer', ...fields } : { id: customer.id, ...fields })
      setCustomers((list) => [...list.filter((c) => c.id !== saved.id), saved].sort((x, y) => x.name.localeCompare(y.name)))
      setInvoice((i) => ({ ...i, customer_id: saved.id, customer_snapshot: snapshotOf(saved) })); setDirty(true)
      setOk(asNew || !customer ? L(`Đã lưu khách hàng mới (mã ${saved.customer_number}).`, `Neuer Kunde gespeichert (Nr. ${saved.customer_number}).`) : L('Đã cập nhật thông tin khách hàng.', 'Kundendaten aktualisiert.'))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function save(go = true): Promise<string | null> {
    setErr(''); setOk('')
    if (!items.length) { setErr(L('Hãy thêm ít nhất một món.', 'Bitte mindestens eine Position hinzufügen.')); return null }
    if (items.some((i) => !i.name.trim())) { setErr(L('Mỗi dòng cần có tên.', 'Jede Position braucht eine Bezeichnung.')); return null }
    setBusy(true)
    try {
      const newId = await saveDraft(rid!, invoice, items)
      setDirty(false)
      // Hoá đơn mới: đổi địa chỉ sang /:id (trang được tải lại). Khi hoàn tất thì đợi cấp số xong mới đổi.
      if (!id && go) nav(`${listBase}/${newId}`, { replace: true })
      setInvoice((i) => ({ ...i, id: newId }))
      setOk(L('Đã lưu nháp.', 'Entwurf gespeichert.'))
      return newId
    } catch (e) { setErr((e as Error).message); return null } finally { setBusy(false) }
  }

  async function finalize() {
    if (!invoice.customer_snapshot?.name?.trim() && !confirm(L(
      `Chưa có thông tin khách hàng (tên, địa chỉ).\nHoá đơn trên 250 € theo luật phải ghi tên và địa chỉ khách; sau khi hoàn tất sẽ không sửa được nữa.\n\nVẫn hoàn tất không có thông tin khách hàng?`,
      `Keine Kundendaten (Name, Anschrift).\nRechnungen über 250 € müssen Name und Anschrift des Kunden enthalten; nach dem Abschluss ist keine Änderung mehr möglich.\n\nTrotzdem ohne Kundendaten abschließen?`))) return
    const want = invoice.desired_number?.trim()
    if (want && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(want)) { setErr(L('Số hoá đơn chỉ gồm chữ, số và . _ / - (tối đa 40 ký tự).', 'Rechnungsnummer: nur Buchstaben, Ziffern und . _ / - (max. 40 Zeichen).')); return }
    if (!confirm(want
      ? L(`Hoàn tất ${docName} với số ${want}? Sau khi hoàn tất sẽ không sửa được nữa.`, `${isQuote ? 'Angebot' : 'Rechnung'} mit Nummer ${want} abschließen? Danach kann nichts mehr geändert werden.`)
      : isQuote
      ? L('Hoàn tất Angebot? Sau khi hoàn tất sẽ có số Angebot và không sửa được nữa.', 'Angebot abschließen? Danach erhält es eine Nummer und kann nicht mehr geändert werden.')
      : L('Hoàn tất hoá đơn? Sau khi hoàn tất sẽ có số hoá đơn và không sửa được nữa.', 'Rechnung abschließen? Danach erhält sie eine Nummer und kann nicht mehr geändert werden.'))) return
    const invId = await save(false)
    if (!invId) return
    setBusy(true)
    try {
      await finalizeInvoice(invId)
      if (!id) { nav(`${listBase}/${invId}`, { replace: true, state: { preview: true } }); return }
      const r = await loadInvoice(invId)
      setInvoice(r.invoice); setItems(r.items)
      if (company) { const { renderInvoicePdf } = await pdfLib(); setPreview(await renderInvoicePdf(company, r.invoice, r.items)) }
      setOk(L(`Đã hoàn tất ${docName} ${r.invoice.invoice_number}.`, `${isQuote ? 'Angebot' : 'Rechnung'} ${r.invoice.invoice_number} abgeschlossen.`))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function makePdf() {
    if (!company) throw new Error(L('Chưa tải được thông tin công ty', 'Firmendaten nicht geladen'))
    const { renderInvoicePdf } = await pdfLib()
    return renderInvoicePdf(company, invoice as Invoice, items)
  }
  async function previewPdf() {
    setBusy(true); setErr('')
    try { setPreview(await makePdf()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function download(blob?: Blob) {
    setBusy(true); setErr('')
    try { const b = blob ?? await makePdf(); (await pdfLib()).downloadBlob(b, pdfFilename(invoice as Invoice)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const mailVars = () => ({ nummer: invoice.invoice_number ?? '', betrag: fmtEur(totals.gross), firma: company?.name ?? '', kunde: invoice.customer_snapshot?.name ?? '', gueltig: fmtDate(invoice.due_date), tage: String(company?.payment_days ?? '') })
  function openMail() {
    if (!company) return
    const vars = mailVars()
    setMail({ to: custEmail || customer?.emails || '', subject: fillTemplate(companyText(company, invoice.language, 'email_subject', invoice.doc_type), vars), body: fillTemplate(companyText(company, invoice.language, 'email_body', invoice.doc_type), vars) })
  }
  async function sendMail() {
    if (!mail || !invoice.id) return
    const to = splitEmails(mail.to)
    if (!to.length) { setErr(L('Hãy nhập email người nhận.', 'Bitte Empfänger eingeben.')); return }
    setBusy(true); setErr('')
    try {
      const blob = await makePdf()
      await sendInvoiceEmail({ invoiceId: invoice.id, to, subject: mail.subject, body: mail.body, pdfBase64: await (await pdfLib()).blobToBase64(blob), filename: pdfFilename(invoice as Invoice) })
      await markSent(invoice.id, to.join(', '))
      setInvoice((i) => ({ ...i, sent_at: new Date().toISOString(), sent_to: to.join(', ') }))
      setMail(null); setOk(L(`Đã gửi email tới ${to.join(', ')}.`, `E-Mail an ${to.join(', ')} gesendet.`))
    } catch (e) { setErr(L('Gửi email không thành công: ', 'E-Mail-Versand fehlgeschlagen: ') + (e as Error).message) } finally { setBusy(false) }
  }

  async function share() {
    if (!company) return
    setBusy(true); setErr('')
    try {
      const blob = await makePdf()
      const lib = await pdfLib()
      const vars = mailVars()
      const subject = fillTemplate(companyText(company, invoice.language, 'email_subject', invoice.doc_type), vars)
      const body = fillTemplate(companyText(company, invoice.language, 'email_body', invoice.doc_type), vars)
      const shared = await lib.shareBlob(blob, pdfFilename(invoice as Invoice), subject, body)
      if (!shared) {
        // Máy tính: tải PDF về rồi mở thư soạn sẵn để đính kèm
        lib.downloadBlob(blob, pdfFilename(invoice as Invoice))
        const to = splitEmails(custEmail || customer?.emails).join(',')
        window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(PDF im Anhang)')}`
        setOk(L('Đã tải PDF về máy. Hãy đính kèm file đó vào thư vừa mở.', 'PDF heruntergeladen. Bitte an die geöffnete E-Mail anhängen.'))
      }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function convertToInvoice() {
    if (!invoice.id) return
    if (dirty && !locked) { const saved = await save(); if (!saved) return }
    if (!confirm(L('Tạo hoá đơn nháp từ Angebot này? Bạn vẫn sửa được hoá đơn trước khi hoàn tất.', 'Aus diesem Angebot einen Rechnungsentwurf erstellen? Die Rechnung kann vor dem Abschließen noch bearbeitet werden.'))) return
    setBusy(true); setErr('')
    try {
      const newId = await saveDraft(rid!, {
        doc_type: 'invoice', source_quote_id: invoice.id, customer_id: invoice.customer_id, customer_snapshot: invoice.customer_snapshot,
        invoice_date: todayIso(), language: invoice.language, price_mode: invoice.price_mode, delivery_type: 'service_date', delivery_date: todayIso(), intro_text: '', closing_text: '',
      }, items)
      await setInvoiceStatus(invoice.id, 'accepted')
      nav(`/r/${rid}/inv/${newId}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function openLinkedInvoice() {
    if (!invoice.id) return
    try {
      const inv = await findInvoiceFromQuote(invoice.id)
      if (inv) nav(`/r/${rid}/inv/${inv}`); else setErr(L('Không tìm thấy hoá đơn (có thể đã bị xoá).', 'Rechnung nicht gefunden (evtl. gelöscht).'))
    } catch (e) { setErr((e as Error).message) }
  }

  async function changeStatus(s: 'open' | 'paid' | 'cancelled') {
    if (s === 'cancelled' && !confirm(isQuote
      ? L('Đánh dấu khách đã từ chối Angebot này?', 'Angebot als abgelehnt markieren?')
      : L('Huỷ hoá đơn này? Số hoá đơn vẫn được giữ lại.', 'Rechnung stornieren? Die Nummer bleibt erhalten.'))) return
    setBusy(true)
    try { await setInvoiceStatus(invoice.id!, s); setInvoice((i) => ({ ...i, status: s, paid_at: s === 'paid' ? todayIso() : null })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function removeDraft() {
    if (!invoice.id || !confirm(L('Xoá bản nháp này?', 'Diesen Entwurf löschen?'))) return
    try { await deleteDraft(invoice.id); nav(listBase) } catch (e) { setErr((e as Error).message) }
  }

  const title = locked ? `${isQuote ? 'Angebot' : 'Rechnung'} ${invoice.invoice_number}` : isQuote ? L('Angebot mới (nháp)', 'Neues Angebot (Entwurf)') : L('Hoá đơn mới (nháp)', 'Neue Rechnung (Entwurf)')
  if (!company) return <InvShell back={listBase} tabs={false} title={title}>{err ? <div className="err">{err}</div> : <div className="center"><div className="spinner" /></div>}</InvShell>

  return (
    <InvShell back={listBase} tabs={false} title={title}>
      {invoice.id && <div style={{ marginBottom: 10 }}><StatusBadge inv={invoice as Invoice} /></div>}
      {err && <div className="err">{err}</div>}
      {ok && <div className="okmsg">{ok}</div>}

      <div className="card">
        <div className="frow" style={{ alignItems: 'flex-start' }}>
          {locked ? (
            <div>
              <span className="lbl">{L('Khách hàng', 'Kunde')}</span>
              <div><b>{invoice.customer_snapshot?.name}</b><br />
                <span className="muted">{invoice.customer_snapshot?.street}, {invoice.customer_snapshot?.zip} {invoice.customer_snapshot?.city}</span></div>
            </div>
          ) : (
            <div style={{ flex: '1 1 340px' }}>
              <NameCombo label={L('Kunde (gõ tên khách mới, hoặc chọn khách có sẵn)', 'Kunde (neuen Namen eingeben oder vorhandenen wählen)')}
                value={addr.name ?? ''} customers={customers.filter((c) => c.kind === 'customer' && !c.archived)}
                onType={(v) => updateAddr({ name: v })} onPick={pickCustomer} />
              <div className="mt"><input placeholder="Adresszusatz" value={addr.supplement ?? ''} onChange={(e) => updateAddr({ supplement: e.target.value })} /></div>
              <div className="mt"><input placeholder="Straße" value={addr.street ?? ''} onChange={(e) => updateAddr({ street: e.target.value })} /></div>
              <div className="frow mt" style={{ gap: 8 }}>
                <div style={{ flex: '0 1 120px' }}><input placeholder="PLZ" value={addr.zip ?? ''} onChange={(e) => updateAddr({ zip: e.target.value })} /></div>
                <div><input placeholder="Ort" value={addr.city ?? ''} onChange={(e) => updateAddr({ city: e.target.value })} /></div>
              </div>
              <div className="mt">
                <span className="lbl">Land</span>
                <select value={addr.country || 'DE'} onChange={(e) => updateAddr({ country: e.target.value })}>
                  {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  {addr.country && !COUNTRIES.some(([c]) => c === addr.country) && <option value={addr.country}>{addr.country}</option>}
                </select>
              </div>
              <div className="mt"><EmailList placeholder={L('E-Mail (để gửi hoá đơn)', 'E-Mail (für den Versand)')} value={custEmail} onChange={(v) => { if (v !== custEmail) { setCustEmail(v); setDirty(true) } }} /></div>
              <div className="toolbar mt" style={{ marginBottom: 0 }}>
                {customer ? <span className="muted small grow">{L('Khách có sẵn · mã', 'Vorhandener Kunde · Nr.')} {customer.customer_number}</span> : addr.name ? <span className="muted small grow">{L('Khách mới (chưa lưu)', 'Neuer Kunde (nicht gespeichert)')}</span> : <span className="grow" />}
                {!customer && addr.name?.trim() && <button className="primary sm" onClick={() => saveAsCustomer(true)} disabled={busy}>{L('Lưu khách hàng mới', 'Als Kunde speichern')}</button>}
                {customer && (!sameAddress(addr, customer) || custEmail !== (customer.emails ?? '')) && <>
                  <button className="sm" onClick={() => saveAsCustomer(false)} disabled={busy}>{L('Cập nhật khách hàng', 'Kunde aktualisieren')}</button>
                  {addr.name !== customer.name && <button className="sm" onClick={() => saveAsCustomer(true)} disabled={busy}>{L('Lưu thành khách mới', 'Als neuen Kunden speichern')}</button>}
                </>}
                {customer && <button className="sm" onClick={() => { setInvoice((i) => ({ ...i, customer_id: null, customer_snapshot: { country: 'DE' } })); setCustEmail(''); setDirty(true) }}>{L('Khách khác', 'Anderer Kunde')}</button>}
              </div>
            </div>
          )}
          <div className="doc-meta">
            {!locked && <div>
              <span className="lbl">{isQuote ? L('Số Angebot', 'Angebotsnr.') : L('Số hoá đơn', 'Rechnungsnr.')}</span>
              <input value={invoice.desired_number ?? ''} maxLength={40} placeholder={L('Để trống = tự động', 'Leer = automatisch')}
                onChange={(e) => update('desired_number', e.target.value.replace(/\s/g, ''))} />
            </div>}
            <div>
              <span className="lbl">{isQuote ? L('Ngày Angebot', 'Angebotsdatum') : L('Ngày hoá đơn', 'Rechnungsdatum')}</span>
              <input type="date" value={invoice.invoice_date ?? ''} disabled={locked} onChange={(e) => update('invoice_date', e.target.value)} />
            </div>
            <div>
              <span className="lbl">{L('Ngôn ngữ', 'Sprache')}</span>
              <select value={invoice.language ?? 'de'} disabled={locked} onChange={(e) => update('language', e.target.value as Lang)}>
                {LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </div>
            <div>
              <span className="lbl">{L('Giá trên hoá đơn', 'Preisangabe')}</span>
              <select value={invoice.price_mode ?? 'gross'} disabled={locked} onChange={(e) => update('price_mode', e.target.value as 'gross' | 'net')}>
                <option value="gross">{L('Brutto (gồm USt)', 'Brutto (inkl. USt)')}</option>
                <option value="net">{L('Netto (cộng USt riêng)', 'Netto (zzgl. USt)')}</option>
              </select>
            </div>
            {isQuote && <div>
              <span className="lbl">Gültig bis</span>
              <input type="date" value={invoice.due_date ?? ''} disabled={locked} onChange={(e) => update('due_date', e.target.value)} />
            </div>}
            {!isQuote && <div>
              <span className="lbl">Lieferung / Leistung</span>
              <select value={invoice.delivery_type ?? 'none'} disabled={locked}
                onChange={(e) => { const t = e.target.value as DeliveryType; setInvoice((i) => ({ ...i, delivery_type: t, delivery_date: t === 'none' ? null : i.delivery_date || i.invoice_date || todayIso() })); setDirty(true) }}>
                {(Object.keys(DELIVERY_LABEL) as DeliveryType[]).map((k) => <option key={k} value={k}>{DELIVERY_LABEL[k]}</option>)}
              </select>
            </div>}
            {!isQuote && invoice.delivery_type && invoice.delivery_type !== 'none' && <div>
              <span className="lbl">{isPeriod(invoice.delivery_type) ? L('Từ ngày', 'Von') : L('Ngày', 'Datum')}</span>
              <input type="date" value={invoice.delivery_date ?? ''} disabled={locked} onChange={(e) => update('delivery_date', e.target.value)} />
            </div>}
            {!isQuote && isPeriod(invoice.delivery_type) && <div>
              <span className="lbl">{L('Đến ngày', 'Bis')}</span>
              <input type="date" value={invoice.delivery_end ?? ''} disabled={locked} min={invoice.delivery_date ?? undefined} onChange={(e) => update('delivery_end', e.target.value)} />
            </div>}
          </div>
        </div>
        {locked && <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
          {isQuote ? 'Gültig bis' : L('Hạn thanh toán', 'Fällig am')}: {fmtDate(invoice.due_date)}
          {invoice.sent_at && <> · {L('Đã gửi email', 'Per E-Mail gesendet')} {fmtDate(invoice.sent_at)} {L('tới', 'an')} {invoice.sent_to}</>}
          {invoice.paid_at && <> · {L('Đã thanh toán', 'Bezahlt am')} {fmtDate(invoice.paid_at)}</>}
        </p>}
      </div>

      {!locked && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{L('Lời mở đầu (tuỳ chọn)', 'Einleitung (optional)')}</h2>
          <span className="lbl">{L('Để trống = dùng câu mặc định', 'Leer = Standardtext')}</span>
          <PresetPicker kind="intro" text={invoice.intro_text ?? ''} presets={presets} onPick={(t) => update('intro_text', t)} onChange={savePresets} />
          <textarea value={invoice.intro_text ?? ''} placeholder={companyText(company, invoice.language, 'intro_text', invoice.doc_type)} onChange={(e) => update('intro_text', e.target.value)} />
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{L('Món / dịch vụ', 'Positionen')}</h2>
        {!locked && (
          <div className="toolbar">
            <div className="grow">
              <Picker<Article>
                placeholder={L('Thêm món: gõ số món hoặc tên…', 'Artikel hinzufügen: Nummer oder Name…')} items={articleList}
                match={(a, t) => a.number === t || norm(`${a.number} ${a.name}`).includes(t)}
                render={(a) => <><span>{a.number ? <b>{a.number} </b> : null}{a.name}{a.is_lunch ? ' (Mittag)' : ''}</span><span className="muted">{fmtEur(a.price_gross)} · {fmt(a.tax_rate).replace(',00', '')}%</span></>}
                onPick={addArticle}
              />
            </div>
            <label className="chk"><input type="checkbox" checked={lunch} onChange={(e) => setLunch(e.target.checked)} /> {L('Giá trưa (Mittag)', 'Mittagspreis')}</label>
            <button onClick={() => { setItems((l) => [...l, emptyItem()]); setDirty(true) }}>+ {L('Dòng tự do', 'Freie Position')}</button>
            <label className={`btn${reading ? ' disabled' : ''}`} title={L('Tải hoá đơn PDF hoặc ảnh từ máy Kasse, app tự điền món', 'Kassenbon (PDF/Foto) hochladen, Positionen werden übernommen')}>
              {reading ? L('Đang đọc…', 'Wird gelesen…') : `📄 ${L('Từ hoá đơn Kasse', 'Aus Kassenbon')}`}
              <input type="file" accept="application/pdf,image/*" multiple hidden disabled={reading} onChange={(e) => { readKasse([...(e.target.files ?? [])]); e.target.value = '' }} />
            </label>
          </div>
        )}
        {!locked && !articles.length && <p className="muted small">{L('Chưa có món nào. Thêm món ở mục "Món & dịch vụ" hoặc nhập từ Lexware trong Cài đặt; vẫn dùng được "Dòng tự do".', 'Noch keine Artikel. Unter „Artikel" anlegen oder in den Einstellungen aus Lexware importieren; „Freie Position" geht immer.')}</p>}
        <div className="items">
          <div className="item head">
            <div>{L('Tên', 'Bezeichnung')}</div><div>{L('Số lượng', 'Menge')}</div><div>{isNet ? L('Giá netto', 'Preis netto') : L('Giá brutto (gồm USt)', 'Preis brutto')}</div><div>USt</div><div className="total">{L('Thành tiền', 'Gesamt')}</div><div />
          </div>
          {items.map((it, i) => (
            <div className="item" key={i}>
              <div className="name">
                <input value={it.name} disabled={locked} placeholder={L('Tên món / dịch vụ', 'Bezeichnung')} onChange={(e) => updateItem(i, { name: e.target.value })} />
                {(!locked || it.description) && <textarea value={it.description} disabled={locked} placeholder={L('Mô tả (tuỳ chọn)', 'Beschreibung (optional)')} rows={1} onChange={(e) => updateItem(i, { description: e.target.value })} />}
              </div>
              <input inputMode="decimal" disabled={locked} defaultValue={String(it.quantity).replace('.', ',')} key={`q${i}-${it.article_id}-${it.quantity}`}
                onBlur={(e) => updateItem(i, { quantity: parseNum(e.target.value) || 1 })} />
              <input inputMode="decimal" disabled={locked} defaultValue={fmt(shownPrice(it))} key={`p${i}-${it.unit_price_gross}-${invoice.price_mode}`}
                onBlur={(e) => { const v = round2(parseNum(e.target.value)); updateItem(i, { unit_price_gross: isNet ? grossOf(v, it.tax_rate) : v }) }} />
              <select value={it.tax_rate} disabled={locked} onChange={(e) => { const r = Number(e.target.value); updateItem(i, isNet ? { tax_rate: r, unit_price_gross: grossOf(netOf(it.unit_price_gross, it.tax_rate), r) } : { tax_rate: r }) }}>
                <option value={7}>7%</option><option value={19}>19%</option><option value={0}>0%</option>
              </select>
              <div className="total">{fmtEur(it.quantity * shownPrice(it))}</div>
              {!locked ? <button className="x" title={L('Xoá dòng', 'Position löschen')} onClick={() => { setItems((l) => l.filter((_, j) => j !== i)); setDirty(true) }}>✕</button> : <div />}
            </div>
          ))}
        </div>
        <div className="totals" style={{ marginTop: 12 }}>
          {totals.taxGroups.map((g) => (
            <div key={g.rate} className="muted small"><span>Netto {fmt(g.rate).replace(',00', '')}% / USt</span><span>{fmtEur(g.net)} / {fmtEur(g.tax)}</span></div>
          ))}
          <div><span>Netto</span><span>{fmtEur(totals.net)}</span></div>
          <div><span>USt</span><span>{fmtEur(totals.tax)}</span></div>
          <div className="grand"><span>{L('Tổng cộng', 'Gesamtbetrag')}</span><span>{fmtEur(totals.gross)}</span></div>
        </div>
      </div>

      {!locked && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{L('Lời kết (tuỳ chọn)', 'Schlusstext (optional)')}</h2>
          <div><span className="lbl">{L('Lời kết (để trống = mặc định)', 'Schlusstext (leer = Standard)')}</span>
            <PresetPicker kind="closing" text={invoice.closing_text ?? ''} presets={presets} onPick={(t) => update('closing_text', t)} onChange={savePresets} />
            <textarea value={invoice.closing_text ?? ''} placeholder={companyText(company, invoice.language, 'closing_text', invoice.doc_type)} onChange={(e) => update('closing_text', e.target.value)} /></div>
        </div>
      )}

      <div className="sticky-actions">
        {!locked && invoice.id && <button className="danger" onClick={removeDraft} disabled={busy}>{L('Xoá nháp', 'Entwurf löschen')}</button>}
        <button onClick={previewPdf} disabled={busy || !items.length}>{L('Xem / In PDF', 'PDF ansehen / drucken')}</button>
        {!locked && <button onClick={() => save()} disabled={busy || (!dirty && Boolean(invoice.id))}>{L('Lưu nháp', 'Entwurf speichern')}</button>}
        {!locked && <button className="primary" onClick={finalize} disabled={busy}>{isQuote ? L('Hoàn tất Angebot', 'Angebot abschließen') : L('Hoàn tất hoá đơn', 'Rechnung abschließen')}</button>}
        {locked && invoice.status !== 'cancelled' && <button onClick={share} disabled={busy}>{L('Chia sẻ', 'Teilen')}</button>}
        {locked && invoice.status !== 'cancelled' && <button onClick={openMail} disabled={busy}>{L('Gửi email', 'Per E-Mail senden')}</button>}
        {!isQuote && locked && invoice.status === 'open' && <button className="primary" onClick={() => changeStatus('paid')} disabled={busy}>{L('Đã thanh toán', 'Als bezahlt markieren')}</button>}
        {!isQuote && locked && invoice.status === 'paid' && <button onClick={() => changeStatus('open')} disabled={busy}>{L('Đánh dấu chưa thanh toán', 'Als offen markieren')}</button>}
        {!isQuote && locked && invoice.status !== 'cancelled' && <button className="danger" onClick={() => changeStatus('cancelled')} disabled={busy}>{L('Huỷ hoá đơn', 'Stornieren')}</button>}
        {isQuote && locked && invoice.status === 'open' && <button className="danger" onClick={() => changeStatus('cancelled')} disabled={busy}>{L('Khách từ chối', 'Abgelehnt')}</button>}
        {isQuote && locked && invoice.status === 'cancelled' && <button onClick={() => changeStatus('open')} disabled={busy}>{L('Mở lại', 'Wieder öffnen')}</button>}
        {isQuote && invoice.id && invoice.status !== 'accepted' && invoice.status !== 'cancelled' && <button className="primary" onClick={convertToInvoice} disabled={busy}>{L('Chuyển thành hoá đơn', 'In Rechnung umwandeln')}</button>}
        {isQuote && invoice.status === 'accepted' && <button className="primary" onClick={openLinkedInvoice} disabled={busy}>{L('Mở hoá đơn', 'Rechnung öffnen')}</button>}
      </div>

      {preview && <PdfSheet pdf={preview} title={pdfFilename(invoice as Invoice)} onClose={() => setPreview(null)}
        actions={[
          { label: L('Tải PDF', 'PDF herunterladen'), primary: !locked || invoice.status === 'cancelled', onClick: () => download(preview) },
          ...(locked && invoice.status !== 'cancelled' ? [{ label: L('Gửi email', 'Per E-Mail senden'), primary: true, onClick: () => { setPreview(null); openMail() } }] : []),
        ]} />}

      {mail && (
        <div className="inv-modal-bg" onClick={() => !busy && setMail(null)}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{L(`Gửi ${docName} qua email`, `${isQuote ? 'Angebot' : 'Rechnung'} per E-Mail senden`)}</h2>
            <span className="lbl">{L('Gửi tới', 'An')}</span>
            <EmailList value={mail.to} onChange={(v) => setMail((m) => m && { ...m, to: v })} />
            <div className="mt"><span className="lbl">{L('Tiêu đề', 'Betreff')}</span>
              <input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
            <div className="mt"><span className="lbl">{L('Nội dung', 'Text')}</span>
              <textarea style={{ minHeight: 160 }} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></div>
            <p className="muted small">{L(`File PDF ${pdfFilename(invoice as Invoice)} sẽ được đính kèm.`, `${pdfFilename(invoice as Invoice)} wird angehängt.`)}</p>
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
              <button onClick={() => setMail(null)} disabled={busy}>{L('Thôi', 'Abbrechen')}</button>
              <button className="primary" onClick={sendMail} disabled={busy}>{busy ? L('Đang gửi…', 'Wird gesendet…') : L('Gửi', 'Senden')}</button>
            </div>
          </div>
        </div>
      )}
    </InvShell>
  )
}

/** Danh sách câu đã lưu: chọn để điền vào ô, lưu câu đang viết, hoặc xoá câu đã lưu */
function PresetPicker({ kind, text, presets, onPick, onChange }: {
  kind: keyof TextPresets; text: string; presets: TextPresets
  onPick: (t: string) => void; onChange: (p: TextPresets) => void
}) {
  const L = useL()
  const list = presets[kind]
  const cur = text.trim()
  const idx = cur ? list.indexOf(cur) : -1
  const set = (next: string[]) => onChange({ ...presets, [kind]: next })
  return (
    <div className="inv-presets">
      <select value={idx >= 0 ? String(idx) : ''} onChange={(e) => { if (e.target.value !== '') onPick(list[Number(e.target.value)]) }} disabled={!list.length}>
        <option value="">{list.length ? L(`Chọn câu đã lưu (${list.length})…`, `Gespeicherten Text wählen (${list.length})…`) : L('Chưa có câu nào được lưu', 'Noch keine gespeicherten Texte')}</option>
        {list.map((t, i) => <option key={i} value={i}>{t.length > 90 ? `${t.slice(0, 90)}…` : t}</option>)}
      </select>
      {idx >= 0
        ? <button type="button" className="sm" onClick={() => set(list.filter((_, i) => i !== idx))}>{L('Xoá khỏi danh sách', 'Aus Liste entfernen')}</button>
        : <button type="button" className="sm" disabled={!cur} onClick={() => set([cur, ...list].slice(0, 50))}>+ {L('Lưu câu này', 'Text speichern')}</button>}
    </div>
  )
}
