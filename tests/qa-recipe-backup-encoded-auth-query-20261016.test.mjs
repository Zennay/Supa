import test from 'node:test'
import assert from 'node:assert/strict'
import { exportRecipeBackup, parseRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

/**
 * Independent QA on frozen product-core #3615, private portable recipe backup.
 * URLSearchParams decodes query keys one layer. Encoding one more layer can
 * hide a credential key from naive denylist checks, then a portable JSON file
 * carries a credential-bearing source URL onto another device.
 *
 * All addresses, query values and recipes are invented, local/in-memory:
 * absolutely no real tokens, external requests, or customer data.
 */
const base = 'https://recipes.example.org/fictional-pasta'
const safeRecipe = {
  title: 'Fictief recept', source: 'url', sourceUrl: base + '?page=2',
  servings: 2, minutes: 15, ingredients: ['200 g pasta'],
  steps: ['Kook de pasta.'],
}
function backedUp(url) {
  return JSON.stringify({
    format: 'supa-private-recipes-backup', version: 1,
    recipes: [{ ...safeRecipe, sourceUrl: url }],
  })
}
function exported(url) {
  return exportRecipeBackup({
    error: null, raw: null,
    recipes: [{
      ...safeRecipe, sourceUrl: url, id: 'own-fake-qa-recipe',
      savedAt: '2026-10-16T20:00:00.000Z',
      ingredients: [{ original: '200 g pasta' }],
    }],
  })
}

// Both paths must reject before private JSON leaves a device or is restored.
// Keys are encoded, not credential *values*: common intermediate gateways
// and URL libraries may decode more than one layer.
const dangerousKeys = [
  ['double-encoded OAuth code', '%2563ode'],
  ['triple-encoded OAuth code', '%252563ode'],
  ['encoded SAMLResponse letter', 'SAML%2552esponse'],
  ['direct PKCE verifier', 'pkce_verifier'],
]
for (const [description, key] of dangerousKeys) {
  const sourceUrl = base + '?' + key + '=FICTIONAL_AUTH_VALUE'
  test('private backup export must reject ' + description + ' URL query key', () => {
    assert.throws(() => exported(sourceUrl), /geheime inloggegevens/,
      'Never persist authentication material in a portable backup')
  })
  test('private backup import must reject ' + description + ' URL query key', () => {
    assert.throws(() => parseRecipeBackup(backedUp(sourceUrl)),
      /geheime inloggegevens/,
      'Never restore a credential-bearing URL into the private recipe library')
  })
}
test('ordinary non-auth query parameters survive private import/export', () => {
  const sourceUrl = base + '?page=2&category=pasta&lang=nl'
  assert.equal(JSON.parse(exported(sourceUrl)).recipes[0].sourceUrl, sourceUrl)
  assert.equal(parseRecipeBackup(backedUp(sourceUrl))[0].sourceUrl, sourceUrl)
})
test('unencoded OAuth authorization code is still rejected as a control', () => {
  const sourceUrl = base + '?code=FICTIONAL_AUTH_VALUE'
  assert.throws(() => exported(sourceUrl), /geheime inloggegevens/)
  assert.throws(() => parseRecipeBackup(backedUp(sourceUrl)), /geheime inloggegevens/)
})
