// Thẻ công thức PDF (tiếng Đức), A4. Tải lười cùng @react-pdf/renderer.
import { Document, Font, Image, Page, pdf, StyleSheet, Text, View } from '@react-pdf/renderer'
import { supabase } from '../lib/supabase'
import { RC_BUCKET } from './api'
import { ALLERGENS, costPct, fmtEur, fmtPct, fmtQty, itemCost, recipeAllergens, recipeCost, scaleQty, STATUS, UNIT_LABEL, type Data, type Item, type Recipe } from './rc'

// Liberation Sans có đủ dấu tiếng Việt và tiếng Đức
const base = import.meta.env.BASE_URL
Font.register({ family: 'LS', fonts: [{ src: `${base}fonts/LiberationSans-Regular.ttf` }, { src: `${base}fonts/LiberationSans-Bold.ttf`, fontWeight: 'bold' }] })
Font.registerHyphenationCallback((w) => [w])

const ACCENT = '#F88712', INK = '#1F1F1F', MUTED = '#6B6B6B', LINE = '#E3E3E3', SHADE = '#F6F3EF'
const st = StyleSheet.create({
  page: { fontFamily: 'LS', fontSize: 10, color: INK, padding: 36, paddingBottom: 48 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 2, borderBottomColor: ACCENT, paddingBottom: 8, marginBottom: 12 },
  kicker: { fontSize: 8, color: ACCENT, fontWeight: 'bold', letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: 'bold', marginTop: 2 },
  sub: { fontSize: 10, color: MUTED, marginTop: 2 },
  meta: { fontSize: 9, color: MUTED, textAlign: 'right' },
  row: { flexDirection: 'row', gap: 16 },
  photo: { width: 200, height: 150, objectFit: 'cover', borderRadius: 6 },
  facts: { flex: 1, gap: 4 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3 },
  h2: { fontSize: 12, fontWeight: 'bold', color: ACCENT, marginTop: 14, marginBottom: 6 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3.5 },
  grp: { fontSize: 9, fontWeight: 'bold', color: MUTED, marginTop: 6, paddingVertical: 2, textTransform: 'uppercase' },
  q: { width: 70, textAlign: 'right', paddingRight: 10, fontWeight: 'bold' },
  name: { flex: 1 },
  cost: { width: 64, textAlign: 'right' },
  step: { flexDirection: 'row', marginBottom: 7 },
  stepNo: { width: 20, height: 20, borderRadius: 10, backgroundColor: ACCENT, color: '#fff', fontSize: 10, fontWeight: 'bold', textAlign: 'center', paddingTop: 4, marginRight: 8 },
  stepImg: { width: 140, height: 95, objectFit: 'cover', borderRadius: 4, marginTop: 4 },
  box: { backgroundColor: SHADE, borderRadius: 6, padding: 10, marginTop: 12 },
  allg: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  al: { fontSize: 9, borderWidth: 0.7, borderColor: ACCENT, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  foot: { position: 'absolute', left: 36, right: 36, top: 842 - 30, fontSize: 8, color: MUTED, flexDirection: 'row', justifyContent: 'space-between' },
})

const de = (n: string | null | undefined, f: string) => (n && n.trim()) || f
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`

async function dataUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from(RC_BUCKET).download(path)
  if (!data) return null
  return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => res(null); r.readAsDataURL(data) })
}

interface Opts { portions: number; withCost: boolean }

function RecipeDoc({ r, d, o, img, plating, stepImgs, concept }: { r: Recipe; d: Data; o: Opts; img: string | null; plating: string | null; stepImgs: (string | null)[]; concept: string | null }) {
  const f = o.portions / Number(r.portions)
  const items = d.items.get(r.id) || []
  const cost = recipeCost(r, d)
  const pct = costPct(r, cost.perPortion)
  const al = recipeAllergens(r, d)
  const nameOf = (it: Item) => {
    if (it.ingredient_id) { const i = d.ings.get(it.ingredient_id); return i ? de(i.name_de, i.name) : '?' }
    const s = it.sub_recipe_id ? d.recipes.get(it.sub_recipe_id) : undefined
    return s ? `${de(s.name_de, s.name)} (Grundrezept)` : '?'
  }
  return (
    <Document title={`Rezept ${de(r.name_de, r.name)}`} author="Vietbowl">
      <Page size="A4" style={st.page}>
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <Text style={st.kicker}>{r.kind === 'base' ? 'GRUNDREZEPT' : 'REZEPTKARTE'}{concept ? ` · ${concept.toUpperCase()}` : ''}</Text>
            <Text style={st.title}>{r.number ? `${r.number}. ` : ''}{de(r.name_de, r.name)}</Text>
            {r.name_de && r.name_de !== r.name && <Text style={st.sub}>{r.name}</Text>}
          </View>
          <View><Text style={st.meta}>Status: {STATUS[r.status].de}</Text><Text style={st.meta}>Stand: {dmy(new Date())}</Text></View>
        </View>

        <View style={st.row}>
          {img && <Image src={img} style={st.photo} />}
          <View style={st.facts}>
            <View style={st.fact}><Text>Portionen</Text><Text style={{ fontWeight: 'bold' }}>{fmtQty(o.portions)}{f !== 1 ? `  (Grundrezept ${fmtQty(r.portions)})` : ''}</Text></View>
            {r.kind === 'base' && r.yield_qty ? <View style={st.fact}><Text>Ergibt</Text><Text>{fmtQty(Number(r.yield_qty) * f)} {UNIT_LABEL[r.yield_unit || 'g'].de}</Text></View> : null}
            {r.prep_min ? <View style={st.fact}><Text>Vorbereitung</Text><Text>{r.prep_min} Min.</Text></View> : null}
            {r.cook_min ? <View style={st.fact}><Text>Garzeit</Text><Text>{r.cook_min} Min.</Text></View> : null}
            {r.kind === 'dish' && r.sell_price != null ? <View style={st.fact}><Text>Verkaufspreis</Text><Text>{fmtEur(r.sell_price)} (inkl. {r.sell_rate} % MwSt.)</Text></View> : null}
            {r.description ? <Text style={{ marginTop: 6, color: MUTED }}>{r.description}</Text> : null}
          </View>
        </View>

        <Text style={st.h2}>Zutaten</Text>
        {items.map((it, i) => {
          const sq = it.unit === 'portion' ? { qty: it.qty * f, unit: it.unit } : scaleQty(it.qty, it.unit, f)
          const showG = it.grp && it.grp !== (items[i - 1]?.grp || null)
          const c = o.withCost ? itemCost({ ...it, qty: it.qty * f }, d).cost : null
          return (
            <View key={i} wrap={false}>
              {showG ? <Text style={st.grp}>{it.grp}</Text> : null}
              <View style={st.tr}>
                <Text style={st.q}>{fmtQty(sq.qty)} {UNIT_LABEL[sq.unit].de}</Text>
                <Text style={st.name}>{nameOf(it)}{it.note ? `, ${it.note}` : ''}</Text>
                {o.withCost && <Text style={st.cost}>{c != null ? fmtEur(c) : '–'}</Text>}
              </View>
            </View>
          )
        })}
        {o.withCost && (
          <View style={[st.tr, { borderBottomWidth: 0 }]}>
            <Text style={st.q} /><Text style={[st.name, { fontWeight: 'bold' }]}>Wareneinsatz gesamt (netto)</Text><Text style={[st.cost, { fontWeight: 'bold' }]}>{fmtEur(cost.total * f)}</Text>
          </View>
        )}

        <Text style={st.h2}>Zubereitung</Text>
        {r.steps.map((s, i) => (
          <View key={i} style={st.step} wrap={false}>
            <Text style={st.stepNo}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text>{s.text}</Text>
              {stepImgs[i] && <Image src={stepImgs[i]!} style={st.stepImg} />}
            </View>
          </View>
        ))}

        {plating && (
          <View wrap={false}>
            <Text style={st.h2}>Anrichten</Text>
            <Image src={plating} style={{ width: 260, height: 180, objectFit: 'cover', borderRadius: 6 }} />
          </View>
        )}

        <View style={st.box} wrap={false}>
          <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>Allergene (LMIV, 14 Hauptallergene)</Text>
          {al.length ? (
            <View style={st.allg}>{al.map((c) => <Text key={c} style={st.al}>{c} – {ALLERGENS.find((a) => a.c === c)?.de}</Text>)}</View>
          ) : <Text style={{ color: MUTED }}>Keine der 14 Hauptallergene enthalten.</Text>}
        </View>

        {o.withCost && r.kind === 'dish' && (
          <View style={st.box} wrap={false}>
            <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>Kalkulation je Portion</Text>
            <View style={st.fact}><Text>Wareneinsatz (netto)</Text><Text>{fmtEur(cost.perPortion)}</Text></View>
            {r.sell_price != null && <View style={st.fact}><Text>Verkaufspreis netto</Text><Text>{fmtEur(Number(r.sell_price) / (1 + r.sell_rate / 100))}</Text></View>}
            <View style={st.fact}><Text>Wareneinsatzquote (Ziel {fmtPct(r.target_pct)})</Text><Text style={{ fontWeight: 'bold', color: pct != null && pct > r.target_pct ? '#C0392B' : INK }}>{fmtPct(pct)}</Text></View>
            {r.sell_price != null && <View style={st.fact}><Text>Rohertrag</Text><Text>{fmtEur(Number(r.sell_price) / (1 + r.sell_rate / 100) - cost.perPortion)}</Text></View>}
            {cost.missing.length > 0 && <Text style={{ color: MUTED, fontSize: 8, marginTop: 4 }}>Ohne Preis: {cost.missing.join(', ')}</Text>}
          </View>
        )}
        {r.notes ? <View style={st.box}><Text style={{ fontWeight: 'bold', marginBottom: 4 }}>Hinweise</Text><Text>{r.notes}</Text></View> : null}

        <View style={st.foot} fixed>
          <Text>{de(r.name_de, r.name)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function renderRecipePdf(r: Recipe, d: Data & { concepts?: { id: string; name: string }[] }, o: Opts): Promise<Blob> {
  const [img, plating, ...stepImgs] = await Promise.all([dataUrl(r.photo), dataUrl(r.plating_photo), ...r.steps.map((s) => dataUrl(s.photo))])
  const concept = d.concepts?.find((c) => c.id === r.concept_id)?.name || null
  return pdf(<RecipeDoc r={r} d={d} o={o} img={img} plating={plating} stepImgs={stepImgs} concept={concept} />).toBlob()
}
