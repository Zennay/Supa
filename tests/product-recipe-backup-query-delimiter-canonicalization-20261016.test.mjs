import test from 'node:test'
import assert from 'node:assert/strict'
import { exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

// All URLs, credentials and recipes are fictional local data, no DNS, HTTP or
// external accounts. Validate both portable backup directions and atomically
// reject source URLs that change query meaning after another decode pass.
const root = 'https://recipes.example.org/fictional-rice'
const stamp = '2026-10-16T21:00:00.000Z'
function input(url) {
  return JSON.stringify({
    format: 'supa-private-recipes-backup', version: 1,
    recipes: [{
      title: 'Fictieve rijst', source: 'url', sourceUrl: url, servings: 2,
      minutes: 10, ingredients: ['100 g rijst'], steps: ['Kook.'],
    }],
  })
}
function exported(url) {
  return exportRecipeBackup({
    raw: null, error: null,
    recipes: [{
      id: 'own-synthetic-qry', savedAt: stamp,
      title: 'Fictieve rijst', source: 'url', sourceUrl: url, servings: 2,
      minutes: 10, ingredients: [{ original: '100 g rijst' }], steps: ['Kook.'],
    }],
  })
}
for (const [label, key] of [
  ['encoded ampersand splits auth parameter', '%26code'],
  ['double encoded ampersand splits auth parameter', '%2526code'],
  ['triple encoded ampersand splits auth parameter', '%252526code'],
  ['encoded equals converts key to OAuth parameter', 'ref%3Dcode'],
  ['double encoded equals converts key to OAuth parameter', 'ref%253Dcode'],
  ['encoded question mark becomes a second query', '%3Ftoken'],
  ['encoded hash becomes a URL fragment', 'ref%23auth'],
  ['encoded line feed changes query semantics', 'ref%0Acode'],
  ['nested control escape is dangerous', 'ref%250Dcode'],
]) {
  test('portable recipe backup fails closed on ' + label, () => {
    const url = root + '?' + key + '=FICTIONAL'
    assert.throws(() => exported(url), /onveilige receptlink|geheime inloggegevens/)
    assert.throws(() => parseRecipeBackup(input(url)), /onveilige receptlink|geheime inloggegevens/)

    // A refused import must not mint IDs or modify existing local storage.
    const storage = { getItem() { return null }, setItem() { assert.fail('write denied') } }
    let mints = 0
    assert.throws(() => restoreRecipeBackup(
      storage, { error: null, raw: null, recipes: [] }, input(url),
      () => { mints++; return 'own-should-not-mint' }, stamp,
    ), /onveilige receptlink|geheime inloggegevens/)
    assert.equal(mints, 0)
  })
}
for (const [label, params] of [
  ['ordinary query', '?page=2&category=pasta'],
  ['percent encoded delimiter within VALUE is harmless', '?category=a%26b'],
  ['percent encoded equals within VALUE is harmless', '?category=a%3Db'],
  ['percent encoded hash within VALUE is harmless', '?category=abc%23def'],
  ['encoded letter in innocuous KEY is harmless', '?%63ategory=rijst'],
  ['second encoded layer in innocent KEY is harmless', '?%2563ategory=rijst'],
]) {
  test('portable recipe backup preserves ' + label, () => {
    const url = root + params
    assert.equal(JSON.parse(exported(url)).recipes[0].sourceUrl, url)
    assert.equal(parseRecipeBackup(input(url))[0].sourceUrl, url)
  })
}
