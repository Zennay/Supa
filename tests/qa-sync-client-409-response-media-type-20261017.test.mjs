import assert from 'node:assert/strict'
import test from 'node:test'

import { DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pushSyncedState } from '../src/lib/supaSync.ts'

// QA1/2: all HTTP responses are synthetic Response objects. No network, VPS,
// retailer APIs, real observation data or production state are used.
const PLAN = 'supa:planner-preferences:v2'
const RECIPES = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const entries = budget => ({ [PLAN]: plan(budget), [RECIPES]: null, [SHOP]: null })

function storageWithLocalEdit() {
  const map = new Map([
    [DEVICE_KEY_STORAGE, 'K'.repeat(43)],
    [PLAN, plan(42)],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: entries(35) })],
    [PRIVATE, 'synthetic-field-draft-that-must-never-be-synced'],
  ])
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  }
}

function snapshot(storage) {
  return [PLAN, RECIPES, SHOP, PRIVATE, SYNC_META_STORAGE, DEVICE_KEY_STORAGE]
    .map(key => [key, storage.getItem(key)])
}

function conflict(mediaType) {
  const encoded = new TextEncoder().encode(JSON.stringify({
    revision: 2,
    updatedAt: '2026-10-17T00:00:00.000Z',
    entries: entries(40),
  }))
  const headers = mediaType === null ? undefined : { 'content-type': mediaType }
  return new Response(encoded, { status: 409, headers })
}

function saved() {
  return new Response(JSON.stringify({ revision: 3, updatedAt: '2026-10-17T00:00:00.000Z' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

test('positive: canonical JSON 409 adopts revision base, retries once and preserves local unsynced edits', async () => {
  const storage = storageWithLocalEdit()
  const privateBefore = storage.getItem(PRIVATE)
  let requests = 0
  const request = async init => {
    assert.equal(init.method, 'PUT')
    assert.equal(JSON.parse(init.body).entries[PLAN], plan(42))
    assert.equal(Object.hasOwn(JSON.parse(init.body).entries, PRIVATE), false)
    if (++requests === 1) {
      assert.equal(JSON.parse(init.body).baseRevision, 1)
      return conflict('application/json; charset=utf-8')
    }
    assert.equal(JSON.parse(init.body).baseRevision, 2)
    return saved()
  }
  assert.equal(await pushSyncedState({ storage, request }), 'saved')
  assert.equal(requests, 2)
  assert.equal(storage.getItem(PLAN), plan(42))
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 3)
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).synced[PLAN], plan(42))
  assert.equal(storage.getItem(PRIVATE), privateBefore)
})

for (const [label, mediaType] of [
  ['HTML', 'text/html'],
  ['missing media type', null],
  ['JSON-like but invalid media type', 'application/json+other'],
  ['plain text', 'text/plain'],
]) {
  test(`P2 #3812: syntactically valid 409 conflict labelled ${label} must not mutate browser metadata or retry`, async () => {
    const storage = storageWithLocalEdit()
    const before = snapshot(storage)
    let requests = 0
    const request = async init => {
      requests++
      assert.equal(JSON.parse(init.body).baseRevision, 1)
      if (requests > 1) throw new Error('malformed 409 must never trigger a second PUT')
      return conflict(mediaType)
    }
    assert.equal(await pushSyncedState({ storage, request }), 'unavailable')
    assert.equal(requests, 1)
    assert.deepEqual(snapshot(storage), before, 'local planner, private M3 and sync metadata must remain byte-identical')
  })
}
