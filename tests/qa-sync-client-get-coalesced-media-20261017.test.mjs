import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pullSyncedState } from '../src/lib/supaSync.ts'

// A comma-coalesced media-type list is not a single application/json token.
// Synthetic Responses only; no network, retailer or human M3 records.
const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = n => JSON.stringify({ budget: n, activeDays: ['Ma'], recipeByDay: {} })
const entries = n => ({ [PLAN]: plan(n), [LIB]: null, [SHOP]: null })
function browser() {
  const data = new Map([
    [DEVICE_KEY_STORAGE, 'L'.repeat(43)],
    [PLAN, plan(35)],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: entries(35) })],
    [PRIVATE, 'local-only-fake-M3'],
  ])
  return {
    getItem: k => data.has(k) ? data.get(k) : null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
  }
}
const state = storage => [PLAN, LIB, SHOP, SYNC_META_STORAGE, PRIVATE]
  .map(k => storage.getItem(k))
for (const header of ['application/json, text/html', 'text/plain, application/json']) {
  test(`P2 #3814: comma-coalesced GET Content-Type ${header} cannot restore a planner`, async () => {
    const storage = browser()
    const before = state(storage)
    let count = 0
    assert.deepEqual(await pullSyncedState({
      storage,
      request: async () => {
        count++
        return new Response(JSON.stringify({ revision: 2, entries: entries(40) }), {
          status: 200, headers: { 'content-type': header },
        })
      },
    }), [])
    assert.equal(count, 1)
    assert.deepEqual(state(storage), before)
  })
}
