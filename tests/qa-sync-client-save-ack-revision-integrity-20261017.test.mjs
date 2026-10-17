import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pushSyncedState,
} from '../src/lib/supaSync.ts'

// Independent QA1/2 on frozen owner DRAFT #3777 commit 9fc1532.
// Fake Response objects only, no remote HTTP or user/retailer data.
const DEVICE = 'A'.repeat(43)
const PLAN = 'supa:planner-preferences:v2'
const LIBRARY = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const plan = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })

function localBrowser() {
  const data = new Map([
    [DEVICE_KEY_STORAGE, DEVICE],
    [PLAN, plan(42)], // unsynced newer browser edit
    [SHOP, null],
    [SYNC_META_STORAGE, JSON.stringify({
      revision: 1,
      synced: { [PLAN]: plan(35), [LIBRARY]: null, [SHOP]: null },
    })],
    ['supa:m3-observation-draft:v1', 'fictional-private-M3-not-on-network'],
  ])
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  }
}
const state = storage => ({
  plan: storage.getItem(PLAN),
  meta: storage.getItem(SYNC_META_STORAGE),
  privateM3: storage.getItem('supa:m3-observation-draft:v1'),
})

const jsonAck = (revision, status = 200) => new Response(JSON.stringify({
  revision,
  updatedAt: '2026-10-17T00:00:00.000Z',
}), { status, headers: { 'content-type': 'application/json' } })

test('positive: a canonical 200 acknowledgement advances exactly one revision and preserves local M3 draft', async () => {
  const storage = localBrowser()
  const before = state(storage)
  const request = async init => {
    assert.equal(init.method, 'PUT')
    assert.equal(JSON.parse(init.body).baseRevision, 1)
    assert.equal(JSON.parse(init.body).entries[PLAN], plan(42))
    assert.equal(Object.hasOwn(JSON.parse(init.body).entries, 'supa:m3-observation-draft:v1'), false)
    return jsonAck(2)
  }
  assert.equal(await pushSyncedState({ storage, request }), 'saved')
  assert.equal(storage.getItem(PLAN), before.plan)
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).synced[PLAN], plan(42))
  assert.equal(storage.getItem('supa:m3-observation-draft:v1'), before.privateM3)
})

for (const [name, bad] of [
  ['missing revision', undefined],
  ['unchanged revision', 1],
  ['skipped future revision', 7],
  ['string revision', '2'],
  ['negative revision', -1],
  ['fractional revision', 2.5],
]) {
  test(`P2: a 200 save acknowledgement with ${name} must not mark local edits as synced`, async () => {
    const storage = localBrowser()
    const before = state(storage)
    const request = async () => jsonAck(bad)
    assert.equal(await pushSyncedState({ storage, request }), 'unavailable',
      'a success status alone cannot prove the revision-2 write was accepted')
    assert.deepEqual(state(storage), before,
      'invalid ack cannot advance browser metadata or discard the unsynced edit')
  })
}

test('P2: a 200 acknowledgement with non-JSON body must fail closed without throwing or writing metadata', async () => {
  const storage = localBrowser()
  const before = state(storage)
  const request = async () => new Response('<html>not JSON</html>', {
    status: 200, headers: { 'content-type': 'text/html' },
  })
  assert.equal(await pushSyncedState({ storage, request }), 'unavailable')
  assert.deepEqual(state(storage), before)
})
