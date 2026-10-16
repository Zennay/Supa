import test from 'node:test'
import assert from 'node:assert/strict'
import { exportRecipeBackup, parseRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

/**
 * Independent QA of the new #3661 encoded QUERY-KEY delimiter guard.
 * The guard scans raw Unicode keys, then NFKC normalizes them for auth
 * aliases. A key containing a compatibility ampersand/equal/hash/question
 * mark can become a different URL query boundary after NFKC on another
 * device, even though there was no literal ASCII delimiter when checked.
 *
 * No retailer data, real auth, browser fetch, or network: synthetic backup.
 */
const root = 'https://recipes.example.org/fictitious-qa-pasta'
const recipe = url => ({
  title:'Fictitious noodles',source:'url',sourceUrl:url,
  servings:2,minutes:15,ingredients:['200 g pasta'],steps:['Boil.'],
})
function serialized(url) {
  return JSON.stringify({
    format:'supa-private-recipes-backup',version:1,
    recipes:[recipe(url)],
  })
}
function exportOne(url) {
  return exportRecipeBackup({
    error:null,raw:null,
    recipes:[{
      ...recipe(url),id:'own-unicode-qa-case',savedAt:'2026-10-16T20:00:00.000Z',
      ingredients:[{original:'200 g pasta'}],
    }],
  })
}

for (const [label, query] of [
  ['compatibility ampersand creates a separate OAuth code', 'page＆code=FICTIONAL'],
  ['compatibility equals creates a new query assignment', 'page＝code=FICTIONAL'],
  ['compatibility question mark creates an alternative query start', 'page？auth=FICTIONAL'],
  ['compatibility hash creates new fragment semantics', 'page＃auth=FICTIONAL'],
  ['compatibility percent introduces encoded delimiter', 'page％26code=FICTIONAL'],
]) {
  const url = root + '?' + query
  test('portable recipe BACKUP export rejects ' + label, () => {
    assert.throws(() => exportOne(url), /onveilige receptlink|geheime inloggegevens/,
      'NFKC must not turn an allowed URL key into a new query delimiter')
  })
  test('portable recipe BACKUP import rejects ' + label, () => {
    assert.throws(() => parseRecipeBackup(serialized(url)),
      /onveilige receptlink|geheime inloggegevens/,
      'Imported URL must not have changed query meaning after Unicode normalization')
  })
}
for (const [label, query] of [
  ['simple benign query', 'category=pasta&lang=nl'],
  ['combining accent in benign key', 'cafe%CC%81=rijst'],
]) {
  test('benign source URL preserved without adding private claims: ' + label, () => {
    const url = root + '?' + query
    assert.equal(JSON.parse(exportOne(url)).recipes[0].sourceUrl,url)
    assert.equal(parseRecipeBackup(serialized(url))[0].sourceUrl,url)
  })
}
