import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pushSyncedState } from '../src/lib/supaSync.ts'

// Extra independent QA controls: a comma-separated list is NOT the singular
// application/json media type. All HTTP and browser state is synthetic.
const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = n => JSON.stringify({ budget: n, activeDays: ['Ma'], recipeByDay: {} })
const entries = n => ({ [PLAN]: plan(n), [LIB]: null, [SHOP]: null })
function browser() {
  const data = new Map([
    [DEVICE_KEY_STORAGE, 'J'.repeat(43)],
    [PLAN, plan(42)],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: entries(35) })],
    [PRIVATE, 'fake-private-data'],
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
  test(`P2 #3812: comma-coalesced 409 Content-Type ${header} is not JSON`, async () => {
    const storage = browser()
    const before = state(storage)
    let count = 0
    const request = async () => {
      count++
      if (count > 1) throw new Error('invalid 409 must not retry')
      return new Response(JSON.stringify({ revision: 2, entries: entries(40) }), {
        status: 409, headers: { 'content-type': header },
      })
    }
    assert.equal(await pushSyncedState({ storage, request }), 'unavailable')
    assert.equal(count, 1)
    assert.deepEqual(state(storage), before)
  })
}
