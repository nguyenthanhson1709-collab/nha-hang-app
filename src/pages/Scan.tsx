import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { dropProps } from '../lib/drop'
import { supabase, errMsg, type Category, type PayMethod } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useT } from '../lib/i18n'
import { todayIso, r2 } from '../lib/format'
import { BLUR_LIMIT, compressImage, parseEInvoice, parseInvoice, parseZbon, pdfEmbeddedXml, readText, sharpness, type ParsedInvoice } from '../lib/ocr'
import { dupKey, findDuplicate, saveChildren, uploadFiles } from '../lib/data'
import { splitScan, type ScanGroup } from '../lib/bulk'
import { guessCategory, loadMemory } from '../lib/categorize'
import { Top, toast, useRestaurant } from '../components/ui'
import Scanner, { type ScannedPage } from '../components/Scanner'
import { autoScanImage, loadCv } from '../lib/scanner'
import { aiReadInvoice, aiReadZbon, lastAiError } from '../lib/ai'
import { autoProblems } from '../lib/autocheck'

type Kind = 'purchase' | 'zbon' | 'sales'
interface Page { blob: Blob; name: string; type: string; preview: string; blurry: boolean }

// Hàng đợi ở nền cho lượt lưu của nhân viên (không mất khi chuyển trang trong app)
const queue = { n: 0, subs: new Set<() => void>() }
function bump(d: number) { queue.n += d; queue.subs.forEach((f) => f()) }
if (typeof window !== 'undefined') window.addEventListener('beforeunload', (e) => { if (queue.n > 0) { e.preventDefault(); e.returnValue = '' } })

/** Chạy tối đa 3 việc cùng lúc (AI đọc mỗi hoá đơn mất vài giây) */
async function eachParallel<T>(items: T[], fn: (x: T) => Promise<void>, n = 3) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]) }))
}

/** Đọc một hoá đơn (AI, lỗi thì e-Rechnung/Tesseract) và lưu. null = trùng, bỏ qua.
 *  Nhân viên: luôn Chờ kiểm tra, không gán Bar/Thẻ (người phụ trách/chủ quyết định). */
