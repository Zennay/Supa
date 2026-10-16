import test from 'node:test'
import assert from 'node:assert/strict'
import {
  exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup,
} from '../src/features/recipes/recipeBackup.ts'

/**
 * Independent QA2 on the frozen product-core #3670 SHA 7de195d.
 * U+034F (combining grapheme joiner), U+FE0F (variation selector-16),
 * and U+180B (Mongolian free variation selector one) have category Mn,
 * NOT Cc/Cf, but ARE Unicode Default_Ignorable_Code_Point characters.
 * A downstream resolver stripping ignorable marks can reinterpret
 * "co<mark>de" as the credential key "code". Portable backups must
 * not preserve this cross-resolver ambiguity.
 *
 * Completely fictional links and values. No network, retailer traffic,
 * permission modification, customer identifiers or actual OAuth data.
 */
const origin = 'https://recipes.example.org/fictional-pasta'
function entry(url) {
  return {
    title: 'Fictieve pasta', source: 'url', sourceUrl: url,
    servings: 2, minutes: 15, ingredients: ['200 g pasta'],
    steps: ['Kook de pasta.'],
  }
}
function portable(url) {
  return JSON.stringify({
    format: 'supa-private-recipes-backup', version: 1,
    recipes: [entry(url)],
  })
}
function exported(url) {
  return exportRecipeBackup({
    error: null, raw: null, recipes: [{
      ...entry(url), id: 'own-qa-default-ignorable',
      savedAt: '2026-10-16T20:00:00.000Z',
      ingredients: [{ original: '200 g pasta' }],
    }],
  })
}

const deceptiveKeys = [
  ['U+034F combining grapheme joiner', 'co\u034Fde'],
  ['U+FE0F variation selector-16', 'co\uFE0Fde'],
  ['U+180B Mongolian free variation selector', 'co\u180Bde'],
  ['once-escaped U+034F', 'co%CD%8Fde'],
  ['twice-escaped U+034F', 'co%25CD%258Fde'],
]

for (const [label, key] of deceptiveKeys) {
  test('private recipe backup rejects default-ignorable query key: ' + label, () => {
    const url = origin + '?' + key + '=FICTIONAL_NON_CREDENTIAL'
    // Sanity: these marks are not handled by the product-core Cc/Cf regex.
    const decodedKey = new URL(url).searchParams.keys().next().value
    assert.match(decodedKey, /[\p{Default_Ignorable_Code_Point}%]/u)
    assert.throws(() => exported(url),
      /onveilige receptlink|geheime inloggegevens/)
    assert.throws(() => parseRecipeBackup(portable(url)),
      /onveilige receptlink|geheime inloggegevens/)

    let allocatedIds = 0
    let storageWrites = 0
    const storage = {
      getItem: () => null,
      setItem: () => { storageWrites += 1 },
    }
    assert.throws(() => restoreRecipeBackup(
      storage, { error: null, raw: null, recipes: [] }, portable(url),
      () => { allocatedIds += 1; return 'own-must-not-save' },
      '2026-10-16T21:00:00.000Z',
    ), /onveilige receptlink|geheime inloggegevens/)
    assert.equal(allocatedIds, 0, 'rejected backup must never mint IDs')
    assert.equal(storageWrites, 0, 'rejected backup must never persist')
  })
}

for (const [label, query] of [
  ['normal percent-encoded category value', '?category=rijst%26pasta'],
  ['ignorable mark in harmless VALUE stays allowed', '?category=pasta\u034Fgroente'],
  ['combining accent in harmless key stays allowed', '?cafe%CC%81=rijst'],
  ['ordinary Unicode value stays allowed', '?ingredient=cr%C3%A8me'],
]) {
  test('private recipe backup preserves harmless query: ' + label, () => {
    const url = origin + query
    const expected = new URL(url).href
    assert.equal(JSON.parse(exported(url)).recipes[0].sourceUrl, expected)
    assert.equal(parseRecipeBackup(portable(url))[0].sourceUrl, expected)
  })
}
