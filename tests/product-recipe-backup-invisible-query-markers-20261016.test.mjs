import test from 'node:test'
import assert from 'node:assert/strict'
import { exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

// Fictional/in-memory recipe URLs; no real tokens, network, shopper records or
// retailer sources. Invisible Unicode in query KEYS is not portable proof.
const root = 'https://recipes.example.org/fake-invisible-key'
const recipe = url => ({
  source: 'url', sourceUrl: url, title: 'Fictieve pasta',
  servings: 2, minutes: 15, ingredients: ['200 g pasta'], steps: ['Kook.'],
})
const backup = url => JSON.stringify({
  format: 'supa-private-recipes-backup', version: 1, recipes: [recipe(url)],
})
const exportOne = url => exportRecipeBackup({
  error: null, raw: null,
  recipes: [{
    ...recipe(url), id: 'own-fake-invisible-key-0001',
    savedAt: '2026-10-16T19:00:00.000Z',
    ingredients: [{ original: '200 g pasta' }],
  }],
})
const invisibles = [
  ['zero width space in oauth code', 'co\u200Bde'],
  ['zero width nonjoiner in oauth code', 'co\u200Cde'],
  ['zero width joiner in oauth code', 'co\u200Dde'],
  ['word joiner in token', 'to\u2060ken'],
  ['right-to-left override in token', 'to\u202Eken'],
  ['left-to-right mark in code', 'co\u200Ede'],
  ['right-to-left mark in code', 'co\u200Fde'],
  ['left-to-right isolate in session', 'se\u2066ssion'],
  ['pop-directional-isolate in auth', 'au\u2069th'],
  ['byte-order mark in code', 'co\uFEFFde'],
  ['percent-encoded zero width space', 'co%E2%80%8Bde'],
  ['double-encoded zero width space', 'co%25E2%2580%258Bde'],
]
for (const [label, key] of invisibles) {
  test('portable backup must refuse invisible query marker: ' + label, () => {
    const url = root + '?' + key + '=FICTIONAL'
    assert.throws(() => exportOne(url),
      /onveilige receptlink|geheime inloggegevens/)
    assert.throws(() => parseRecipeBackup(backup(url)),
      /onveilige receptlink|geheime inloggegevens/)
    let mints = 0
    let writes = 0
    const storage = { getItem: () => null, setItem: () => { writes++ } }
    assert.throws(() => restoreRecipeBackup(
      storage, { error: null, raw: null, recipes: [] }, backup(url),
      () => { mints++; return 'own-not-allowed' }, '2026-10-16T21:00:00Z',
    ), /onveilige receptlink|geheime inloggegevens/)
    assert.equal(mints, 0)
    assert.equal(writes, 0)
  })
}
for (const [label, query] of [
  ['ordinary recipe category', '?category=rijst&page=2'],
  ['Unicode controls in query VALUE are not auth-key smuggling', '?category=pasta\u200Brijst'],
  ['encoded zero-width SPACE within harmless VALUE', '?category=pasta%E2%80%8Brijst'],
  ['normal Unicode Dutch accents', '?cafe%CC%81=rijst'],
  ['ordinary NFKC-safe query key', '?ｐａｇｅ=2'],
]) {
  test('portable backup retains harmless query value: ' + label, () => {
    const url = root + query
    const href = new URL(url).href
    assert.equal(JSON.parse(exportOne(url)).recipes[0].sourceUrl, href)
    assert.equal(parseRecipeBackup(backup(url))[0].sourceUrl, href)
  })
}
