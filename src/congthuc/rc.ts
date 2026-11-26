// Concept & Công thức món ăn: kiểu dữ liệu, tính giá vốn, dị ứng (thuần, test được không cần trình duyệt)

export type Status = 'active' | 'testing' | 'stopped'
export type BaseUnit = 'g' | 'ml' | 'pcs'
export type ItemUnit = 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'portion'

export interface Concept {
  id: string; name: string; description: string | null; cover: string | null
  restaurant_ids: string[]; status: Status; sort: number
}
export interface Ingredient {
  id: string; name: string; name_de: string | null; unit: BaseUnit; allergens: string[]; rate: number; yield_pct: number
  match_name: string | null; match_supplier: string | null; pack_size: number | null
  price_manual: number | null; price: number | null; price_prev: number | null; price_date: string | null; price_supplier: string | null
  price_source: 'manual' | 'invoice' | null; note: string | null
}
export interface Step { text: string; photo?: string | null }
export interface Recipe {
  id: string; concept_id: string | null; kind: 'dish' | 'base'; number: string | null
  name: string; name_de: string | null; description: string | null; photo: string | null; plating_photo: string | null
  status: Status; restaurant_ids: string[]; portions: number; yield_qty: number | null; yield_unit: BaseUnit | null
  sell_price: number | null; sell_rate: number; target_pct: number; prep_min: number | null; cook_min: number | null
  steps: Step[]; allergens_extra: string[]; notes: string | null; sort: number; updated_at?: string
}
export interface Item {
  id?: string; recipe_id?: string; pos: number; grp: string | null
  ingredient_id: string | null; sub_recipe_id: string | null; qty: number; unit: ItemUnit; note: string | null
}

/** 14 nhóm chất gây dị ứng theo EU (LMIV), mã chữ thường dùng trên thực đơn ở Đức */
export const ALLERGENS: { c: string; vi: string; de: string }[] = [
  { c: 'A', vi: 'Gluten (lúa mì, lúa mạch…)', de: 'Glutenhaltiges Getreide' },
  { c: 'B', vi: 'Giáp xác (tôm, cua)', de: 'Krebstiere' },
  { c: 'C', vi: 'Trứng', de: 'Eier' },
  { c: 'D', vi: 'Cá', de: 'Fisch' },
  { c: 'E', vi: 'Đậu phộng', de: 'Erdnüsse' },
  { c: 'F', vi: 'Đậu nành', de: 'Soja' },
  { c: 'G', vi: 'Sữa (lactose)', de: 'Milch (Laktose)' },
  { c: 'H', vi: 'Các loại hạt (óc chó, hạnh nhân…)', de: 'Schalenfrüchte' },
  { c: 'L', vi: 'Cần tây', de: 'Sellerie' },
  { c: 'M', vi: 'Mù tạt', de: 'Senf' },
  { c: 'N', vi: 'Vừng (mè)', de: 'Sesam' },
  { c: 'O', vi: 'Sulfit (SO₂ > 10 mg/kg)', de: 'Schwefeldioxid und Sulfite' },
  { c: 'P', vi: 'Đậu lupin', de: 'Lupinen' },
  { c: 'R', vi: 'Nhuyễn thể (mực, sò, ốc)', de: 'Weichtiere' },
]
export const allergenName = (c: string, de: boolean) => { const a = ALLERGENS.find((x) => x.c === c); return a ? (de ? a.de : a.vi) : c }

export const STATUS: Record<Status, { vi: string; de: string }> = {
  active: { vi: 'Đang bán', de: 'Im Verkauf' },
  testing: { vi: 'Thử nghiệm', de: 'In Testphase' },
  stopped: { vi: 'Ngừng bán', de: 'Eingestellt' },
}
export const UNIT_LABEL: Record<ItemUnit, { vi: string; de: string }> = {
  g: { vi: 'g', de: 'g' }, kg: { vi: 'kg', de: 'kg' }, ml: { vi: 'ml', de: 'ml' }, l: { vi: 'l', de: 'l' },
  pcs: { vi: 'cái', de: 'Stk.' }, portion: { vi: 'phần', de: 'Port.' },
}
export const BASE_PRICE_LABEL: Record<BaseUnit, { vi: string; de: string }> = {
  g: { vi: '€/kg', de: '€/kg' }, ml: { vi: '€/l', de: '€/l' }, pcs: { vi: '€/cái', de: '€/Stk.' },
}