async function saveInvoice(rid: string, g: ScanGroup, o: {
  kind?: 'purchase' | 'sales'; manage: boolean; pay: PayMethod | null; categories: Category[]; known?: Set<string>
  onDup?: (pi: ParsedInvoice, date: string, gross: number) => boolean; onUpload?: () => void
}): Promise<{ id: string; auto: boolean; supplier: string | null; gross: number } | null> {
  const kind = o.kind || 'purchase'
  const files0 = g.blobs.map((blob, i) => ({ blob, type: g.types[i] }))
  const hasXml = g.types.some((x) => x.includes('xml'))
  const aiInv = !hasXml ? await aiReadInvoice(rid, files0.filter((f) => !f.type.includes('xml'))) : null
  // AI lỗi: ghi lý do vào đầu văn bản đọc được, để xem lại sau
  let text = aiInv ? 'AI: ' + JSON.stringify(aiInv) : !hasXml && lastAiError ? `[AI-Fehler: ${lastAiError}]\n` : ''
  let parsedE: ParsedInvoice | null = null
  for (const p of aiInv ? [] : files0) {
    if (p.type.includes('xml')) { const x = await p.blob.text(); parsedE = parseEInvoice(x); text += x.slice(0, 20000); continue }
    if (p.type === 'application/pdf') { const x = await pdfEmbeddedXml(p.blob); if (x) parsedE = parseEInvoice(x) }
    try { text += (await readText(p.blob, p.type)) + '\n' } catch { /* đọc lỗi: nhập tay */ }
  }
  o.onUpload?.()
  const pi = parsedE || aiInv || parseInvoice(text)
  const date = pi.doc_date || todayIso()
  const gross = r2(pi.gross || pi.taxes.reduce((s, x) => s + x.gross, 0))
  // Trùng: cùng số HĐ + ngày + số tiền (cả trong cùng lượt scan)
  const key = dupKey({ supplier: pi.supplier, invoice_no: pi.invoice_no, doc_date: date, gross })
  const inBatch = !!key && !!o.known?.has(key)
  if (key) o.known?.add(key) // đánh dấu trước khi chờ, vì các hoá đơn khác đang đọc song song
  const dup = inBatch || await findDuplicate(rid, pi.supplier, date, gross, undefined, pi.invoice_no)
  if (dup && !(o.onDup?.(pi, date, gross))) return null
  const files = await uploadFiles(rid, date, g.blobs, g.names)
  const payment = o.manage ? o.pay || pi.payment : null
  // Chủ/quản lý tải lên, AI (hoặc e-Rechnung) đọc đủ và khớp, không trùng -> duyệt luôn
  const auto = o.manage && kind === 'purchase' && !dup && !!(parsedE || aiInv) && autoProblems({ ...pi, gross }, payment).length === 0
  const { data: doc, error } = await supabase.from('nh_documents').insert({
    restaurant_id: rid, kind, ...(kind === 'purchase' && pi.is_credit ? { is_credit: true, ref_invoice_no: pi.ref_invoice_no || null } : {}), status: auto ? 'reviewed' : 'uploaded', doc_date: date, period: date.slice(0, 7),
    supplier: pi.supplier, invoice_no: pi.invoice_no, seller_tax_id: pi.seller_tax_id, gross, files, ocr_text: text.slice(0, 50000),
  }).select().single()
  if (error) throw error
  // Lưu nhà cung cấp mới vào danh sách
  if (pi.supplier) {
    const { data: ex } = await supabase.from('nh_suppliers').select('id').ilike('name', pi.supplier.replace(/[%_]/g, '')).limit(1)
    if (!ex?.length) await supabase.from('nh_suppliers').insert({ name: pi.supplier, tax_id: pi.seller_tax_id })
  }
  const mem = await loadMemory()
  await saveChildren(doc.id,
    payment ? [{ method: payment, amount: gross }] : [],
    pi.taxes,
    pi.lines.map((l, i) => ({ pos: i, name: l.name, qty: l.qty, unit: l.unit || null, unit_price: l.unit_price, total: l.total, rate: l.rate, category_id: guessCategory(l.name, o.categories, mem).id })),
    false)
  return { id: doc.id, auto, supplier: pi.supplier, gross }
}

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
  const [scanner, setScanner] = useState<false | 'scan' | 'photo'>(false)
  const cam = useRef<HTMLInputElement>(null)
  const pick = useRef<HTMLInputElement>(null)

  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.preview)), []) // eslint-disable-line
  // tải sẵn bộ xử lý ảnh khi mở trang scan, để máy scan và ảnh chụp xử lý ngay
  useEffect(() => { const id = setTimeout(() => { loadCv().catch(() => {}) }, 300); return () => clearTimeout(id) }, [])
  const [, rerender] = useState(0)
  useEffect(() => { const f = () => rerender((x) => x + 1); queue.subs.add(f); return () => { queue.subs.delete(f) } }, [])

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
    for (const p of ps) {
      let { blob, preview } = p
      // Ảnh chụp khi bộ nhận mép chưa sẵn: cắt mép, làm thẳng bây giờ
      if (p.raw) try { blob = await autoScanImage(p.blob); URL.revokeObjectURL(preview); preview = URL.createObjectURL(blob) } catch { /* giữ ảnh gốc */ }
      add.push({ blob, name: 'scan.jpg', type: 'image/jpeg', preview, blurry: (await sharpness(blob)) < BLUR_LIMIT })
    }
    setPages((x) => [...x, ...add])
  }

  // Nhân viên: bấm Lưu là xong. AI đọc, tách hoá đơn và lưu ở nền (vào Chờ kiểm tra, chưa có Bar/Thẻ),
  // nhân viên scan tiếp được ngay. Người phụ trách/chủ quyết định Bar hay Thẻ trong Chờ kiểm tra.
  function staffSave() {
    const ps = pages, rr = rid!, tt = t
    setPages([]); setPay(null); setStaffDone(true)
    bump(1)
    ;(async () => {
      try {
        const groups = await splitScan(rr, ps)
        const known = new Set<string>()
        let ok = 0, dup = 0, err = ''
        await eachParallel(groups, async (g) => {
          try { if (await saveInvoice(rr, g, { manage: false, pay: null, categories, known })) ok++; else dup++ }
          catch (e) { err = errMsg(e) }
        })
        toast(`${ok ? '✓' : '⚠'} ${tt('staffResult', { n: String(ok) })}${dup ? ` · ${tt('dupSkipped', { n: String(dup) })}` : ''}${err ? ` · ${err}` : ''}`)
      } catch (e) { toast(errMsg(e)) }
      finally { ps.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)); bump(-1) }
    })()
  }

  async function process() {
    if (!pages.length || !r) return
    if (!m && kind === 'purchase') return staffSave()
    try {
      setBusy(t('reading'))
      if (kind !== 'zbon') {
        // Nhiều hoá đơn trong một lần scan: AI tách theo trang rồi lưu từng hoá đơn
        const all: ScanGroup = { blobs: pages.map((p) => p.blob), types: pages.map((p) => p.type), names: pages.map((p) => p.name), pages: '' }
        const groups = kind === 'purchase' ? await splitScan(rid!, pages, setBusy) : [all]
        if (groups.length > 1) {
          const known = new Set<string>()
          let auto = 0, open = 0, dup = 0, done = 0
          setBusy(`📄 0/${groups.length}`)
          await eachParallel(groups, async (g) => {
            const res = await saveInvoice(rid!, g, { manage: m, pay, categories, known })
            if (!res) dup++; else if (res.auto) auto++; else open++
            setBusy(`📄 ${++done}/${groups.length}`)
          })
          toast(`✓ ${t('staffResult', { n: String(auto + open) })}${auto ? ` · ${t('autoOk')}: ${auto}` : ''}${dup ? ` · ${t('dupSkipped', { n: String(dup) })}` : ''}`)
          setPages([]); setPay(null); setBusy('')
          if (open) nav(`/r/${rid}?v=review`)
          return
        }
        const res = await saveInvoice(rid!, groups[0], {
          kind, manage: m, pay, categories,
          onDup: (pi, date, gross) => window.confirm(`${t('duplicate')}\n\n${pi.supplier} · ${date.split('-').reverse().join('.')} · ${gross.toFixed(2).replace('.', ',')} €\n\n${t('saveAnyway')}?`),
          onUpload: () => setBusy(t('uploading')),
        })
        if (lastAiError) toast(`⚠ AI: ${lastAiError}`)
        if (!res) { setBusy(''); toast(t('duplicate')); return }
        if (res.auto) { toast(`✓ ${t('autoOk')}: ${res.supplier} · ${res.gross.toFixed(2).replace('.', ',')} €`); setPages([]); setPay(null); setBusy(''); return }
        nav(`/r/${rid}/doc/${res.id}`)
        return
      }
      // Z-Bon
      const imgs = pages.filter((p) => !p.type.includes('xml'))
      const aiZ = await aiReadZbon(rid!, imgs)
      let text = aiZ ? 'AI: ' + JSON.stringify(aiZ) : ''
      if (!aiZ) for (const p of imgs) { try { text += (await readText(p.blob, p.type)) + '\n' } catch { /* đọc lỗi: nhập tay */ } }
      setBusy(t('uploading'))
      const z = aiZ || parseZbon(text, r.pos_type, r.pos_payment_map)
      const date = z.z_date || todayIso()
      const files = await uploadFiles(rid!, date, pages.map((p) => p.blob), pages.map((p) => p.name))
      nav(`/r/${rid}/z/new`, { state: { parsed: z, files, ocr_text: text } })
    } catch (e) {
      toast(errMsg(e)); setBusy('')
    }
  }

  if (!r) return null
  const blurry = pages.some((p) => p.blurry)

  return (
    <>
      <Top title={t('scan')} sub={r.name} back={`/r/${rid}`} />
      <div className="page drop-page" {...dropProps((fl) => { setStaffDone(false); addFiles(fl) })}>
        {m && (
          <div className="seg" style={{ marginBottom: 12 }}>
            {(['purchase', 'zbon', 'sales'] as Kind[]).map((k) => (
              <button key={k} className={kind === k ? 'sel' : ''} onClick={() => setKind(k)}>
                {k === 'purchase' ? t('scanInvoice') : k === 'zbon' ? t('scanZbon') : t('scanSales')}
              </button>
            ))}
          </div>
        )}
        {staffDone && <div className="alert ok">✓ {t('staffQueued')} {t('staffNote')}</div>}
        {queue.n > 0 && <div className="alert warn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 18, height: 18, flex: 'none' }} />{t('staffWorking', { n: String(queue.n) })}</div>}

        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <input ref={pick} type="file" accept="image/*,application/pdf,.xml,text/xml,application/xml" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />

        <button className="primary huge" onClick={() => { setStaffDone(false); setScanner('scan') }}>📄 {pages.length ? t('addPage') : t('scan')}</button>
        <div className="grid2" style={{ marginTop: 8 }}>
          <button onClick={() => { setStaffDone(false); setScanner('photo') }}>📷 {t('takePhoto')}</button>
          <button onClick={() => { setStaffDone(false); pick.current?.click() }}>📁 {t('chooseFile')}<span className="drop-hint">{t('dropHint')}</span></button>
        </div>
        {kind === 'purchase' && <div className="small muted" style={{ marginTop: 8 }}>{t('splitHint')}</div>}
        {scanner && <Scanner plain={scanner === 'photo'} onDone={fromScanner} onCancel={() => setScanner(false)} onFallback={() => cam.current?.click()} />}

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

            {m && kind !== 'zbon' && (
              <>
                <h3>{t('payment')}</h3>
                <div className="seg">
                  {(['cash', 'card', 'transfer'] as PayMethod[]).map((x) => (
                    <button key={x} className={pay === x ? 'sel' : ''} onClick={() => setPay(pay === x ? null : x)}>{t(x)}</button>
                  ))}
                </div>
              </>
            )}
            <button className="primary block" style={{ marginTop: 12 }} disabled={!!busy} onClick={process}>
              {busy || (m ? `${t('scan')} →` : t('save'))}
            </button>
          </div>
        )}
        {busy && <div className="center" style={{ minHeight: 120 }}><div className="spinner" /></div>}
      </div>
    </>
  )
}
