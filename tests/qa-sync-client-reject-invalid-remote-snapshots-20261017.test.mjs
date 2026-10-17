import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_KEY_STORAGE, SYNC_META_STORAGE,
  pullSyncedState, pushSyncedState,
} from '../src/lib/supaSync.ts'

// Independent QA against frozen owner DRAFT #3777, fe562fc. Pure in-memory
// synthetic API responses: never reach real retailers, customers or the VPS.
// A corrupted server-side snapshot must not poison durable browser state.
const PLAN = 'supa:planner-preferences:v2'
const LIBRARY = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE_M3 = 'supa:m3-observation-draft:v1'
const DEVICE = 'B'.repeat(43)
const planner = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const checklist = ids => JSON.stringify({ schemaVersion: 1, basketKey: 'fictional-basket', doneLineIds: ids })
const canonical = (plan, list) => ({ [PLAN]: plan, [LIBRARY]: null, [SHOP]: list })
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
})

function browser(seed = {}) {
  const items = new Map(Object.entries(seed))
  return {
    getItem: key => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
  }
}
function existing({ local = planner(35), synced = planner(35), list = checklist(['a']) } = {}) {
  const meta = JSON.stringify({ revision: 1, synced: canonical(synced, list) })
  return browser({
    [DEVICE_KEY_STORAGE]: DEVICE,
    [SYNC_META_STORAGE]: meta,
    [PLAN]: local,
    [SHOP]: list,
    [PRIVATE_M3]: '{"fictional":"private-never-networked"}',
  })
}
function snapshot(storage) {
  return {
    planner: storage.getItem(PLAN),
    checklist: storage.getItem(SHOP),
    privateM3: storage.getItem(PRIVATE_M3),
    meta: storage.getItem(SYNC_META_STORAGE),
  }
}

test('positive: canonical newer remote snapshot safely restores only clean allowed records', async () => {
  const storage = existing()
  const serverPlan = planner(42)
  const calls = []
  const request = async init => {
    calls.push(init)
    return response(200, { revision: 2, entries: canonical(serverPlan, checklist(['a'])) })
  }
  assert.deepEqual(await pullSyncedState({ storage, request }), [PLAN])
  assert.equal(storage.getItem(PLAN), serverPlan)
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
  assert.equal(storage.getItem(PRIVATE_M3), '{"fictional":"private-never-networked"}')
  assert.equal(calls.length, 1)
})

test('P2: malformed planner JSON returned as 200 must not overwrite previously valid local planner', async () => {
  const storage = existing()
  const before = snapshot(storage)
  const remote = { revision: 2, entries: canonical('{"budget":', checklist(['a'])) }
  const request = async () => response(200, remote)
  assert.deepEqual(await pullSyncedState({ storage, request }), [],
    'invalid remote bytes must be rejected before adopting or updating sync metadata')
  assert.deepEqual(snapshot(storage), before,
    'invalid server JSON must never replace durable local planner or sync base')
})

test('P2: missing normalized entries with positive revision must not erase the known-good planner', async () => {
  const storage = existing()
  const before = snapshot(storage)
  const request = async () => response(200, { revision: 2, entries: {} })
  assert.deepEqual(await pullSyncedState({ storage, request }), [])
  assert.deepEqual(snapshot(storage), before,
    'a rev>0 server snapshot missing canonical keys is not evidence of deliberate deletion')
})

test('P2: an unexpected private M3 key must reject an otherwise plausible newer remote record', async () => {
  const storage = existing()
  const before = snapshot(storage)
  const remote = {
    revision: 2,
    entries: {
      ...canonical(planner(42), checklist(['a'])),
      [PRIVATE_M3]: '{"fictional":"sensitive-device-only"}',
    },
  }
  assert.deepEqual(await pullSyncedState({ storage, request: async () => response(200, remote) }), [],
    'do not accept out-of-contract server snapshots even if three allowed fields are well formed')
  assert.deepEqual(snapshot(storage), before)
})

test('P2: a malformed 409 conflict body must not contaminate checklist or trigger a retry', async () => {
  // Local planner edit is genuinely unsynced, so the client must attempt PUT.
  const storage = existing({ local: planner(46) })
  const before = snapshot(storage)
  let calls = 0
  const request = async () => {
    calls += 1
    if (calls === 1) return response(409, {
      revision: 2,
      entries: canonical(planner(40), '{"schemaVersion":1,"doneLineIds":["a","a"]}'),
    })
    return response(200, { revision: 3, updatedAt: '2026-10-17T00:00:00Z' })
  }
  assert.equal(await pushSyncedState({ storage, request }), 'unavailable',
    'conflicts with malformed persisted server records must fail closed, not retry/publish')
  assert.equal(calls, 1, 'invalid 409 snapshot must never trigger a second write')
  assert.deepEqual(snapshot(storage), before,
    'local planner, checklist, private M3 and sync metadata must remain byte-identical')
})

test('P2: malformed 409 without entries must fail gracefully without an uncaught exception', async () => {
  const storage = existing({ local: planner(46) })
  const before = snapshot(storage)
  const request = async () => response(409, { revision: 2 })
  assert.equal(await pushSyncedState({ storage, request }), 'unavailable',
    'malformed conflict bodies must never crash the background sync task')
  assert.deepEqual(snapshot(storage), before)
})
