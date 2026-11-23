import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase, errMsg, type PayMethod } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useT } from '../lib/i18n'
import { todayIso, r2 } from '../lib/format'
import { BLUR_LIMIT, compressImage, parseEInvoice, parseInvoice, parseZbon, pdfEmbeddedXml, readText, sharpness, type ParsedInvoice } from '../lib/ocr'
import { saveChildren, uploadFiles } from '../lib/data'
import { guessCategory, loadMemory } from '../lib/categorize'
import { Top, toast, useRestaurant } from '../components/ui'
import Scanner, { type ScannedPage } from '../components/Scanner'
import { autoScanImage } from '../lib/scanner'
import { aiReadInvoice, aiReadZbon } from '../lib/ai'

type Kind = 'purchase' | 'zbon' | 'sales'
interface Page { blob: Blob; name: string; type: string; preview: string; blurry: boolean }

export default function Scan() {
  const { rid } = useParams()
  const [sp] = useSearchParams()
  const t = useT()
  const nav = useNavigate()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const { categories } = useApp()
  const m = canManage(role)
  const [kind, setKind] = useState<Kind>((sp.get('type') as Kind) || 'purchase')
  const [pages, setPages] = useState<Page[]>([])
  const [busy, setBusy] = useState('')
  const [pay, setPay] = useState<PayMethod | null>(null)
  const [staffDone, setStaffDone] = useState(false)
  const [scanner, setScanner] = useState(false)
  const cam = useRef<HTMLInputElement>(null)
  const pick = useRef<HTMLInputElement>(null)

  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.preview)), []) // eslint-disable-line

  async function addFiles(fl: FileList | null) {
    if (!fl) return
    const add: Page[] = []
    for (const f of Array.from(fl)) {
      if (f.type.startsWith('image/')) {
        let blob: Blob
        try { blob = await autoScanImage(f) } catch { blob = await compressImage(f) }
        const sh = await sharpness(blob)
        add.push({ blob, name: f.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', preview: URL.createObjectURL(blob), blurry: sh < BLUR_LIMIT })
      } else {
        add.push({ blob: f, name: f.name, type: f.type || (f.name.endsWith('.xml') ? 'application/xml' : ''), preview: '', blurry: false })
      }
    }
    setPages((p) => [...p, ...add])
  }

  async function fromScanner(ps: ScannedPage[]) {
    setScanner(false)
    const add: Page[] = []
    for (const p of ps) add.push({ blob: p.blob, name: 'scan.jpg', type: 'image/jpeg', preview: p.preview, blurry: (await sharpness(p.blob)) < BLUR_LIMIT })
    setPages((x) => [...x, ...add])
  }

  async function process() {
    if (!pages.length || !r) return
    try {
      setBusy(t('reading'))
      // Ưu tiên AI đọc ảnh; lỗi hoặc chưa có khoá thì dùng bộ đọc miễn phí
      const imgs = pages.filter((p) => !p.type.includes('xml'))
      const hasXml = pages.some((p) => p.type.includes('xml'))
      const aiZ = kind === 'zbon' ? await aiReadZbon(rid!, imgs) : null
      const aiInv = kind !== 'zbon' && !hasXml ? await aiReadInvoice(rid!, imgs) : null
      // Đọc chữ
      let text = aiZ || aiInv ? 'AI: ' + JSON.stringify(aiZ || aiInv) : ''
      let parsedE: ParsedInvoice | null = null
      for (const p of aiZ || aiInv ? [] : pages) {
        if (p.type.includes('xml')) { const x = await p.blob.text(); parsedE = parseEInvoice(x); text += x.slice(0, 20000); continue }
        if (p.type === 'application/pdf') { const x = await pdfEmbeddedXml(p.blob); if (x) parsedE = parseEInvoice(x) }
        try { text += (await readText(p.blob, p.type)) + '\n' } catch { /* đọc lỗi: nhập tay */ }
      }
      setBusy(t('uploading'))

      if (kind === 'zbon') {
        const z = aiZ || parseZbon(text, r.pos_type, r.pos_payment_map)
        const date = z.z_date || todayIso()
        const files = await uploadFiles(rid!, date, pages.map((p) => p.blob), pages.map((p) => p.name))
        nav(`/r/${rid}/z/new`, { state: { parsed: z, files, ocr_text: text } })
        return
      }

      const pi = parsedE || aiInv || parseInvoice(text)
      const date = pi.doc_date || todayIso()
      const files = await uploadFiles(rid!, date, pages.map((p) => p.blob), pages.map((p) => p.name))
      const payment = pay || pi.payment
      const gross = r2(pi.gross || pi.taxes.reduce((s, x) => s + x.gross, 0))
      const { data: doc, error } = await supabase.from('nh_documents').insert({
        restaurant_id: rid, kind, status: 'uploaded', doc_date: date, period: date.slice(0, 7),
        supplier: pi.supplier, invoice_no: pi.invoice_no, seller_tax_id: pi.seller_tax_id, gross, files, ocr_text: text.slice(0, 50000),
      }).select().single()
      if (error) throw error
      const mem = await loadMemory()
      await saveChildren(doc.id,
        payment ? [{ method: payment, amount: gross }] : [],
        pi.taxes,
        pi.lines.map((l, i) => ({ pos: i, name: l.name, qty: l.qty, unit: null, unit_price: l.unit_price, total: l.total, rate: l.rate, category_id: guessCategory(l.name, categories, mem).id })),
        false)
      if (!m) { setStaffDone(true); setPages([]); setPay(null); setBusy(''); return }
      nav(`/r/${rid}/doc/${doc.id}`)
    } catch (e) {
      toast(errMsg(e)); setBusy('')
    }
  }

  if (!r) return null
  const blurry = pages.some((p) => p.blurry)

  return (
    <>
      <Top title={t('scan')} sub={r.name} />
      <div className="page">
        {m && (
          <div className="seg" style={{ marginBottom: 12 }}>
            {(['purchase', 'zbon', 'sales'] as Kind[]).map((k) => (
              <button key={k} className={kind === k ? 'sel' : ''} onClick={() => setKind(k)}>
                {k === 'purchase' ? t('scanInvoice') : k === 'zbon' ? t('scanZbon') : t('scanSales')}
              </button>
            ))}
          </div>
        )}
        {staffDone && <div className="alert ok">✓ {t('saved')}. {t('staffNote')}</div>}

        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <input ref={pick} type="file" accept="image/*,application/pdf,.xml,text/xml,application/xml" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />

        <button className="primary huge" onClick={() => { setStaffDone(false); setScanner(true) }}>📄 {pages.length ? t('addPage') : t('scan')}</button>
        <div className="grid2" style={{ marginTop: 8 }}>
          <button onClick={() => { setStaffDone(false); cam.current?.click() }}>📷 {t('takePhoto')}</button>
          <button onClick={() => { setStaffDone(false); pick.current?.click() }}>📁 {t('chooseFile')}</button>
        </div>
        {scanner && <Scanner onDone={fromScanner} onCancel={() => setScanner(false)} />}

        {pages.length > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="thumbs">
              {pages.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {p.preview ? <img src={p.preview} alt="" style={p.blurry ? { outline: '3px solid var(--warn)' } : undefined} /> : <div className="pdf">{p.type.includes('xml') ? 'XML' : 'PDF'}</div>}
                  <button className="ghost" style={{ position: 'absolute', top: 0, right: 0, minHeight: 30, padding: 4 }} onClick={() => setPages((ps) => ps.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            {blurry && <div className="alert warn">{t('blurry')}</div>}

            {kind !== 'zbon' && (
              <>
                <h3>{t('payment')}</h3>
                <div className="seg">
                  {(['cash', 'card', 'transfer'] as PayMethod[]).map((x) => (
                    <button key={x} className={pay === x ? 'sel' : ''} onClick={() => setPay(pay === x ? null : x)}>{t(x)}</button>
                  ))}
                </div>
                {!m && !pay && <div className="small muted" style={{ marginTop: 6 }}>{t('mustChoosePayment')}</div>}
              </>
            )}
            <button className="primary block" style={{ marginTop: 12 }} disabled={!!busy || (!m && !pay)} onClick={process}>
              {busy || (m ? `${t('scan')} →` : t('save'))}
            </button>
          </div>
        )}
        {busy && <div className="center" style={{ minHeight: 120 }}><div className="spinner" /></div>}
      </div>
    </>
  )
}
