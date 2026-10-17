import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pullSyncedState } from '../src/lib/supaSync.ts'

// Entirely synthetic same-origin response objects; no network, real retailer,
// personal data, live server or third-party capture is involved.
const PLAN = 'supa:planner-preferences:v2'
const RECIPES = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const remoteEntries = { [PLAN]: plan(40), [RECIPES]: null, [SHOP]: null }

function storageWithSyncedPlan() {
  const map = new Map([
    [DEVICE_KEY_STORAGE, 'G'.repeat(43)],
    [PLAN, plan(35)],
    [SYNC_META_STORAGE, JSON.stringify({
      revision: 1, synced: { [PLAN]: plan(35), [RECIPES]: null, [SHOP]: null },
    })],
    [PRIVATE, 'fake-private-M3-draft'],
  ])
  return {
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
}
const bytes = storage => [PLAN, RECIPES, SHOP, SYNC_META_STORAGE, PRIVATE, DEVICE_KEY_STORAGE]
  .map(key => [key, storage.getItem(key)])

function reply(mediaType) {
  const encoded = new TextEncoder().encode(JSON.stringify({
    revision: 2, updatedAt: '2026-10-17T00:00:00.000Z', entries: remoteEntries,
  }))
  return new Response(encoded, {
    status: 200,
    headers: mediaType === null ? undefined : { 'content-type': mediaType },
  })
}

test('positive: true application/json charset response restores a changed server planner', async () => {
  const storage = storageWithSyncedPlan()
  const beforeM3 = storage.getItem(PRIVATE)
  let requests = 0
  assert.deepEqual(await pullSyncedState({
    storage,
    request: async init => {
      requests++
      assert.equal(init.method, undefined, 'initial pull must be GET')
      return reply('application/json; charset=utf-8')
    },
  }), [PLAN])
  assert.equal(requests, 1)
  assert.equal(storage.getItem(PLAN), plan(40))
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
  assert.equal(storage.getItem(PRIVATE), beforeM3)
})

for (const [label, mediaType] of [
  ['HTML with JSON substring parameter', 'text/html; note=application/json'],
  ['JavaScript JSONP type', 'application/jsonp'],
  ['JSON text sequence media type', 'application/json-seq'],
  ['plain text with JSON-like charset', 'text/plain; charset=application/json'],
  ['no content type', null],
]) {
  test(`P2 #3814: reject ${label} before remote GET can replace local planner`, async () => {
    const storage = storageWithSyncedPlan()
    const before = bytes(storage)
    let requests = 0
    assert.deepEqual(await pullSyncedState({
      storage,
      request: async () => { requests++; return reply(mediaType) },
    }), [])
    assert.equal(requests, 1)
    assert.deepEqual(bytes(storage), before, 'invalid media type cannot change synced planner or private M3')
  })
}
