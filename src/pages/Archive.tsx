import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import JSZip from 'jszip'
import { supabase, errMsg, type Doc, type ZBon, type CashCount, type CashMove } from '../lib/supabase'
import { canManage, catName, useApp, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { addMonths, dmy, eur, monthLabel, monthRange, thisMonth } from '../lib/format'
import { DOC_SELECT, balanceBefore, docsInRange, folderParts, kassenbuch, lockedPeriods } from '../lib/data'
import { kbLines, kbPdf, kbXlsx } from '../lib/kassenbuch'
import { addOriginals, download, folderFiles, scansPdf, type ExtraBeleg, type Folder } from '../lib/pdf'
import { PayTag, Top, toast, useRestaurant } from '../components/ui'

const FOLDERS: Folder[] = ['Bargeld', 'Rechnungseingang', 'Rechnungsausgang']
// Tên hiển thị gọn; tên file xuất ra vẫn giữ tên chuyên môn (Rechnungseingang / Rechnungsausgang)
const LABEL: Record<Folder, string> = { Bargeld: 'Bargeld', Rechnungseingang: 'Rechnung', Rechnungsausgang: 'Z-Bon' }

export default function Archive() {
  const { rid } = useParams()
  const t = useT()
  const { lang } = useLang()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const m = canManage(role)
  const { categories, profile, reload } = useApp()
  const [period, setPeriod] = useState(thisMonth())
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const folder = sp.get('f') as Folder | null
  const setFolder = (f: Folder | null) => nav(f ? `/r/${rid}/archive?f=${f}` : `/r/${rid}/archive`)
  const [docs, setDocs] = useState<Doc[]>([])
  const [zbons, setZbons] = useState<ZBon[]>([])
  const [extra, setExtra] = useState<ExtraBeleg[]>([])
  const [locked, setLocked] = useState(false)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Doc[] | null>(null)
  const [fPay, setFPay] = useState(''); const [fRate, setFRate] = useState(''); const [fCat, setFCat] = useState(''); const [fSup, setFSup] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!rid) return
    const { from, to } = monthRange(period)
    docsInRange(rid, from, to, true).then(setDocs).catch((e) => toast(errMsg(e)))
    if (m) supabase.from('nh_zbons').select('*').eq('restaurant_id', rid).eq('period', period).order('z_date').then(({ data }) => setZbons((data || []) as ZBon[]))
    lockedPeriods(rid).then((s) => setLocked(s.has(period)))
    // Chi/thu khác trong Kassenbuch có ảnh hoá đơn -> thuộc thư mục Bargeld
    if (m) supabase.from('nh_cash_moves').select('move_date, type, description, files').eq('restaurant_id', rid).eq('period', period).then(({ data }) =>
      setExtra((data || []).filter((x) => x.files?.length).map((x) => ({ date: x.move_date, name: x.description || (x.type === 'sonstige_einnahme' ? 'Sonstige Einnahme' : 'Sonstige Ausgabe'), files: x.files }))))
  }, [rid, period, m])

  useEffect(() => {
    if (q.trim().length < 2) { setFound(null); return }
    const id = setTimeout(async () => {
      const { data: ls } = await supabase.from('nh_document_lines').select('document_id').ilike('name', `%${q.trim()}%`).limit(300)
      const ids = [...new Set((ls || []).map((x) => x.document_id))]
      let qq = supabase.from('nh_documents').select(DOC_SELECT).eq('restaurant_id', rid!).order('doc_date', { ascending: false }).limit(200)
      qq = ids.length ? qq.or(`id.in.(${ids.join(',')}),supplier.ilike.%${q.trim().replace(/[,()]/g, ' ')}%`) : qq.ilike('supplier', `%${q.trim()}%`)
      const { data } = await qq
      setFound((data || []) as Doc[])
    }, 350)
    return () => clearTimeout(id)
  }, [q, rid])

  const subs = categories.filter((c) => c.parent_id)
  const suppliers = useMemo(() => [...new Set(docs.map((d) => d.supplier).filter(Boolean))].sort() as string[], [docs])

  const items = useMemo(() => {
    const src = found || docs
    const out: { d: Doc; amount: number; method: string; folder: Folder }[] = []
    for (const d of src) for (const p of folderParts(d)) {
      if (!found && p.folder !== folder) continue
      if (fPay && p.method !== fPay) continue
      if (fRate && !(d.nh_document_taxes || []).some((x) => String(Number(x.rate)) === fRate)) continue
      if (fCat && !(d.nh_document_lines || []).some((l) => l.category_id === fCat)) continue
      if (fSup && d.supplier !== fSup) continue
      out.push({ d, amount: p.amount, method: p.method, folder: p.folder })
    }
    return out
  }, [docs, found, folder, fPay, fRate, fCat, fSup])

  if (!r || !m) return null
  const sum = items.reduce((s, i) => s + i.amount, 0)
  const zSum = zbons.reduce((s, z) => s + Number(z.total), 0)
  const safe = r.name.replace(/\W+/g, '_')

  const fail = (e: unknown) => toast(errMsg(e))
  async function pdfFolder(f: Folder) {
    setBusy('PDF…')
    try { const b = await scansPdf(f, docs, zbons, setBusy, extra); if (b) download(b, `${safe}_${period}_${f}.pdf`); else toast(t('noData')) } catch (e) { fail(e) }
    setBusy('')
  }
  async function originals(fs: Folder[], name: string) {
    setBusy('ZIP…')
    try {
      const z = new JSZip()
      for (const f of fs) await addOriginals(z, fs.length > 1 ? `${f}/` : '', f, docs, zbons, setBusy, extra)
      download(await z.generateAsync({ type: 'blob' }), name)
    } catch (e) { fail(e) }
    setBusy('')
  }
  async function zipPdf() {
    setBusy('ZIP…')
    try {
      const z = new JSZip()
      for (const f of FOLDERS) { const b = await scansPdf(f, docs, zbons, setBusy, extra); if (b) z.file(`${safe}_${period}_${f}.pdf`, b) }
      const rows = await kassenbuch(rid!, period)
      const { data: c } = await supabase.from('nh_cash_counts').select('*').eq('restaurant_id', rid!).eq('period', period)
      const { data: mv } = await supabase.from('nh_cash_moves').select('*').eq('restaurant_id', rid!).eq('period', period)
      const opening = rows.length ? Number(rows[0].saldo) - Number(rows[0].einnahme) + Number(rows[0].ausgabe) : await balanceBefore(rid!, monthRange(period).from, Number(r!.opening_cash))
      const kl = kbLines(docs, zbons, (mv || []) as CashMove[], r!, period, opening, categories)
      z.file(`${safe}_${period}_Kassenbuch.pdf`, kbPdf(kl, (c || []) as CashCount[], r!, period, opening))
      z.file(`${safe}_${period}_Kassenbuch.xlsx`, kbXlsx(kl, r!, period, opening))
      download(await z.generateAsync({ type: 'blob' }), `${safe}_${period}.zip`)
    } catch (e) { fail(e) }
    setBusy('')
  }
  async function lock() {
    if (!confirm(t('lockConfirm', { m: monthLabel(period) }))) return
    const pending = docs.filter((d) => d.status === 'uploaded').length
    if (pending && !confirm(`${pending} × ${t('toReview')}. OK?`)) return
    const { error } = await supabase.from('nh_periods').insert({ restaurant_id: rid, period, locked_by: profile.id })
    if (error) toast(errMsg(error)); else { setLocked(true); reload() }
  }

  return (
    <>
      <Top title={folder ? LABEL[folder] : t('archive')} sub={r.name} back={folder ? `/r/${rid}/archive` : undefined} />
      <div className="page">
        <input placeholder={`🔍 ${t('search')}`} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
        {!found && (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <button onClick={() => setPeriod(addMonths(period, -1))}>‹</button>
              <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
              <button onClick={() => setPeriod(addMonths(period, 1))}>›</button>
            </div>
            {locked && <div className="alert warn">🔒 {t('locked')}</div>}
            {!folder && (
              <div className="tiles">
                {FOLDERS.map((f) => (
                  <button key={f} className="tile" onClick={() => setFolder(f)}>
                    <span className="ic">{f === 'Bargeld' ? '💶' : f === 'Rechnungseingang' ? '📥' : '📤'}</span>
                    <span>{LABEL[f]}</span>
                    <span className="small muted">{folderFiles(f, docs, f === 'Rechnungsausgang' ? zbons : [], extra).length} Belege</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {(folder || found) && <>
        <details style={{ marginBottom: 10 }}>
          <summary className="small muted">Filter</summary>
          <div className="grid2" style={{ marginTop: 8 }}>
            <select value={fPay} onChange={(e) => setFPay(e.target.value)}><option value="">{t('payment')}: {t('all')}</option><option value="cash">{t('cash')}</option><option value="card">{t('card')}</option><option value="transfer">{t('transfer')}</option></select>
            <select value={fRate} onChange={(e) => setFRate(e.target.value)}><option value="">{t('taxRate')}: {t('all')}</option><option value="7">7%</option><option value="19">19%</option><option value="0">0%</option></select>
            <select value={fCat} onChange={(e) => setFCat(e.target.value)}><option value="">{t('category')}: {t('all')}</option>{subs.map((c) => <option key={c.id} value={c.id}>{catName(categories.find((p) => p.id === c.parent_id), lang)} · {catName(c, lang)}</option>)}</select>
            <select value={fSup} onChange={(e) => setFSup(e.target.value)}><option value="">{t('supplier')}: {t('all')}</option>{suppliers.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
        </details>

        <div className="list">
          {items.map(({ d, amount, method, folder: fo }, i) => (
            <Link className="it" key={d.id + i} to={`/r/${rid}/doc/${d.id}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{d.supplier || '—'}{folderParts(d).length > 1 && <span className="tag" style={{ marginLeft: 6 }}>⇄</span>}</div>
                <div className="small muted">{dmy(d.doc_date)}{found && ` · ${LABEL[fo]}`}{d.status === 'uploaded' && <> · <span className="tag warn">{t('uploaded')}</span></>}{d.flags?.length > 0 && <> · <span className="tag err">!</span></>}</div>
              </div>
              <div className="right"><div className="num">{eur(amount)}</div>{method && <PayTag m={method.split('+')[0]} />}</div>
            </Link>
          ))}
          {!found && folder === 'Rechnungsausgang' && zbons.map((z) => (
            <Link className="it" key={z.id} to={`/r/${rid}/z/${z.id}`}>
              <div className="grow"><div className="t">Z-Bon</div><div className="small muted">{dmy(z.z_date)}</div></div>
              <div className="num">{eur(z.total)}</div>
            </Link>
          ))}
          {!items.length && !(folder === 'Rechnungsausgang' && zbons.length) && <div className="it muted">{t('noData')}</div>}
        </div>
        {!found && <div className="row between small muted" style={{ marginBottom: 12 }}><span>{items.length + (folder === 'Rechnungsausgang' ? zbons.length : 0)} Belege</span><b>{eur(sum + (folder === 'Rechnungsausgang' ? zSum : 0))}</b></div>}

        </>}

        {m && !found && (
          <div className="card">
            <div className="grid2">
              {folder ? <>
                <button disabled={!!busy} onClick={() => pdfFolder(folder)}>📄 {t('exportPdf')}</button>
                <button disabled={!!busy} onClick={() => originals([folder], `${safe}_${period}_${folder}_Original.zip`)}>🗂 {t('originals')}</button>
              </> : <>
                <button disabled={!!busy} onClick={zipPdf}>🗜 {t('exportZip')} (PDF)</button>
                <button disabled={!!busy} onClick={() => originals(FOLDERS, `${safe}_${period}_Original.zip`)}>🗂 {t('exportZip')} ({t('originals')})</button>
              </>}
            </div>
            {!folder && profile.is_owner && !locked && <button className="danger block" style={{ marginTop: 10 }} onClick={lock}>🔒 {t('lockMonth')} {monthLabel(period)}</button>}
            {busy && <div className="small muted" style={{ marginTop: 8 }}>{busy}</div>}
          </div>
        )}
      </div>
    </>
  )
}
