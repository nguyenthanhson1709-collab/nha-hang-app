import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Concept, Data, Ingredient, Item, Recipe } from './rc'

export const RC_BUCKET = 'nh-recipes'

const num = <T extends object>(o: T, keys: string[]): T => {
  const x = { ...o } as Record<string, unknown>
  for (const k of keys) if (x[k] != null) x[k] = Number(x[k])
  return x as T
}

export interface RcState extends Data { concepts: Concept[]; list: Recipe[]; ingList: Ingredient[] }

export async function loadAll(): Promise<RcState> {
  const [c, i, r, it] = await Promise.all([
    supabase.from('nh_rc_concepts').select('*').order('sort').order('name'),
    supabase.from('nh_rc_ingredients').select('*').order('name'),
    supabase.from('nh_rc_recipes').select('*').order('sort').order('name'),
    supabase.from('nh_rc_items').select('*').order('pos'),
  ])
  const err = c.error || i.error || r.error || it.error
  if (err) throw err
  const ingList = (i.data || []).map((x) => num(x as Ingredient, ['rate', 'yield_pct', 'pack_size', 'price_manual', 'price', 'price_prev']))
  const list = (r.data || []).map((x) => num(x as Recipe, ['portions', 'yield_qty', 'sell_price', 'sell_rate', 'target_pct']))
  const items = new Map<string, Item[]>()
  for (const x of (it.data || []) as Item[]) {
    const arr = items.get(x.recipe_id!) || []
    arr.push({ ...x, qty: Number(x.qty) }); items.set(x.recipe_id!, arr)
  }
  return {
    concepts: (c.data || []) as Concept[], list, ingList,
    ings: new Map(ingList.map((x) => [x.id, x])), recipes: new Map(list.map((x) => [x.id, x])), items,
  }
}

/** Tải toàn bộ dữ liệu công thức (dùng chung cả chuỗi, số lượng nhỏ) */
export function useRc() {
  const [s, setS] = useState<RcState | null>(null)
  const [err, setErr] = useState('')
  const reload = useCallback(() => loadAll().then(setS).catch((e) => setErr(e.message || String(e))), [])
  useEffect(() => { reload() }, [reload])
  return { s, err, reload }
}

export async function saveRecipe(r: Partial<Recipe>, items: Item[]): Promise<string> {
  const { id, updated_at: _u, ...rest } = r as Recipe
  void _u
  let rid = id
  if (rid) {
    const { error } = await supabase.from('nh_rc_recipes').update(rest).eq('id', rid)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('nh_rc_recipes').insert(rest).select('id').single()
    if (error) throw error
    rid = data.id as string
  }
  // Thay toàn bộ dòng công thức
  const { error: de } = await supabase.from('nh_rc_items').delete().eq('recipe_id', rid)
  if (de) throw de
  if (items.length) {
    const rows = items.map((x, pos) => ({ recipe_id: rid, pos, grp: x.grp || null, ingredient_id: x.ingredient_id, sub_recipe_id: x.sub_recipe_id, qty: x.qty || 0, unit: x.unit, note: x.note || null }))
    const { error } = await supabase.from('nh_rc_items').insert(rows)
    if (error) throw error
  }
  return rid!
}

export async function deleteRecipe(id: string) {
  const { error } = await supabase.from('nh_rc_recipes').delete().eq('id', id)
  if (error) throw error
}

export async function saveIngredient(i: Partial<Ingredient>): Promise<Ingredient> {
  const { id, ...rest } = i
  const q = id ? supabase.from('nh_rc_ingredients').update(rest).eq('id', id) : supabase.from('nh_rc_ingredients').insert(rest)
  const { data, error } = await q.select('*').single()
  if (error) throw error
  return data as Ingredient
}
export async function deleteIngredient(id: string) {
  const { error } = await supabase.from('nh_rc_ingredients').delete().eq('id', id)
  if (error) throw error
}

export async function saveConcept(c: Partial<Concept>): Promise<string> {
  const { id, ...rest } = c
  if (id) { const { error } = await supabase.from('nh_rc_concepts').update(rest).eq('id', id); if (error) throw error; return id }
  const { data, error } = await supabase.from('nh_rc_concepts').insert(rest).select('id').single()
  if (error) throw error
  return data.id as string
}
export async function deleteConcept(id: string) {
  const { error } = await supabase.from('nh_rc_concepts').delete().eq('id', id)
  if (error) throw error
}

export async function refreshPrices(): Promise<number> {
  const { data, error } = await supabase.rpc('nh_rc_refresh_prices')
  if (error) throw error
  return Number(data) || 0
}
export interface FoundLine { name: string; supplier: string | null; unit: string | null; n: number; last_date: string; last_unit_net: number }
export async function findLines(q: string): Promise<FoundLine[]> {
  const { data, error } = await supabase.rpc('nh_rc_find_lines', { q })
  if (error) throw error
  return (data || []) as FoundLine[]
}
export interface PricePoint { doc_date: string; supplier: string | null; name: string; qty: number | null; unit: string | null; unit_net: number; base_price: number | null }
export async function priceHistory(ing: string): Promise<PricePoint[]> {
  const { data, error } = await supabase.rpc('nh_rc_price_history', { ing })
  if (error) throw error
  return (data || []) as PricePoint[]
}

/** Thu nhỏ ảnh (tối đa 1600px, JPEG) rồi tải lên. Trả về đường dẫn trong bucket. */
export async function uploadPhoto(file: File): Promise<string> {
  let blob: Blob = file
  try {
    const url = URL.createObjectURL(file)
    const img = new Image(); img.src = url; await img.decode()
    const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(url)
    blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.82))
  } catch { /* giữ file gốc */ }
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(RC_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

const cache = new Map<string, { url: string; at: number }>()
/** Link tạm cho ảnh (nhớ 50 phút) */
export function usePhotoUrls(paths: (string | null | undefined)[]): Record<string, string> {
  const key = [...new Set(paths.filter(Boolean) as string[])].sort().join('|')
  const [m, setM] = useState<Record<string, string>>({})
  useEffect(() => {
    const ps = key ? key.split('|') : []
    const now = Date.now()
    const have: Record<string, string> = {}
    const need: string[] = []
    for (const p of ps) { const c = cache.get(p); if (c && now - c.at < 50 * 60e3) have[p] = c.url; else need.push(p) }
    setM(have)
    if (!need.length) return
    let live = true
    supabase.storage.from(RC_BUCKET).createSignedUrls(need, 3600).then(({ data }) => {
      for (const x of data || []) if (x.signedUrl && x.path) cache.set(x.path, { url: x.signedUrl, at: now })
      if (live) setM((o) => { const n = { ...o }; for (const x of data || []) if (x.signedUrl && x.path) n[x.path] = x.signedUrl; return n })
    })
    return () => { live = false }
  }, [key])
  return m
}
