import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Exercise the actual client implementation without depending on this VPS's
// Node build being compiled with the experimental TypeScript parser.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/supaSync.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  write: false, logLevel: 'silent',
})
const { startBackgroundSync, SYNC_META_STORAGE, DEVICE_KEY_STORAGE } =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

const PLAN = 'supa:planner-preferences:v2'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const privateDraft = 'synthetic-private-M3-never-sync'

function browser(t, request) {
  const saved = Object.fromEntries(
    ['setInterval', 'clearInterval', 'document', 'window'].map(k => [k, globalThis[k]]),
  )
  t.after(() => {
    for (const [k, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[k]
      else globalThis[k] = value
    }
  })
  let tick = null
  let cleared = 0
  let requestCount = 0
  const listeners = new Map()
  globalThis.setInterval = fn => { tick = fn; return 101 }
  globalThis.clearInterval = id => { assert.equal(id, 101); cleared++ }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type)
    },
  }
  const map = new Map([
    [DEVICE_KEY_STORAGE, 'Q'.repeat(43)],
    [PLAN, plan],
    [PRIVATE, privateDraft],
  ])
  const storage = {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  }
  const stop = startBackgroundSync({ storage, request: async init => {
    requestCount++
    return request(init)
  } }, 4000)
  return {
    stop,
    fire: () => { assert.ok(tick); tick() },
    map,
    listeners,
    requests: () => requestCount,
    cleared: () => cleared,
  }
}

async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve() }
const status = code => new Response('{}', { status: code, headers: { 'Content-Type': 'application/json' } })

test('positive: transient HTTP 503 keeps retry timer and visibility handler active', async t => {
  const b = browser(t, async () => status(503))
  b.fire(); await flush()
  assert.equal(b.requests(), 1)
  assert.equal(b.cleared(), 0)
  assert.ok(b.listeners.has('visibilitychange'))
  b.fire(); await flush()
  assert.equal(b.requests(), 2)
  assert.equal(b.map.get(PRIVATE), privateDraft)
  b.stop()
})

test('P2: static-host HTTP 404 terminal no-api result retires interval and listener', async t => {
  const b = browser(t, async () => status(404))
  b.fire(); await flush()
  assert.equal(b.requests(), 1)
  assert.equal(b.cleared(), 1, 'terminal no-api result must clear the periodic timer, not just set stopped=true')
  assert.equal(b.listeners.has('visibilitychange'), false, 'terminal result must remove global visibility handler')
  assert.equal(b.map.get(PRIVATE), privateDraft)
})

test('P2: permanent HTTP 422 rejected sync retires timer and visibility handler', async t => {
  const b = browser(t, async () => status(422))
  b.fire(); await flush()
  assert.equal(b.requests(), 1)
  assert.equal(b.cleared(), 1, 'rejected records must not keep a dormant interval for app lifetime')
  assert.equal(b.listeners.has('visibilitychange'), false)
  assert.equal(b.map.get(PRIVATE), privateDraft)
})

test('positive: explicit stop synchronously removes both resources and prevents new requests', async t => {
  const b = browser(t, async () => status(503))
  b.stop()
  assert.equal(b.cleared(), 1)
  assert.equal(b.listeners.has('visibilitychange'), false)
  b.fire(); await flush()
  assert.equal(b.requests(), 0)
  assert.equal(b.map.get(PRIVATE), privateDraft)
})

test('P2: disposing during an in-flight PUT may not later mutate browser sync metadata', async t => {
  let resolveRequest
  const b = browser(t, () => new Promise(resolve => { resolveRequest = resolve }))
  b.fire(); await flush()
  assert.equal(b.requests(), 1)
  assert.equal(typeof resolveRequest, 'function')
  const before = [...b.map].sort(([a], [b]) => a.localeCompare(b))
  b.stop()
  resolveRequest(new Response(JSON.stringify({ revision: 1 }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }))
  await flush()
  assert.equal(b.map.get(SYNC_META_STORAGE), null,
    'a disposed background job must not treat an out-of-lifetime 200 as a fresh save')
  assert.deepEqual([...b.map].sort(([a], [b]) => a.localeCompare(b)), before)
  assert.equal(b.map.get(PRIVATE), privateDraft)
})
