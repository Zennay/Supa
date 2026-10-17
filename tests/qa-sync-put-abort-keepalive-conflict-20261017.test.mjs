import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/supaSync.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  write: false, logLevel: 'silent',
})
const { pushSyncedState, DEVICE_KEY_STORAGE, SYNC_META_STORAGE } =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const remote = () => new Response(JSON.stringify({
  revision: 1, entries: { [PLAN]: null, [LIB]: null, [SHOP]: null },
}), { status: 409, headers: { 'content-type': 'application/json' } })
const saved = () => new Response(JSON.stringify({ revision: 2 }), {
  status: 200, headers: { 'content-type': 'application/json' },
})

function fixture() {
  const data = new Map([
    [DEVICE_KEY_STORAGE, 'V'.repeat(43)],
    [PLAN, plan],
    [PRIVATE, 'synthetic-private-M3'],
  ])
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    data,
  }
}

async function exercise({ signal, keepalive }) {
  const storage = fixture()
  const attempts = []
  const result = await pushSyncedState({
    storage,
    request: async init => {
      attempts.push(init)
      return attempts.length === 1 ? remote() : saved()
    },
  }, { signal, keepalive })
  return { storage, attempts, result }
}

test('positive: active 409 -> 200 preserves keepalive, unsynced plan and private M3 draft', async () => {
  const { storage, attempts, result } = await exercise({ keepalive: true })
  assert.equal(result, 'saved')
  assert.equal(attempts.length, 2)
  assert.ok(attempts.every(init => init.keepalive === true && init.method === 'PUT'))
  assert.equal(storage.getItem(PLAN), plan)
  assert.equal(storage.getItem(PRIVATE), 'synthetic-private-M3')
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
})

test('P2: both 409 CAS attempts in a cancellable keepalive session forward the identical AbortSignal', async () => {
  const controller = new AbortController()
  const { storage, attempts, result } = await exercise({ signal: controller.signal, keepalive: true })
  assert.equal(result, 'saved')
  assert.equal(attempts.length, 2)
  for (const [index, init] of attempts.entries()) {
    assert.equal(init.method, 'PUT')
    assert.equal(init.keepalive, true)
    assert.equal(init.signal, controller.signal, 'retry attempt ' + (index + 1) + ' must propagate cancellation')
  }
  assert.equal(storage.getItem(PRIVATE), 'synthetic-private-M3')
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 2)
})
