import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import {
  DEVICE_KEY_STORAGE, SYNC_META_STORAGE,
  pullSyncedState, pushSyncedState,
} from '../src/lib/supaSync.ts'

// Independent QA on DRAFT product #3777: intentional deletion and server
// storage-loss replay. No real shopping IDs, human M3 data, or retailer HTTP.
const ORIGIN = 'https://supa-qa-only.invalid'
const DEVICE = 'b'.repeat(43)
const PLAN = 'supa:planner-preferences:v2'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const planner = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const shopping = doneLineIds => JSON.stringify({
  schemaVersion: 1,
  basketKey: 'synthetic-fixed-basket',
  doneLineIds,
})

function memoryStorage(seed={}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  }
}

async function localServer(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-sync-recovery-'))
  const dir = join(root, 'sync')
  t.after(() => rm(root, { recursive: true, force: true }))
  async function start() {
    const server = createRecipeServer({
      root, origin: ORIGIN, syncStore: createFileSyncStore({ dir }),
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + server.address().port
    return {
      request(init) {
        return fetch(base + '/api/sync', {
          ...init, headers: { ...init.headers, Origin: ORIGIN },
        })
      },
      async record() {
        const resp = await fetch(base + '/api/sync', {
          headers: { Authorization: 'Bearer ' + DEVICE },
        })
        assert.equal(resp.status, 200)
        return resp.json()
      },
      async stop() {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      },
    }
  }
  return { dir, start }
}

test('intentional shopping deletion syncs null without clearing planner or either device’s private M3 draft', async t => {
  const { start } = await localServer(t)
  const server = await start()
  const phone = memoryStorage({
    [DEVICE_KEY_STORAGE]: DEVICE,
    [PLAN]: planner(35),
    [SHOP]: shopping(['synthetic-1']),
    [PRIVATE]: 'local-field-draft-phone-not-evidence',
  })
  const tablet = memoryStorage({
    [DEVICE_KEY_STORAGE]: DEVICE,
    [PRIVATE]: 'local-field-draft-tablet-not-evidence',
  })
  try {
    assert.equal(await pushSyncedState({ storage: phone, request: server.request }), 'saved')
    await pullSyncedState({ storage: tablet, request: server.request })
    assert.equal(tablet.getItem(SHOP), shopping(['synthetic-1']))
    phone.removeItem(SHOP)
    assert.equal(await pushSyncedState({ storage: phone, request: server.request }), 'saved')
    assert.deepEqual(await pullSyncedState({ storage: tablet, request: server.request }), [SHOP])
    assert.equal(phone.getItem(PLAN), planner(35))
    assert.equal(tablet.getItem(PLAN), planner(35))
    assert.equal(phone.getItem(SHOP), null)
    assert.equal(tablet.getItem(SHOP), null)
    assert.equal(phone.getItem(PRIVATE), 'local-field-draft-phone-not-evidence')
    assert.equal(tablet.getItem(PRIVATE), 'local-field-draft-tablet-not-evidence')
    const persisted = await server.record()
    assert.equal(persisted.revision, 2)
    assert.equal(persisted.entries[SHOP], null)
    assert.equal(persisted.entries[PLAN], planner(35))
    assert.equal(Object.hasOwn(persisted.entries, PRIVATE), false)
  } finally { await server.stop() }
})

test('after losing server disk state, next sync rebuilds valid local planner/checklist without syncing private M3', async t => {
  const { dir, start } = await localServer(t)
  let server = await start()
  const phone = memoryStorage({
    [DEVICE_KEY_STORAGE]: DEVICE,
    [PLAN]: planner(36),
    [SHOP]: shopping(['synthetic-1', 'synthetic-2']),
    [PRIVATE]: 'local-field-draft-no-network',
  })
  try {
    assert.equal(await pushSyncedState({ storage: phone, request: server.request }), 'saved')
    phone.setItem(PLAN, planner(37))
    assert.equal(await pushSyncedState({ storage: phone, request: server.request }), 'saved')
    assert.equal(JSON.parse(phone.getItem(SYNC_META_STORAGE)).revision, 2)
  } finally { await server.stop() }

  // Model a wiped/restored server while the browser still has its own local
  // uncorrupted records: do not invent a real retail or participant event.
  await rm(dir, { recursive: true, force: true })
  server = await start()
  try {
    const empty = await server.record()
    assert.equal(empty.revision, 0)
    assert.deepEqual(await pullSyncedState({ storage: phone, request: server.request }), [])
    assert.equal(phone.getItem(PLAN), planner(37))
    assert.equal(phone.getItem(SHOP), shopping(['synthetic-1', 'synthetic-2']))
    assert.equal(phone.getItem(PRIVATE), 'local-field-draft-no-network')
    assert.equal(JSON.parse(phone.getItem(SYNC_META_STORAGE)).revision, 0)

    assert.equal(await pushSyncedState({ storage: phone, request: server.request }), 'saved')
    const recovered = await server.record()
    assert.equal(recovered.revision, 1)
    assert.equal(recovered.entries[PLAN], planner(37))
    assert.equal(recovered.entries[SHOP], shopping(['synthetic-1', 'synthetic-2']))
    assert.equal(Object.hasOwn(recovered.entries, PRIVATE), false)
    assert.equal(phone.getItem(PRIVATE), 'local-field-draft-no-network')
  } finally { await server.stop() }
})
