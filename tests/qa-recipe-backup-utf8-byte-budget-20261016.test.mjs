import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualRecipeDraft } from '../src/domain/userRecipeImport.ts'
import { readRecipeLibrary, saveRecipeLibrary } from '../src/features/recipes/recipeLibrary.ts'
import { parseRecipeBackup, exportRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

// Independent QA only on frozen product-core portable backup. No actual user
// data, external URL, retailer source, checkout evidence or public upload.
const LIMIT = 2_000_000
const textHeavy = 'é'.repeat(5_000) // 5,000 JS code units, 10,000 UTF-8 bytes
function memory() {
  let raw = null
  return { getItem: () => raw, setItem: (_key, data) => { raw = data } }
}
function heavyBackupRecipe(number) {
  return {
    title: 'Fictief privé-recept ' + number,
    source: 'manual', sourceUrl: null,
    servings: 2, minutes: 25,
    ingredients: ['200 g rijst'],
    steps: Array.from({length: 100}, () => textHeavy),
  }
}
function portableText() {
  const serialized = JSON.stringify({
    format: 'supa-private-recipes-backup', version: 1,
    recipes: [heavyBackupRecipe(1), heavyBackupRecipe(2), heavyBackupRecipe(3)],
  })
  assert.ok(serialized.length < LIMIT,
    'intentional: within character count yet over actual byte limit')
  assert.ok(Buffer.byteLength(serialized, 'utf8') > LIMIT,
    'intentional: legal JSON is larger than the allowed UTF-8 file size')
  return serialized
}

test('ordinary Dutch Unicode backup remains portable and preserves the source text', () => {
  const doc = {
    format: 'supa-private-recipes-backup', version: 1,
    recipes: [{
      title: 'Citroën met crème fraîche', source: 'manual', sourceUrl: null,
      servings: 2, minutes: 10,
      ingredients: ['200 g crème fraîche'],
      steps: ['Roer de crème fraîche erdoor.'],
    }],
  }
  const raw = JSON.stringify(doc)
  const parsed = parseRecipeBackup(raw)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].title, doc.recipes[0].title)
  assert.equal(parsed[0].ingredients[0].original, doc.recipes[0].ingredients[0])
  assert.equal(parsed[0].status, 'needs_review')
  assert.ok(Buffer.byteLength(raw, 'utf8') < LIMIT)
})

test('a valid but UTF-8-overlimit portable JSON file must be refused before parsing drafts', () => {
  const raw = portableText()
  assert.throws(() => parseRecipeBackup(raw),
    /Back-upbestand is te groot of ongeldig/,
    'MAX_BYTES must be checked against actual UTF-8 bytes, not JS characters')
})

test('an export larger than the stated byte budget must never mint an unimportable backup', () => {
  const storage = memory()
  const state = saveRecipeLibrary(storage, readRecipeLibrary(storage),
    [1, 2, 3].map(number => ({
      ...createManualRecipeDraft({
        title: 'Fictief privé-recept ' + number, servings: 2, minutes: 25,
        ingredients: ['200 g rijst'],
        steps: Array.from({length:100}, () => textHeavy),
      }),
      id: 'own-utf8-test-' + number,
      savedAt: '2026-10-16T20:00:00.000Z',
    })))
  assert.equal(state.error, null)
  assert.ok(state.raw.length < LIMIT, 'realistic persisted private collection')
  assert.ok(Buffer.byteLength(state.raw, 'utf8') > LIMIT)
  assert.throws(() => exportRecipeBackup(state), /te groot om te exporteren/,
    'export must refuse UTF-8 overbudget before producing an un-restorable file')
})
