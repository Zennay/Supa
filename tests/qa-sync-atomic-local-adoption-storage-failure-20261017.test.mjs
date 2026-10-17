import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_KEY_STORAGE,
  SYNC_META_STORAGE,
  pullSyncedState,
  pushSyncedState,
} from '../src/lib/supaSync.ts'

// Synthetic browser-memory only. Reproduces a quota-like single write fault
// after an earlier record was successfully changed. A rejected remote restore
// must never leave half a basket or planner applied with stale sync metadata.
const PLAN = 'supa:planner-preferences:v2'
const LIBRARY = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = n => JSON.stringify({ budget: n, activeDays: ['Ma'], recipeByDay: {} })
const shopping = JSON.stringify({ schemaVersion: 1, basketKey: 'fictional-basket', doneLineIds: ['fictional-id'] })
const entries = (n, shop = null) => ({ [PLAN]: plan(n), [LIBRARY]: null, [SHOP]: shop })
const json = (status, revision, values) => new Response(
  JSON.stringify({ revision, entries: values }),
  { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
)

function browser({ localPlan = 31, syncedPlan = 31, faultKey = null } = {}) {
  const data = new Map([
    [DEVICE_KEY_STORAGE, 'Q'.repeat(43)],
    [PLAN, plan(localPlan)],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: entries(syncedPlan) })],
    [PRIVATE, 'synthetic-private-m3-not-for-sync'],
  ])
  let failOnce = faultKey
  const storage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => {
      if (key === failOnce) {
        failOnce = null
        throw new Error('synthetic QuotaExceededError at ' + key)
      }
      data.set(key, String(value))
    },
    removeItem: key => {
      if (key === failOnce) {
        failOnce = null
        throw new Error('synthetic QuotaExceededError at ' + key)
      }
      data.delete(key)
    },
  }
  return { storage, snapshot: () => [...data.entries()].sort(([a], [b]) => a.localeCompare(b)) }
}

test('positive: valid GET adopts planner and shopping state, preserving private M3 data', async () => {
  const { storage } = browser()
  const changed = await pullSyncedState({
    storage, request: async () => json(200, 2, entries(40, shopping)),
  })
  assert.deepEqual(changed, [PLAN, SHOP])
  assert.equal(storage.getItem(PLAN), plan(40))
  assert.equal(storage.getItem(SHOP), shopping)
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
  assert.equal(storage.getItem(PRIVATE), 'synthetic-private-m3-not-for-sync')
})

test('P2: GET quota fault on second record cannot persist the first record partially', async () => {
  const { storage, snapshot } = browser({ faultKey: SHOP })
  const before = snapshot()
  try {
    await pullSyncedState({ storage, request: async () => json(200, 2, entries(40, shopping)) })
  } catch { /* returning unavailable or throwing is not the key integrity condition */ }
  assert.deepEqual(snapshot(), before,
    'a failed shopping write cannot leave a freshly adopted planner with old metadata')
})

test('P2: GET quota fault while saving sync metadata cannot retain adopted records', async () => {
  const { storage, snapshot } = browser({ faultKey: SYNC_META_STORAGE })
  const before = snapshot()
  try {
    await pullSyncedState({ storage, request: async () => json(200, 2, entries(40, shopping)) })
  } catch { /* snapshot integrity must hold regardless of failure reporting */ }
  assert.deepEqual(snapshot(), before,
    'a rejected sync-meta write must not turn valid local planner/checklist into untracked remote data')
})

test('positive: genuine JSON 409 rebase then 200 saves local edit and remote shopping once', async () => {
  const { storage } = browser({ localPlan: 42 })
  let count = 0
  const result = await pushSyncedState({
    storage, request: async () => (++count === 1
      ? json(409, 2, entries(40, shopping))
      : new Response(JSON.stringify({ revision: 3, updatedAt: '2026-10-17T00:00:00.000Z' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })),
  })
  assert.equal(result, 'saved')
  assert.equal(count, 2)
  assert.equal(storage.getItem(PLAN), plan(42), 'unsynced planner edit is authoritative')
  assert.equal(storage.getItem(SHOP), shopping)
  const meta = JSON.parse(storage.getItem(SYNC_META_STORAGE))
  assert.equal(meta.revision, 3)
  assert.equal(meta.synced[PLAN], plan(42))
  assert.equal(storage.getItem(PRIVATE), 'synthetic-private-m3-not-for-sync')
})

test('P2: 409 rebase meta quota fault cannot persist a partially adopted remote basket', async () => {
  const { storage, snapshot } = browser({ localPlan: 42, faultKey: SYNC_META_STORAGE })
  const before = snapshot()
  let calls = 0
  try {
    await pushSyncedState({
      storage, request: async () => {
        calls++
        if (calls > 1) throw new Error('failed rebase must not retry')
        return json(409, 2, entries(40, shopping))
      },
    })
  } catch { /* do not allow a partial durable adoption even on thrown storage errors */ }
  assert.equal(calls, 1)
  assert.deepEqual(snapshot(), before,
    'failed 409 metadata write must not persist other remote records without the corresponding revision')
})
