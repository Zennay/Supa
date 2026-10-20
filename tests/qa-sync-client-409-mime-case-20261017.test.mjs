import assert from 'node:assert/strict'
import test from 'node:test'

import { DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pushSyncedState } from '../src/lib/supaSync.ts'

// Separate compatibility controls for the media-type strictness patch to #3812.
// HTTP content-type tokens are case-insensitive, and a valid 409 must still
// advance the optimistic-concurrency base before retrying the local edit.
// Entirely synthetic: zero network, retailers or actual private M3 material.
const PLAN = 'supa:planner-preferences:v2'
const RECIPES = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const entries = budget => ({ [PLAN]: plan(budget), [RECIPES]: null, [SHOP]: null })

function memory() {
  const map = new Map([
    [DEVICE_KEY_STORAGE, 'Y'.repeat(43)],
    [PLAN, plan(42)],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: entries(35) })],
    [PRIVATE, 'mock-local-only-M3'],
  ])
  return {
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
}

for (const mime of ['APPLICATION/JSON', 'Application/Json; Charset=UTF-8']) {
  test(`positive P2 #3812: canonical case-insensitive ${mime} 409 still CAS-retries without touching M3`, async () => {
    const storage = memory()
    let n = 0
    const request = async init => {
      const body = JSON.parse(init.body)
      assert.equal(init.method, 'PUT')
      assert.equal(body.entries[PLAN], plan(42))
      assert.equal(Object.hasOwn(body.entries, PRIVATE), false)
      if (++n === 1) {
        assert.equal(body.baseRevision, 1)
        return new Response(JSON.stringify({
          revision: 2, updatedAt: '2026-10-17T00:00:00.000Z', entries: entries(40),
        }), { status: 409, headers: { 'content-type': mime } })
      }
      assert.equal(body.baseRevision, 2)
      return new Response(JSON.stringify({ revision: 3 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    assert.equal(await pushSyncedState({ storage, request }), 'saved')
    assert.equal(n, 2)
    assert.equal(storage.getItem(PLAN), plan(42))
    assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 3)
    assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).synced[PLAN], plan(42))
    assert.equal(storage.getItem(PRIVATE), 'mock-local-only-M3')
  })
}
