import test from 'node:test'
import assert from 'node:assert/strict'
import { exportRecipeBackup, parseRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

// Synthetic offline private recipes and fake auth strings only; no network.
const base = 'https://recipes.example.org/fake-private-recipe'
function backup(url) {
  return JSON.stringify({
    format: 'supa-private-recipes-backup', version: 1,
    recipes: [{
      title: 'Fictieve maaltijd', source: 'url', sourceUrl: url,
      servings: 2, minutes: 20, ingredients: ['100 g rijst'],
      steps: ['Kook rijst.'],
    }],
  })
}
function exportOne(url) {
  return exportRecipeBackup({
    error: null, raw: null,
    recipes: [{
      id: 'own-qa-extra-001', savedAt: '2026-10-16T20:00:00Z',
      title: 'Fictieve maaltijd', source: 'url', sourceUrl: url,
      servings: 2, minutes: 20, ingredients: [{ original: '100 g rijst' }],
      steps: ['Kook rijst.'],
    }],
  })
}
const deeplyEscaped = Array.from({ length: 11 }).reduce(
  (key) => encodeURIComponent(key), '%63ode',
)
for (const [label, key] of [
  ['11 nested encoded OAuth name', deeplyEscaped],
  ['bad percent escape', '%ZZ'],
  ['raw incomplete escape', '%'],
  ['fullwidth Unicode code name', 'ｃｏｄｅ'],
  ['API key separator spelling', 'api_key'],
  ['code verifier alias', 'code_verifier'],
  ['PKCE verifier alias', 'pkce-verifier'],
  ['OAuth underscore code', 'oauth_code'],
]) {
  test('private recipe backup refuses suspicious query key: ' + label, () => {
    const url = base + '?' + key + '=FICTIONAL_NONFUNCTIONAL_AUTH'
    assert.throws(() => parseRecipeBackup(backup(url)),
      /onveilige receptlink|geheime inloggegevens/)
    assert.throws(() => exportOne(url),
      /onveilige receptlink|geheime inloggegevens/)
  })
}
for (const [label, suffix] of [
  ['plain category', '?page=2&category=pasta&lang=nl'],
  ['URLSearchParams encoded ordinary category', '?%63ategory=rice'],
  ['nested encoded ordinary category', '?%2563ategory=rice'],
  ['percent escape inside value only', '?category=5%25-korting'],
]) {
  test('non-authenticated recipe query remains exportable: ' + label, () => {
    const url = base + suffix
    assert.equal(JSON.parse(exportOne(url)).recipes[0].sourceUrl, url)
    assert.equal(parseRecipeBackup(backup(url))[0].sourceUrl, url)
  })
}
