/**
 * Product P1 #3295: no recycled revision-1 authority after delete/recreate.
 * Synthetic Map-only draft storage, zero browser/network/user records.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  saveRecipeDeviceDraft, deleteRecipeDeviceDraft, readRecipeDeviceDraft,
} from '../src/features/user-recipes/recipeDraftDeviceStorage.ts'
import { restoreLocalRecipeReviewDraft } from '../src/features/user-recipes/recipeDraftFlow.ts'

const id = '22e34aba-1234-4ac9-82aa-123456789abc'
function storage() {
  const map = new Map()
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  }
}
function draft(title) {
  return {
    source: 'manual', sourceUrl: 'https://example.org/fictional?token=NEVER_STORE',
    title, servings: 2, minutes: 10,
    steps: ['Kook de rijst'], warnings: [],
    ingredients: [{
      original: '200 g rijst', label: 'Rijst', query: 'rijst',
      amount: 200, unit: 'g', reviewReason: null,
    }],
    status: 'needs_review',
  }
}
function recreate(store) {
  const first = saveRecipeDeviceDraft(store, id, draft('Oud'), null)
  assert.equal(first.status, 'saved')
  assert.equal(first.record.revision, 1)
  assert.equal(deleteRecipeDeviceDraft(store, id, 1).status, 'deleted')
  assert.equal(readRecipeDeviceDraft(store, id).status, 'missing')
  const second = saveRecipeDeviceDraft(store, id, draft('Nieuw'), null)
  assert.equal(second.status, 'saved')
  assert.equal(second.record.revision, 1, 'public revision semantics retained')
  assert.equal(second.record.reusedIdentity, true)
  assert.match(second.record.incarnation, /^[0-9a-f-]{36}$/)
  return second
}
test('deleting a draft leaves only a private tombstone, no old recipe details', () => {
  const store = storage()
  saveRecipeDeviceDraft(store, id, draft('SUPER PRIVATE RECIPE'), null)
  assert.equal(deleteRecipeDeviceDraft(store, id, 1).status, 'deleted')
  assert.equal(readRecipeDeviceDraft(store, id).status, 'missing')
  assert.equal(store.map.size, 1, 'opaque tombstone is intentionally retained')
  for (const serialized of store.map.values()) {
    assert.doesNotMatch(serialized, /SUPER PRIVATE RECIPE|NEVER_STORE|ingredients|steps/)
    assert.match(serialized, /supa-recipe-device-tombstone/)
  }
})
for (const action of ['update', 'delete']) {
  test('old revision 1 must not ' + action + ' a newly recreated draft', () => {
    const store = storage()
    const newer = recreate(store)
    const snapshot = [...store.map.values()]
    const outcome = action === 'update'
      ? saveRecipeDeviceDraft(store, id, draft('Stale tab'), 1)
      : deleteRecipeDeviceDraft(store, id, 1)
    assert.equal(outcome.status, 'conflict')
    assert.deepEqual([...store.map.values()], snapshot)
    assert.equal(readRecipeDeviceDraft(store, id).record.draft.title, 'Nieuw')
    assert.equal(readRecipeDeviceDraft(store, id).record.incarnation, newer.record.incarnation)
  })
}
test('new incarnation token permits legitimate update and delete, stale token refused', () => {
  const store = storage()
  const created = recreate(store)
  const token = created.record.incarnation
  assert.equal(saveRecipeDeviceDraft(store, id, draft('Nieuw gewijzigd'), 1, token).status, 'saved')
  assert.equal(saveRecipeDeviceDraft(store, id, draft('Oud gewijzigd'), 2, 'invalid-token').status, 'conflict')
  assert.equal(deleteRecipeDeviceDraft(store, id, 2, 'invalid-token').status, 'conflict')
  assert.equal(readRecipeDeviceDraft(store, id).record.revision, 2)
  assert.equal(deleteRecipeDeviceDraft(store, id, 2, token).status, 'deleted')
  assert.equal(readRecipeDeviceDraft(store, id).status, 'missing')
})
test('recovery surfaces incarnation only for recycled IDs, never authorization or prices', () => {
  const store = storage()
  const first = saveRecipeDeviceDraft(store, id, draft('Oud'), null)
  assert.equal(first.status, 'saved')
  assert.equal('incarnation' in restoreLocalRecipeReviewDraft(store, id), false)
  deleteRecipeDeviceDraft(store, id, 1)
  const next = saveRecipeDeviceDraft(store, id, draft('Nieuw'), null)
  const recovered = restoreLocalRecipeReviewDraft(store, id)
  assert.equal(recovered.status, 'found')
  assert.equal(recovered.incarnation, next.record.incarnation)
  assert.equal(recovered.draft.sourceUrl, null)
  assert.equal(recovered.draft.status, 'needs_review')
})
test('tampered marker cannot be mistaken for an empty available slot', () => {
  const store = storage()
  const key = 'supa:recipe:device-draft:v1:' + id
  store.setItem(key, '{"format":"supa-recipe-device-tombstone","version":1,"nonce":"bad"}')
  assert.equal(readRecipeDeviceDraft(store, id).status, 'protected')
  assert.equal(saveRecipeDeviceDraft(store, id, draft('Dont overwrite'), null).status, 'protected')
})
