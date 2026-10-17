import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Independent QA only: bundle actual production client, not a copy of sync logic.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/supaSync.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  write: false, logLevel: 'silent',
})
const { startBackgroundSync, pushSyncedState, pullSyncedState, SYNC_META_STORAGE, DEVICE_KEY_STORAGE } =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

const PLAN = 'supa:planner-preferences:v2'
const PRIVATE = 'supa:m3-observation-draft:v1'
const plan = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const KEY = 'V'.repeat(43)
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

function storage() {
  const values = new Map([[DEVICE_KEY_STORAGE, KEY], [PLAN, plan], [PRIVATE, 'synthetic-private-M3']])
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  }
}

function start(t, request) {
  const original = Object.fromEntries(['setInterval', 'clearInterval', 'document'].map(key => [key, globalThis[key]]))
  t.after(() => { for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key]
    else globalThis[key] = value
  } })
  let callback
  let clears = 0
  const listeners = new Map()
  globalThis.setInterval = cb => { callback = cb; return 402 }
  globalThis.clearInterval = id => { assert.equal(id, 402); clears++ }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (event, cb) => listeners.set(event, cb),
    removeEventListener: (event, cb) => { if (listeners.get(event) === cb) listeners.delete(event) },
  }
  const store = storage()
  const stop = startBackgroundSync({ storage: store, request }, 4000)
  return { store, stop, fire: () => callback(), clears: () => clears, listeners }
}

test('positive: foreground PUT still saves normally without a caller cancellation signal', async () => {
  const store = storage()
  const calls = []
  assert.equal(await pushSyncedState({
    storage: store,
    request: init => { calls.push(init); return Promise.resolve(json({ revision: 1 })) },
  }), 'saved')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'PUT')
  assert.equal(JSON.parse(store.getItem(SYNC_META_STORAGE)).revision, 1)
  assert.equal(store.getItem(PRIVATE), 'synthetic-private-M3')
})

test('positive: initial GET already forwards its caller AbortSignal to the network transport', async () => {
  const store = storage()
  const controller = new AbortController()
  let received
  const result = await pullSyncedState({
    storage: store,
    request: init => { received = init.signal; return Promise.resolve(json({ revision: 0, entries: {} })) },
  }, controller.signal)
  assert.deepEqual(result, [])
  assert.equal(received, controller.signal)
  assert.equal(store.getItem(PRIVATE), 'synthetic-private-M3')
})

test('P2: a cancellable direct PUT must propagate the caller signal to request before awaiting transport', async () => {
  const store = storage()
  const controller = new AbortController()
  let received
  const result = await pushSyncedState({
    storage: store,
    request: init => { received = init.signal; return Promise.resolve(json({ revision: 1 })) },
  }, { signal: controller.signal })
  assert.equal(result, 'saved')
  assert.equal(received, controller.signal, 'the PUT network request must receive the explicit abort signal')
  assert.equal(store.getItem(PRIVATE), 'synthetic-private-M3')
})

test('P2: stopping background sync aborts a cooperative in-flight PUT instead of leaving transport hanging', async t => {
  let init
  let abortCount = 0
  const ctx = start(t, options => {
    init = options
    return new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => {
        abortCount++
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      }, { once: true })
    })
  })
  ctx.fire()
  await flush()
  assert.equal(init?.method, 'PUT')
  ctx.stop()
  await flush()
  assert.equal(ctx.clears(), 1)
  assert.equal(ctx.listeners.size, 0)
  assert.equal(init.signal?.aborted, true, 'disposing the client must abort the actual pending PUT transport')
  assert.equal(abortCount, 1)
  assert.equal(ctx.store.getItem(SYNC_META_STORAGE), null)
  assert.equal(ctx.store.getItem(PRIVATE), 'synthetic-private-M3')
})

test('P2: an aborted PUT must fail closed before consuming a successful-looking late HTTP 200', async () => {
  const store = storage()
  const controller = new AbortController()
  let requestSignal
  const result = await pushSyncedState({
    storage: store,
    request: init => {
      requestSignal = init.signal
      controller.abort()
      return Promise.resolve(json({ revision: 1 }))
    },
  }, { signal: controller.signal })
  assert.equal(result, 'unavailable')
  assert.equal(requestSignal, controller.signal)
  assert.equal(store.getItem(SYNC_META_STORAGE), null)
  assert.equal(store.getItem(PRIVATE), 'synthetic-private-M3')
})
