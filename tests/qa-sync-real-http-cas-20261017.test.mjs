import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import { pushSyncedState, pullSyncedState, SYNC_META_STORAGE, DEVICE_KEY_STORAGE } from '../src/lib/supaSync.ts'
import { syncRequest } from '../src/lib/syncTransport.ts'

// Separate immutable QA-only real-wire CAS follow-up. Only 127.0.0.1, private
// temporary files, fictional planners. No external sources or live users.
const PLAN = 'supa:planner-preferences:v2'
const PRIVATE = 'supa:m3-observation-draft:v1'
const KEY = 'J'.repeat(43)
const plan = (budget, day) => JSON.stringify({ budget, activeDays: [day], recipeByDay: {} })

const memory = initial => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

test('real HTTP CAS: two devices preserve unsynced planner edits across genuine 409 -> 200 retry', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-real-wire-cas-'))
  const server = createRecipeServer({
    root,
    origin: 'http://supa.test',
    syncStore: createFileSyncStore({ dir: join(root, 'sync') }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const realFetch = globalThis.fetch
  const issued = []
  globalThis.fetch = (url, init = {}) => {
    assert.equal(url, '/api/sync', 'production sync transport must remain same-origin scoped')
    issued.push(init)
    return realFetch(`http://127.0.0.1:${server.address().port}/api/sync`, {
      ...init, headers: { ...init.headers, Origin: 'http://supa.test' },
    })
  }
  t.after(async () => {
    globalThis.fetch = realFetch
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const phone = memory({ [DEVICE_KEY_STORAGE]: KEY, [PLAN]: plan(35, 'Ma'), [PRIVATE]: 'phone-private-M3' })
  const tablet = memory({ [DEVICE_KEY_STORAGE]: KEY, [PRIVATE]: 'tablet-private-M3' })
  const opts = storage => ({ storage, request: syncRequest })

  assert.equal(await pushSyncedState(opts(phone)), 'saved')
  assert.deepEqual(await pullSyncedState(opts(tablet)), [PLAN])
  assert.equal(tablet.getItem(PLAN), plan(35, 'Ma'))
  assert.equal(JSON.parse(tablet.getItem(SYNC_META_STORAGE)).revision, 1)

  // Both devices edit after the common revision. Phone wins revision 2;
  // tablet must retain its own unsynced edit when its PUT receives 409.
  phone.setItem(PLAN, plan(39, 'Di'))
  tablet.setItem(PLAN, plan(44, 'Wo'))
  assert.equal(await pushSyncedState(opts(phone)), 'saved')
  assert.equal(JSON.parse(phone.getItem(SYNC_META_STORAGE)).revision, 2)
  assert.equal(await pushSyncedState(opts(tablet)), 'saved',
    'server 409 must be rebased and retried over real HTTP')
  assert.equal(tablet.getItem(PLAN), plan(44, 'Wo'),
    'own unsynced planner bytes must survive the remote revision rebase')
  assert.equal(JSON.parse(tablet.getItem(SYNC_META_STORAGE)).revision, 3)

  assert.deepEqual(await pullSyncedState(opts(phone)), [PLAN])
  assert.equal(phone.getItem(PLAN), plan(44, 'Wo'))
  assert.equal(JSON.parse(phone.getItem(SYNC_META_STORAGE)).revision, 3)
  assert.equal(phone.getItem(PRIVATE), 'phone-private-M3')
  assert.equal(tablet.getItem(PRIVATE), 'tablet-private-M3')
  assert.deepEqual(issued.map(x => x.method ?? 'GET'), ['PUT', 'GET', 'PUT', 'PUT', 'PUT', 'GET'])
  assert.ok(issued.every(x => x.credentials === 'same-origin'))
})
