import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualRecipeDraft } from '../src/domain/userRecipeImport.ts'
import {
  readRecipeLibrary, saveRecipeLibrary, updateSavedRecipe, deleteSavedRecipe, duplicateSavedRecipe,
} from '../src/features/recipes/recipeLibrary.ts'

function memory() {
  const entries = new Map()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  }
}

function draft(title, ingredient = '200 g rijst') {
  return createManualRecipeDraft({
    title, servings: 2, minutes: 20,
    ingredients: [ingredient], steps: ['Bereid en serveer.'],
  })
}

function seeded() {
  const storage = memory()
  const first = { ...draft('Rijst'), id: 'own-1', savedAt: '2026-10-16T08:00:00.000Z' }
  const second = { ...draft('Pasta'), id: 'own-2', savedAt: '2026-10-16T08:01:00.000Z' }
  const state = saveRecipeLibrary(storage, readRecipeLibrary(storage), [first, second])
  return { storage, state }
}

test('editing a private recipe keeps its ID, creation timestamp, order and other recipes', () => {
  const { storage, state } = seeded()
  const revised = updateSavedRecipe(storage, state, 'own-1', draft('Rijst met melk', '0,5 l melk'))
  assert.deepEqual(revised.recipes.map(recipe => recipe.id), ['own-1', 'own-2'])
  assert.equal(revised.recipes[0].savedAt, state.recipes[0].savedAt)
  assert.equal(revised.recipes[0].title, 'Rijst met melk')
  assert.deepEqual(revised.recipes[0].ingredients.map(item => [item.amount, item.unit]), [[500, 'ml']])
  assert.deepEqual(revised.recipes[1], state.recipes[1])
  assert.equal(readRecipeLibrary(storage).recipes[0].title, 'Rijst met melk')
})

test('unreviewed source units remain unpriced and explicitly review-required after editing', () => {
  const { storage, state } = seeded()
  const updated = updateSavedRecipe(storage, state, 'own-1', draft('Cups zonder fictieve grammen', '1 cup bloem'))
  assert.equal(updated.recipes[0].ingredients[0].amount, null)
  assert.equal(updated.recipes[0].ingredients[0].unit, null)
  assert.ok(updated.recipes[0].warnings.some(warning => warning.includes('metrische')))
  assert.equal(Object.hasOwn(updated.recipes[0], 'estimatedCost'), false)
})

test('explicit delete removes only the chosen private recipe and persists', () => {
  const { storage, state } = seeded()
  const updated = deleteSavedRecipe(storage, state, 'own-1')
  assert.deepEqual(updated.recipes.map(recipe => recipe.id), ['own-2'])
  assert.deepEqual(readRecipeLibrary(storage).recipes.map(recipe => recipe.id), ['own-2'])
})

test('no ID spoofing: editing and deleting unknown/demo recipes never mutate storage', () => {
  const { storage, state } = seeded()
  const previous = state.raw
  for (const id of ['supa-thai', 'own-missing', '']) {
    assert.throws(() => updateSavedRecipe(storage, state, id, draft('Hacked')), /bestaat niet/)
    assert.throws(() => deleteSavedRecipe(storage, state, id), /bestaat niet/)
  }
  assert.equal(readRecipeLibrary(storage).raw, previous)
})

test('stale tabs cannot overwrite a newer edit or resurrect a deleted recipe', () => {
  const { storage, state } = seeded()
  const next = updateSavedRecipe(storage, state, 'own-1', draft('Actueel'))
  assert.throws(() => deleteSavedRecipe(storage, state, 'own-1'), /ander tabblad/)
  assert.throws(() => updateSavedRecipe(storage, state, 'own-1', draft('Verouderd')), /ander tabblad/)
  assert.equal(readRecipeLibrary(storage).recipes[0].title, 'Actueel')
  const afterDelete = deleteSavedRecipe(storage, next, 'own-1')
  assert.throws(() => updateSavedRecipe(storage, afterDelete, 'own-1', draft('Herleef')), /bestaat niet/)
  assert.deepEqual(readRecipeLibrary(storage).recipes.map(recipe => recipe.id), ['own-2'])
})

test('invalid edited ingredients cannot erase an existing recipe', () => {
  const { storage, state } = seeded()
  assert.throws(() => updateSavedRecipe(storage, state, 'own-1', {
    ...draft('Onvolledig'), steps: [],
  }), /bereidingsstap/)
  assert.equal(readRecipeLibrary(storage).raw, state.raw)
})

test('duplicate creates a fresh independent own recipe with the same reviewed quantities', () => {
  const { storage, state } = seeded()
  const next = duplicateSavedRecipe(storage, state, 'own-1', 'own-new-uuid-123', '2026-10-16T20:00:00Z')
  assert.deepEqual(next.recipes.map(recipe => recipe.id), ['own-new-uuid-123', 'own-1', 'own-2'])
  assert.equal(next.recipes[0].title, 'Kopie van Rijst')
  assert.equal(next.recipes[0].savedAt, '2026-10-16T20:00:00Z')
  assert.equal(next.recipes[0].ingredients[0].amount, 200)
  assert.equal(next.recipes[0].ingredients[0].unit, 'g')
  assert.equal(Object.hasOwn(next.recipes[0], 'estimatedCost'), false)
  const edited = updateSavedRecipe(storage, next, 'own-new-uuid-123', draft('Mijn bewerkte kopie', '500 g rijst'))
  assert.equal(edited.recipes[0].ingredients[0].amount, 500)
  assert.equal(edited.recipes[1].ingredients[0].amount, 200)
  assert.equal(edited.recipes[1].title, 'Rijst')
})

test('duplicate rejects unknown source, ID collisions and stale tab revisions', () => {
  const { storage, state } = seeded()
  assert.throws(() => duplicateSavedRecipe(storage, state, 'supa-thai', 'own-other', '2026-10-16T20:00:00Z'), /bestaat niet/)
  assert.throws(() => duplicateSavedRecipe(storage, state, 'own-1', 'own-2', '2026-10-16T20:00:00Z'), /recept-ID/)
  assert.throws(() => duplicateSavedRecipe(storage, state, 'own-1', '../escape', '2026-10-16T20:00:00Z'), /recept-ID/)
  assert.throws(() => duplicateSavedRecipe(storage, state, 'own-1', 'own-new-test', 'not-a-date'), /bewaartijd/)
  const next = deleteSavedRecipe(storage, state, 'own-2')
  assert.throws(() => duplicateSavedRecipe(storage, state, 'own-1', 'own-new-test', '2026-10-16T20:00:00Z'), /ander tabblad/)
  assert.deepEqual(readRecipeLibrary(storage).recipes, next.recipes)
})
