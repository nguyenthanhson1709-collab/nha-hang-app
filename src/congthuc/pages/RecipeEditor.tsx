import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Spinner, toast } from '../../components/ui'
import { useApp } from '../../lib/app'
import { costPct, fmtEur, fmtPct, itemCost, recipeAllergens, recipeCost, UNIT_LABEL, type Data, type Ingredient, type Item, type ItemUnit, type Recipe, type Step } from '../rc'
import { deleteRecipe, saveIngredient, saveRecipe, usePhotoUrls, useRc } from '../api'
import { AllergenChips, AllergenPicker, PhotoInput, RcShell, useL, useRcPerm } from '../ui'

const blank = (kind: 'dish' | 'base', rid: string, owner: boolean, concept: string | null): Recipe => ({
  id: '', concept_id: concept, kind, number: null, name: '', name_de: null, description: null, photo: null, plating_photo: null,
  status: 'testing', restaurant_ids: owner ? [] : [rid], portions: kind === 'base' ? 1 : 1, yield_qty: null, yield_unit: kind === 'base' ? 'ml' : null,
  sell_price: null, sell_rate: 7, target_pct: 30, prep_min: null, cook_min: null, steps: [], allergens_extra: [], notes: null, sort: 0,
})
const parse = (v: string) => { const n = Number(v.replace(',', '.')); return v.trim() === '' || isNaN(n) ? null : n }
const show = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

