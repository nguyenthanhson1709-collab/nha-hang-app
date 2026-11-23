import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, errMsg, signedUrl, type CashCount, type KbRow } from '../lib/supabase'
import { canManage, useRole } from '../lib/app'
import { useT } from '../lib/i18n'
import { addMonths, dmy, eur, monthLabel, monthRange, r2, thisMonth, todayIso } from '../lib/format'
import { balanceBefore, currentBalance, kassenbuch, lockedPeriods, uploadFiles } from '../lib/data'
import Scanner, { type ScannedPage } from '../components/Scanner'
import { autoScanImage } from '../lib/scanner'
import { compressImage } from '../lib/ocr'
import { download, kassenbuchPdf } from '../lib/pdf'
import { Money, Sheet, Spinner, Top, toast, useRestaurant } from '../components/ui'

type MoveType = 'einlage' | 'privatentnahme' | 'geldtransit' | 'sonstige_einnahme' | 'sonstige_ausgabe'
const OUT = new Set(['privatentnahme', 'geldtransit', 'sonstige_ausgabe'])

export default function Kassenbuch() {
  const { rid } = useParams()
  const t = useT()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [period, setPeriod] = useState(thisMonth())
  const [rows, setRows] = useState<KbRow[] | null>(null)
  const [counts, setCounts] = useState<CashCount[]>([])
  const [opening, setOpening] = useState(0)
  const [locked, setLocked] = useState(false)
  const [move, setMove] = useState<{ type: MoveType; date: string; amount: number; description: string } | null>(null)
  const [mvPages, setMvPages] = useState<{ blob: Blob; preview: string }[]>([])
  const [scanner, setScanner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mvFiles, setMvFiles] = useState<Record<string, string[]>>({})
  const cam = useRef<HTMLInputElement>(null)
  const [count, setCount] = useState<{ date: string; counted: number; book: number; reason: string } | null>(null)

  const load = useCallback(async () => {
    if (!r) return
    setRows(null)
    const [kb, c, lk, mv] = await Promise.all([
      kassenbuch(rid!, period),
      supabase.from('nh_cash_counts').select('*').eq('restaurant_id', rid!).eq('period', period).order('count_date'),
      lockedPeriods(rid!),
      supabase.from('nh_cash_moves').select('id, files').eq('restaurant_id', rid!).eq('period', period),
    ])
    setMvFiles(Object.fromEntries((mv.data || []).filter((x) => x.files?.length).map((x) => [x.id, x.files as string[]])))
    const op = kb.length ? r2(Number(kb[0].saldo) - Number(kb[0].einnahme) + Number(kb[0].ausgabe)) : await balanceBefore(rid!, monthRange(period).from, Number(r.opening_cash))
    setOpening(op); setRows(kb); setCounts((c.data || []) as CashCount[]); setLocked(lk.has(period))
  }, [rid, period, r])
  useEffect(() => { load() }, [load])

  if (!r) return null
  if (!canManage(role)) return null

  async function saveMove() {
    if (!move || move.amount <= 0) return
    if (OUT.has(move.type)) {
      const bal = await currentBalance(rid!, Number(r!.opening_cash))
      if (bal - move.amount < 0) { toast(t('negativeBalance')); return }
    }
    setSaving(true)
    try {
      const files = mvPages.length ? await uploadFiles(rid!, move.date, mvPages.map((p) => p.blob), mvPages.map(() => 'beleg.jpg')) : []
      const { error } = await supabase.from('nh_cash_moves').insert({ restaurant_id: rid, move_date: move.date, period: move.date.slice(0, 7), type: move.type, amount: move.amount, description: move.description || null, files })
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
  const byDay: [string, KbRow[]][] = []
  for (const x of rows || []) {
    const last = byDay[byDay.length - 1]
    if (last && last[0] === x.entry_date) last[1].push(x); else byDay.push([x.entry_date, [x]])
  }
  for (const c of counts) if (!byDay.some(([d]) => d === c.count_date)) byDay.push([c.count_date, []])
  byDay.sort((a, b) => a[0].localeCompare(b[0]))
  const ein = (rows || []).reduce((s, x) => s + Number(x.einnahme), 0), aus = (rows || []).reduce((s, x) => s + Number(x.ausgabe), 0)
  const negative = (rows || []).some((x) => Number(x.saldo) < 0)

  const link = (x: KbRow) => x.source === 'beleg' ? `/r/${rid}/doc/${x.source_id}` : x.source === 'zbon' || x.source === 'tip' ? `/r/${rid}/z/${x.source_id}` : null

  return (
    <>
      <Top title={t('kassenbuch')} sub={r.name} right={<button onClick={() => rows && download(kassenbuchPdf(rows, counts, r, period, opening), `Kassenbuch_${r.name.replace(/\W+/g, '_')}_${period}.pdf`)}>PDF</button>} />
      <div className="page">
        <div className="row" style={{ marginBottom: 10 }}>
          <button onClick={() => setPeriod(addMonths(period, -1))}>‹</button>
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          <button onClick={() => setPeriod(addMonths(period, 1))}>›</button>
        </div>
        {locked && <div className="alert warn">🔒 {t('locked')} · {t('lockedHint')}</div>}
        {negative && <div className="alert err">{t('negativeBalance')}</div>}
        <div className="grid3" style={{ marginBottom: 12 }}>
          <div className="stat"><div className="l">{t('openingCash')}</div><div className="v">{eur(opening)}</div></div>
          <div className="stat"><div className="l">+ / −</div><div className="v small"><span className="kb-in">{eur(ein)}</span><br /><span className="kb-out">{eur(aus)}</span></div></div>
          <div className="stat"><div className="l">{t('cashBalance')}</div><div className="v">{eur(opening + ein - aus)}</div></div>
        </div>
        {!locked && (
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <button className="primary" onClick={openCount}>🧮 {t('count')}</button>
            {(['geldtransit', 'sonstige_ausgabe', 'sonstige_einnahme'] as MoveType[]).map((x) => (
              <button key={x} onClick={() => setMove({ type: x, date: todayIso(), amount: 0, description: '' })}>{OUT.has(x) ? '−' : '+'} {t(x).split(' (')[0]}</button>
            ))}
          </div>
        )}
        {!rows ? <Spinner /> : !byDay.length ? <div className="card muted">{t('noData')}</div> : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Nr.</th><th>{t('description')}</th><th className="num">+</th><th className="num">−</th><th className="num">{t('cashBalance')}</th></tr></thead>
              <tbody>
                {byDay.map(([d, xs]) => (
                  <DayRows key={d} d={d} xs={xs} c={cmap.get(d)} link={link} onDel={locked ? undefined : delMove} t={t} files={mvFiles} onFile={openFile} />
                ))}
              </tbody>
              <tfoot><tr><td /><td>{t('total')}</td><td className="num kb-in">{eur(ein)}</td><td className="num kb-out">{eur(aus)}</td><td className="num">{eur(opening + ein - aus)}</td></tr></tfoot>
            </table>
          </div>
        )}
        <div className="small muted">{monthLabel(period)} · Z-Bon <Link to={`/r/${rid}/scan?type=zbon`}>+ {t('scanZbon')}</Link></div>
      </div>

      {scanner && <Scanner onDone={fromScanner} onCancel={() => setScanner(false)} />}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
      <Sheet open={!!move && !scanner} onClose={closeMove} title={move ? t(move.type) : ''}>
        {move && <>
          <label className="f"><span>{t('date')}</span><input type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} /></label>
          <label className="f"><span>{t('amount')}</span><Money value={move.amount} onChange={(v) => setMove({ ...move, amount: v })} /></label>
          <label className="f"><span>{t('description')}</span><input value={move.description} onChange={(e) => setMove({ ...move, description: e.target.value })} /></label>
          {move.type !== 'geldtransit' && <>
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

function DayRows({ d, xs, c, link, onDel, t, files, onFile }: { d: string; xs: KbRow[]; c?: CashCount; link: (x: KbRow) => string | null; onDel?: (id: string) => void; t: ReturnType<typeof useT>; files: Record<string, string[]>; onFile: (p: string) => void }) {
  return (
    <>
      <tr><td colSpan={5} style={{ background: 'color-mix(in srgb, var(--line) 30%, transparent)', fontWeight: 600 }}>{dmy(d)}</td></tr>
      {xs.map((x) => {
        const l = link(x)
        return (
          <tr key={x.source + x.source_id}>
            <td className="muted">{x.nr}</td>
            <td>{l ? <Link to={l}>{x.text}</Link> : x.text}{x.mwst && <span className="small muted"> · {x.mwst}</span>}
              {x.source === 'move' && files[x.source_id]?.map((f) => <button key={f} className="ghost small" style={{ minHeight: 0, padding: '0 4px' }} onClick={() => onFile(f)}>📎</button>)}
              {x.source === 'move' && onDel && <button className="ghost small" style={{ minHeight: 0, padding: '0 4px' }} onClick={() => onDel(x.source_id)}>✕</button>}</td>
            <td className="num kb-in">{Number(x.einnahme) ? eur(x.einnahme, false) : ''}</td>
            <td className="num kb-out">{Number(x.ausgabe) ? eur(x.ausgabe, false) : ''}</td>
            <td className="num" style={Number(x.saldo) < 0 ? { color: 'var(--err)', fontWeight: 700 } : undefined}>{eur(x.saldo, false)}</td>
          </tr>
        )
      })}
      {c && (
        <tr><td /><td colSpan={3}>{t('count')}: {eur(c.counted)} {Number(c.difference) === 0 ? <span className="tag">✓</span> : <span className="tag err">{eur(c.difference)} · {c.reason}</span>}</td><td /></tr>
      )}
    </>
  )
}
