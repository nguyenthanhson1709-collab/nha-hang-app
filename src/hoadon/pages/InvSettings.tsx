import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getCounter, insertMany, listArticles, listCustomers, loadCompany, saveCompany, setCounter } from '../api'
import type { Company } from '../types'
import { todayIso } from '../money'
import { InvShell, useL } from '../ui'
import { dropProps } from '../../lib/drop'

interface LexwareExport {
  articles: { nr: string; name: string; mittag: string; beschreibung: string; einheit: string; ust: number; netto: number; brutto: number }[]
  contacts: { nr: string; typ: string; name: string; strasse: string; plz: string; ort: string; email?: string }[]
}

async function resizeImage(file: File, maxW = 600, maxH = 240): Promise<string> {
  const img = new Image()
  img.src = URL.createObjectURL(file)
  await img.decode()
  const scale = Math.min(1, maxW / img.width, maxH / img.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export default function InvSettings() {
  const { rid } = useParams()
  const L = useL()
  const [c, setC] = useState<Company | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const period = todayIso().slice(0, 7).replace('-', '')
  const [counter, setCounterVal] = useState('')
  const [counter0, setCounter0] = useState('')
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadCompany(rid!).then(setC).catch((e) => setErr(e.message))
    getCounter(rid!, period).then((v) => { setCounterVal(String(v)); setCounter0(String(v)) }).catch(() => {})
  }, [rid, period])

  if (!c) return <InvShell>{err ? <div className="err">{err}</div> : <div className="center"><div className="spinner" /></div>}</InvShell>

  const f = (k: keyof Company) => ({
    value: String(c[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setC({ ...c, [k]: k === 'payment_days' ? Number(e.target.value) : e.target.value }),
  })

  async function save() {
    setErr(''); setOk(''); setBusy(true)
    try {
      await saveCompany(rid!, c!)
      const n = parseInt(counter)
      if (counter !== counter0 && Number.isFinite(n) && n >= 0) { await setCounter(rid!, period, n); setCounter0(String(n)) }
      setOk(L('Đã lưu cài đặt.', 'Einstellungen gespeichert.'))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function importLexware(file: File) {
    setErr(''); setOk(''); setImporting(true)
    try {
      const data = JSON.parse(await file.text()) as LexwareExport
      if (!Array.isArray(data.articles) || !Array.isArray(data.contacts)) throw new Error(L('File không đúng định dạng (cần lexware_data.json).', 'Falsches Format (lexware_data.json erwartet).'))
      const [existingC, existingA] = await Promise.all([listCustomers(rid!, true), listArticles(rid!, true)])
      const haveNr = new Set(existingC.map((x) => x.customer_number))
      const newC = data.contacts.filter((x) => !haveNr.has(Number(x.nr))).map((x) => ({
        restaurant_id: rid, customer_number: Number(x.nr) || null, kind: x.typ === 'Lieferant' ? 'vendor' : 'customer', name: x.name,
        street: x.strasse ?? '', zip: x.plz ?? '', city: x.ort ?? '', emails: x.email ?? '',
      }))
      const key = (n: string, name: string, lunch: boolean) => `${n}|${name}|${lunch}`
      const haveA = new Set(existingA.map((a) => key(a.number, a.name, a.is_lunch)))
      const newA = data.articles.filter((a) => !haveA.has(key(a.nr ?? '', a.name, Boolean(a.mittag)))).map((a) => ({
        restaurant_id: rid, number: a.nr ?? '', name: a.name, description: a.beschreibung ?? '', unit: a.einheit || 'Stück', tax_rate: a.ust,
        price_net: a.netto ?? 0, price_gross: a.brutto ?? 0, is_lunch: Boolean(a.mittag),
      }))
      await insertMany('nh_inv_customers', newC)
      await insertMany('nh_inv_articles', newA)
      setOk(L(`Đã nhập ${newC.length} khách hàng và ${newA.length} món (bỏ qua những mục đã có).`, `${newC.length} Kunden und ${newA.length} Artikel importiert (vorhandene übersprungen).`))
    } catch (e) { setErr((e as Error).message) } finally { setImporting(false) }
  }

  return (
    <InvShell>
      {err && <div className="err">{err}</div>}
      {ok && <div className="okmsg">{ok}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{L('Thông tin công ty (in trên hoá đơn)', 'Firmendaten (auf der Rechnung)')}</h2>
        <span className="lbl">{L('Tên công ty', 'Firmenname')}</span><input {...f('name')} />
        <div className="frow mt">
          <div style={{ flex: '2 1 240px' }}><span className="lbl">{L('Đường, số nhà', 'Straße')}</span><input {...f('street')} /></div>
          <div style={{ flex: '0 1 110px' }}><span className="lbl">PLZ</span><input {...f('zip')} /></div>
          <div><span className="lbl">{L('Thành phố', 'Ort')}</span><input {...f('city')} /></div>
        </div>
        <div className="frow mt">
          <div><span className="lbl">{L('Điện thoại', 'Telefon')}</span><input {...f('phone')} /></div>
          <div><span className="lbl">E-Mail</span><input {...f('email')} /></div>
          <div><span className="lbl">Website</span><input {...f('website')} /></div>
        </div>
        <div className="frow mt">
          <div><span className="lbl">USt-IdNr.</span><input {...f('vat_id')} /></div>
          <div><span className="lbl">Steuernummer</span><input {...f('tax_number')} /></div>
          <div><span className="lbl">Geschäftsführer</span><input {...f('managing_director')} /></div>
        </div>
        <div className="frow mt">
          <div><span className="lbl">{L('Toà án đăng ký (Amtsgericht)', 'Amtsgericht')}</span><input placeholder="Charlottenburg" {...f('register_court')} /></div>
          <div><span className="lbl">{L('Số đăng ký (HRB)', 'Handelsregister (HRB)')}</span><input placeholder="HRB 123456 B" {...f('register_number')} /></div>
        </div>
        <div className="frow mt">
          <div><span className="lbl">{L('Chủ tài khoản', 'Kontoinhaber')}</span><input {...f('account_holder')} /></div>
          <div><span className="lbl">{L('Ngân hàng', 'Bank')}</span><input {...f('bank_name')} /></div>
        </div>
        <div className="frow mt">
          <div style={{ flex: '2 1 260px' }}><span className="lbl">IBAN</span><input {...f('iban')} /></div>
          <div><span className="lbl">BIC</span><input {...f('bic')} /></div>
        </div>
        <div className="mt">
          <span className="lbl">Logo (PNG/JPG)</span>
          <div className="toolbar">
            {c.logo_url && <img src={c.logo_url} alt="Logo" style={{ maxHeight: 60, maxWidth: 200, background: '#fff', borderRadius: 8, padding: 4 }} />}
            <label className="btn drop" {...dropProps(async (fl) => {
              const file = Array.from(fl).find((x) => /^image\/(png|jpeg)$/.test(x.type)); if (file) setC({ ...c, logo_url: await resizeImage(file) })
            })}>
              🖼️ {L('Chọn logo', 'Logo wählen')}<span className="drop-hint">{L('hoặc kéo thả ảnh vào đây', 'oder Bild hierher ziehen')}</span>
              <input type="file" accept="image/png,image/jpeg" hidden onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = ''; if (file) setC({ ...c, logo_url: await resizeImage(file) })
              }} />
            </label>
            {c.logo_url && <button className="sm" onClick={() => setC({ ...c, logo_url: null })}>{L('Bỏ logo', 'Logo entfernen')}</button>}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{L('Hoá đơn', 'Rechnung')}</h2>
        <div className="frow">
          <div><span className="lbl">{L('Hạn thanh toán (ngày)', 'Zahlungsziel (Tage)')}</span><input type="number" min={0} {...f('payment_days')} /></div>
          <div>
            <span className="lbl">{L(`Số thứ tự cuối cùng của tháng ${period.slice(4)}/${period.slice(0, 4)}`, `Letzte Nummer im Monat ${period.slice(4)}/${period.slice(0, 4)}`)}</span>
            <input inputMode="numeric" value={counter} onChange={(e) => setCounterVal(e.target.value)} />
            <span className="muted small">{L('Hoá đơn tiếp theo', 'Nächste Rechnung')}: {period}{String((parseInt(counter) || 0) + 1).padStart(3, '0')}</span>
          </div>
        </div>
        <div className="mt"><span className="lbl">{L('Lời mở đầu mặc định (tiếng Đức)', 'Einleitung (Deutsch)')}</span><textarea {...f('intro_text')} /></div>
        <div className="mt"><span className="lbl">{L('Lời kết mặc định ({tage} = số ngày hạn thanh toán)', 'Schlusstext ({tage} = Zahlungsziel)')}</span><textarea {...f('closing_text')} /></div>
        <div className="mt"><span className="lbl">{L('Lời mở đầu tiếng Anh (hoá đơn English)', 'Einleitung (Englisch)')}</span><textarea {...f('intro_text_en')} /></div>
        <div className="mt"><span className="lbl">{L('Lời kết tiếng Anh', 'Schlusstext (Englisch)')}</span><textarea {...f('closing_text_en')} /></div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>E-Mail</h2>
        <p className="muted small">{L('Có thể dùng', 'Platzhalter')}: {'{nummer}'} {L('số hoá đơn', 'Nummer')}, {'{betrag}'} {L('số tiền', 'Betrag')}, {'{firma}'} {L('tên công ty', 'Firma')}, {'{kunde}'} {L('tên khách', 'Kunde')}.</p>
        <span className="lbl">{L('Tiêu đề (tiếng Đức)', 'Betreff (Deutsch)')}</span><input {...f('email_subject')} />
        <div className="mt"><span className="lbl">{L('Nội dung (tiếng Đức)', 'Text (Deutsch)')}</span><textarea style={{ minHeight: 140 }} {...f('email_body')} /></div>
        <div className="mt"><span className="lbl">{L('Tiêu đề (tiếng Anh)', 'Betreff (Englisch)')}</span><input {...f('email_subject_en')} /></div>
        <div className="mt"><span className="lbl">{L('Nội dung (tiếng Anh)', 'Text (Englisch)')}</span><textarea style={{ minHeight: 140 }} {...f('email_body_en')} /></div>
      </div>

      <div className="sticky-actions"><button className="primary" onClick={save} disabled={busy}>{L('Lưu cài đặt', 'Speichern')}</button></div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>{L('Nhập dữ liệu từ Lexware', 'Import aus Lexware')}</h2>
        <p className="muted small">{L('Chọn file lexware_data.json. Khách hàng và món đã có sẽ được bỏ qua, nên nhập lại nhiều lần cũng không bị trùng.', 'Datei lexware_data.json wählen. Vorhandene Kunden und Artikel werden übersprungen.')}</p>
        <label className={`btn drop${importing ? ' disabled' : ''}`} {...dropProps((fl) => { const file = Array.from(fl).find((x) => x.name.toLowerCase().endsWith('.json')); if (file) importLexware(file) }, importing)}>
          📄 {L('Chọn file JSON', 'JSON-Datei wählen')}<span className="drop-hint">{L('hoặc kéo thả file vào đây', 'oder Datei hierher ziehen')}</span>
          <input type="file" accept="application/json,.json" hidden disabled={importing} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) importLexware(file) }} />
        </label>
        {importing && <p className="muted small">{L('Đang nhập…', 'Import läuft…')}</p>}
      </div>
    </InvShell>
  )
}
