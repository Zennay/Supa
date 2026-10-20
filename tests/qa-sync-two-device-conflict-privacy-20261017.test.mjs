import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import {
  DEVICE_KEY_STORAGE, SYNC_META_STORAGE, SYNC_KEYS,
  pullSyncedState, pushSyncedState,
} from '../src/lib/supaSync.ts'

// New independent QA on frozen DRAFT product #3777. All identity keys and
// basket contents are synthetic. No external network or real retailer data.
const PLAN = 'supa:planner-preferences:v2'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE_M3 = 'supa:m3-observation-draft:v1'
const DEVICE = 'a'.repeat(43)
const ORIGIN = 'https://supa-synthetic-device-qa.invalid'
const plan = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const shop = checked => JSON.stringify({
  schemaVersion: 1,
  basketKey: 'fictional-basket:v1',
  doneLineIds: checked,
})

function storage(seed={}) {
  const items = new Map(Object.entries(seed))
  return {
    getItem: key => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
  }
}

async function withLocalApi(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-conflict-merge-'))
  const server = createRecipeServer({
    root, origin: ORIGIN, syncStore: createFileSyncStore({ dir: join(root, 'sync') }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  return init => fetch('http://127.0.0.1:' + server.address().port + '/api/sync', {
    ...init,
    headers: { ...init.headers, Origin: ORIGIN },
  })
}

test('two devices merge nonoverlapping changed planner/shopping records across HTTP 409; private M3 stays local', async t => {
  const request = await withLocalApi(t)
  const m3 = JSON.stringify({ participantKey: 'FICTIONAL_M3_PRIVATE_20261017', evidenceStatus: 'collection-template-not-evidence' })
  const phone = storage({
    [DEVICE_KEY_STORAGE]: DEVICE,
    [PLAN]: plan(35),
    [SHOP]: shop(['synthetic-1']),
    [PRIVATE_M3]: m3,
  })
  const tablet = storage({ [DEVICE_KEY_STORAGE]: DEVICE })

  assert.equal(await pushSyncedState({ storage: phone, request }), 'saved')
  assert.deepEqual(new Set(await pullSyncedState({ storage: tablet, request })), new Set([PLAN, SHOP]))
  assert.equal(tablet.getItem(PLAN), plan(35))
  assert.equal(tablet.getItem(SHOP), shop(['synthetic-1']))
  assert.equal(tablet.getItem(PRIVATE_M3), null, 'private M3 observation is intentionally device-local')
  assert.equal(phone.getItem(PRIVATE_M3), m3, 'phone draft stays untouched')

  // Phone changes planner, tablet independently checks another product.
  phone.setItem(PLAN, plan(42))
  tablet.setItem(SHOP, shop(['synthetic-1', 'synthetic-2']))
  assert.equal(await pushSyncedState({ storage: phone, request }), 'saved')
  assert.equal(await pushSyncedState({ storage: tablet, request }), 'saved',
    'tablet must retry its genuine 409 conflict after preserving the phone plan')
  assert.equal(tablet.getItem(PLAN), plan(42), 'server planner edit must be adopted during 409 merge')
  assert.equal(tablet.getItem(SHOP), shop(['synthetic-1', 'synthetic-2']),
    'locally unsynced checkbox changes must survive 409 merge')
  assert.equal(tablet.getItem(PRIVATE_M3), null)
  assert.equal(phone.getItem(PRIVATE_M3), m3)

  assert.deepEqual(await pullSyncedState({ storage: phone, request }), [SHOP])
  assert.equal(phone.getItem(PLAN), plan(42))
  assert.equal(phone.getItem(SHOP), shop(['synthetic-1', 'synthetic-2']))
  assert.equal(phone.getItem(PRIVATE_M3), m3)
  for (const browser of [phone, tablet]) {
    const meta = JSON.parse(browser.getItem(SYNC_META_STORAGE))
    assert.equal(meta.revision, 3)
    assert.equal(meta.synced[PLAN], plan(42))
    assert.equal(meta.synced[SHOP], shop(['synthetic-1', 'synthetic-2']))
    assert.equal(Object.keys(meta.synced).length, SYNC_KEYS.length)
    assert.equal(Object.hasOwn(meta.synced, PRIVATE_M3), false)
  }
})

test('missing API cannot erase existing synthetic shopping progress, M3 draft, or sync metadata', async () => {
  const m3 = '{"synthetic":"private-operator-draft"}'
  const meta = JSON.stringify({ revision: 7, synced: { [PLAN]: plan(35), [SHOP]: shop(['x']) } })
  const browser = storage({
    [DEVICE_KEY_STORAGE]: DEVICE,
    [PLAN]: plan(36),
    [SHOP]: shop(['x']),
    [PRIVATE_M3]: m3,
    [SYNC_META_STORAGE]: meta,
  })
  const noApi = async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
  assert.deepEqual(await pullSyncedState({ storage: browser, request: noApi }), [])
  assert.equal(await pushSyncedState({ storage: browser, request: noApi }), 'no-api')
  assert.equal(browser.getItem(PLAN), plan(36))
  assert.equal(browser.getItem(SHOP), shop(['x']))
  assert.equal(browser.getItem(PRIVATE_M3), m3)
  assert.equal(browser.getItem(SYNC_META_STORAGE), meta)
})
