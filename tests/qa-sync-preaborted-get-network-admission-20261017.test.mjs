import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Supplementary independent QA: test the production GET half of device sync,
// without editing the earlier immutable PUT fail-first tests or requesting HTTP.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/supaSync.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  write: false, logLevel: 'silent',
})
const { pullSyncedState, DEVICE_KEY_STORAGE, SYNC_META_STORAGE } =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const remotePlan = JSON.stringify({ budget: 37, activeDays: ['Ma'], recipeByDay: {} })
const success = () => new Response(JSON.stringify({
  revision: 1,
  entries: { [PLAN]: remotePlan, [LIB]: null, [SHOP]: null },
}), { status: 200, headers: { 'content-type': 'application/json' } })

function storage(onRead = () => {}) {
  const values = new Map([
    [DEVICE_KEY_STORAGE, 'G'.repeat(43)],
    [PRIVATE, 'fictional-M3-local-only'],
  ])
  return {
    values,
    getItem(key) { onRead(key); return values.get(key) ?? null },
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

test('positive: uncancelled GET restores canonical planner and never reads private M3 into network', async () => {
  const store = storage()
  const controller = new AbortController()
  const calls = []
  assert.deepEqual(await pullSyncedState({
    storage: store,
    request: async init => { calls.push(init); return success() },
  }, controller.signal), [PLAN])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, undefined)
  assert.equal(calls[0].signal, controller.signal)
  assert.equal(JSON.parse(store.getItem(SYNC_META_STORAGE)).revision, 1)
  assert.equal(store.getItem(PLAN), remotePlan)
  assert.equal(store.getItem(PRIVATE), 'fictional-M3-local-only')
})

test('P2: already-aborted bootstrap GET must not dispatch a fresh network request', async () => {
  const controller = new AbortController()
  controller.abort()
  const store = storage()
  let calls = 0
  const changed = await pullSyncedState({
    storage: store,
    request: async () => { calls++; return success() },
  }, controller.signal)
  assert.deepEqual(changed, [])
  assert.equal(calls, 0, 'a cancelled bootstrap is not permitted to dispatch a GET')
  assert.equal(store.getItem(SYNC_META_STORAGE), null)
  assert.equal(store.getItem(PLAN), null)
  assert.equal(store.getItem(PRIVATE), 'fictional-M3-local-only')
})

test('P2: abort while loading device identity must suppress the subsequent GET', async () => {
  const controller = new AbortController()
  let once = false
  const store = storage(key => {
    if (key === DEVICE_KEY_STORAGE && !once) {
      once = true
      controller.abort()
    }
  })
  let calls = 0
  const changed = await pullSyncedState({
    storage: store,
    request: async () => { calls++; return success() },
  }, controller.signal)
  assert.deepEqual(changed, [])
  assert.equal(calls, 0, 'an abort occurring while opening local identity must fence the GET')
  assert.equal(store.getItem(SYNC_META_STORAGE), null)
  assert.equal(store.getItem(PLAN), null)
  assert.equal(store.getItem(PRIVATE), 'fictional-M3-local-only')
})
