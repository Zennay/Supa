import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// QA-only retry boundary: production module + synchronous in-memory storage
// callback, no HTTP, no user or retailer observations.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/supaSync.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  write: false, logLevel: 'silent',
})
const { pushSyncedState, SYNC_META_STORAGE, DEVICE_KEY_STORAGE } =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

const PLAN = 'supa:planner-preferences:v2'
const RECIPES = 'supa.recipe-library.v1'
const SHOPPING = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const localPlan = JSON.stringify({ budget: 42, activeDays: ['Ma'], recipeByDay: {} })
const conflict = () => new Response(JSON.stringify({
  revision: 1,
  entries: { [PLAN]: null, [RECIPES]: null, [SHOPPING]: null },
}), { status: 409, headers: { 'content-type': 'application/json' } })
const success = () => new Response(JSON.stringify({ revision: 2 }), {
  status: 200, headers: { 'content-type': 'application/json' },
})

function fixture(onMetaWrite = () => {}) {
  const data = new Map([
    [DEVICE_KEY_STORAGE, 'R'.repeat(43)],
    [PLAN, localPlan],
    [PRIVATE, 'synthetic-private-hold'],
  ])
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      data.set(key, String(value))
      if (key === SYNC_META_STORAGE) onMetaWrite()
    },
    removeItem: key => data.delete(key),
  }
}

async function execute({ cancelOnAdopt = false } = {}) {
  const controller = new AbortController()
  const store = fixture(cancelOnAdopt ? () => controller.abort() : undefined)
  const calls = []
  const result = await pushSyncedState({
    storage: store,
    request: async init => {
      calls.push(init)
      return calls.length === 1 ? conflict() : success()
    },
  }, { signal: controller.signal })
  return { controller, store, calls, result }
}

test('control: noncancelled 409 CAS uses two PUT calls and retains local unsynced plan', async () => {
  const { store, calls, result, controller } = await execute()
  assert.equal(controller.signal.aborted, false)
  assert.equal(result, 'saved')
  assert.equal(calls.length, 2)
  assert.ok(calls.every(request => request.method === 'PUT'))
  assert.equal(store.getItem(PLAN), localPlan)
  assert.equal(JSON.parse(store.getItem(SYNC_META_STORAGE)).revision, 2)
  assert.equal(store.getItem(PRIVATE), 'synthetic-private-hold')
})

test('P2: stop during synchronous 409 metadata adoption must suppress the second PUT', async () => {
  const { store, calls, result, controller } = await execute({ cancelOnAdopt: true })
  assert.equal(controller.signal.aborted, true)
  assert.equal(result, 'unavailable')
  assert.equal(calls.length, 1, 'cancellation during adopt must not initiate another network PUT')
  assert.equal(JSON.parse(store.getItem(SYNC_META_STORAGE)).revision, 1)
  assert.equal(store.getItem(PLAN), localPlan, 'local planner edit remains unsynced')
  assert.equal(store.getItem(PRIVATE), 'synthetic-private-hold')
})
