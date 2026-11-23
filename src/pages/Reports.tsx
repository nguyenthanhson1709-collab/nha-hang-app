import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase, errMsg, type CashMove, type Doc, type ZBon } from '../lib/supabase'
import { canManage, catName, useApp, useRole } from '../lib/app'
import { useLang, useT } from '../lib/i18n'
import { addMonths, dmy, eur, monthLabel, monthRange, r2, thisMonth } from '../lib/format'
import { docsInRange, zbonsInRange } from '../lib/data'
import { buildBookings } from '../lib/datev'
import { download, reportPdf } from '../lib/pdf'
import { Spinner, Top, toast, useRestaurant } from '../components/ui'

type Mode = 'month' | 'quarter' | 'year' | 'custom'

function Bars({ data, fmt = (n: number) => eur(n) }: { data: { label: string; value: number; sub?: string }[]; fmt?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div>
      {data.map((d) => (
        <div key={d.label} style={{ marginBottom: 8 }}>
          <div className="row between small"><span>{d.label}{d.sub && <span className="muted"> · {d.sub}</span>}</span><b className="num">{fmt(d.value)}</b></div>
          <div className="bar-bg"><div className="bar" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

export default function Reports() {
  const { rid } = useParams()
  const t = useT()
  const { lang } = useLang()
  const { categories, restaurants, profile } = useApp()
  const r = useRestaurant(rid)
  const role = useRole(rid)
  const [mode, setMode] = useState<Mode>('month')
  const [anchor, setAnchor] = useState(thisMonth())
  const [custom, setCustom] = useState(monthRange(thisMonth()))
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [zs, setZs] = useState<ZBon[]>([])
  const [moves, setMoves] = useState<CashMove[]>([])
  const [trend, setTrend] = useState<{ p: string; food: number; drink: number; nonfood: number; other: number }[]>([])
  const [open, setOpen] = useState<string | null>(null)

  const range = useMemo(() => {
    if (mode === 'custom') return custom
    const [y, m] = anchor.split('-').map(Number)
    if (mode === 'month') return monthRange(anchor)
    if (mode === 'quarter') { const q0 = Math.floor((m - 1) / 3) * 3 + 1; const a = `${y}-${String(q0).padStart(2, '0')}`; return { from: monthRange(a).from, to: monthRange(addMonths(a, 2)).to } }
    return { from: `${y}-01-01`, to: `${y}-12-31` }
  }, [mode, anchor, custom])
  const byPeriod = mode !== 'custom'

  useEffect(() => {
    setDocs(null)
    ;(async () => {
      const [d, z] = await Promise.all([docsInRange(rid || null, range.from, range.to, byPeriod), zbonsInRange(rid || null, range.from, range.to)])
      let mq = supabase.from('nh_cash_moves').select('*').gte('move_date', range.from).lte('move_date', range.to)
      if (rid) mq = mq.eq('restaurant_id', rid)
      const { data: mv } = await mq
      setDocs(d.filter((x) => x.status === 'reviewed')); setZs(z); setMoves((mv || []) as CashMove[])
    })().catch((e) => toast(errMsg(e)))
  }, [rid, range.from, range.to, byPeriod])

  useEffect(() => {
    const end = thisMonth(), start = addMonths(end, -11)
    let q = supabase.from('nh_documents').select('period, nh_document_lines(total, category_id), gross').eq('kind', 'purchase').eq('status', 'reviewed').gte('period', start).lte('period', end)
    if (rid) q = q.eq('restaurant_id', rid)
    q.then(({ data }) => {
      const kindOf = (cid: string | null) => { const c = categories.find((x) => x.id === cid); return (c?.kind || 'other') as 'food' }
      const map = new Map<string, { p: string; food: number; drink: number; nonfood: number; other: number }>()
      for (let i = 0; i < 12; i++) { const p = addMonths(start, i); map.set(p, { p, food: 0, drink: 0, nonfood: 0, other: 0 }) }
      for (const d of (data || []) as unknown as { period: string; gross: number; nh_document_lines: { total: number; category_id: string | null }[] }[]) {
        const row = map.get(d.period); if (!row) continue
        if (!d.nh_document_lines.length) { row.other += Number(d.gross); continue }
        for (const l of d.nh_document_lines) row[kindOf(l.category_id)] += Number(l.total)
      }
      setTrend([...map.values()])
    })
  }, [rid, categories])

  const a = useMemo(() => {
    if (!docs) return null
    const purchase = docs.filter((d) => d.kind === 'purchase'), sales = docs.filter((d) => d.kind === 'sales')
    // Thuế
    const vst: Record<number, { net: number; tax: number }> = {}
    for (const d of purchase) for (const x of d.nh_document_taxes || []) { const k = Number(x.rate); vst[k] ??= { net: 0, tax: 0 }; vst[k].net += Number(x.net); vst[k].tax += Number(x.tax) }
    const ust: Record<number, { net: number; tax: number }> = { 7: { net: 0, tax: 0 }, 19: { net: 0, tax: 0 }, 0: { net: 0, tax: 0 } }
    for (const z of zs) { ust[7].net += Number(z.net7); ust[7].tax += Number(z.tax7); ust[19].net += Number(z.net19); ust[19].tax += Number(z.tax19) }
    for (const d of sales) for (const x of d.nh_document_taxes || []) { const k = Number(x.rate); ust[k] ??= { net: 0, tax: 0 }; ust[k].net += Number(x.net); ust[k].tax += Number(x.tax) }
    const vstSum = Object.values(vst).reduce((s, x) => s + x.tax, 0), ustSum = Object.values(ust).reduce((s, x) => s + x.tax, 0)
    // Nhóm hàng: dòng hàng (Brutto) + Netto theo mức thuế dòng
    const cat: Record<string, { gross: number; net: number }> = {}
    const addCat = (k: string, g: number, rate: number | null) => { cat[k] ??= { gross: 0, net: 0 }; cat[k].gross += g; cat[k].net += rate == null ? g : g / (1 + rate / 100) }
    for (const d of purchase) {
      const ls = d.nh_document_lines || []
      if (!ls.length) { for (const x of d.nh_document_taxes || []) addCat('_none', Number(x.gross), Number(x.rate)); if (!(d.nh_document_taxes || []).length) addCat('_none', Number(d.gross), null); continue }
      const lsum = ls.reduce((s, l) => s + Number(l.total), 0) || 1
      const f = Number(d.gross) / lsum
      for (const l of ls) addCat(l.category_id || '_none', Number(l.total) * f, l.rate == null ? null : Number(l.rate))
    }
    // Thanh toán
    const pay: Record<string, { sum: number; n: number }> = { cash: { sum: 0, n: 0 }, card: { sum: 0, n: 0 }, transfer: { sum: 0, n: 0 } }
    for (const d of purchase) for (const p of d.nh_document_payments || []) { pay[p.method].sum += Number(p.amount); pay[p.method].n++ }
    // Nhà cung cấp, mặt hàng
    const sup: Record<string, { sum: number; n: number }> = {}
    for (const d of purchase) { const k = d.supplier || '—'; sup[k] ??= { sum: 0, n: 0 }; sup[k].sum += Number(d.gross); sup[k].n++ }
    const items: Record<string, { sum: number; qty: number; n: number }> = {}
    for (const d of purchase) for (const l of d.nh_document_lines || []) { const k = l.name.trim().toLowerCase(); items[k] ??= { sum: 0, qty: 0, n: 0 }; items[k].sum += Number(l.total); items[k].qty += Number(l.qty || 1); items[k].n++ }
    // Doanh thu Z
    const zrev = { total: 0, cash: 0, card: 0, storno: 0, diff: 0, tip: 0 }
    for (const z of zs) {
      const cardRev = z.card_terminal == null ? Number(z.card_pos) : Number(z.card_terminal) - Number(z.tip_card)
      zrev.total += Number(z.total); zrev.card += cardRev; zrev.cash += Number(z.total) - cardRev; zrev.storno += Number(z.storno); zrev.tip += Number(z.tip)
      if (z.card_terminal != null) zrev.diff += Number(z.card_pos) - cardRev
    }
    // So sánh nhà hàng
    const cmp: Record<string, { spend: number; rev: number }> = {}
    for (const d of purchase) { cmp[d.restaurant_id] ??= { spend: 0, rev: 0 }; cmp[d.restaurant_id].spend += Number(d.gross) }
    for (const z of zs) { cmp[z.restaurant_id] ??= { spend: 0, rev: 0 }; cmp[z.restaurant_id].rev += Number(z.total) }
    return { purchase, vst, ust, vstSum, ustSum, cat, pay, sup, items, zrev, cmp, spend: purchase.reduce((s, d) => s + Number(d.gross), 0) }
  }, [docs, zs])

  if (rid && !canManage(role)) return null
  if (!rid && !profile.is_owner) return null

  const tops = categories.filter((c) => !c.parent_id)
  const catRows = a ? tops.map((tp) => {
    const subsC = categories.filter((c) => c.parent_id === tp.id)
    const subsV = subsC.map((c) => ({ c, v: a.cat[c.id] || { gross: 0, net: 0 } })).filter((x) => x.v.gross)
    return { tp, gross: subsV.reduce((s, x) => s + x.v.gross, 0) + (a.cat[tp.id]?.gross || 0), net: subsV.reduce((s, x) => s + x.v.net, 0) + (a.cat[tp.id]?.net || 0), subs: subsV }
  }) : []
  const none = a?.cat['_none']
  const label = mode === 'month' ? monthLabel(anchor) : mode === 'quarter' ? `Q${Math.floor((Number(anchor.slice(5)) - 1) / 3) + 1}/${anchor.slice(0, 4)}` : mode === 'year' ? anchor.slice(0, 4) : `${dmy(range.from)}–${dmy(range.to)}`
  const rName = (id: string) => restaurants.find((x) => x.id === id)?.name || '?'
  const supRows = a ? Object.entries(a.sup).sort((x, y) => y[1].sum - x[1].sum) : []
  const itemRows = a ? Object.entries(a.items).sort((x, y) => y[1].sum - x[1].sum).slice(0, 30) : []

  function sections() {
    if (!a) return []
    return [
      { title: 'Umsatzsteuer-Voranmeldung (Vorschau)', cols: [{ h: '', w: 110 }, { h: 'Bemessungsgrundlage', w: 36, right: true }, { h: 'Steuer', w: 36, right: true }], rows: [
        ['Kz 81 Umsätze 19 %', eur(a.ust[19].net), eur(a.ust[19].tax)], ['Kz 86 Umsätze 7 %', eur(a.ust[7].net), eur(a.ust[7].tax)],
        ['Kz 66 Vorsteuer', '', eur(a.vstSum)]], foot: ['Zahllast (geschätzt)', '', eur(a.ustSum - a.vstSum)] },
      { title: 'Umsatz aus Z-Bons', cols: [{ h: '', w: 130 }, { h: 'Betrag', w: 52, right: true }], rows: [
        ['Gesamtumsatz (ohne Trinkgeld)', eur(a.zrev.total)], ['davon Bar', eur(a.zrev.cash)], ['davon Karte (EC-Terminal)', eur(a.zrev.card)],
        ['Storno', eur(a.zrev.storno)], ['Trinkgeld lt. Kasse', eur(a.zrev.tip)], ['Differenz Karte Kasse/Terminal', eur(a.zrev.diff)]] },
      { title: 'Ausgaben nach Warengruppe', cols: [{ h: 'Gruppe', w: 110 }, { h: 'Netto', w: 36, right: true }, { h: 'Brutto', w: 36, right: true }],
        rows: [...catRows.flatMap((c) => [[c.tp.name_de, eur(c.net), eur(c.gross)], ...c.subs.map((s) => [`   ${s.c.name_de}`, eur(s.v.net), eur(s.v.gross)])]), ...(none ? [['Ohne Gruppe', eur(none.net), eur(none.gross)]] : [])],
        foot: ['Summe', eur(Object.values(a.cat).reduce((s, x) => s + x.net, 0)), eur(Object.values(a.cat).reduce((s, x) => s + x.gross, 0))] },
      { title: 'Karte und Bar (Eingangsbelege)', cols: [{ h: 'Zahlungsart', w: 110 }, { h: 'Anzahl', w: 36, right: true }, { h: 'Betrag', w: 36, right: true }],
        rows: [['Bar', String(a.pay.cash.n), eur(a.pay.cash.sum)], ['Karte', String(a.pay.card.n), eur(a.pay.card.sum)], ['Überweisung', String(a.pay.transfer.n), eur(a.pay.transfer.sum)]] },
      { title: 'Nach Lieferant', cols: [{ h: 'Lieferant', w: 110 }, { h: 'Belege', w: 36, right: true }, { h: 'Brutto', w: 36, right: true }], rows: supRows.map(([k, v]) => [k, String(v.n), eur(v.sum)]) },
      { title: 'Meistgekaufte Artikel', cols: [{ h: 'Artikel', w: 100 }, { h: 'Menge', w: 25, right: true }, { h: 'Ø Preis', w: 27, right: true }, { h: 'Brutto', w: 30, right: true }], rows: itemRows.map(([k, v]) => [k, String(r2(v.qty)).replace('.', ','), eur(v.sum / (v.qty || 1)), eur(v.sum)]) },
    ]
  }
  function excel() {
    if (!a) return
    const wb = XLSX.utils.book_new()
    for (const s of sections()) {
      const ws = XLSX.utils.aoa_to_sheet([s.cols.map((c) => c.h), ...s.rows, ...(s.foot ? [s.foot] : [])])
      XLSX.utils.book_append_sheet(wb, ws, s.title.slice(0, 30).replace(/[\\/?*[\]:]/g, ' '))
    }
    const bookings = buildBookings(a.purchase.concat(docs!.filter((d) => d.kind === 'sales')), zs, moves, r || restaurants[0], categories)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Datum', 'Betrag', 'Soll', 'Haben', 'BU', 'Buchungstext', 'Belegfeld 1'], ...bookings.map((b) => [dmy(b.date), b.amount, b.soll, b.haben, b.bu, b.text, b.beleg])]), 'Buchungsjournal')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    download(new Blob([out]), `Bericht_${(r?.name || 'Alle').replace(/\W+/g, '_')}_${label.replace(/\W+/g, '-')}.xlsx`)
  }

  const bookings = a ? buildBookings(docs!, zs, moves, r || restaurants[0], categories) : []

  return (
    <>
      <Top title={t('reports')} sub={r?.name || t('allRestaurants')} back={!rid ? '/restaurants' : undefined}
        right={<div className="row"><button onClick={() => a && download(reportPdf(`Bericht ${label}`, r || null, label, sections()), `Bericht_${label.replace(/\W+/g, '-')}.pdf`)}>PDF</button><button onClick={excel}>Excel</button></div>} />
      <div className="page">
        <div className="seg" style={{ marginBottom: 8 }}>
          {(['month', 'quarter', 'year', 'custom'] as Mode[]).map((x) => <button key={x} className={mode === x ? 'sel' : ''} onClick={() => setMode(x)}>{x === 'month' ? t('month') : x === 'quarter' ? t('quarter') : x === 'year' ? t('year') : `${t('from')}–${t('to')}`}</button>)}
        </div>
        {mode !== 'custom' ? (
          <div className="row" style={{ marginBottom: 12 }}>
            <button onClick={() => setAnchor(addMonths(anchor, mode === 'month' ? -1 : mode === 'quarter' ? -3 : -12))}>‹</button>
            <div className="grow" style={{ textAlign: 'center', fontWeight: 600 }}>{label}</div>
            <button onClick={() => setAnchor(addMonths(anchor, mode === 'month' ? 1 : mode === 'quarter' ? 3 : 12))}>›</button>
          </div>
        ) : (
          <div className="grid2" style={{ marginBottom: 12 }}>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        {!a ? <Spinner /> : (
          <>
            <div className="grid2" style={{ marginBottom: 12 }}>
              <div className="stat"><div className="l">{t('spending')} (Brutto)</div><div className="v">{eur(a.spend)}</div></div>
              <div className="stat"><div className="l">{t('revenue')} (Z-Bon)</div><div className="v">{eur(a.zrev.total)}</div></div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('vat')}</h3>
              <table><tbody>
                <tr><td>{t('umsatzsteuer')} 19% <span className="muted small">(Kz 81: {eur(a.ust[19].net)})</span></td><td className="num">{eur(a.ust[19].tax)}</td></tr>
                <tr><td>{t('umsatzsteuer')} 7% <span className="muted small">(Kz 86: {eur(a.ust[7].net)})</span></td><td className="num">{eur(a.ust[7].tax)}</td></tr>
                <tr><td>− {t('vorsteuer')} <span className="muted small">(7%: {eur(a.vst[7]?.tax || 0)} · 19%: {eur(a.vst[19]?.tax || 0)})</span></td><td className="num">{eur(a.vstSum)}</td></tr>
              </tbody><tfoot><tr><td>{t('payable')}</td><td className="num">{eur(a.ustSum - a.vstSum)}</td></tr></tfoot></table>
              <div className="small muted" style={{ marginTop: 6 }}>{t('vatNote')}</div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('zRevenue')}</h3>
              <div className="grid3">
                <div><div className="small muted">{t('cash')}</div><b>{eur(a.zrev.cash)}</b></div>
                <div><div className="small muted">{t('card')}</div><b>{eur(a.zrev.card)}</b></div>
                <div><div className="small muted">{t('storno')}</div><b>{eur(a.zrev.storno)}</b></div>
              </div>
              {Math.abs(a.zrev.diff) > 0.01 && <div className="alert warn">{t('cardDiff')}: {eur(a.zrev.diff)}</div>}
              {zs.length > 1 && (
                <div className="chart">
                  {zs.slice(-31).map((z) => { const mx = Math.max(...zs.map((x) => Number(x.total)), 1); return <div className="c" key={z.id} title={`${dmy(z.z_date)} ${eur(z.total)}`}><div className="b" style={{ height: `${(Number(z.total) / mx) * 100}%` }} /><div className="x">{z.z_date.slice(8)}</div></div> })}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('byCategory')}</h3>
              {catRows.map((c) => (
                <div key={c.tp.id} onClick={() => setOpen(open === c.tp.id ? null : c.tp.id)} style={{ cursor: 'pointer' }}>
                  <Bars data={[{ label: `${open === c.tp.id ? '▾' : '▸'} ${catName(c.tp, lang)}`, value: c.gross, sub: `Netto ${eur(c.net)}` }]} />
                  {open === c.tp.id && <div style={{ paddingLeft: 14 }}><Bars data={c.subs.map((s) => ({ label: catName(s.c, lang), value: s.v.gross, sub: `Netto ${eur(s.v.net)}` }))} /></div>}
                </div>
              ))}
              {none && <Bars data={[{ label: t('uncategorized'), value: none.gross, sub: `Netto ${eur(none.net)}` }]} />}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('payments')}</h3>
              <table><tbody>
                {(['cash', 'card', 'transfer'] as const).map((k) => <tr key={k}><td>{t(k)}</td><td className="num muted">{a.pay[k].n}×</td><td className="num">{eur(a.pay[k].sum)}</td></tr>)}
              </tbody></table>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('trend')}</h3>
              <div className="chart" style={{ height: 160 }}>
                {trend.map((x) => {
                  const mx = Math.max(...trend.map((y) => y.food + y.drink + y.nonfood + y.other), 1)
                  const h = (v: number) => `${(v / mx) * 100}%`
                  return (
                    <div className="c" key={x.p} title={`${monthLabel(x.p)}: ${eur(x.food + x.drink + x.nonfood + x.other)}`}>
                      <div style={{ width: '100%', maxWidth: 32, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ height: h(x.other), background: 'var(--muted)' }} /><div style={{ height: h(x.nonfood), background: 'var(--transfer)' }} />
                        <div style={{ height: h(x.drink), background: 'var(--cardc)' }} /><div style={{ height: h(x.food), background: 'var(--brand)' }} />
                      </div>
                      <div className="x">{x.p.slice(5)}</div>
                    </div>
                  )
                })}
              </div>
              <div className="row wrap small" style={{ marginTop: 6 }}>
                {tops.map((tp) => <span key={tp.id}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: tp.kind === 'food' ? 'var(--brand)' : tp.kind === 'drink' ? 'var(--cardc)' : 'var(--transfer)' }} /> {catName(tp, lang)}</span>)}
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--muted)' }} /> {t('uncategorized')}</span>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('bySupplier')}</h3>
              <Bars data={supRows.slice(0, 15).map(([k, v]) => ({ label: k, value: v.sum, sub: `${v.n}×` }))} />
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('topItems')}</h3>
              <div className="tbl-wrap" style={{ border: 0 }}>
                <table><thead><tr><th>{t('item')}</th><th className="num">{t('count_')}</th><th className="num">{t('avgPrice')}</th><th className="num">{t('total')}</th></tr></thead>
                  <tbody>{itemRows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{r2(v.qty)}</td><td className="num">{eur(v.sum / (v.qty || 1))}</td><td className="num">{eur(v.sum)}</td></tr>)}</tbody></table>
              </div>
            </div>

            {!rid && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>{t('compare')}</h3>
                {Object.entries(a.cmp).map(([id, v]) => (
                  <div key={id} style={{ marginBottom: 10 }}>
                    <div className="small"><b>{rName(id)}</b></div>
                    <Bars data={[{ label: t('revenue'), value: v.rev }, { label: t('spending'), value: v.spend }]} />
                  </div>
                ))}
              </div>
            )}

            {rid && (
              <details className="card">
                <summary><b>{t('journal')}</b> <span className="muted small">({bookings.length})</span></summary>
                <div className="tbl-wrap" style={{ marginTop: 8 }}>
                  <table><thead><tr><th>{t('date')}</th><th>{t('soll')}</th><th>{t('haben')}</th><th>BU</th><th>Text</th><th className="num">€</th></tr></thead>
                    <tbody>{bookings.map((b, i) => <tr key={i}><td>{dmy(b.date)}</td><td>{b.soll}</td><td>{b.haben}</td><td>{b.bu}</td><td>{b.text}</td><td className="num">{eur(b.amount, false)}</td></tr>)}</tbody></table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </>
  )
}
