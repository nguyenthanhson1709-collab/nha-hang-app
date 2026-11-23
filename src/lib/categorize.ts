import type { Category } from './supabase'
import { supabase } from './supabase'
import { normName } from './format'

// Từ khoá -> nhóm con (theo name_de của danh mục mặc định)
const RULES: [RegExp, string][] = [
  [/(bier|pils|weizen|radler|heineken|\bbeck'?s?\b|krombacher|warsteiner|saigon|tiger|333|hanoi)/i, 'Bier'],
  [/(wein|sekt|prosecco|vodka|whisky|\brum\b|\bgin\b|likör|likor|schnaps|sake|soju|spirit)/i, 'Wein und Spirituosen'],
  [/(wasser|mineral|vittel|gerolsteiner|evian|volvic|selters|sprudel|still)/i, 'Wasser'],
  [/(\bcola\b|coca|fanta|sprite|\blimo|saft|juice|eistee|ice tea|schorle|red bull|energy|\bmate\b|nektar)/i, 'Softdrinks und Säfte'],
  [/(kaffee|coffee|tee\b|tea\b|eis\s?würfel|eiswürfel)/i, 'Sonstige Getränke'],
  [/(rind|schwein|hähnchen|hahnchen|huhn|geflügel|\bente\b|lamm|hack|steak|filet|brust|keule|wurst|speck|thịt|bò|gà|heo|vịt)/i, 'Fleisch'],
  [/(garnele|shrimp|lachs|fisch|tintenfisch|calamar|muschel|thunfisch|pangasius|tôm|cá|mực)/i, 'Fisch und Meeresfrüchte'],
  [/(ei\b|eier|milch|sahne|butter|käse|kase|joghurt|quark|trứng|sữa)/i, 'Eier und Milchprodukte'],
  [/(salat|zwiebel|knoblauch|tomate|rucola|rukola|gurke|paprika|kohl|möhre|mohre|karotte|kartoffel|zitrone|limette|ingwer|chili|koriander|minze|basilikum|lauch|pilz|champignon|banane|apfel|mango|ananas|sprossen|rau|hành|tỏi|chanh|ớt)/i, 'Obst und Gemüse'],
  [/(reis|nudel|mehl|bohne|linse|glasnudel|reisnudel|reispapier|\bmie\b|udon|ramen|stärke|starke|gạo|bún|mì|phở)/i, 'Trockenware'],
  [/(salz|zucker|pfeffer|sojasauce|soja|fischsauce|sauce|soße|essig|öl\b|ol\b|oil|brühe|bruhe|gewürz|gewurz|curry|sesam|mắm|dầu|đường|muối)/i, 'Gewürze und Saucen'],
  [/(tk |tiefkühl|tiefkuhl|frozen|pommes|gefroren)/i, 'Tiefkühlware'],
  [/(box|becher|deckel|tüte|tute|beutel|serviette|stäbchen|stabchen|alufolie|folie|einweg|strohhalm|karton|verpackung|to go)/i, 'Verpackung und Einwegartikel'],
  [/(spül|spul|reiniger|putz|desinfekt|seife|müllbeutel|mullbeutel|handschuh|schwamm|wc|chlor|klarspüler)/i, 'Reinigung'],
  [/(\bgas\b|propan|butan|kohle|brennstoff|benzin|diesel)/i, 'Gas und Brennstoffe'],
  [/(messer|topf|pfanne|brett|kelle|sieb|wok|schüssel|schussel)/i, 'Werkzeuge und Kleingeräte'],
]

let memory: Map<string, string> | null = null
export async function loadMemory() {
  if (memory) return memory
  const { data } = await supabase.from('nh_item_memory').select('name_norm, category_id')
  memory = new Map((data || []).map((x) => [x.name_norm, x.category_id]))
  return memory
}
export async function remember(name: string, categoryId: string) {
  const k = normName(name)
  if (!k) return
  const mem = await loadMemory()
  if (mem.get(k) === categoryId) return
  mem.set(k, categoryId)
  await supabase.from('nh_item_memory').upsert({ name_norm: k, category_id: categoryId, updated_at: new Date().toISOString() })
}

export function guessCategory(name: string, cats: Category[], mem: Map<string, string> | null): { id: string | null; remembered: boolean } {
  const k = normName(name)
  if (mem?.has(k)) return { id: mem.get(k)!, remembered: true }
  for (const [re, de] of RULES) if (re.test(name)) {
    const c = cats.find((x) => x.parent_id && x.name_de === de)
    if (c) return { id: c.id, remembered: false }
  }
  return { id: null, remembered: false }
}

/** Tài khoản SKR03 cho một dòng hàng */
export function accountFor(cat: Category | undefined, rate: number): string {
  if (cat?.skr_account) return cat.skr_account
  if (rate === 7) return '3300'
  if (rate === 19) return '3400'
  return '3200'
}
