import assert from 'node:assert/strict'
import test from 'node:test'

import { DEVICE_KEY_STORAGE, SYNC_META_STORAGE, pullSyncedState } from '../src/lib/supaSync.ts'

// Add-only interoperability controls for #3814: the HTTP media type token is
// case-insensitive. This is deliberately distinct from immutable GET fail-first
// tests at fbf63f4. No real network, data or third-party sources are used.
const PLAN = 'supa:planner-preferences:v2'
const RECIPES = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const entries = budget => ({ [PLAN]: plan(budget), [RECIPES]: null, [SHOP]: null })

function memory() {
  const map = new Map([
    [DEVICE_KEY_STORAGE, 'H'.repeat(43)],
    [PLAN, plan(35)],
    [SYNC_META_STORAGE, JSON.stringify({ revision: 1, synced: entries(35) })],
    [PRIVATE, 'synthetic-local-only-M3'],
  ])
  return {
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
}

for (const mime of ['APPLICATION/JSON', 'Application/Json; Charset=UTF-8']) {
  test(`positive P2 #3814: GET accepts case-insensitive canonical MIME token ${mime}`, async () => {
    const storage = memory()
    let requests = 0
    const request = async () => {
      requests++
      return new Response(JSON.stringify({
        revision: 2,
        updatedAt: '2026-10-17T00:00:00.000Z',
        entries: entries(40),
      }), { status: 200, headers: { 'content-type': mime } })
    }
    assert.deepEqual(await pullSyncedState({ storage, request }), [PLAN])
    assert.equal(requests, 1)
    assert.equal(storage.getItem(PLAN), plan(40))
    assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
    assert.equal(storage.getItem(PRIVATE), 'synthetic-local-only-M3')
  })
}
