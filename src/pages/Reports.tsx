import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase, errMsg, type Category, type Doc, type ZBon } from '../lib/supabase'
import { remember } from '../lib/categorize'
import { canManage, catName, useApp, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { addMonths, daysOfMonth, dmy, eur, monthLabel, monthRange, r2, thisMonth } from '../lib/format'
import { docsInRange, zbonsInRange } from '../lib/data'
import { download, reportPdf } from '../lib/pdf'
import { Spinner, Top, toast, useRestaurant } from '../components/ui'

type Mode = 'month' | 'quarter' | 'year' | 'custom'
type Tab = 'umsatz' | 'supplier' | 'food' | 'drink' | 'nonfood'
type Item = { name: string; qty: number; sum: number; n: number; last: string; suppliers: Set<string>; ids: string[]; cid: string | null }
type DL = NonNullable<Doc['nh_document_lines']>[number]

const TABS: { k: Tab; icon: string; vi: string; de: string }[] = [
  { k: 'umsatz', icon: '📊', vi: 'Umsatz', de: 'Umsatz' },
  { k: 'supplier', icon: '🏪', vi: 'Theo nhà cung cấp', de: 'Nach Lieferant' },
  { k: 'food', icon: '🥩', vi: 'Thực phẩm', de: 'Lebensmittel' },
  { k: 'drink', icon: '🥤', vi: 'Đồ uống', de: 'Getränke' },
  { k: 'nonfood', icon: '🧻', vi: 'Nonfood', de: 'Non-Food' },
]

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div>
      {data.map((d) => (
        <div key={d.label} style={{ marginBottom: 8 }}>
          <div className="row between small"><span>{d.label}</span><b className="num">{eur(d.value)}</b></div>
          <div className="bar-bg"><div className="bar" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

/** Gộp dòng hàng theo tên */
function addItem(map: Map<string, Item>, l: DL, date: string, supplier: string) {
  const k = l.name.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!k) return
  const it = map.get(k) || { name: l.name.trim(), qty: 0, sum: 0, n: 0, last: '', suppliers: new Set<string>(), ids: [], cid: null }
  it.qty += Number(l.qty || 1); it.sum += Number(l.total); it.n++
  if (l.id) it.ids.push(l.id)
  if (date >= it.last) { it.last = date; it.cid = l.category_id }
  it.suppliers.add(supplier)
  map.set(k, it)
}
const qtyFmt = (n: number) => String(r2(n)).replace('.', ',')

export default function Reports() {
  const { rid } = useParams()
  const t = useT()
  const { lang } = useLang()
  const { categories, profile } = useApp()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [tab, setTab] = useState<Tab | null>(null)
  const [mode, setMode] = useState<Mode>('month')
  const [anchor, setAnchor] = useState(thisMonth())
  const [custom, setCustom] = useState(monthRange(thisMonth()))
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [zs, setZs] = useState<ZBon[]>([])
  const [sup, setSup] = useState<string | null>(null)

  const range = useMemo(() => {
    if (mode === 'custom') return custom
    const [y, m] = anchor.split('-').map(Number)
    if (mode === 'month') return monthRange(anchor)
    if (mode === 'quarter') { const q0 = Math.floor((m - 1) / 3) * 3 + 1; const a = `${y}-${String(q0).padStart(2, '0')}`; return { from: monthRange(a).from, to: monthRange(addMonths(a, 2)).to } }
    return { from: `${y}-01-01`, to: `${y}-12-31` }
  }, [mode, anchor, custom])

  useEffect(() => {
    setDocs(null)
    ;(async () => {
      const [d, z] = await Promise.all([docsInRange(rid || null, range.from, range.to, false), zbonsInRange(rid || null, range.from, range.to)])
      setDocs(d.filter((x) => x.kind === 'purchase' && x.status === 'reviewed')); setZs(z)
    })().catch((e) => toast(errMsg(e)))
  }, [rid, range.from, range.to])

  // Nhóm của một nhóm hàng: theo nhóm cha
  const kindOf = useMemo(() => {
    const m = new Map<string, Category>(categories.map((c) => [c.id, c]))
    return (cid: string | null) => {
      const c = cid ? m.get(cid) : undefined
      if (!c) return null
      const p = c.parent_id ? m.get(c.parent_id) : c
      return (p?.kind || c.kind) as 'food' | 'drink' | 'nonfood'
    }
  }, [categories])

  const label = mode === 'month' ? monthLabel(anchor) : mode === 'quarter' ? `Q${Math.floor((Number(anchor.slice(5)) - 1) / 3) + 1}/${anchor.slice(0, 4)}` : mode === 'year' ? anchor.slice(0, 4) : `${dmy(range.from)}–${dmy(range.to)}`

  // Umsatz theo ngày (tháng / tự chọn ≤ 62 ngày) hoặc theo tháng
  const umsatz = useMemo(() => {
    const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 864e5) + 1
    const byDay = mode === 'month' || (mode === 'custom' && days <= 62)
    const keys: string[] = []
    if (byDay) { if (mode === 'month') keys.push(...daysOfMonth(anchor)); else for (let i = 0; i < days; i++) keys.push(new Date(Date.parse(range.from) + i * 864e5).toISOString().slice(0, 10)) }
    else { let p = range.from.slice(0, 7); while (p <= range.to.slice(0, 7)) { keys.push(p); p = addMonths(p, 1) } }
    const map = new Map(keys.map((k) => [k, { k, total: 0, cash: 0, card: 0 }]))
    for (const z of zs) {
      const row = map.get(byDay ? z.z_date : z.z_date.slice(0, 7)); if (!row) continue
      row.total += Number(z.total); row.cash += Number(z.cash_revenue); row.card += Number(z.total) - Number(z.cash_revenue)
    }
    const rows = [...map.values()]
    return { byDay, rows, total: rows.reduce((s, x) => s + x.total, 0), cash: rows.reduce((s, x) => s + x.cash, 0), card: rows.reduce((s, x) => s + x.card, 0) }
  }, [zs, range, mode, anchor])

  // Nhà cung cấp
  const suppliers = useMemo(() => {
    const m = new Map<string, { sum: number; n: number; items: Map<string, Item> }>()
    for (const d of docs || []) {
      const k = d.supplier || '—'
      const s = m.get(k) || { sum: 0, n: 0, items: new Map() }
      s.sum += Number(d.gross); s.n++
      for (const l of d.nh_document_lines || []) addItem(s.items, l, d.doc_date, k)
      m.set(k, s)
    }
    return [...m.entries()].sort((a, b) => b[1].sum - a[1].sum)
  }, [docs])

  // Thực phẩm / đồ uống / nonfood
  const group = useMemo(() => {
    const res: Record<'food' | 'drink' | 'nonfood', { sum: number; subs: Map<string, number>; items: Map<string, Item> }> = {
      food: { sum: 0, subs: new Map(), items: new Map() }, drink: { sum: 0, subs: new Map(), items: new Map() }, nonfood: { sum: 0, subs: new Map(), items: new Map() },
    }
    let none = 0
    const noneItems = new Map<string, Item>()
    for (const d of docs || []) for (const l of d.nh_document_lines || []) {
      const k = kindOf(l.category_id)
      if (!k) { none += Number(l.total); addItem(noneItems, l, d.doc_date, d.supplier || '—'); continue }
      const g = res[k]
      g.sum += Number(l.total)
      g.subs.set(l.category_id!, (g.subs.get(l.category_id!) || 0) + Number(l.total))
      addItem(g.items, l, d.doc_date, d.supplier || '—')
    }
    return { ...res, none, noneItems }
  }, [docs, kindOf])

  // Đổi nhóm của một mặt hàng: sửa mọi dòng cùng tên trong kỳ đang xem + nhớ cho lần sau
  async function setCat(it: Item, cid: string | null) {
    try {
      for (let i = 0; i < it.ids.length; i += 100) {
        const { error } = await supabase.from('nh_document_lines').update({ category_id: cid }).in('id', it.ids.slice(i, i + 100))
        if (error) throw error
      }
      if (cid) await remember(it.name, cid)
      const ids = new Set(it.ids)
      setDocs((ds) => ds && ds.map((d) => ({ ...d, nh_document_lines: (d.nh_document_lines || []).map((l) => (l.id && ids.has(l.id) ? { ...l, category_id: cid } : l)) })))
      toast(t('saved'))
    } catch (e) { toast(errMsg(e)) }
  }
  const catSel = { categories, lang, onChange: setCat }

  if (rid && !canManage(role)) return null
  if (!rid && !profile.is_owner) return null

  const tabName = (k: Tab) => { const x = TABS.find((y) => y.k === k)!; return lang === 'de' ? x.de : x.vi }
  const itemCols = [{ h: 'Artikel', w: 76 }, { h: 'Menge', w: 18, right: true }, { h: 'Ø Preis', w: 22, right: true }, { h: 'Summe', w: 26, right: true }, { h: 'Zuletzt', w: 22 }, { h: 'Käufe', w: 18, right: true }]
  const itemRows = (m: Map<string, Item>) => [...m.values()].sort((a, b) => b.sum - a.sum)
  const itemAoa = (m: Map<string, Item>) => itemRows(m).map((i) => [i.name, qtyFmt(i.qty), eur(i.sum / (i.qty || 1)), eur(i.sum), dmy(i.last), String(i.n)])
  const umsatzLabel = (k: string) => (umsatz.byDay ? dmy(k) : monthLabel(k))

  function sections(): Parameters<typeof reportPdf>[3] {
    if (tab === 'umsatz') return [{
      title: `Umsatz ${label}`, cols: [{ h: umsatz.byDay ? 'Datum' : 'Monat', w: 60 }, { h: 'Bar', w: 40, right: true }, { h: 'Karte', w: 40, right: true }, { h: 'Gesamt', w: 42, right: true }],
      rows: umsatz.rows.map((x) => [umsatzLabel(x.k), eur(x.cash), eur(x.card), eur(x.total)]), foot: ['Summe', eur(umsatz.cash), eur(umsatz.card), eur(umsatz.total)],
    }]
    if (tab === 'supplier') {
      const list = sup ? suppliers.filter(([k]) => k === sup) : suppliers
      return [
        ...(sup ? [] : [{ title: 'Lieferanten', cols: [{ h: 'Lieferant', w: 110 }, { h: 'Belege', w: 36, right: true }, { h: 'Brutto', w: 36, right: true }], rows: suppliers.map(([k, v]) => [k, String(v.n), eur(v.sum)]) }]),
        ...list.map(([k, v]) => ({ title: `Artikel: ${k}`, cols: itemCols, rows: itemAoa(v.items), foot: ['Summe', '', '', eur(v.sum), '', ''] })),
      ]
    }
    if (tab === 'food' || tab === 'drink' || tab === 'nonfood') {
      const g = group[tab]
      return [
        { title: `${tabName(tab)} nach Warengruppe`, cols: [{ h: 'Warengruppe', w: 140 }, { h: 'Brutto', w: 42, right: true }],
          rows: [...g.subs.entries()].sort((a, b) => b[1] - a[1]).map(([cid, v]) => [categories.find((c) => c.id === cid)?.name_de || '?', eur(v)]), foot: ['Summe', eur(g.sum)] },
        { title: `${tabName(tab)}: Artikel`, cols: itemCols, rows: itemAoa(g.items) },
      ]
    }
    return []
  }
  const fname = () => `Bericht_${tab}_${(r?.name || 'Alle').replace(/\W+/g, '_')}_${label.replace(/\W+/g, '-')}`
  function pdf() { download(reportPdf(`${tabName(tab!)} ${label}`, r || null, label, sections()), fname() + '.pdf') }
  function excel() {
    const wb = XLSX.utils.book_new()
    sections().forEach((s, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.cols.map((c) => c.h), ...s.rows, ...(s.foot ? [s.foot] : [])]), `${i + 1} ${s.title}`.slice(0, 30).replace(/[\\/?*[\]:]/g, ' ')))
    download(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]), fname() + '.xlsx')
  }

  // Màn hình chọn báo cáo
  if (!tab) return (
    <>
      <Top title={t('reports')} sub={r?.name || t('allRestaurants')} back={!rid ? '/restaurants' : undefined} />
      <div className="page">
        <div className="tiles">
          {TABS.map((x) => (
            <button key={x.k} className="tile" onClick={() => { setTab(x.k); setSup(null) }}>
              <span className="ic">{x.icon}</span><span>{lang === 'de' ? x.de : x.vi}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )

  const groupTab = tab === 'food' || tab === 'drink' || tab === 'nonfood' ? group[tab] : null
  const supData = sup ? suppliers.find(([k]) => k === sup)?.[1] : null

  return (
    <>
      <Top title={tabName(tab)} sub={`${r?.name || t('allRestaurants')} · ${label}`}
        right={<div className="row"><button onClick={() => (sup ? setSup(null) : setTab(null))}>‹</button></div>} />
      <div className="page">
        <div className="seg" style={{ marginBottom: 8 }}>
          {(['month', 'quarter', 'year', 'custom'] as Mode[]).map((x) => <button key={x} className={mode === x ? 'sel' : ''} onClick={() => setMode(x)}>{t(x)}</button>)}
        </div>
        {mode !== 'custom' ? (
          <div className="row" style={{ marginBottom: 10 }}>
            <button onClick={() => setAnchor(addMonths(anchor, mode === 'month' ? -1 : mode === 'quarter' ? -3 : -12))}>‹</button>
            <div className="grow" style={{ textAlign: 'center', fontWeight: 600 }}>{label}</div>
            <button onClick={() => setAnchor(addMonths(anchor, mode === 'month' ? 1 : mode === 'quarter' ? 3 : 12))}>›</button>
          </div>
        ) : (
          <div className="grid2" style={{ marginBottom: 10 }}>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        <div className="grid2" style={{ marginBottom: 12 }}>
          <button disabled={!docs} onClick={pdf}>⬇ PDF</button>
          <button disabled={!docs} onClick={excel}>⬇ Excel</button>
        </div>

        {!docs ? <Spinner /> : <>
          {tab === 'umsatz' && (
            <div className="card">
              <div className="grid3" style={{ marginBottom: 8 }}>
                <div><div className="small muted">{t('total')}</div><b>{eur(umsatz.total)}</b></div>
                <div><div className="small muted">{t('cash')}</div><b>{eur(umsatz.cash)}</b></div>
                <div><div className="small muted">{t('card')}</div><b>{eur(umsatz.card)}</b></div>
              </div>
              <div className="chart" style={{ height: 200, gap: umsatz.rows.length > 20 ? 2 : 4 }}>
                {umsatz.rows.map((x, i) => {
                  const mx = Math.max(...umsatz.rows.map((y) => y.total), 1)
                  return (
                    <div className="c" key={x.k} title={`${umsatzLabel(x.k)}: ${eur(x.total)}`}>
                      <div style={{ width: '100%', maxWidth: 32, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ height: `${(x.card / mx) * 100}%`, background: 'var(--cardc)', borderRadius: '4px 4px 0 0' }} />
                        <div style={{ height: `${(x.cash / mx) * 100}%`, background: 'var(--brand)' }} />
                      </div>
                      <div className="x">{umsatz.byDay ? (umsatz.rows.length > 16 && i % 5 !== 0 && i !== umsatz.rows.length - 1 ? '' : x.k.slice(8)) : x.k.slice(5)}</div>
                    </div>
                  )
                })}
              </div>
              <div className="row small" style={{ gap: 12, marginTop: 6 }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--brand)', borderRadius: 2 }} /> {t('cash')}</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--cardc)', borderRadius: 2 }} /> {t('card')}</span>
              </div>
              <div className="tbl-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>{umsatz.byDay ? t('date') : t('month')}</th><th className="num">{t('cash')}</th><th className="num">{t('card')}</th><th className="num">{t('total')}</th></tr></thead>
                  <tbody>{umsatz.rows.filter((x) => x.total).map((x) => <tr key={x.k}><td>{umsatzLabel(x.k)}</td><td className="num">{eur(x.cash, false)}</td><td className="num">{eur(x.card, false)}</td><td className="num"><b>{eur(x.total, false)}</b></td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'supplier' && !sup && (
            <div className="list">
              {suppliers.map(([k, v]) => (
                <button key={k} className="it" style={{ width: '100%', textAlign: 'left' }} onClick={() => setSup(k)}>
                  <div className="grow"><div className="t">{k}</div><div className="small muted">{v.n} Belege · {v.items.size} Artikel</div></div>
                  <div className="num">{eur(v.sum)}</div><span className="muted">›</span>
                </button>
              ))}
              {!suppliers.length && <div className="it muted">{t('noData')}</div>}
            </div>
          )}
          {tab === 'supplier' && sup && supData && (
            <div className="card">
              <div className="row between" style={{ marginBottom: 8 }}><b>{sup}</b><b>{eur(supData.sum)}</b></div>
              <ItemTable items={itemRows(supData.items)} t={t} cat={catSel} />
            </div>
          )}

          {groupTab && (
            <>
              <div className="card">
                <div className="row between" style={{ marginBottom: 8 }}><b>{tabName(tab)}</b><b>{eur(groupTab.sum)}</b></div>
                <Bars data={[...groupTab.subs.entries()].sort((a, b) => b[1] - a[1]).map(([cid, v]) => ({ label: catName(categories.find((c) => c.id === cid), lang), value: v }))} />
                {group.none > 0 && <div className="small muted">{t('uncategorized')}: {eur(group.none)}</div>}
              </div>
              <div className="card"><ItemTable items={itemRows(groupTab.items)} t={t} showSupplier cat={catSel} /></div>
              {group.noneItems.size > 0 && <div className="card"><b>{t('uncategorized')}</b><div style={{ marginTop: 8 }}><ItemTable items={itemRows(group.noneItems)} t={t} showSupplier cat={catSel} /></div></div>}
            </>
          )}
        </>}
      </div>
    </>
  )
}

type CatSel = { categories: Category[]; lang: string; onChange: (it: Item, cid: string | null) => void }
function ItemTable({ items, t, showSupplier, cat }: { items: Item[]; t: ReturnType<typeof useT>; showSupplier?: boolean; cat?: CatSel }) {
  const tops = cat ? cat.categories.filter((c) => !c.parent_id).sort((a, b) => a.sort - b.sort) : []
  if (!items.length) return <div className="muted">{t('noData')}</div>
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>{t('item')}</th><th className="num">{t('qty')}</th><th className="num">Ø</th><th className="num">{t('total')}</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.name + i.last}>
              <td>{i.name}<div className="small muted">{dmy(i.last)}{showSupplier && ` · ${[...i.suppliers].join(', ')}`}</div>
                {cat && (
                  <select className="cat-sel" value={i.cid || ''} onChange={(e) => cat.onChange(i, e.target.value || null)}>
                    <option value="">— {t('category')} —</option>
                    {tops.map((tp) => (
                      <optgroup key={tp.id} label={catName(tp, cat.lang as 'vi' | 'de')}>
                        {cat.categories.filter((c) => c.parent_id === tp.id).sort((a, b) => a.sort - b.sort).map((c) => <option key={c.id} value={c.id}>{catName(c, cat.lang as 'vi' | 'de')}</option>)}
                      </optgroup>
                    ))}
                  </select>
                )}
              </td>
              <td className="num">{qtyFmt(i.qty)}</td>
              <td className="num">{eur(i.sum / (i.qty || 1), false)}</td>
              <td className="num"><b>{eur(i.sum, false)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
