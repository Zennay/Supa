import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import { startBackgroundSync, pushSyncedState, pullSyncedState, DEVICE_KEY_STORAGE, SYNC_META_STORAGE } from '../src/lib/supaSync.ts'
import { syncRequest } from '../src/lib/syncTransport.ts'

// QA-only real loopback HTTP exercise of the *actual* browser transport and
// API entrypoint. Never contacts retailers, public URLs or user databases.
const PLAN = 'supa:planner-preferences:v2'
const PRIVATE_M3 = 'supa:m3-observation-draft:v1'
const KEY = 'W'.repeat(43)
const PLAN_VALUE = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })

function storage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  }
}

async function apiHarness(t, createStore) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-real-http-abort-'))
  const server = createRecipeServer({
    root, origin: 'http://supa.test',
    syncStore: createStore(join(root, 'sync')),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const nativeFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = (url, init = {}) => {
    assert.equal(url, '/api/sync', 'production transport may only target its own sync API')
    calls.push(init)
    return nativeFetch(`http://127.0.0.1:${server.address().port}/api/sync`, {
      ...init,
      headers: { ...init.headers, Origin: 'http://supa.test' },
    })
  }
  t.after(async () => {
    globalThis.fetch = nativeFetch
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  return { root, calls }
}

test('real HTTP: genuine syncTransport PUT/GET saves and restores only allowed planner records', async t => {
  const h = await apiHarness(t, dir => createFileSyncStore({ dir }))
  const first = storage({
    [DEVICE_KEY_STORAGE]: KEY,
    [PLAN]: PLAN_VALUE,
    [PRIVATE_M3]: 'synthetic-secret-private-draft',
  })
  assert.equal(await pushSyncedState({ storage: first, request: syncRequest }), 'saved')
  assert.equal(JSON.parse(first.getItem(SYNC_META_STORAGE)).revision, 1)

  const second = storage({ [DEVICE_KEY_STORAGE]: KEY, [PRIVATE_M3]: 'another-private-draft' })
  assert.deepEqual(await pullSyncedState({ storage: second, request: syncRequest }), [PLAN])
  assert.equal(second.getItem(PLAN), PLAN_VALUE)
  assert.equal(second.getItem(PRIVATE_M3), 'another-private-draft')
  assert.equal(first.getItem(PRIVATE_M3), 'synthetic-secret-private-draft')
  assert.deepEqual(h.calls.map(call => call.method ?? 'GET'), ['PUT', 'GET'])
  assert.ok(h.calls.every(call => call.credentials === 'same-origin'))
  const disk = await readFile(join(h.root, 'sync', createHash('sha256').update(KEY).digest('hex') + '.json'), 'utf8')
  assert.ok(!disk.includes('synthetic-secret-private-draft'), 'the private M3 draft must not be synced to disk')
  assert.ok(!disk.includes(KEY), 'a bearer key must not appear in record content')
})

test('real HTTP: hidden-page PUT propagates cancellation to native fetch without saving late sync metadata', async t => {
  let entered
  let release
  const writeStarted = new Promise(resolve => { entered = resolve })
  const writing = new Promise(resolve => { release = resolve })
  const h = await apiHarness(t, () => ({
    read: async () => ({ revision: 0, updatedAt: null, entries: {} }),
    write: async () => {
      entered()
      return writing
    },
  }))
  const record = { revision: 1, updatedAt: '2026-10-17T00:00:00.000Z', entries: {} }
  const originalDocument = globalThis.document
  let onHide
  globalThis.document = {
    visibilityState: 'hidden',
    addEventListener: (name, callback) => { if (name === 'visibilitychange') onHide = callback },
    removeEventListener: (name, callback) => { if (name === 'visibilitychange' && onHide === callback) onHide = undefined },
  }
  let stop
  t.after(() => {
    stop?.()
    release?.({ conflict: false, record })
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  })
  const local = storage({
    [DEVICE_KEY_STORAGE]: KEY,
    [PLAN]: PLAN_VALUE,
    [PRIVATE_M3]: 'offline-only-private-M3',
  })
  stop = startBackgroundSync({ storage: local, request: syncRequest }, 60_000)
  assert.equal(typeof onHide, 'function')
  onHide()
  await Promise.race([
    writeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('local loopback PUT did not reach server')), 5000)),
  ])
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].method, 'PUT')
  assert.equal(h.calls[0].keepalive, true)
  assert.ok(h.calls[0].signal instanceof AbortSignal)
  assert.equal(h.calls[0].signal.aborted, false)
  stop()
  assert.equal(h.calls[0].signal.aborted, true, 'stop must abort the actual native fetch')
  release({ conflict: false, record })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(local.getItem(SYNC_META_STORAGE), null, 'late response must never mark unsynced plan saved')
  assert.equal(local.getItem(PLAN), PLAN_VALUE)
  assert.equal(local.getItem(PRIVATE_M3), 'offline-only-private-M3')
})
