import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Spinner } from '../../components/ui'
import PdfSheet from '../../components/PdfSheet'
import { costPct, fmtEur, fmtPct, fmtQty, ingPrice, itemCost, priceRise, recipeAllergens, recipeCost, RISE_WARN, scaleQty, UNIT_LABEL, type Item } from '../rc'
import { usePhotoUrls, useRc } from '../api'
import { AllergenChips, RcShell, StatusBadge, useL, useRcPerm } from '../ui'
import { initials } from './Recipes'

export default function RecipeView() {
  const { rid, id } = useParams()
  const L = useL()
  const nav = useNavigate()
  const { s, err } = useRc()
  const perm = useRcPerm()
  const [sp, setSp] = useSearchParams()
  const kitchen = sp.get('k') === '1'
  const r = s?.recipes.get(id!)
  const [portions, setPortions] = useState<number>(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [pdf, setPdf] = useState<Blob | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  useEffect(() => { if (r) setPortions(Number(r.portions)) }, [r?.id]) // eslint-disable-line

  // Chế độ bếp: màn hình không tắt khi đang nấu (nếu trình duyệt hỗ trợ)
  useEffect(() => {
    if (!kitchen) return
    let lock: { release: () => Promise<void> } | null = null
    const nv = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }
    nv.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => { /* bỏ qua */ })
    document.getElementById('root')?.classList.add('xwide')
    return () => { lock?.release().catch(() => {}); document.getElementById('root')?.classList.remove('xwide') }
  }, [kitchen])

  const items = useMemo(() => (r && s ? s.items.get(r.id) || [] : []), [r, s])
  const stepPhotos = (r?.steps || []).map((x) => x.photo)
  const photos = usePhotoUrls([r?.photo, r?.plating_photo, ...stepPhotos])

  if (err) return <RcShell><div className="err-box">{err}</div></RcShell>
  if (!s) return <RcShell tabs={false}><Spinner /></RcShell>
  if (!r) return <RcShell tabs={false}><p className="muted">{L('Không tìm thấy món.', 'Gericht nicht gefunden.')}</p></RcShell>

  const showCost = perm.manager && !kitchen
  const f = portions > 0 ? portions / Number(r.portions) : 1
  const cost = recipeCost(r, s)
  const pct = costPct(r, cost.perPortion)
  const al = recipeAllergens(r, s)
  const concept = s.concepts.find((c) => c.id === r.concept_id)
  const editable = perm.canEdit(r.restaurant_ids)
  const name = L(r.name, r.name_de || r.name)

  const groups: [string, Item[]][] = []
  for (const it of items) {
    const g = it.grp || ''
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(it); else groups.push([g, [it]])
  }
  const itemName = (it: Item) => {
    if (it.ingredient_id) { const i = s.ings.get(it.ingredient_id); return i ? L(i.name, i.name_de || i.name) : '?' }
    const sub = it.sub_recipe_id ? s.recipes.get(it.sub_recipe_id) : undefined
    return sub ? L(sub.name, sub.name_de || sub.name) : '?'
  }

  async function makePdf(withCost: boolean) {
    setPdfBusy(true)
    try {
      const { renderRecipePdf } = await import('../pdf')
      setPdf(await renderRecipePdf(r!, s!, { portions: portions || Number(r!.portions), withCost }))
    } finally { setPdfBusy(false) }
  }

  const right = (
    <div className="row" style={{ gap: 6 }}>
      <button className={kitchen ? 'sel' : ''} onClick={() => { if (kitchen) sp.delete('k'); else sp.set('k', '1'); setSp(sp, { replace: true }) }} title={L('Chế độ bếp', 'Küchenmodus')}>👨‍🍳<span className="hide-s"> {L('Bếp', 'Küche')}</span></button>
    </div>
  )

  return (
    <RcShell title={name} tabs={false} back={`/r/${rid}/rc${r.kind === 'base' ? '?k=base' : ''}`} right={right}>
      <div className={`rc-view${kitchen ? ' kitchen' : ''}`}>
        {!kitchen && (
          <div className="rc-hero">
            <div className="rc-hero-img">
              {r.photo && photos[r.photo] ? <img src={photos[r.photo]} alt="" /> : <span className="rc-noimg big">{initials(r)}</span>}
            </div>
            <div className="rc-hero-b">
              <div className="row wrap" style={{ gap: 6 }}>
                <StatusBadge s={r.status} />
                {r.kind === 'base' && <span className="rc-tag">{L('Công thức nền', 'Grundrezept')}</span>}
                {concept && <Link className="rc-tag" to={`/r/${rid}/rc?c=${concept.id}`}>{concept.name}</Link>}
                {r.number && <span className="rc-tag">Nr. {r.number}</span>}
              </div>
              {r.name_de && <div className="muted">{L(r.name_de, r.name)}</div>}
              {r.description && <p className="rc-desc">{r.description}</p>}
              <div className="rc-kv">
                {(r.prep_min || r.cook_min) ? <span>⏱ {L('Chuẩn bị', 'Vorb.')} {r.prep_min || 0}′ · {L('Nấu', 'Garen')} {r.cook_min || 0}′</span> : null}
                {r.kind === 'dish' && r.sell_price != null && <span>{L('Giá bán', 'Verkaufspreis')} <b>{fmtEur(r.sell_price)}</b> ({r.sell_rate}% MwSt)</span>}
                {r.kind === 'base' && r.yield_qty && <span>{L('Thành phẩm', 'Ergibt')} <b>{fmtQty(r.yield_qty)} {UNIT_LABEL[r.yield_unit || 'g'][L.de ? 'de' : 'vi']}</b></span>}
              </div>
              <div style={{ marginTop: 8 }}><AllergenChips codes={al} long /></div>
            </div>
          </div>
        )}

        {showCost && (
          <div className="rc-costbox">
            <div><span className="muted small">{L('Giá vốn / phần (Netto)', 'Wareneinsatz / Portion (netto)')}</span><b>{fmtEur(cost.perPortion)}</b></div>
            {r.kind === 'dish' && <div><span className="muted small">{L('Giá bán Netto', 'VK netto')}</span><b>{r.sell_price != null ? fmtEur(Number(r.sell_price) / (1 + r.sell_rate / 100)) : '—'}</b></div>}
            {r.kind === 'dish' && <div><span className="muted small">Wareneinsatz</span><b className={pct != null && pct > r.target_pct ? 'bad' : 'good'}>{fmtPct(pct)}</b><span className="muted small">{L('mục tiêu', 'Ziel')} {fmtPct(r.target_pct)}</span></div>}
            {r.kind === 'dish' && r.sell_price != null && <div><span className="muted small">{L('Lãi gộp / phần', 'Rohertrag / Portion')}</span><b>{fmtEur(Number(r.sell_price) / (1 + r.sell_rate / 100) - cost.perPortion)}</b></div>}
            {(cost.missing.length > 0 || cost.rising.length > 0) && (
              <div className="full small">
                {cost.rising.length > 0 && <div className="rc-tag warn">↑ {L('Giá tăng', 'Preis gestiegen')}: {cost.rising.join(', ')}</div>}
                {cost.missing.length > 0 && <div className="muted">{L('Chưa có giá hoặc đơn vị không khớp', 'Ohne Preis oder Einheit passt nicht')}: {cost.missing.join(', ')}</div>}
              </div>
            )}
          </div>
        )}

        <div className="rc-cols">
          <section className="rc-sec">
            <div className="row between wrap">
              <h2>{L('Nguyên liệu', 'Zutaten')}</h2>
              <div className="rc-scale">
                <button onClick={() => setPortions((p) => Math.max(1, Math.round((p - 1) * 100) / 100))} aria-label="−">−</button>
                <input inputMode="decimal" value={portions || ''} onChange={(e) => setPortions(Number(e.target.value.replace(',', '.')) || 0)} />
                <span className="muted small">{L('phần', 'Port.')}</span>
                <button onClick={() => setPortions((p) => Math.round((p + 1) * 100) / 100)} aria-label="+">+</button>
                {f !== 1 && <button className="ghost small" onClick={() => setPortions(Number(r.portions))}>↺</button>}
              </div>
            </div>
            {f !== 1 && <p className="muted small">{L(`Đã nhân ×${fmtQty(f)} so với công thức gốc (${fmtQty(r.portions)} phần)`, `×${fmtQty(f)} gegenüber Grundrezept (${fmtQty(r.portions)} Port.)`)}</p>}
            <table className="rc-ing">
              <tbody>
                {groups.map(([g, its]) => (
                  <GroupRows key={g + its[0].pos} g={g} its={its} render={(it) => {
                    const sq = it.unit === 'portion' ? { qty: it.qty * f, unit: it.unit } : scaleQty(it.qty, it.unit, f)
                    const ic = showCost ? itemCost({ ...it, qty: it.qty * f }, s) : null
                    const ing = it.ingredient_id ? s.ings.get(it.ingredient_id) : undefined
                    const rise = ing ? priceRise(ing) : null
                    return (
                      <tr key={it.pos}>
                        <td className="q">{fmtQty(sq.qty)} <span className="muted">{UNIT_LABEL[sq.unit][L.de ? 'de' : 'vi']}</span></td>
                        <td>
                          {it.sub_recipe_id ? <Link to={`/r/${rid}/rc/${it.sub_recipe_id}${kitchen ? '?k=1' : ''}`}>{itemName(it)} ↗</Link> : itemName(it)}
                          {it.note && <span className="muted small"> · {it.note}</span>}
                          {showCost && ing && ingPrice(ing) == null && <span className="rc-tag small">{L('thiếu giá', 'kein Preis')}</span>}
                          {showCost && rise != null && rise >= RISE_WARN && <span className="rc-tag warn small">↑ {fmtPct(rise)}</span>}
                        </td>
                        {showCost && <td className="n">{ic?.cost != null ? fmtEur(ic.cost) : '—'}</td>}
                      </tr>
                    )
                  }} />
                ))}
                {!items.length && <tr><td className="muted">{L('Chưa có nguyên liệu', 'Keine Zutaten')}</td></tr>}
              </tbody>
              {showCost && items.length > 0 && <tfoot><tr><td /><td>{L('Tổng', 'Summe')}</td><td className="n">{fmtEur(cost.total * f)}</td></tr></tfoot>}
            </table>
            {kitchen && <div style={{ marginTop: 12 }}><AllergenChips codes={al} long /></div>}
          </section>

          <section className="rc-sec">
            <h2>{L('Cách làm', 'Zubereitung')}</h2>
            <ol className="rc-steps">
              {r.steps.map((st, i) => (
                <li key={i} className={done.has(i) ? 'done' : ''} onClick={() => kitchen && setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n })}>
                  <span className="rc-stepno">{i + 1}</span>
                  <div className="grow">
                    <div className="rc-step-t">{st.text}</div>
                    {st.photo && photos[st.photo] && <img className="rc-step-img" src={photos[st.photo]} alt="" />}
                  </div>
                </li>
              ))}
              {!r.steps.length && <li className="muted">{L('Chưa có các bước', 'Keine Schritte')}</li>}
            </ol>
            {kitchen && r.steps.length > 0 && <p className="muted small">{L('Chạm vào bước đã xong để gạch đi.', 'Erledigte Schritte antippen zum Abhaken.')}</p>}
            {r.plating_photo && photos[r.plating_photo] && (
              <>
                <h2>{L('Trình bày (Plating)', 'Anrichten')}</h2>
                <img className="rc-plating" src={photos[r.plating_photo]} alt="" />
              </>
            )}
            {r.notes && !kitchen && <><h2>{L('Ghi chú', 'Hinweise')}</h2><p className="rc-desc">{r.notes}</p></>}
          </section>
        </div>

        {!kitchen && (
          <div className="rc-actions">
            <button onClick={() => makePdf(false)} disabled={pdfBusy}>📄 {L('Thẻ công thức PDF', 'Rezeptkarte PDF')}</button>
            {perm.manager && <button onClick={() => makePdf(true)} disabled={pdfBusy}>📊 {L('PDF kèm giá vốn', 'PDF mit Kalkulation')}</button>}
            {editable && <button className="primary" onClick={() => nav(`/r/${rid}/rc/${r.id}/edit`)}>✎ {L('Sửa', 'Bearbeiten')}</button>}
          </div>
        )}
      </div>
      {pdf && <PdfSheet pdf={pdf} title={`Rezept ${r.name_de || r.name}`} onClose={() => setPdf(null)}
        actions={[{ label: L('Tải về', 'Herunterladen'), primary: true, onClick: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(pdf); a.download = `Rezept_${(r.name_de || r.name).replace(/[^\p{L}\p{N}]+/gu, '_')}.pdf`; a.click() } }]} />}
    </RcShell>
  )
}

function GroupRows({ g, its, render }: { g: string; its: Item[]; render: (it: Item) => React.ReactNode }) {
  return <>{g && <tr className="grp"><td colSpan={3}>{g}</td></tr>}{its.map(render)}</>
}
