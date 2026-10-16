import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RECIPE_FAVORITES_KEY, readRecipeFavorites,
  toggleRecipeFavorite, removeRecipeFavorite,
} from '../src/features/recipes/recipeFavorites.ts'

// Independent QA2 of owner Figma recipe cross-tab state. Pure local-memory
// storage only; no browser account, external URLs, retailer/savings evidence.
function sharedState(ids = []) {
  return { raw: JSON.stringify({ version: 1, ids }), writes: 0 }
}
function storage(shared, onRead = null) {
  let reads = 0
  return {
    getItem(key) {
      assert.equal(key, RECIPE_FAVORITES_KEY)
      reads++
      onRead?.(shared, reads)
      return shared.raw
    },
    setItem(key, value) {
      assert.equal(key, RECIPE_FAVORITES_KEY)
      shared.writes++
      shared.raw = value
    },
  }
}

test('two browser tabs can alternate valid favorite edits without losing either selection', () => {
  const shared = sharedState()
  const first = storage(shared)
  const second = storage(shared)
  assert.deepEqual(toggleRecipeFavorite(first, 'supa-soep').ids, ['supa-soep'])
  assert.deepEqual(toggleRecipeFavorite(second, 'supa-curry').ids, ['supa-soep', 'supa-curry'])
  assert.deepEqual(toggleRecipeFavorite(first, 'own-1').ids, ['supa-soep', 'supa-curry', 'own-1'])
  assert.deepEqual(toggleRecipeFavorite(second, 'supa-soep').ids, ['supa-curry', 'own-1'])
  assert.deepEqual(readRecipeFavorites(first).ids, ['supa-curry', 'own-1'])
  assert.equal(shared.writes, 4)
})

test('a concurrent tab update between favorite read and write fails closed', () => {
  const shared = sharedState(['supa-soep'])
  const first = storage(shared, (state, reads) => {
    if (reads === 2) state.raw = JSON.stringify({
      version: 1, ids: ['supa-soep', 'supa-curry'],
    })
  })
  assert.throws(() => toggleRecipeFavorite(first, 'supa-risotto'), /ander tabblad/)
  assert.equal(shared.writes, 0, 'stale tab must not overwrite changed storage')
  assert.deepEqual(JSON.parse(shared.raw).ids, ['supa-soep', 'supa-curry'])
})

test('deleting a recipe favorite cannot remove another tab’s newer selection', () => {
  const shared = sharedState(['own-1', 'supa-soep'])
  const deletingTab = storage(shared, (state, reads) => {
    if (reads === 2) state.raw = JSON.stringify({
      version: 1, ids: ['own-1', 'supa-soep', 'supa-curry'],
    })
  })
  assert.throws(() => removeRecipeFavorite(deletingTab, 'own-1'), /ander tabblad/)
  assert.equal(shared.writes, 0)
  assert.deepEqual(JSON.parse(shared.raw).ids,
    ['own-1', 'supa-soep', 'supa-curry'])
})

test('removing an absent ID makes no write and cannot clear newly added favorites', () => {
  const shared = sharedState(['supa-curry'])
  const tab = storage(shared)
  assert.deepEqual(removeRecipeFavorite(tab, 'own-no-longer-present').ids, ['supa-curry'])
  assert.equal(shared.writes, 0)
  assert.deepEqual(readRecipeFavorites(tab).ids, ['supa-curry'])
})