export default function RecipeEditor() {
  const { rid, id } = useParams()
  const [sp] = useSearchParams()
  const L = useL()
  const nav = useNavigate()
  const { restaurants } = useApp()
  const perm = useRcPerm()
  const { s, err: loadErr, reload } = useRc()
  const [r, setR] = useState<Recipe | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [extraIngs, setExtraIngs] = useState<Ingredient[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!s || r) return
    if (id) {
      const x = s.recipes.get(id)
      if (x) { setR({ ...x, steps: x.steps || [] }); setItems((s.items.get(id) || []).map((i) => ({ ...i }))) }
    } else setR(blank(sp.get('k') === 'base' ? 'base' : 'dish', rid!, perm.owner, sp.get('c')))
  }, [s, id]) // eslint-disable-line

  // Dữ liệu để tính giá xem trước (gồm nguyên liệu vừa tạo nhanh)
  const data: Data | null = useMemo(() => {
    if (!s || !r) return null
    const ings = new Map(s.ings); for (const i of extraIngs) ings.set(i.id, i)
    const recipes = new Map(s.recipes); const me = { ...r, id: r.id || '__new' }; recipes.set(me.id, me)
    const its = new Map(s.items); its.set(me.id, items)
    return { ings, recipes, items: its }
  }, [s, r, items, extraIngs])

  const photos = usePhotoUrls([r?.photo, r?.plating_photo, ...(r?.steps || []).map((x) => x.photo)])

  if (loadErr) return <RcShell tabs={false}><div className="err-box">{loadErr}</div></RcShell>
  if (!s || !r || !data) return <RcShell tabs={false}><Spinner /></RcShell>
  if (!perm.anyManager || (id && !perm.canEdit(r.restaurant_ids))) return <Navigate to={`/r/${rid}/rc${id ? `/${id}` : ''}`} replace />

  const me = data.recipes.get(r.id || '__new')!
  const cost = recipeCost(me, data)
  const pct = costPct(me, cost.perPortion)
  const al = recipeAllergens(me, data)
  const set = <K extends keyof Recipe>(k: K, v: Recipe[K]) => setR({ ...r, [k]: v })
  const allIngs = [...s.ingList, ...extraIngs]
  const bases = s.list.filter((x) => x.kind === 'base' && x.id !== r.id)
  const myRests = restaurants.filter((x) => perm.manageable.includes(x.id))

  const setItem = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = <T,>(arr: T[], i: number, d: number) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }
  const setStep = (i: number, patch: Partial<Step>) => set('steps', r.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function save() {
    if (!r!.name.trim()) { setErr(L('Cần có tên món.', 'Name fehlt.')); return }
    const bad = items.find((x) => !x.ingredient_id && !x.sub_recipe_id)
    if (bad) { setErr(L('Có dòng nguyên liệu chưa chọn.', 'Eine Zutatenzeile ist leer.')); return }
    setBusy(true); setErr('')
    try {
      const steps = r!.steps.filter((x) => x.text.trim() || x.photo)
      const nid = await saveRecipe({ ...r!, id: r!.id || undefined, steps, name: r!.name.trim(), name_de: r!.name_de?.trim() || null } as Recipe, items)
      toast(L('Đã lưu', 'Gespeichert'))
      await reload()
      nav(`/r/${rid}/rc/${nid}`, { replace: true })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function del() {
    if (!r!.id || !confirm(L(`Xoá món "${r!.name}"?`, `„${r!.name}" löschen?`))) return
    try { await deleteRecipe(r!.id); await reload(); nav(`/r/${rid}/rc`, { replace: true }) }
    catch (e) { setErr(/foreign key|violates/i.test((e as Error).message) ? L('Công thức này đang được dùng trong món khác.', 'Wird in einem anderen Rezept verwendet.') : (e as Error).message) }
  }
  async function quickIng(i: number, name: string) {
    const unit = items[i].unit === 'pcs' ? 'pcs' : items[i].unit === 'ml' || items[i].unit === 'l' ? 'ml' : 'g'
    try {
      const ing = await saveIngredient({ name, unit })
      setExtraIngs((x) => [...x, { ...ing, rate: 7, yield_pct: 100 } as Ingredient])
      setItem(i, { ingredient_id: ing.id, sub_recipe_id: null })
      toast(L('Đã tạo nguyên liệu. Nhập giá ở tab "Nguyên liệu & giá".', 'Zutat angelegt. Preis unter „Zutaten & Preise" eintragen.'))
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <RcShell title={r.id ? L('Sửa công thức', 'Rezept bearbeiten') : r.kind === 'base' ? L('Công thức nền mới', 'Neues Grundrezept') : L('Món mới', 'Neues Gericht')} tabs={false} back={r.id ? `/r/${rid}/rc/${r.id}` : `/r/${rid}/rc`}>
      <div className="rc-edit">
        {err && <div className="err-box">{err}</div>}
        <section className="card">
          <div className="rc-frow">
            <label className="f" style={{ flex: '0 0 90px' }}><span>{L('Số', 'Nr.')}</span><input value={r.number || ''} onChange={(e) => set('number', e.target.value || null)} /></label>
            <label className="f"><span>{L('Tên món (tiếng Việt)', 'Name (Vietnamesisch)')} *</span><input value={r.name} onChange={(e) => set('name', e.target.value)} autoFocus={!r.id} /></label>
            <label className="f"><span>{L('Tên tiếng Đức (in trên PDF)', 'Name (Deutsch, für PDF)')}</span><input value={r.name_de || ''} onChange={(e) => set('name_de', e.target.value || null)} /></label>
          </div>
          <div className="rc-frow">
            <label className="f"><span>{L('Loại', 'Art')}</span>
              <select value={r.kind} onChange={(e) => set('kind', e.target.value as Recipe['kind'])}>
                <option value="dish">{L('Món ăn (bán)', 'Gericht (Verkauf)')}</option>
                <option value="base">{L('Công thức nền (sốt, nước dùng…)', 'Grundrezept (Sauce, Brühe…)')}</option>
              </select>
            </label>
            <label className="f"><span>Concept</span>
              <select value={r.concept_id || ''} onChange={(e) => set('concept_id', e.target.value || null)}>
                <option value="">—</option>
                {s.concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="f"><span>{L('Trạng thái', 'Status')}</span>
              <select value={r.status} onChange={(e) => set('status', e.target.value as Recipe['status'])}>
                <option value="active">{L('Đang bán', 'Im Verkauf')}</option>
                <option value="testing">{L('Thử nghiệm', 'In Testphase')}</option>
                <option value="stopped">{L('Ngừng bán', 'Eingestellt')}</option>
              </select>
            </label>
          </div>
          <div className="f"><span>{L('Quán dùng món này', 'Verwendet in')}</span>
            <div className="rc-chips">
              {perm.owner && <button type="button" className={!r.restaurant_ids.length ? 'sel' : ''} onClick={() => set('restaurant_ids', [])}>{L('Mọi quán', 'Alle Filialen')}</button>}
              {myRests.map((x) => {
                const on = r.restaurant_ids.includes(x.id)
                return <button type="button" key={x.id} className={on ? 'sel' : ''} onClick={() => set('restaurant_ids', on ? r.restaurant_ids.filter((y) => y !== x.id) : [...r.restaurant_ids, x.id])}>{x.name}</button>
              })}
            </div>
          </div>
          <label className="f"><span>{L('Mô tả', 'Beschreibung')}</span><textarea value={r.description || ''} onChange={(e) => set('description', e.target.value || null)} /></label>
          <div className="rc-frow">
            <div className="f"><span>{L('Ảnh món', 'Foto')}</span><PhotoInput path={r.photo} url={r.photo ? photos[r.photo] : undefined} onChange={(p) => set('photo', p)} label={L('Ảnh món', 'Foto')} /></div>
            <div className="f"><span>{L('Ảnh trình bày (plating)', 'Anrichte-Foto')}</span><PhotoInput path={r.plating_photo} url={r.plating_photo ? photos[r.plating_photo] : undefined} onChange={(p) => set('plating_photo', p)} label="Plating" /></div>
          </div>
        </section>

        <section className="card">
          <h3>{L('Khẩu phần, thời gian, giá bán', 'Portionen, Zeit, Verkaufspreis')}</h3>
          <div className="rc-frow">
            <label className="f"><span>{L('Công thức này ra bao nhiêu phần', 'Rezept ergibt Portionen')}</span><input inputMode="decimal" value={show(r.portions)} onChange={(e) => set('portions', parse(e.target.value) || 1)} /></label>
            {r.kind === 'base' && <>
              <label className="f"><span>{L('Tổng thành phẩm', 'Gesamtmenge')}</span><input inputMode="decimal" value={show(r.yield_qty)} onChange={(e) => set('yield_qty', parse(e.target.value))} placeholder="2000" /></label>
              <label className="f" style={{ flex: '0 0 100px' }}><span>{L('Đơn vị', 'Einheit')}</span>
                <select value={r.yield_unit || 'ml'} onChange={(e) => set('yield_unit', e.target.value as Recipe['yield_unit'])}><option value="ml">ml</option><option value="g">g</option><option value="pcs">{L('cái', 'Stk.')}</option></select>
              </label>
            </>}
            <label className="f"><span>{L('Chuẩn bị (phút)', 'Vorbereitung (Min.)')}</span><input inputMode="numeric" value={show(r.prep_min)} onChange={(e) => set('prep_min', parse(e.target.value))} /></label>
            <label className="f"><span>{L('Nấu (phút)', 'Garzeit (Min.)')}</span><input inputMode="numeric" value={show(r.cook_min)} onChange={(e) => set('cook_min', parse(e.target.value))} /></label>
          </div>
          {r.kind === 'dish' && (
            <div className="rc-frow">
              <label className="f"><span>{L('Giá bán / phần (Brutto, €)', 'Verkaufspreis / Portion (brutto, €)')}</span><input inputMode="decimal" value={show(r.sell_price)} onChange={(e) => set('sell_price', parse(e.target.value))} /></label>
              <label className="f"><span>MwSt</span>
                <select value={r.sell_rate} onChange={(e) => set('sell_rate', Number(e.target.value))}><option value={7}>7 % ({L('đồ ăn', 'Speisen')})</option><option value={19}>19 % ({L('đồ uống', 'Getränke')})</option></select>
              </label>
              <label className="f"><span>{L('Wareneinsatz mục tiêu (%)', 'Ziel-Wareneinsatz (%)')}</span><input inputMode="decimal" value={show(r.target_pct)} onChange={(e) => set('target_pct', parse(e.target.value) ?? 30)} /></label>
            </div>
          )}
        </section>

        <section className="card">
          <div className="row between wrap"><h3>{L('Nguyên liệu và định lượng', 'Zutaten und Mengen')}</h3><span className="muted small">{L(`cho ${show(r.portions)} phần`, `für ${show(r.portions)} Port.`)}</span></div>
          <div className="rc-items">
            {items.map((it, i) => {
              const c = itemCost(it, data)
              return (
                <div className="rc-item" key={i}>
                  <input className="grp" placeholder={L('Nhóm', 'Gruppe')} value={it.grp || ''} onChange={(e) => setItem(i, { grp: e.target.value || null })} title={L('Nhóm trong công thức, vd "Sốt"', 'Gruppe, z. B. „Sauce"')} />
                  <input className="qty" inputMode="decimal" value={show(it.qty)} onChange={(e) => setItem(i, { qty: parse(e.target.value) ?? 0 })} />
                  <select className="unit" value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value as ItemUnit })}>
                    {(Object.keys(UNIT_LABEL) as ItemUnit[]).filter((u) => u !== 'portion' || it.sub_recipe_id).map((u) => <option key={u} value={u}>{UNIT_LABEL[u][L.de ? 'de' : 'vi']}</option>)}
                  </select>
                  <IngPicker ings={allIngs} bases={bases} value={it} onPick={(p) => setItem(i, p.kind === 'ing' ? { ingredient_id: p.id, sub_recipe_id: null } : { sub_recipe_id: p.id, ingredient_id: null })} onCreate={(name) => quickIng(i, name)} />
                  <input className="note" placeholder={L('Ghi chú (thái hạt lựu…)', 'Hinweis (gewürfelt…)')} value={it.note || ''} onChange={(e) => setItem(i, { note: e.target.value || null })} />
                  <span className="cost small">{c.cost != null ? fmtEur(c.cost) : <span className="muted">—</span>}</span>
                  <span className="ctl">
                    <button type="button" className="ghost" onClick={() => setItems(move(items, i, -1))} aria-label="up">↑</button>
                    <button type="button" className="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="delete">✕</button>
                  </span>
                </div>
              )
            })}
          </div>
          <button type="button" onClick={() => setItems([...items, { pos: items.length, grp: items[items.length - 1]?.grp || null, ingredient_id: null, sub_recipe_id: null, qty: 0, unit: 'g', note: null }])}>+ {L('Thêm nguyên liệu', 'Zutat hinzufügen')}</button>
          <div className="rc-costline">
            <span>{L('Giá vốn', 'Wareneinsatz')}: <b>{fmtEur(cost.total)}</b> · {L('mỗi phần', 'je Portion')} <b>{fmtEur(cost.perPortion)}</b></span>
            {pct != null && <span className={`rc-pct ${pct > r.target_pct ? 'bad' : 'good'}`}>{fmtPct(pct)}</span>}
            {cost.missing.length > 0 && <span className="muted small">{L('thiếu giá', 'ohne Preis')}: {cost.missing.join(', ')}</span>}
          </div>
        </section>

        <section className="card">
          <h3>{L('Các bước làm', 'Zubereitungsschritte')}</h3>
          {r.steps.map((st, i) => (
            <div className="rc-step-ed" key={i}>
              <span className="rc-stepno">{i + 1}</span>
              <div className="grow">
                <textarea value={st.text} onChange={(e) => setStep(i, { text: e.target.value })} placeholder={L('Mô tả bước này…', 'Schritt beschreiben…')} />
                <PhotoInput small path={st.photo || null} url={st.photo ? photos[st.photo] : undefined} onChange={(p) => setStep(i, { photo: p })} label={L('Ảnh bước', 'Foto')} />
              </div>
              <span className="ctl">
                <button type="button" className="ghost" onClick={() => set('steps', move(r.steps, i, -1))} aria-label="up">↑</button>
                <button type="button" className="ghost" onClick={() => set('steps', move(r.steps, i, 1))} aria-label="down">↓</button>
                <button type="button" className="ghost" onClick={() => set('steps', r.steps.filter((_, j) => j !== i))} aria-label="delete">✕</button>
              </span>
            </div>
          ))}
          <button type="button" onClick={() => set('steps', [...r.steps, { text: '' }])}>+ {L('Thêm bước', 'Schritt hinzufügen')}</button>
        </section>

        <section className="card">
          <h3>{L('Chất gây dị ứng (14 nhóm EU)', 'Allergene (14 EU-Hauptallergene)')}</h3>
          <p className="muted small">{L('Tự lấy từ nguyên liệu:', 'Automatisch aus Zutaten:')} <AllergenChips codes={recipeAllergens({ ...me, allergens_extra: [] }, data)} /></p>
          <p className="muted small">{L('Đánh dấu thêm nếu món có chất khác (vd. nhiễm chéo):', 'Zusätzlich markieren (z. B. Kreuzkontakt):')}</p>
          <AllergenPicker value={r.allergens_extra} onChange={(v) => set('allergens_extra', v)} />
          <p className="small" style={{ marginTop: 8 }}>{L('Kết quả trên thực đơn:', 'Kennzeichnung:')} <AllergenChips codes={al} /></p>
        </section>

        <section className="card">
          <label className="f"><span>{L('Ghi chú (bảo quản, lưu ý cho bếp…)', 'Hinweise (Lagerung, Küche…)')}</span><textarea value={r.notes || ''} onChange={(e) => set('notes', e.target.value || null)} /></label>
        </section>

        <div className="rc-actions sticky">
          {r.id && <button className="danger" onClick={del}>{L('Xoá', 'Löschen')}</button>}
          <span className="grow" />
          <button onClick={() => nav(-1)}>{L('Huỷ', 'Abbrechen')}</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? '…' : L('Lưu', 'Speichern')}</button>
        </div>
      </div>
    </RcShell>
  )
}

