import assert from 'node:assert'
import { guessCategory } from '../src/lib/categorize.ts'
const names = ['Bier', 'Softdrinks und Säfte', 'Obst und Gemüse', 'Verpackung und Einwegartikel', 'Wein und Spirituosen', 'Fleisch', 'Gewürze und Saucen']
const cats = names.map((n, i) => ({ id: n, parent_id: 'p', kind: 'food' as const, name_vi: n, name_de: n, skr_account: null, sort: i }))
const g = (x: string) => guessCategory(x, cats, null).id
assert.strictEqual(g('Tomaten,strauch hol.'), 'Obst und Gemüse')
assert.strictEqual(g('Rucola itl. 10er'), 'Obst und Gemüse')
assert.strictEqual(g('Coca-Cola 1l'), 'Softdrinks und Säfte')
assert.strictEqual(g('Club-Mate'), 'Softdrinks und Säfte')
assert.strictEqual(g('Apfelsaft'), 'Softdrinks und Säfte')
assert.strictEqual(g('Becher 500ml'), 'Verpackung und Einwegartikel')
assert.strictEqual(g("Beck's Pils"), 'Bier')
assert.strictEqual(g('Ingwer'), 'Obst und Gemüse')
console.log('categorize ok')
