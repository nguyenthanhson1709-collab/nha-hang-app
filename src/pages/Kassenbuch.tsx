import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, errMsg, signedUrl, type CashCount, type CashMove, type ZBon } from '../lib/supabase'
import { canManage, useApp, useRole } from '../lib/app'
import { useT } from '../lib/i18n'
import { addMonths, daysOfMonth, eur, monthLabel, monthRange, r2, thisMonth, todayIso } from '../lib/format'
import { balanceBefore, currentBalance, kassenbuch, lockedPeriods, uploadFiles } from '../lib/data'
import Scanner, { type ScannedPage } from '../components/Scanner'
import { autoScanImage } from '../lib/scanner'
import { compressImage } from '../lib/ocr'
import { download } from '../lib/pdf'
import { kbLines, kbPdf, kbTotals, kbXlsx, type KbLine } from '../lib/kassenbuch'
import { docsInRange } from '../lib/data'
import { Money, Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'

type MoveType = 'einlage' | 'privatentnahme' | 'geldtransit' | 'sonstige_einnahme' | 'sonstige_ausgabe'
const OUT = new Set(['privatentnahme', 'geldtransit', 'sonstige_ausgabe'])

export default function Kassenbuch() {
  const { rid } = useParams()
  const t = useT()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [period, setPeriod] = useState(thisMonth())
  const [rows, setRows] = useState<KbLine[] | null>(null)
  const { categories } = useApp()
  const [counts, setCounts] = useState<CashCount[]>([])
  const [opening, setOpening] = useState(0)
  const [locked, setLocked] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [move, setMove] = useState<{ type: MoveType; date: string; amount: number; description: string; channel?: string } | null>(null)
  const [mvPages, setMvPages] = useState<{ blob: Blob; preview: string }[]>([])
  const [scanner, setScanner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mvFiles, setMvFiles] = useState<Record<string, string[]>>({})
  const cam = useRef<HTMLInputElement>(null)
  const [count, setCount] = useState<{ date: string; counted: number; book: number; reason: string } | null>(null)

  const load = useCallback(async () => {
    if (!r) return
    setRows(null)
    const { from, to } = monthRange(period)
    const [kb, c, lk, mv, docs, zq] = await Promise.all([
      kassenbuch(rid!, period),
      supabase.from('nh_cash_counts').select('*').eq('restaurant_id', rid!).eq('period', period).order('count_date'),
      lockedPeriods(rid!),
      supabase.from('nh_cash_moves').select('*').eq('restaurant_id', rid!).eq('period', period),
      docsInRange(rid!, from, to, true),
      supabase.from('nh_zbons').select('*').eq('restaurant_id', rid!).eq('period', period),
    ])
    setMvFiles(Object.fromEntries((mv.data || []).filter((x) => x.files?.length).map((x) => [x.id, x.files as string[]])))
    const op = kb.length ? r2(Number(kb[0].saldo) - Number(kb[0].einnahme) + Number(kb[0].ausgabe)) : await balanceBefore(rid!, from, Number(r.opening_cash))
    setOpening(op); setCounts((c.data || []) as CashCount[]); setLocked(lk.has(period))
    // Ngày đã qua trong tháng chưa có Z-Bon
    const have = new Set(((zq.data || []) as ZBon[]).map((z) => z.z_date))
    const today = todayIso()
    setMissing(daysOfMonth(period).filter((d) => d < today && !have.has(d) && (!r.opening_date || d >= r.opening_date)))
    setRows(kbLines(docs, (zq.data || []) as ZBon[], (mv.data || []) as CashMove[], r, period, op, categories))
  }, [rid, period, r, categories])
  useEffect(() => { load() }, [load])

  if (!r) return null
  if (!canManage(role)) return null

  async function saveMove() {
    if (!move || move.amount <= 0) return
    if (OUT.has(move.type) && move.channel !== 'viva') {
      const bal = await currentBalance(rid!, Number(r!.opening_cash))
      if (bal - move.amount < 0) { toast(t('negativeBalance')); return }
    }
    setSaving(true)
    try {
      const files = mvPages.length ? await uploadFiles(rid!, move.date, mvPages.map((p) => p.blob), mvPages.map(() => 'beleg.jpg')) : []
      const { error } = await supabase.from('nh_cash_moves').insert({ restaurant_id: rid, move_date: move.date, period: move.date.slice(0, 7), type: move.type, amount: move.amount, description: move.description || null, files, channel: move.channel || null })
      if (error) throw error
      closeMove(); load()
    } catch (e) { toast(errMsg(e)) }
    setSaving(false)
  }
  function closeMove() { mvPages.forEach((p) => URL.revokeObjectURL(p.preview)); setMvPages([]); setMove(null) }
  async function addPhotos(fl: FileList | null) {
    for (const f of Array.from(fl || [])) {
      let blob: Blob
      try { blob = await autoScanImage(f) } catch { blob = await compressImage(f) }
      setMvPages((p) => [...p, { blob, preview: URL.createObjectURL(blob) }])
    }
  }
  async function fromScanner(ps: ScannedPage[]) {
    setScanner(false)
    for (const p of ps) {
      let blob = p.blob
      if (p.raw) try { blob = await autoScanImage(p.blob) } catch { /* giữ ảnh gốc */ }
      setMvPages((x) => [...x, { blob, preview: URL.createObjectURL(blob) }])
    }
  }
  async function openFile(path: string) {
    const u = await signedUrl(path); if (u) window.open(u, '_blank')
  }
  async function openCount() {
    const d = todayIso()
    const { data } = await supabase.from('nh_kassenbuch').select('saldo').eq('restaurant_id', rid!).lte('entry_date', d).order('entry_date', { ascending: false }).order('nr', { ascending: false }).limit(1)
    const book = data?.[0] ? Number(data[0].saldo) : Number(r!.opening_cash)
    setCount({ date: d, counted: book, book, reason: '' })
  }
  async function changeCountDate(d: string) {
    const { data } = await supabase.from('nh_kassenbuch').select('saldo').eq('restaurant_id', rid!).lte('entry_date', d).order('entry_date', { ascending: false }).order('nr', { ascending: false }).limit(1)
    const book = data?.[0] ? Number(data[0].saldo) : Number(r!.opening_cash)
    setCount((c) => c && { ...c, date: d, book })
  }
  async function saveCount() {
    if (!count) return
    const diff = r2(count.counted - count.book)
    if (diff !== 0 && !count.reason.trim()) { toast(t('reason')); return }
    const { error } = await supabase.from('nh_cash_counts').upsert({ restaurant_id: rid, count_date: count.date, period: count.date.slice(0, 7), counted: count.counted, book_balance: count.book, reason: count.reason || null })
    if (error) { toast(errMsg(error)); return }
    setCount(null); load()
  }
  async function delMove(id: string) {
    if (!confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('nh_cash_moves').delete().eq('id', id)
    if (error) toast(errMsg(error)); else load()
  }

  const cmap = new Map(counts.map((c) => [c.count_date, c]))
  const tot = kbTotals(rows || [])
  const ein = tot.ein, aus = tot.aus
  const negative = (rows || []).some((x) => x.saldo < 0)
  const fname = `Kasse_${r.name.replace(/\W+/g, '_')}_${period}`
  const pdfBlob = () => kbPdf(rows || [], counts, r!, period, opening)
  function viewPdf() {
    // mở cửa sổ trước rồi mới gán (Safari chặn cửa sổ mở sau khi chờ)
    const w = window.open('', '_blank')
    const u = URL.createObjectURL(pdfBlob())
    if (w) w.location.href = u; else location.href = u
  }
  return (
    <>
      <Top title={t('kassenbuch')} sub={r.name} />
      <div className="page">
        <div className="row" style={{ marginBottom: 10 }}>
          <button onClick={() => setPeriod(addMonths(period, -1))}>‹</button>
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          <button onClick={() => setPeriod(addMonths(period, 1))}>›</button>
        </div>
        {locked && <div className="alert warn">🔒 {t('locked')} · {t('lockedHint')}</div>}
        {negative && <div className="alert err">{t('negativeBalance')}</div>}
        {missing.length > 0 && (
          <div className="alert warn">
            <b>{t('missingZbon')} ({missing.length}):</b> {missing.map((d) => d.slice(8) + '.').join(' ')}{' '}
            <Link to={`/r/${rid}/scan?type=zbon`}>+ {t('scanZbon')}</Link>
          </div>
        )}
        <div className="grid3" style={{ marginBottom: 12 }}>
          <div className="stat"><div className="l">{t('openingCash')}</div><div className="v">{eur(opening)}</div></div>
          <div className="stat"><div className="l">+ / −</div><div className="v small"><span className="kb-in">{eur(ein)}</span><br /><span className="kb-out">{eur(aus)}</span></div></div>
          <div className="stat"><div className="l">{t('cashBalance')}</div><div className="v">{eur(opening + ein - aus)}</div></div>
        </div>
        {!locked && (
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <button className="primary" onClick={openCount}>🧮 {t('count')}</button>
            <button onClick={() => setMove({ type: 'geldtransit', date: todayIso(), amount: 0, description: '', channel: 'viva' })}>− Viva Wallet</button>
            {(['geldtransit', 'sonstige_ausgabe', 'sonstige_einnahme'] as MoveType[]).map((x) => (
              <button key={x} onClick={() => setMove({ type: x, date: todayIso(), amount: 0, description: '' })}>{OUT.has(x) ? '−' : '+'} {t(x).split(' (')[0]}</button>
            ))}
          </div>
        )}
        {rows && (
          <div className="grid3" style={{ marginBottom: 12 }}>
            <button onClick={viewPdf}>👁 PDF</button>
            <button onClick={() => download(pdfBlob(), fname + '.pdf')}>⬇ PDF</button>
            <button onClick={() => download(kbXlsx(rows, r, period, opening), fname + '.xlsx')}>⬇ Excel</button>
          </div>
        )}
        {!rows ? <Spinner /> : !rows.length && !counts.length ? <div className="card muted">{t('noData')}</div> : (
          <div className="tbl-wrap">
            <table className="kb">
              <thead><tr><th>Datum</th><th>Beleg</th><th className="num">Einnahmen</th><th className="num">Ausgaben</th><th className="num">MwSt.</th><th className="num">USt</th><th className="num">VSt</th><th className="num">Ein.Netto</th><th className="num">Aus.Netto</th><th className="num">Saldo</th><th>Konto</th><th>Text</th></tr></thead>
              <tbody>
                <tr><td colSpan={9} /><td className="num">{eur(opening, false)}</td><td /><td className="muted">Saldo Vormonat</td></tr>
                {rows.map((x, i) => {
                  const c = rows[i + 1]?.date !== x.date ? cmap.get(x.date) : undefined
                  return (
                    <KbTr key={i} x={x} c={c} onDel={locked ? undefined : delMove} files={mvFiles} onFile={openFile} />
                  )
                })}
              </tbody>
              <tfoot><tr><td /><td>Summe</td><td className="num">{eur(tot.ein, false)}</td><td className="num">{eur(tot.aus, false)}</td><td /><td className="num">{eur(tot.ust, false)}</td><td className="num">{eur(tot.vst, false)}</td><td className="num">{eur(tot.einNetto, false)}</td><td className="num">{eur(tot.ausNetto, false)}</td><td className="num">{eur(opening + tot.ein - tot.aus, false)}</td><td /><td>Endbestand</td></tr></tfoot>
            </table>
          </div>
        )}
        <div className="small muted">{monthLabel(period)} · Z-Bon <Link to={`/r/${rid}/scan?type=zbon`}>+ {t('scanZbon')}</Link></div>
      </div>

      {scanner && <Scanner onDone={fromScanner} onCancel={() => setScanner(false)} />}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
      <Sheet open={!!move && !scanner} onClose={closeMove} title={move ? (move.channel === 'viva' ? 'Viva Wallet (Kartenzahlung)' : t(move.type)) : ''}>
        {move && <>
          <label className="f"><span>{t('date')}</span><input type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} /></label>
          <label className="f"><span>{t('amount')}</span><Money value={move.amount} onChange={(v) => setMove({ ...move, amount: v })} /></label>
          <label className="f"><span>{t('description')}</span><input value={move.description} onChange={(e) => setMove({ ...move, description: e.target.value })} /></label>
          {(move.type !== 'geldtransit' || move.channel === 'viva') && <>
            <div className="grid2" style={{ marginBottom: 8 }}>
              <button onClick={() => setScanner(true)}>📄 {t('scan')}</button>
              <button onClick={() => cam.current?.click()}>📷 {t('takePhoto')}</button>
            </div>
            {mvPages.length > 0 && <div className="thumbs" style={{ marginBottom: 8 }}>
              {mvPages.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={p.preview} alt="" />
                  <button className="ghost" style={{ position: 'absolute', top: 0, right: 0, minHeight: 30, padding: 4 }} onClick={() => setMvPages((ps) => ps.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>}
          </>}
          <button className="primary block" disabled={saving} onClick={saveMove}>{saving ? '…' : t('save')}</button>
        </>}
      </Sheet>
      <Sheet open={!!count} onClose={() => setCount(null)} title={t('count')}>
        {count && <>
          <label className="f"><span>{t('date')}</span><input type="date" value={count.date} onChange={(e) => changeCountDate(e.target.value)} /></label>
          <div className="row between" style={{ marginBottom: 8 }}><span>{t('bookBalance')}</span><b>{eur(count.book)}</b></div>
          <label className="f"><span>{t('counted')}</span><Money value={count.counted} onChange={(v) => setCount({ ...count, counted: v })} /></label>
          {r2(count.counted - count.book) !== 0 && <>
            <div className="alert warn">{t('difference')}: {eur(count.counted - count.book)}</div>
            <label className="f"><span>{t('reason')}</span><input value={count.reason} onChange={(e) => setCount({ ...count, reason: e.target.value })} /></label>
          </>}
          <button className="primary block" onClick={saveCount}>✓ {t('confirmDay')}</button>
        </>}
      </Sheet>
    </>
  )
}

const nz = (v: number) => (v ? eur(v, false) : '')
function KbTr({ x, c, onDel, files, onFile }: { x: KbLine; c?: CashCount; onDel?: (id: string) => void; files: Record<string, string[]>; onFile: (p: string) => void }) {
  return (
    <>
      <tr>
        <td>{x.date.slice(8, 10)}.{x.date.slice(5, 7)}</td>
        <td>{x.beleg}</td>
        <td className="num kb-in">{nz(x.ein)}</td>
        <td className="num kb-out">{nz(x.aus)}</td>
        <td className="num">{x.rate == null ? '' : `${x.rate}%`}</td>
        <td className="num">{nz(x.ust)}</td>
        <td className="num">{nz(x.vst)}</td>
        <td className="num">{nz(x.einNetto)}</td>
        <td className="num">{nz(x.ausNetto)}</td>
        <td className="num" style={x.saldo < 0 ? { color: 'var(--err)', fontWeight: 700 } : undefined}>{eur(x.saldo, false)}</td>
        <td>{x.konto}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{x.link ? <Link to={x.link}>{x.text}</Link> : x.text}
          {x.moveId && files[x.moveId]?.map((f) => <button key={f} className="ghost small" style={{ minHeight: 0, padding: '0 4px' }} onClick={() => onFile(f)}>📎</button>)}
          {x.moveId && onDel && <button className="ghost small" style={{ minHeight: 0, padding: '0 4px' }} onClick={() => onDel(x.moveId!)}>✕</button>}</td>
      </tr>
      {c && <tr><td colSpan={11} /><td className="small">Kassensturz: {eur(c.counted)} {Number(c.difference) === 0 ? <span className="tag">✓</span> : <span className="tag err">{eur(c.difference)} · {c.reason}</span>}</td></tr>}
    </>
  )
}