type Pick = { kind: 'ing' | 'base'; id: string }
function IngPicker({ ings, bases, value, onPick, onCreate }: { ings: Ingredient[]; bases: Recipe[]; value: Item; onPick: (p: Pick) => void; onCreate: (name: string) => void }) {
  const L = useL()
  const cur = value.ingredient_id ? ings.find((x) => x.id === value.ingredient_id)?.name : value.sub_recipe_id ? `↻ ${bases.find((x) => x.id === value.sub_recipe_id)?.name || ''}` : ''
  const [q, setQ] = useState<string | null>(null)
  const t = (q ?? '').trim().toLowerCase()
  const opts: (Pick & { label: string })[] = [
    ...ings.map((x) => ({ kind: 'ing' as const, id: x.id, label: x.name + (x.name_de ? ` · ${x.name_de}` : '') })),
    ...bases.map((x) => ({ kind: 'base' as const, id: x.id, label: `↻ ${x.name}` })),
  ].filter((o) => !t || o.label.toLowerCase().includes(t)).slice(0, 80)
  const exact = ings.some((x) => x.name.toLowerCase() === t)
  return (
    <div className="rc-pick">
      <input value={q ?? cur ?? ''} placeholder={L('Chọn nguyên liệu…', 'Zutat wählen…')} onFocus={() => setQ('')} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setQ(null), 180)} />
      {q !== null && (
        <div className="rc-pick-list">
          {t && !exact && <div className="rc-pick-it new" onMouseDown={(e) => e.preventDefault()} onClick={() => { onCreate(q.trim()); setQ(null) }}>+ {L('Tạo nguyên liệu', 'Neue Zutat')} „{q.trim()}"</div>}
          {opts.map((o) => <div key={o.kind + o.id} className="rc-pick-it" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(o); setQ(null) }}>{o.label}</div>)}
          {!opts.length && !t && <div className="rc-pick-it muted">{L('Gõ tên để tìm hoặc tạo mới', 'Name eingeben')}</div>}
        </div>
      )}
    </div>
  )
}
