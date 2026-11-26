// Tính giá vốn / dị ứng / quy cách gói. npx tsx tests/recipe-cost.mts
import { costPct, guessPack, recipeAllergens, recipeCost, scaleQty, type Data, type Ingredient, type Item, type Recipe } from '../src/congthuc/rc'

let fails = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

const ing = (id: string, p: Partial<Ingredient>): Ingredient => ({ id, name: id, name_de: null, unit: 'g', allergens: [], rate: 7, yield_pct: 100, match_name: null, match_supplier: null, pack_size: null, price_manual: null, price: null, price_prev: null, price_date: null, price_supplier: null, price_source: null, note: null, ...p })
const rec = (id: string, p: Partial<Recipe>): Recipe => ({ id, concept_id: null, kind: 'dish', number: null, name: id, name_de: null, description: null, photo: null, plating_photo: null, status: 'active', restaurant_ids: [], portions: 1, yield_qty: null, yield_unit: null, sell_price: null, sell_rate: 7, target_pct: 30, prep_min: null, cook_min: null, steps: [], allergens_extra: [], notes: null, sort: 0, ...p })
const it = (p: Partial<Item>): Item => ({ pos: 0, grp: null, ingredient_id: null, sub_recipe_id: null, qty: 0, unit: 'g', note: null, ...p })

const ings = [
  ing('banhpho', { price: 5, price_prev: 4, price_source: 'invoice', match_name: 'x' }),        // 5 €/kg, tăng 25%
  ing('bo', { price_manual: 20, allergens: [] }),                                               // 20 €/kg
  ing('hanh', { price_manual: 2, yield_pct: 80 }),                                              // 2 €/kg, dùng được 80%
  ing('nuocmam', { unit: 'ml', price_manual: 4, allergens: ['D'] }),                            // 4 €/l
  ing('trung', { unit: 'pcs', price_manual: 0.25, allergens: ['C'] }),
  ing('xuong', { price_manual: 3 }), ing('quehoi', { price_manual: 30 }),
]
const recipes = [
  rec('nuocdung', { kind: 'base', portions: 10, yield_qty: 5000, yield_unit: 'ml' }),
  rec('pho', { sell_price: 14.9, sell_rate: 7 }),
]
const items = new Map<string, Item[]>([
  ['nuocdung', [it({ ingredient_id: 'xuong', qty: 2, unit: 'kg' }), it({ ingredient_id: 'quehoi', qty: 20 }), it({ ingredient_id: 'nuocmam', qty: 100, unit: 'ml' })]],
  ['pho', [it({ ingredient_id: 'banhpho', qty: 180 }), it({ ingredient_id: 'bo', qty: 100 }), it({ ingredient_id: 'hanh', qty: 20 }), it({ sub_recipe_id: 'nuocdung', qty: 500, unit: 'ml' }), it({ ingredient_id: 'trung', qty: 1, unit: 'pcs' })]],
])
const d: Data = { ings: new Map(ings.map((x) => [x.id, x])), recipes: new Map(recipes.map((x) => [x.id, x])), items }

const nd = recipeCost(recipes[0], d)
ok(near(nd.total, 6 + 0.6 + 0.4), `Nước dùng cả mẻ = 6 + 0,60 + 0,40 = 7,00 € (được ${nd.total.toFixed(2)})`)
const c = recipeCost(recipes[1], d)
// 0.9 + 2.0 + 0.05 + 0.70 + 0.25 = 3.90
ok(near(c.perPortion, 3.9), `Phở: 0,90 + 2,00 + 0,05 (hành 80%) + 0,70 (500 ml nước dùng) + 0,25 = 3,90 € (được ${c.perPortion.toFixed(3)})`)
ok(c.rising.includes('banhpho'), 'Cảnh báo bánh phở tăng giá')
const pct = costPct(recipes[1], c.perPortion)!
ok(near(pct, 3.9 / (14.9 / 1.07) * 100), `Wareneinsatz = 3,90 / 13,93 = ${pct.toFixed(1)} %`)
ok(JSON.stringify(recipeAllergens(recipes[1], d)) === '["C","D"]', 'Dị ứng gồm cả công thức nền: C (trứng), D (nước mắm)')
const miss = recipeCost(rec('x', {}), { ...d, items: new Map([['x', [it({ ingredient_id: 'trung', qty: 50, unit: 'g' })]]]) })
ok(miss.missing.includes('trung'), 'Đơn vị không khớp (g với cái) -> báo thiếu giá')
ok(JSON.stringify(guessPack('Reisbandnudeln 5kg', 'Stk')) === '{"size":5000,"unit":"g"}', 'Đoán gói: "5kg" = 5000 g')
ok(JSON.stringify(guessPack('Coca Cola 24x0,33l', 'Kiste')) === '{"size":7920,"unit":"ml"}', 'Đoán gói: "24x0,33l" = 7920 ml')
ok(JSON.stringify(guessPack('Rinderhuefte', 'kg')) === '{"size":1000,"unit":"g"}', 'Đoán gói: đơn vị kg = 1000 g')
const s = scaleQty(180, 'g', 10)
ok(s.unit === 'kg' && near(s.qty, 1.8), 'Nhân 10 phần: 180 g -> 1,8 kg')

console.log(fails ? `\n${fails} lỗi` : '\nTất cả đạt')
process.exit(fails ? 1 : 0)
