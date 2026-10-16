import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualRecipeDraft } from '../src/domain/userRecipeImport.ts'
import {
  readRecipeLibrary, saveRecipeLibrary, updateSavedRecipe,
  duplicateSavedRecipe, deleteSavedRecipe, RECIPE_LIBRARY_KEY,
} from '../src/features/recipes/recipeLibrary.ts'

// Independent P0 acceptance for the live Figma recipe flows on the frozen
// product-core branch: local-only, invented recipes and example.test URLs.
function memory() {
  const entries = new Map()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  }
}
function draft(title, ingredient = '250 g wortels') {
  return createManualRecipeDraft({
    title, servings: 2, minutes: 25,
    ingredients: [ingredient], steps: ['Was de wortels.', 'Kook alles gaar.'],
  })
}
function imported(title = 'Zelf gevonden soep') {
  return {
    ...draft(title), source: 'url',
    sourceUrl: 'https://recipes.example.test/soep?origineel=1',
  }
}
function seeded() {
  const storage = memory()
  const recipe = {
    ...imported(), id: 'own-imported-1',
    savedAt: '2026-10-16T08:00:00.000Z',
  }
  const state = saveRecipeLibrary(storage, readRecipeLibrary(storage), [recipe])
  return { storage, state }
}

test('review/edit of an imported recipe retains its original HTTPS attribution, ID, time, and steps', () => {
  const { storage, state } = seeded()
  const newDraft = { ...imported('Mijn bewerkte soep'),
    ingredients: draft('Soep', '1 cup wortels').ingredients }
  const updated = updateSavedRecipe(storage, state, 'own-imported-1', newDraft)
  const fromDisk = readRecipeLibrary(storage)
  assert.equal(updated.recipes.length, 1)
  assert.deepEqual(updated.recipes, fromDisk.recipes)
  assert.equal(fromDisk.recipes[0].source, 'url')
  assert.equal(fromDisk.recipes[0].sourceUrl, 'https://recipes.example.test/soep?origineel=1')
  assert.equal(fromDisk.recipes[0].id, 'own-imported-1')
  assert.equal(fromDisk.recipes[0].savedAt, '2026-10-16T08:00:00.000Z')
  assert.deepEqual(fromDisk.recipes[0].steps, ['Was de wortels.', 'Kook alles gaar.'])
  assert.equal(fromDisk.recipes[0].ingredients[0].amount, null)
  assert.ok(fromDisk.recipes[0].warnings.some(w => w.includes('metrische')))
  assert.equal(Object.hasOwn(fromDisk.recipes[0], 'currentPriceCents'), false)
})

test('duplicate of imported recipe preserves read-only source evidence without changing original', () => {
  const { storage, state } = seeded()
  const duplicate = duplicateSavedRecipe(
    storage, state, 'own-imported-1', 'own-imported-copy-2',
    '2026-10-16T19:00:00.000Z',
  )
  assert.deepEqual(duplicate.recipes.map(r => r.id),
    ['own-imported-copy-2', 'own-imported-1'])
  assert.equal(duplicate.recipes[0].source, 'url')
  assert.equal(duplicate.recipes[0].sourceUrl, state.recipes[0].sourceUrl)
  assert.equal(duplicate.recipes[0].title, 'Kopie van Zelf gevonden soep')
  assert.equal(duplicate.recipes[0].ingredients[0].amount, 250)
  assert.deepEqual(duplicate.recipes[1], state.recipes[0])
  const afterDelete = deleteSavedRecipe(storage, duplicate, 'own-imported-copy-2')
  assert.deepEqual(afterDelete.recipes, state.recipes)
  assert.deepEqual(readRecipeLibrary(storage).recipes, state.recipes)
})

test('invalid imported link scheme or credentials cannot replace a valid stored recipe', () => {
  const { storage, state } = seeded()
  for (const bad of [
    'http://recipes.example.test/soep',
    'https://me:secret@recipes.example.test/soep',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => updateSavedRecipe(storage, state, 'own-imported-1', {
      ...imported('Aanval'), sourceUrl: bad,
    }), /Controleer je recept/)
    assert.equal(storage.getItem(RECIPE_LIBRARY_KEY), state.raw)
  }
  assert.equal(readRecipeLibrary(storage).recipes[0].title, 'Zelf gevonden soep')
})

test('a corrupt saved URL does not get erased or overwritten by a concurrent edit attempt', () => {
  const { storage, state } = seeded()
  const corrupt = JSON.parse(state.raw)
  corrupt.recipes[0].sourceUrl = 'file:///etc/passwd'
  const raw = JSON.stringify(corrupt)
  storage.setItem(RECIPE_LIBRARY_KEY, raw)
  const failed = readRecipeLibrary(storage)
  assert.equal(failed.error !== null, true)
  assert.deepEqual(failed.recipes, [])
  assert.throws(() => saveRecipeLibrary(storage, failed, []))
  assert.equal(storage.getItem(RECIPE_LIBRARY_KEY), raw)
  assert.throws(() => updateSavedRecipe(storage, state, 'own-imported-1', imported('Oud')), /ander tabblad/)
  assert.equal(storage.getItem(RECIPE_LIBRARY_KEY), raw)
})
