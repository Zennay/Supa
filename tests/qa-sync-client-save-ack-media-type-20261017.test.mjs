import assert from 'node:assert/strict'
import test from 'node:test'

import { DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pushSyncedState } from '../src/lib/supaSync.ts'

// QA-only media-type acceptance contract for PUT 200: deliberately separate
// from immutable eight-case 200-ack revision test. All responses fake.
const PLAN = 'supa:planner-preferences:v2'
const DEVICE = 'M'.repeat(43)
const local = JSON.stringify({ budget: 40, activeDays: ['Ma'], recipeByDay: {} })
const prior = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const empty = { [PLAN]: prior, 'supa.recipe-library.v1': null, 'supa:shopping-list-progress:v1': null }

function memory() {
  const map = new Map([
    [DEVICE_KEY_STORAGE, DEVICE],
    [PLAN, local],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: empty })],
    ['supa:m3-observation-draft:v1', 'synthetic-private-field-draft'],
  ])
  return {
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
}
function snapshot(storage) {
  return [storage.getItem(PLAN), storage.getItem(SYNC_META_STORAGE),
    storage.getItem('supa:m3-observation-draft:v1')]
}
function reply(type) {
  return new Response(JSON.stringify({ revision: 2, updatedAt: '2026-10-17T00:00:00.000Z' }), {
    status: 200, headers: { 'Content-Type': type },
  })
}

test('positive: a proper application/json with charset save ack is accepted', async () => {
  const storage = memory()
  assert.equal(await pushSyncedState({
    storage, request: async () => reply('application/json; charset=utf-8'),
  }), 'saved')
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
})

test('P2: a successful-looking JSON body labelled text/html cannot affirm a device sync write', async () => {
  const storage = memory()
  const before = snapshot(storage)
  assert.equal(await pushSyncedState({ storage, request: async () => reply('text/html') }), 'unavailable',
    'a 200 response from an unexpected endpoint or HTML fallback cannot mark local edits uploaded')
  assert.deepEqual(snapshot(storage), before,
    'the client must retain the unsynced planner and private M3 draft byte-for-byte')
})

test('P2: a successful-looking JSON body with no Content-Type cannot affirm a device sync write', async () => {
  const storage = memory()
  const before = snapshot(storage)
  const request = async () => new Response(JSON.stringify({
    revision: 2, updatedAt: '2026-10-17T00:00:00.000Z',
  }), { status: 200 })
  assert.equal(await pushSyncedState({ storage, request }), 'unavailable')
  assert.deepEqual(snapshot(storage), before)
})
