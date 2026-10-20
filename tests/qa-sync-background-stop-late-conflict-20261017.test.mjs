import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Independent sibling suite: keeps the original five-case lifecycle file
// byte-identical for owner RED -> GREEN replay.
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/supaSync.ts', import.meta.url))],
  platform: 'node', format: 'esm', bundle: true, target: 'node22', write: false, logLevel: 'silent',
})
const { startBackgroundSync, DEVICE_KEY_STORAGE, SYNC_META_STORAGE } =
  await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))

const PLAN = 'supa:planner-preferences:v2'
const SHOP = 'supa:shopping-list-progress:v1'
const LIBRARY = 'supa.recipe-library.v1'
const PRIVATE = 'supa:m3-observation-draft:v1'
const localPlan = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const remoteShopping = JSON.stringify({ schemaVersion: 1, basketKey: 'synthetic', doneLineIds: ['synthetic-item'] })
const conflict = () => new Response(JSON.stringify({
  revision: 1,
  entries: { [PLAN]: null, [LIBRARY]: null, [SHOP]: remoteShopping },
}), { status: 409, headers: { 'Content-Type': 'application/json' } })
const saved = () => new Response(JSON.stringify({ revision: 2 }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
})

function fixture(t, request) {
  const old = Object.fromEntries(['setInterval', 'clearInterval', 'document'].map(k => [k, globalThis[k]]))
  t.after(() => { for (const [k, value] of Object.entries(old)) {
    if (value === undefined) delete globalThis[k]
    else globalThis[k] = value
  } })
  let tick, cleared = 0, requests = 0
  const listeners = new Map()
  globalThis.setInterval = fn => { tick = fn; return 99 }
  globalThis.clearInterval = id => { assert.equal(id, 99); cleared++ }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name)
    },
  }
  const data = new Map([[DEVICE_KEY_STORAGE, 'Q'.repeat(43)], [PLAN, localPlan], [PRIVATE, 'synthetic-private-m3']])
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  }
  const stop = startBackgroundSync({ storage, request: init => { requests++; return request(init) } })
  return { fire: () => tick(), stop, data, requests: () => requests, cleaned: () => cleared, listeners }
}
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

test('positive: active background sync can adopt a valid 409 and retry with one 200', async t => {
  let index = 0
  const b = fixture(t, async () => (++index === 1 ? conflict() : saved()))
  b.fire(); await flush()
  assert.equal(b.requests(), 2)
  assert.equal(b.data.get(SHOP), remoteShopping)
  assert.equal(JSON.parse(b.data.get(SYNC_META_STORAGE)).revision, 2)
  assert.equal(b.data.get(PLAN), localPlan)
  assert.equal(b.data.get(PRIVATE), 'synthetic-private-m3')
  b.stop()
})

test('P2: disposal before a delayed HTTP 409 must not adopt shopping or retry PUT', async t => {
  let answer
  const b = fixture(t, () => new Promise(resolve => { answer = resolve }))
  b.fire(); await flush()
  assert.equal(b.requests(), 1)
  assert.equal(typeof answer, 'function')
  const before = [...b.data.entries()]
  b.stop()
  answer(conflict()); await flush()
  assert.equal(b.requests(), 1, 'the disposed task may not start an additional CAS retry')
  assert.deepEqual([...b.data.entries()], before, 'a post-disposal 409 must not adopt remote shopping')
  assert.equal(b.data.get(PRIVATE), 'synthetic-private-m3')
  assert.equal(b.cleaned(), 1)
  assert.equal(b.listeners.size, 0)
})
