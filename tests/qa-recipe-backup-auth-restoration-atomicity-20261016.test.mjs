import test from 'node:test'
import assert from 'node:assert/strict'
import { readRecipeLibrary, saveRecipeLibrary } from '../src/features/recipes/recipeLibrary.ts'
import { exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup } from '../src/features/recipes/recipeBackup.ts'
import { createManualRecipeDraft } from '../src/domain/userRecipeImport.ts'

/**
 * Independent QA: rejecting a credential-bearing portable URL must happen
 * before restore mints an ID or writes anything, including across a device
 * that already has valid private recipes. This checks atomicity (not just
 * parse rejection) after the original #3650 source fix.
 *
 * Entirely fictional local values, no real tokens, DNS, or network.
 */
const base = 'https://recipes.example.org/test-only-pasta'
const savedAt = '2026-10-16T19:00:00.000Z'
const stamp = '2026-10-16T21:00:00.000Z'
function recipe(url) {
  return {
    title: 'Fictieve pasta', source: 'url', sourceUrl: url,
    servings: 2, minutes: 15, ingredients: ['200 g pasta'],
    steps: ['Kook de pasta.'],
  }
}
function backup(url) {
  return JSON.stringify({
    format: 'supa-private-recipes-backup', version: 1,
    recipes: [recipe(url)],
  })
}
function storage() {
  let raw = null
  let writes = 0
  return {
    getItem: () => raw,
    setItem: (_key, value) => { raw = value; writes++ },
    writes: () => writes,
  }
}
function oldState(store) {
  const prior = {
    ...createManualRecipeDraft({
      title: 'Mijn eigen avondeten', ingredients: ['100 g rijst'],
      servings: 2, minutes: 10, steps: ['Kook.'],
    }),
    id: 'own-existing-qa-01', savedAt,
  }
  return saveRecipeLibrary(store, readRecipeLibrary(store), [prior])
}
for (const [description, query] of [
  ['plain SAML response', 'SAMLResponse=FICTIONAL'],
  ['escaped SAML response', 'S%2541MLResponse=FICTIONAL'],
  ['double escaped OAuth code', '%2563ode=FICTIONAL'],
  ['triple escaped OAuth code', '%252563ode=FICTIONAL'],
  ['PKCE verifier alias', 'pkce_verifier=FICTIONAL'],
  ['session cookie alias', 'session_id=FICTIONAL'],
  ['OAuth state alias', 'oauth_state=FICTIONAL'],
  ['malformed encoded key', '%ZZ=FICTIONAL'],
]) {
  test('private backup restore is completely atomic for ' + description, () => {
    const store = storage()
    const existing = oldState(store)
    const before = store.getItem()
    const initialWrites = store.writes()
    let mints = 0
    assert.throws(() => restoreRecipeBackup(
      store, existing, backup(base + '?' + query),
      () => { mints++; return 'own-should-never-mint' }, stamp,
    ), /onveilige receptlink|geheime inloggegevens/)
    assert.equal(mints, 0, 'reject source URL before allocating any new identity')
    assert.equal(store.writes(), initialWrites, 'no partial storage write')
    assert.equal(store.getItem(), before, 'keep prior valid recipes byte-for-byte')
  })
}
test('legitimate non-auth URL and harmless value escapes survive portable transfer', () => {
  const source = base + '?page=2&category=%C3%A9pinards&lang=nl#ignore-me'
  const parsed = parseRecipeBackup(backup(source))
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].sourceUrl, source.split('#')[0])
  const serialized = exportRecipeBackup({
    error: null, raw: null,
    recipes: [{
      ...recipe(source), id: 'own-safe-qa-01', savedAt,
      ingredients: [{ original: '200 g pasta' }],
    }],
  })
  assert.equal(JSON.parse(serialized).recipes[0].sourceUrl, source.split('#')[0])
})
