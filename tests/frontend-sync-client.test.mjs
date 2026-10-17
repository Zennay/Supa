import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import { pullSyncedState, pushSyncedState, deviceKey, DEVICE_KEY_STORAGE, SYNC_META_STORAGE } from '../src/lib/supaSync.ts'

const PLAN = 'supa:planner-preferences:v2'
const plan = days => JSON.stringify({ budget: 35, activeDays: days, recipeByDay: {} })

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    data,
  }
}

async function withApi(run) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-client-'))
  const server = createRecipeServer({ root: dir, origin: 'http://supa.test', syncStore: createFileSyncStore({ dir }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  // What syncRequest does in the browser, plus the Origin a same-origin page sends.
  const request = init => fetch(base + '/api/sync', { ...init, headers: { ...init.headers, Origin: 'http://supa.test' } })
  try { await run(request) } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
}

test('device key is random, url-safe and stable', () => {
  const storage = memoryStorage()
  const key = deviceKey({ storage, randomBytes: size => new Uint8Array(size).fill(251) })
  assert.match(key, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(deviceKey({ storage, randomBytes: () => { throw new Error('must reuse') } }), key)
})

test('a second browser with the same device key restores the plan from the API', async () => {
  await withApi(async request => {
    const phone = memoryStorage({ [PLAN]: plan(['Ma', 'Di']) })
    assert.equal(await pushSyncedState({ storage: phone, request }), 'saved')
    assert.equal(await pushSyncedState({ storage: phone, request }), 'unchanged')

    const tablet = memoryStorage({ [DEVICE_KEY_STORAGE]: phone.getItem(DEVICE_KEY_STORAGE) })
    assert.deepEqual(await pullSyncedState({ storage: tablet, request }), [PLAN])
    assert.equal(tablet.getItem(PLAN), plan(['Ma', 'Di']))
    assert.equal(JSON.parse(tablet.getItem(SYNC_META_STORAGE)).revision, 1)
  })
})

test('unsynced local edits are never overwritten by an older or newer server copy', async () => {
  await withApi(async request => {
    const a = memoryStorage({ [PLAN]: plan(['Ma']) })
    await pushSyncedState({ storage: a, request })
    const b = memoryStorage({ [DEVICE_KEY_STORAGE]: a.getItem(DEVICE_KEY_STORAGE) })
    await pullSyncedState({ storage: b, request })

    a.setItem(PLAN, plan(['Wo']))
    assert.equal(await pushSyncedState({ storage: a, request }), 'saved')

    // b edited too, from the stale base: its own edit wins after one merge.
    b.setItem(PLAN, plan(['Do']))
    assert.deepEqual(await pullSyncedState({ storage: b, request }), [], 'local edit is kept on pull')
    assert.equal(b.getItem(PLAN), plan(['Do']))
    assert.equal(await pushSyncedState({ storage: b, request }), 'saved')
    assert.deepEqual(await pullSyncedState({ storage: a, request }), [PLAN])
    assert.equal(a.getItem(PLAN), plan(['Do']))
  })
})

test('a wiped server never deletes local records; they are uploaded again', async () => {
  const storage = memoryStorage({
    [PLAN]: plan(['Ma']),
    [DEVICE_KEY_STORAGE]: 'a'.repeat(43),
    [SYNC_META_STORAGE]: JSON.stringify({ revision: 5, synced: { [PLAN]: plan(['Ma']) } }),
  })
  const empty = async () => new Response(JSON.stringify({ revision: 0, updatedAt: null, entries: {} }), { headers: { 'content-type': 'application/json' } })
  assert.deepEqual(await pullSyncedState({ storage, request: empty }), [])
  assert.equal(storage.getItem(PLAN), plan(['Ma']))
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 0)
})

test('without an API (static host) the app keeps its local data and stops pushing', async () => {
  const storage = memoryStorage({ [PLAN]: plan(['Ma']) })
  const html = async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
  assert.deepEqual(await pullSyncedState({ storage, request: html }), [])
  const missing = async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
  assert.equal(await pushSyncedState({ storage, request: missing }), 'no-api')
  assert.equal(storage.getItem(PLAN), plan(['Ma']))
})
