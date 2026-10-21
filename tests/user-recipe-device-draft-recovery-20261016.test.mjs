import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDeviceDraftId,
  saveRecipeDeviceDraft,
  readRecipeDeviceDraft,
  deleteRecipeDeviceDraft,
} from '../src/features/user-recipes/recipeDraftDeviceStorage.ts'

const id = '22e34aba-1234-4ac9-82aa-123456789abc'
const otherId = '22e34aba-1234-4ac9-82aa-123456789abd'

function storage() {
  const saved = new Map()
  return {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, val) => saved.set(key, val),
    removeItem: (key) => saved.delete(key),
    saved,
  }
}
function draft() {
  return {
    source: 'url', sourceUrl: 'https://public.example.nl/recept?token=TOPSECRET',
    title: 'Kipbowl', servings: 2, minutes: 20, status: 'needs_review',
    ingredients: [{ clientId: 'ui-only-42', original: '100 g kip', label: 'kip', query: 'kip',
      amount: 100, unit: 'g', reviewReason: null }],
    steps: ['Bakken'], warnings: ['Review import'],
    estimatedCost: 0, credentials: 'NEVER_STORE_ME',
  }
}

test('explicit first save and restore preserve only approved private device draft fields', () => {
  const store = storage()
  const input = draft()
  const initial = structuredClone(input)
  const save = saveRecipeDeviceDraft(store, id, input, null)
  assert.equal(save.status, 'saved')
  assert.equal(save.record.revision, 1)
  assert.equal(save.record.draft.status, 'needs_review')
  const raw = [...store.saved.values()][0]
  assert.doesNotMatch(raw, /TOPSECRET|NEVER_STORE_ME|clientId|estimatedCost/)
  const recovered = readRecipeDeviceDraft(store, id)
  assert.equal(recovered.status, 'found')
  assert.equal(recovered.record.draft.sourceUrl, null)
  assert.equal(recovered.record.draft.ingredients[0].amount, 100)
  assert.deepEqual(input, initial)
})

test('same device draft can be revisioned only when the last seen revision matches', () => {
  const store = storage()
  assert.equal(saveRecipeDeviceDraft(store, id, draft(), null).status, 'saved')
  const updated = { ...draft(), title: 'Nieuwe bowl' }
  assert.equal(saveRecipeDeviceDraft(store, id, updated, 1).status, 'saved')
  assert.equal(readRecipeDeviceDraft(store, id).record.revision, 2)
  assert.equal(readRecipeDeviceDraft(store, id).record.draft.title, 'Nieuwe bowl')
  assert.equal(saveRecipeDeviceDraft(store, id, draft(), 1).status, 'conflict')
  assert.equal(saveRecipeDeviceDraft(store, id, draft(), null).status, 'conflict')
  assert.equal(readRecipeDeviceDraft(store, id).record.draft.title, 'Nieuwe bowl')
})

test('missing record, invalid IDs and deletes with stale revisions fail closed', () => {
  const store = storage()
  assert.equal(readRecipeDeviceDraft(store, otherId).status, 'missing')
  assert.equal(saveRecipeDeviceDraft(store, '../injection', draft(), null).status, 'invalid')
  assert.equal(deleteRecipeDeviceDraft(store, id, 1).status, 'conflict')
  assert.equal(saveRecipeDeviceDraft(store, id, draft(), null).status, 'saved')
  assert.equal(deleteRecipeDeviceDraft(store, id, 2).status, 'conflict')
  assert.equal(deleteRecipeDeviceDraft(store, id, 1).status, 'deleted')
  assert.equal(readRecipeDeviceDraft(store, id).status, 'missing')
})

test('new IDs are generated from secure crypto UUID and have correct namespace', () => {
  const created = createDeviceDraftId()
  assert.match(created, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('unrecognized schema, bad JSON and future versions never get overwritten', () => {
  const store = storage()
  store.setItem('supa:recipe:device-draft:v1:' + id, '{not-json')
  assert.equal(readRecipeDeviceDraft(store, id).status, 'protected')
  assert.equal(saveRecipeDeviceDraft(store, id, draft(), null).status, 'protected')
  store.setItem('supa:recipe:device-draft:v1:' + id, JSON.stringify({
    format: 'supa-recipe-device-draft', version: 2, revision: 1,
    savedAt: new Date().toISOString(), draft: draft(),
  }))
  assert.equal(readRecipeDeviceDraft(store, id).status, 'protected')
  assert.equal(deleteRecipeDeviceDraft(store, id, 1).status, 'protected')
})

test('invalid/missing/import-uncertain quantities can be saved as draft, not priced product', () => {
  const store = storage()
  const input = draft()
  input.ingredients[0].amount = null
  input.ingredients[0].unit = null
  input.ingredients[0].reviewReason = 'Cups are unknown'
  const saved = saveRecipeDeviceDraft(store, id, input, null)
  assert.equal(saved.status, 'saved')
  assert.equal(saved.record.draft.ingredients[0].amount, null)
  assert.equal(saved.record.draft.ingredients[0].reviewReason, 'Cups are unknown')
  assert.equal(saved.record.draft.status, 'needs_review')
})

test('huge amounts, invalid units, too many ingredients, unsupported precision are rejected', () => {
  const store = storage()
  for (const [amount, unit] of [[0, 'g'], [-10, 'g'], [Infinity, 'g'], [1, 'cup'], [0.0001, 'g']]) {
    const input = draft()
    input.ingredients[0].amount = amount
    input.ingredients[0].unit = unit
    assert.equal(saveRecipeDeviceDraft(store, id, input, null).status, 'invalid')
  }
  const tooMany = draft()
  tooMany.ingredients = Array(101).fill(tooMany.ingredients[0])
  assert.equal(saveRecipeDeviceDraft(store, id, tooMany, null).status, 'invalid')
})

test('storage exceptions signal unavailable and never claim a saved draft', () => {
  const unavailable = {
    getItem: () => { throw Error('denied') },
    setItem: () => { throw Error('denied') },
    removeItem: () => { throw Error('denied') },
  }
  assert.equal(readRecipeDeviceDraft(unavailable, id).status, 'unavailable')
  assert.equal(saveRecipeDeviceDraft(unavailable, id, draft(), null).status, 'unavailable')
  const store = storage()
  const noWrites = { ...store, setItem: () => { throw Error('quota') } }
  assert.equal(saveRecipeDeviceDraft(noWrites, id, draft(), null).status, 'unavailable')
})

test('output stays below 64 KiB, no partial persistent records on over-limit', () => {
  const store = storage()
  const input = draft()
  input.steps = Array(90).fill('large cook text '.repeat(80))
  assert.equal(saveRecipeDeviceDraft(store, id, input, null).status, 'invalid')
  assert.equal(store.saved.size, 0)
})
