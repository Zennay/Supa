/**
 * SUPA independent QA 2/2: saved local recipe revisions must not treat
 * delete + recreate as the same logical record incarnation (ABA).
 * Frozen owner #3280 fc06caffe6d2fb211ec9e3db5680b92567b5b47a.
 * Only synthetic Map memory, never real browser/customer storage or network.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  saveRecipeDeviceDraft,
  deleteRecipeDeviceDraft,
  readRecipeDeviceDraft,
} from '../src/features/user-recipes/recipeDraftDeviceStorage.ts'
const ID = '22e34aba-1234-4ac9-82aa-123456789abc'
function memory() {
  const map = new Map()
  return {
    map,
    getItem(key) { return map.get(key) ?? null },
    setItem(key, value) { map.set(key, value) },
    removeItem(key) { map.delete(key) },
  }
}
function draft(title) {
  return {
    source: 'manual', sourceUrl: null,
    title, servings: 2, minutes: 20,
    status: 'needs_review', steps: ['Bereid dit fictieve gerecht'],
    ingredients: [{
      original: '100 g bloem', label: 'Bloem', query: 'bloem',
      amount: 100, unit: 'g', reviewReason: null,
    }],
    warnings: [],
  }
}
function newIncarnation(store) {
  const original = saveRecipeDeviceDraft(store, ID, draft('Oorspronkelijk'), null)
  assert.equal(original.status, 'saved')
  assert.equal(original.record.revision, 1)
  assert.equal(deleteRecipeDeviceDraft(store, ID, 1).status, 'deleted')
  const replacement = saveRecipeDeviceDraft(store, ID, draft('Nieuw los concept'), null)
  assert.equal(replacement.status, 'saved')
  assert.equal(replacement.record.revision, 1,
    'observed ABA: deleting then recreating the same ID resets numeric revision')
  return replacement
}
test('positive: stale numeric revision correctly rejects ordinary contiguous update', () => {
  const store = memory()
  assert.equal(saveRecipeDeviceDraft(store, ID, draft('Origineel'), null).status, 'saved')
  assert.equal(saveRecipeDeviceDraft(store, ID, draft('Versie twee'), 1).status, 'saved')
  assert.equal(saveRecipeDeviceDraft(store, ID, draft('Oud tabblad'), 1).status, 'conflict')
  assert.equal(readRecipeDeviceDraft(store, ID).record.draft.title, 'Versie twee')
})
test('stale tab cannot overwrite different recreated draft with recycled revision 1 [EXPECTED RED]', () => {
  const store = memory()
  newIncarnation(store)
  const before = [...store.map.values()]
  const attempt = saveRecipeDeviceDraft(store, ID, draft('Oud tabblad overschrijft nieuw concept'), 1)
  assert.equal(attempt.status, 'conflict',
    'an earlier incarnation must not masquerade as same optimistic generation')
  assert.deepEqual([...store.map.values()], before)
  assert.equal(readRecipeDeviceDraft(store, ID).record.draft.title, 'Nieuw los concept')
})
test('stale tab cannot delete different recreated draft with recycled revision 1 [EXPECTED RED]', () => {
  const store = memory()
  newIncarnation(store)
  const before = [...store.map.values()]
  assert.equal(deleteRecipeDeviceDraft(store, ID, 1).status, 'conflict',
    'numeric revision reuse must not allow stale delete of unrelated new draft')
  assert.deepEqual([...store.map.values()], before)
  assert.equal(readRecipeDeviceDraft(store, ID).record.draft.title, 'Nieuw los concept')
})
test('positive: ordinary delete with matching revision succeeds without re-creation', () => {
  const store = memory()
  assert.equal(saveRecipeDeviceDraft(store, ID, draft('Temporary'), null).status, 'saved')
  assert.equal(deleteRecipeDeviceDraft(store, ID, 1).status, 'deleted')
  assert.equal(readRecipeDeviceDraft(store, ID).status, 'missing')
})