/** Đổi lượng về đơn vị gốc (g, ml, cái). 'portion' giữ nguyên. */
export function toBase(qty: number, unit: ItemUnit): { q: number; u: BaseUnit | 'portion' } {
  if (unit === 'kg') return { q: qty * 1000, u: 'g' }
  if (unit === 'l') return { q: qty * 1000, u: 'ml' }
  return { q: qty, u: unit }
}
/** g và ml coi như tương đương (1 ml ≈ 1 g) để công thức ghi kiểu nào cũng tính được */
const sameFamily = (a: string, b: string) => a === b || (a !== 'pcs' && b !== 'pcs' && a !== 'portion' && b !== 'portion')

/** Giá Netto đang dùng cho 1 kg / 1 l / 1 cái */
export function ingPrice(i: Ingredient): number | null {
  if (i.match_name && i.price != null && i.price_source === 'invoice') return Number(i.price)
  return i.price_manual != null ? Number(i.price_manual) : null
}
/** % tăng giá so với lần mua trước (chỉ khi lấy từ hoá đơn) */
export function priceRise(i: Ingredient): number | null {
  if (i.price_source !== 'invoice' || i.price == null || !i.price_prev) return null
  return (Number(i.price) - Number(i.price_prev)) / Number(i.price_prev) * 100
}
export const RISE_WARN = 5

/** Đoán quy cách gói từ tên/đơn vị trên hoá đơn: "Reisnudeln 5kg" -> 5000 g; "10x1L" -> 10000 ml */
export function guessPack(name: string, unit: string | null): { size: number; unit: BaseUnit } | null {
  const s = name.toLowerCase().replace(',', '.')
  const m = s.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|l|ltr|liter|ml|cl)\b/)
  if (m) {
    const n = (m[1] ? Number(m[1]) : 1) * Number(m[2])
    const u = m[3]
    if (u === 'kg') return { size: n * 1000, unit: 'g' }
    if (u === 'g' || u === 'gr') return { size: n, unit: 'g' }
    if (u === 'ml') return { size: n, unit: 'ml' }
    if (u === 'cl') return { size: n * 10, unit: 'ml' }
    return { size: n * 1000, unit: 'ml' }
  }
  const u = (unit || '').toLowerCase()
  if (u === 'kg') return { size: 1000, unit: 'g' }
  if (u === 'l' || u === 'ltr') return { size: 1000, unit: 'ml' }
  if (u === 'g') return { size: 1, unit: 'g' }
  return null
}

export interface Data { ings: Map<string, Ingredient>; recipes: Map<string, Recipe>; items: Map<string, Item[]> }
export interface Cost { total: number; perPortion: number; missing: string[]; rising: string[] }

/** Giá vốn Netto cả công thức và mỗi phần. missing = nguyên liệu chưa có giá / sai đơn vị. */
export function recipeCost(r: Recipe, d: Data, seen: Set<string> = new Set()): Cost {
  const out: Cost = { total: 0, perPortion: 0, missing: [], rising: [] }
  if (seen.has(r.id)) { out.missing.push(r.name); return out }
  const next = new Set(seen).add(r.id)
  for (const it of d.items.get(r.id) || []) {
    const c = itemCost(it, d, next)
    if (c.cost == null) out.missing.push(c.label)
    else out.total += c.cost
    out.missing.push(...c.missing); out.rising.push(...c.rising)
  }
  out.perPortion = out.total / (Number(r.portions) || 1)
  out.missing = [...new Set(out.missing)]; out.rising = [...new Set(out.rising)]
  return out
}

