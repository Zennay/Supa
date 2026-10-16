import test from 'node:test'
import assert from 'node:assert/strict'
import {
  exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup,
} from '../src/features/recipes/recipeBackup.ts'

// Own product-core coverage beyond independent QA #3671. Entirely synthetic
// private recipe URLs, never credentials/retailer data/network traffic.
const base = 'https://recipes.example.org/fictional'
const entry = sourceUrl => ({
  title: 'Pasta', source: 'url', sourceUrl, servings: 2, minutes: 20,
  ingredients: ['200 g pasta'], steps: ['Kook de pasta.'],
})
const backup = sourceUrl => JSON.stringify({
  format: 'supa-private-recipes-backup', version: 1,
  recipes: [entry(sourceUrl)],
})
const exported = sourceUrl => exportRecipeBackup({
  raw: null, error: null, recipes: [{
    ...entry(sourceUrl), id: 'own-fake-source-1234',
    savedAt: '2026-10-16T21:00:00.000Z',
    ingredients: [{ original: '200 g pasta' }],
  }],
})

for (const [name, queryKey] of [
  ['supplementary-plane variation selector', 'co\u{E0100}de'],
  ['Khmer inherent vowel', 'co\u17B4de'],
  ['Hangul choseong filler', 'co\u115Fde'],
  ['Hangul jungseong filler', 'co\u1160de'],
  ['Mongolian free variation selector two', 'co\u180Cde'],
  ['Mongolian free variation selector three', 'co\u180Dde'],
  ['escaped supplementary variation selector', 'co%F3%A0%84%80de'],
  ['double percent-escaped variation selector', 'co%25F3%25A0%2584%2580de'],
]) {
  test('reviewed private backup refuses default-ignorable key: ' + name, () => {
    const url = base + '?' + queryKey + '=FICTIONAL'
    assert.throws(() => exported(url), /onveilige receptlink|geheime inloggegevens/)
    assert.throws(() => parseRecipeBackup(backup(url)),
      /onveilige receptlink|geheime inloggegevens/)
    let ids = 0
    let writes = 0
    assert.throws(() => restoreRecipeBackup(
      { getItem: () => null, setItem: () => { writes++ } },
      { error: null, raw: null, recipes: [] },
      backup(url), () => { ids++; return 'own-must-refuse' },
      '2026-10-16T21:00:00.000Z',
    ), /onveilige receptlink|geheime inloggegevens/)
    assert.equal(ids, 0)
    assert.equal(writes, 0)
  })
}

for (const [name, query] of [
  ['normal acute combining accent in key', '?cafe%CC%81=rijst'],
  ['Vietnamese combining grave accent in key', '?a%CC%80=rijst'],
  ['recipe value with variation selector', '?recipe=pasta\uFE0Frijst'],
  ['recipe value with astral variation selector', '?recipe=pasta\u{E0100}rijst'],
  ['UTF-8 value plus harmless encoded delimiter', '?recipe=cr%C3%A8me%26pasta'],
]) {
  test('reviewed private backup preserves harmless query: ' + name, () => {
    const url = base + query
    const expected = new URL(url).href
    assert.equal(JSON.parse(exported(url)).recipes[0].sourceUrl, expected)
    assert.equal(parseRecipeBackup(backup(url))[0].sourceUrl, expected)
  })
}
