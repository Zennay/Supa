import test from 'node:test'
import assert from 'node:assert/strict'
import { exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

// All recipe links, parameters and data here are fictional; no networking,
// real authentication tokens, shopper data or actual retailer permissions.
const root = 'https://recipes.example.org/private-recipe-nfkc'
const recipe = url => ({
  title: 'Fictief recept', source: 'url', sourceUrl: url, servings: 2,
  minutes: 15, ingredients: ['200 g pasta'], steps: ['Kook.'],
})
function backup(url) {
  return JSON.stringify({ format: 'supa-private-recipes-backup',
    version: 1, recipes: [recipe(url)] })
}
function exported(url) {
  return exportRecipeBackup({ raw: null, error: null, recipes: [{
    ...recipe(url), id: 'own-synthetic-nfkc-01',
    savedAt: '2026-10-16T20:00:00.000Z',
    ingredients: [{ original: '200 g pasta' }],
  }] })
}
const cases = [
  ['fullwidth ampersand', 'page＆code'],
  ['fullwidth percent that decodes to ampersand', 'page％26code'],
  ['fullwidth equals', 'page＝auth'],
  ['fullwidth hash', 'page＃auth'],
  ['fullwidth question mark', 'page？oauth'],
  ['double decoded fullwidth ampersand', 'page%EF%BC%86code'],
  ['nested percent-encoded fullwidth percent', 'page%EF%BC%8526code'],
  ['fullwidth percent escapes percent', 'page％2526code'],
  ['fullwidth percent creates encoded equal', 'page％3Dtoken'],
  ['multiple unicode escapes', 'page％EF％BC％86code'],
]
for (const [label, key] of cases) {
  test('deny NFKC query boundary and keep restore atomic: ' + label, () => {
    const url = root + '?' + key + '=FAKE_VALUE'
    assert.throws(() => exported(url), /onveilige receptlink|geheime inloggegevens/)
    assert.throws(() => parseRecipeBackup(backup(url)),
      /onveilige receptlink|geheime inloggegevens/)
    let writes = 0
    let minted = 0
    const storage = {
      getItem: () => null,
      setItem: () => { writes++ },
    }
    assert.throws(() => restoreRecipeBackup(
      storage, { raw: null, error: null, recipes: [] }, backup(url),
      () => { minted++; return 'own-wrong-id' }, '2026-10-16T21:00:00.000Z',
    ), /onveilige receptlink|geheime inloggegevens/)
    assert.equal(writes, 0)
    assert.equal(minted, 0)
  })
}
for (const [label, query] of [
  ['ordinary simple query', '?page=2&category=pasta'],
  ['harmless value Unicode delimiter', '?category=pasta＆rijst'],
  ['percent-encoded harmless query value', '?category=pasta%26rijst'],
  ['combining accent key', '?cafe%CC%81=rijst'],
  ['NFKC normalizable harmless fullwidth key', '?ｐａｇｅ=2'],
  ['source anchor stripped', '?category=rijst#private-anchor'],
]) {
  test('preserve benign recipe source link: ' + label, () => {
    const url = root + query
    const expected = url.split('#')[0]
    assert.equal(JSON.parse(exported(url)).recipes[0].sourceUrl, new URL(expected).href)
    assert.equal(parseRecipeBackup(backup(url))[0].sourceUrl, new URL(expected).href)
  })
}