export function itemCost(it: Item, d: Data, seen: Set<string> = new Set()): { cost: number | null; label: string; missing: string[]; rising: string[] } {
  const b = toBase(Number(it.qty) || 0, it.unit)
  if (it.ingredient_id) {
    const i = d.ings.get(it.ingredient_id)
    if (!i) return { cost: null, label: '?', missing: [], rising: [] }
    const p = ingPrice(i)
    const rising = (priceRise(i) ?? 0) >= RISE_WARN ? [i.name] : []
    if (p == null || !sameFamily(b.u, i.unit)) return { cost: null, label: i.name, missing: [], rising }
    const perBase = i.unit === 'pcs' ? p : p / 1000
    return { cost: b.q * perBase / ((Number(i.yield_pct) || 100) / 100), label: i.name, missing: [], rising }
  }
  const sub = it.sub_recipe_id ? d.recipes.get(it.sub_recipe_id) : undefined
  if (!sub) return { cost: null, label: '?', missing: [], rising: [] }
  const sc = recipeCost(sub, d, seen)
  if (b.u === 'portion') return { cost: sc.perPortion * b.q, label: sub.name, missing: sc.missing, rising: sc.rising }
  if (sub.yield_qty && sub.yield_unit && sameFamily(b.u, sub.yield_unit)) return { cost: sc.total * b.q / Number(sub.yield_qty), label: sub.name, missing: sc.missing, rising: sc.rising }
  return { cost: null, label: sub.name, missing: sc.missing, rising: sc.rising }
}

/** Wareneinsatz % = giá vốn Netto / giá bán Netto */
export function costPct(r: Recipe, perPortion: number): number | null {
  if (!r.sell_price) return null
  const net = Number(r.sell_price) / (1 + Number(r.sell_rate) / 100)
  return net > 0 ? perPortion / net * 100 : null
}

/** Dị ứng của món = các nguyên liệu (kể cả công thức con) + ghi thêm */
export function recipeAllergens(r: Recipe, d: Data, seen: Set<string> = new Set()): string[] {
  if (seen.has(r.id)) return []
  seen.add(r.id)
  const s = new Set(r.allergens_extra || [])
  for (const it of d.items.get(r.id) || []) {
    if (it.ingredient_id) for (const a of d.ings.get(it.ingredient_id)?.allergens || []) s.add(a)
    else if (it.sub_recipe_id) { const sub = d.recipes.get(it.sub_recipe_id); if (sub) for (const a of recipeAllergens(sub, d, seen)) s.add(a) }
  }
  return ALLERGENS.map((a) => a.c).filter((c) => s.has(c))
}

/** Nhân/chia khẩu phần: đổi g↔kg, ml↔l cho dễ đọc */
export function scaleQty(qty: number, unit: ItemUnit, f: number): { qty: number; unit: ItemUnit } {
  let q = Number(qty) * f, u = unit
  if (u === 'g' && q >= 1000) { q /= 1000; u = 'kg' } else if (u === 'kg' && q < 1) { q *= 1000; u = 'g' }
  if (u === 'ml' && q >= 1000) { q /= 1000; u = 'l' } else if (u === 'l' && q < 1) { q *= 1000; u = 'ml' }
  return { qty: q, unit: u }
}
export function fmtQty(n: number, de = true): string {
  const d = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2
  const s = (Math.round(n * 10 ** d) / 10 ** d).toString()
  return de ? s.replace('.', ',') : s.replace('.', ',')
}
export const fmtEur = (n: number | null | undefined, digits = 2) =>
  n == null || isNaN(Number(n)) ? '—' : `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`
export const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`)

/** Món dùng nguyên liệu / công thức con này (để biết món nào bị ảnh hưởng khi giá tăng) */
export function usedIn(id: string, d: Data): Recipe[] {
  const out: Recipe[] = []
  for (const [rid, items] of d.items) if (items.some((i) => i.ingredient_id === id || i.sub_recipe_id === id)) { const r = d.recipes.get(rid); if (r) out.push(r) }
  return out
}
