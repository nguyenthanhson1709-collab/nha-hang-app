import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase, errMsg, type Doc, type ZBon } from '../lib/supabase'
import { canManage, catName, useApp, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { dmy, eur, monthLabel, monthRange, thisMonth } from '../lib/format'
import { DOC_SELECT, deleteDoc, docsInRange, folderParts, lockedPeriods } from '../lib/data'
import { download, folderFiles, folderPdf, scansPdf, type ExtraBeleg, type Folder } from '../lib/pdf'
import { PayTag, Top, toast, useRestaurant } from '../components/ui'
import { MonthBar } from '../components/MonthBar'
import { liveFlags } from '../lib/lines'
import { fillUnits } from '../lib/ai'
import { bulkUpload, bulkZbon, MAX_MB, MAX_PAGES, type BulkResult, type ZBulkResult } from '../lib/bulk'

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
  const [unitBusy, setUnitBusy] = useState('')
  const [q] = useState('')
  const [found, setFound] = useState<Doc[] | null>(null)
  const [fPay, setFPay] = useState(''); const [fRate, setFRate] = useState(''); const [fCat, setFCat] = useState(''); const [fSup, setFSup] = useState('')
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState(0)
  const [bulk, setBulk] = useState<BulkResult | null>(null)
  const [zb, setZb] = useState<ZBulkResult | null>(null)

  useEffect(() => {
    if (!rid) return
    const { from, to } = monthRange(period)
    docsInRange(rid, from, to, true).then(setDocs).catch((e) => toast(errMsg(e)))
    if (m) supabase.from('nh_zbons').select('*').eq('restaurant_id', rid).eq('period', period).order('z_date').then(({ data }) => setZbons((data || []) as ZBon[]))
    lockedPeriods(rid).then((s) => setLocked(s.has(period)))
    // Chi/thu khác trong Kassenbuch có ảnh hoá đơn -> thuộc thư mục Bargeld
    if (m) supabase.from('nh_cash_moves').select('move_date, type, description, files').eq('restaurant_id', rid).eq('period', period).then(({ data }) =>
      setExtra((data || []).filter((x) => x.files?.length).map((x) => ({ date: x.move_date, name: x.description || (x.type === 'sonstige_einnahme' ? 'Sonstige Einnahme' : 'Sonstige Ausgabe'), files: x.files }))))
  }, [rid, period, m, tick])

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
  // Tải PDF: nội dung đã đọc (danh sách + từng chứng từ), không kèm ảnh
  async function pdfFolder(f: Folder) {
    setBusy('PDF…')
    try { download(await folderPdf(f, docs, f === 'Rechnungsausgang' ? zbons : [], r!, period, categories, setBusy, false), `${safe}_${period}_${f}.pdf`) } catch (e) { fail(e) }
    setBusy('')
  }
  // Tải file gốc: PDF gồm các bản scan
  async function scans(f: Folder) {
    setBusy('PDF…')
    try { const b = await scansPdf(f, docs, zbons, setBusy, extra); if (b) download(b, `${safe}_${period}_${f}_Original.pdf`); else toast(t('noData')) } catch (e) { fail(e) }
    setBusy('')
  }
  // Tải dữ liệu lên: 1 file PDF chứa nhiều hoá đơn
  async function upload(f: Folder, file: File | undefined) {
    if (!file || (f !== 'Bargeld' && f !== 'Rechnungseingang')) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('PDF'); return }
    setBulk(null); setBusy('…')
    try {
      const res = await bulkUpload({ rid: rid!, file, folder: f, period, categories, onProgress: setBusy })
      setBulk(res); setTick((x) => x + 1); reload()
    } catch (e) { fail(e) }
    setBusy('')
  }
  async function uploadZ(list: FileList | null) {
    const files = [...(list || [])]
    if (!files.length) return
    setZb(null); setBusy('…')
    try { const res = await bulkZbon({ rid: rid!, files, onProgress: setBusy }); setZb(res); setTick((x) => x + 1) } catch (e) { fail(e) }
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
      <Top title={folder ? LABEL[folder] : t('archive')} sub={r.name} back={folder ? `/r/${rid}/archive` : `/r/${rid}`} />
      <div className="page">
        {!found && (
          <>
            <MonthBar value={period} onChange={setPeriod} />
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
                <Link className="tile" to={`/r/${rid}/statements`}>
                  <span className="ic">🏦</span><span>Kontoauszug</span>
                </Link>
                <Link className="tile" to={`/r/${rid}/contracts`}>
                  <span className="ic">📑</span><span>{t('contracts')}</span><span className="small muted">Lastschrift</span>
                </Link>
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

        {m && !locked && (() => {
          const miss = [...new Set(items.map((x) => x.d))].filter((d) => (d.nh_document_lines || []).length > 0 && (d.nh_document_lines || []).every((l) => !l.unit))
          if (!miss.length) return null
          return <button className="block" style={{ marginBottom: 10 }} disabled={!!unitBusy} onClick={async () => {
            let done = 0, filled = 0
            try {
              for (const d of miss) { setUnitBusy(`${++done}/${miss.length}`); filled += await fillUnits(d) }
              toast(lang === 'de' ? `${filled} Positionen ergänzt` : `Đã bổ sung đơn vị cho ${filled} dòng`)
              setDocs((ds) => [...ds])
            } catch (e) { toast(errMsg(e)) } finally { setUnitBusy('') }
          }}>{unitBusy ? `… ${t('reading')} ${unitBusy}` : `📏 ${lang === 'de' ? `Einheiten ergänzen (${miss.length} Rechnungen)` : `Bổ sung đơn vị cho ${miss.length} hoá đơn`}`}</button>
        })()}
        <div className="list">
          {items.map(({ d, amount, method, folder: fo }, i) => (
            <Link className="it" key={d.id + i} to={`/r/${rid}/doc/${d.id}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{d.supplier || '—'}{folderParts(d).length > 1 && <span className="tag" style={{ marginLeft: 6 }}>⇄</span>}</div>
                <div className="small muted">{dmy(d.doc_date)}{found && ` · ${LABEL[fo]}`}{d.status === 'uploaded' && <> · <span className="tag warn">{t('uploaded')}</span></>}{liveFlags(d).length > 0 && <> · <span className="tag err">!</span></>}</div>
              </div>
              <div className="right"><div className="num">{eur(amount)}</div>{method && <PayTag m={method.split('+')[0]} />}</div>
              {m && !locked && <button className="ghost small" title={t('delete')} style={{ marginLeft: 4 }} onClick={async (e) => {
                e.preventDefault(); e.stopPropagation()
                if (!confirm(`${t('confirmDelete')}\n${d.supplier || '—'} · ${dmy(d.doc_date)} · ${eur(d.gross)}`)) return
                try { await deleteDoc(d); setDocs((ds) => ds.filter((x) => x.id !== d.id)); toast(t('deleted')) } catch (err) { toast(errMsg(err)) }
              }}>🗑</button>}
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
            {folder && <div className="grid2">
              {folder ? <>
                <button disabled={!!busy} onClick={() => pdfFolder(folder)}>📄 {t('exportPdf')}</button>
                <button disabled={!!busy} onClick={() => scans(folder)}>🗂 {t('originals')}</button>
              </> : null}
            </div>}
            {folder && folder !== 'Rechnungsausgang' && !locked && (
              <label className={`btn primary block${busy ? ' disabled' : ''}`} style={{ marginTop: 8, textAlign: 'center' }}>
                ⬆ {t('uploadData')}
                <input type="file" accept="application/pdf,.pdf" hidden disabled={!!busy} onChange={(e) => { upload(folder, e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}
            {folder === 'Rechnungsausgang' && !locked && (
              <label className={`btn primary block${busy ? ' disabled' : ''}`} style={{ marginTop: 8, textAlign: 'center' }}>
                ⬆ {t('uploadZ')}
                <input type="file" accept="application/pdf,.pdf,image/*" multiple hidden disabled={!!busy} onChange={(e) => { uploadZ(e.target.files); e.target.value = '' }} />
              </label>
            )}
            {folder === 'Rechnungsausgang' && !locked && !busy && !zb && <div className="small muted" style={{ marginTop: 6 }}>{t('uploadZHint')}</div>}
            {folder === 'Rechnungsausgang' && zb && (
              <div style={{ marginTop: 10 }}>
                <div className="alert ok">✓ {t('zAdded', { n: String(zb.added.length) })}{zb.skipped.length > 0 && ` · ${t('bulkSkipped', { n: String(zb.skipped.length) })}`}</div>
                <div className="small">
                  {zb.added.map((x, i) => <div key={'a' + i}>{x.warn ? '⚠️' : '✓'} {dmy(x.date)} · {eur(x.total)} <span className="muted">({x.src})</span>{x.warn && <> · <span className="tag warn">{t('zCheck')}</span></>}</div>)}
                  {zb.skipped.map((x, i) => <div key={'s' + i} className="muted">✕ {x.src}{x.date && ` · ${dmy(x.date)}`} ({x.why === 'dup' ? t('zDup') : x.why === 'AI' ? t('bulkUnread') : x.why})</div>)}
                </div>
                {zb.added.length > 0 && <Link className="btn block" style={{ marginTop: 8, textAlign: 'center' }} to={`/r/${rid}/kb`}>Kassenbuch →</Link>}
              </div>
            )}
            {folder && folder !== 'Rechnungsausgang' && !locked && !busy && !bulk && <div className="small muted" style={{ marginTop: 6 }}>{t('uploadHint', { p: String(MAX_PAGES), mb: String(MAX_MB) })}</div>}
            {bulk && (
              <div style={{ marginTop: 10 }}>
                <div className="alert ok">✓ {t('bulkAdded', { n: String(bulk.added.length) })} ({t('autoOk')}: {bulk.added.filter((x) => x.ok).length}){bulk.skipped.length > 0 && ` · ${t('bulkSkipped', { n: String(bulk.skipped.length) })}`}</div>
                <div className="small">
                  {bulk.added.map((x, i) => <div key={'a' + i}>{x.ok ? '✓' : '🔎'} {x.pages}: {x.supplier || '—'} · {dmy(x.date)} · {eur(x.gross)}{!x.ok && <> · <span className="tag warn">{t('toReview')}</span></>}</div>)}
                  {bulk.skipped.map((x, i) => <div key={'s' + i} className="muted">✕ {x.pages}: {x.supplier || '—'}{x.gross ? ` · ${eur(x.gross)}` : ''} ({x.why === 'dup' ? t('dupShort') : x.why === 'AI' ? t('bulkUnread') : x.why})</div>)}
                </div>
                {bulk.added.some((x) => !x.ok) && <Link className="btn block" style={{ marginTop: 8, textAlign: 'center' }} to={`/r/${rid}?v=review`}>{t('toReview')} →</Link>}
              </div>
            )}
            {!folder && profile.is_owner && !locked && <button className="danger block" onClick={lock}>🔒 {t('lockMonth')} {monthLabel(period)}</button>}
            {busy && <div className="small muted" style={{ marginTop: 8 }}>{busy}</div>}
          </div>
        )}
      </div>
    </>
  )
}
