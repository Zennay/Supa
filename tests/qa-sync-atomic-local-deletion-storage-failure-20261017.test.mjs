import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pullSyncedState, pushSyncedState,
} from '../src/lib/supaSync.ts'

// Supplemental QA1-only deletion/rollback controls for #3821.
// The original fail-first test file on PR #3819 is intentionally untouched.
const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = n => JSON.stringify({ budget: n, activeDays: ['Ma'], recipeByDay: {} })
const checked = JSON.stringify({ schemaVersion: 1, basketKey: 'fictional-week', doneLineIds: ['fictional-a'] })
const normalized = (p, shop) => ({ [PLAN]: p === null ? null : plan(p), [LIB]: null, [SHOP]: shop })
const response = (status, revision, e) => new Response(JSON.stringify({ revision, entries: e }), {
  status, headers: { 'content-type': 'application/json' },
})

function storageFixture({ localPlan = 31, syncedPlan = 31, savedShop = checked, failAt = null } = {}) {
  const data = new Map([
    [DEVICE_KEY_STORAGE, 'D'.repeat(43)],
    [PLAN, plan(localPlan)],
    [SHOP, savedShop],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: normalized(syncedPlan, savedShop) })],
    [PRIVATE, 'private-M3-synthetic-kept'],
  ])
  let failure = failAt
  const storage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem(key, value) {
      if (key === failure) { failure = null; throw new Error('one-shot quota-fault') }
      data.set(key, String(value))
    },
    removeItem(key) {
      if (key === failure) { failure = null; throw new Error('one-shot removal-fault') }
      data.delete(key)
    },
  }
  const snapshot = () => [...data.entries()].sort(([a], [b]) => a.localeCompare(b))
  return { storage, snapshot }
}

test('positive: successful valid remote explicit-null clears planner and checklist with revision update', async () => {
  const { storage } = storageFixture()
  const changed = await pullSyncedState({
    storage, request: async () => response(200, 2, normalized(null, null)),
  })
  assert.deepEqual(changed, [PLAN, SHOP])
  assert.equal(storage.getItem(PLAN), null)
  assert.equal(storage.getItem(SHOP), null)
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
  assert.equal(storage.getItem(PRIVATE), 'private-M3-synthetic-kept')
})

test('P1 #3821: failed second GET write cannot leave original planner deleted', async () => {
  const { storage, snapshot } = storageFixture({ failAt: SHOP })
  const before = snapshot()
  try {
    await pullSyncedState({ storage, request: async () => response(200, 2, normalized(null, 'new-remote-value')) })
  } catch { /* storage refusal may throw, but must be failure atomic */ }
  assert.deepEqual(snapshot(), before,
    'planner deletion must roll back when subsequent checklist write fails')
})

test('P1 #3821: failed metadata write cannot leave synchronized shopping progress removed', async () => {
  const { storage, snapshot } = storageFixture({ failAt: SYNC_META_STORAGE })
  const before = snapshot()
  try {
    await pullSyncedState({ storage, request: async () => response(200, 2, normalized(31, null)) })
  } catch { /* error return shape is secondary to preserving original bytes */ }
  assert.deepEqual(snapshot(), before,
    'an incomplete GET must not durably clear a real previous shopping checklist')
})

test('positive: 409 delete from server preserves unsynced planner, then CAS retries once', async () => {
  const { storage } = storageFixture({ localPlan: 42, syncedPlan: 31 })
  let calls = 0
  const result = await pushSyncedState({
    storage, request: async () => {
      calls++
      return calls === 1
        ? response(409, 2, normalized(40, null))
        : new Response(JSON.stringify({ revision: 3 }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
    },
  })
  assert.equal(result, 'saved')
  assert.equal(calls, 2)
  assert.equal(storage.getItem(PLAN), plan(42))
  assert.equal(storage.getItem(SHOP), null)
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 3)
  assert.equal(storage.getItem(PRIVATE), 'private-M3-synthetic-kept')
})

test('P1 #3821: failed 409 metadata update cannot irreversibly clear local checked basket', async () => {
  const { storage, snapshot } = storageFixture({
    localPlan: 42, syncedPlan: 31, failAt: SYNC_META_STORAGE,
  })
  const before = snapshot()
  let calls = 0
  try {
    await pushSyncedState({
      storage,
      request: async () => {
        calls++
        if (calls > 1) throw new Error('failed rebase must not retry')
        return response(409, 2, normalized(40, null))
      },
    })
  } catch { /* fail-closed without retaining partial deletions */ }
  assert.equal(calls, 1)
  assert.deepEqual(snapshot(), before,
    'failed rebase must not lose the original physical checked basket')
})
