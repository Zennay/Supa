import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Independent quality validation: use the real production sync client.
// Fixture requests remain local functions; no HTTP, retailers or personal data.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/supaSync.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  write: false, logLevel: 'silent',
})
const { pushSyncedState, DEVICE_KEY_STORAGE, SYNC_META_STORAGE } =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

const PLAN = 'supa:planner-preferences:v2'
const PRIVATE_M3 = 'supa:m3-observation-draft:v1'
const savedPlan = JSON.stringify({ budget: 42, activeDays: ['Ma'], recipeByDay: {} })
const ack = () => new Response(JSON.stringify({ revision: 1 }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

function fixture({ onRead } = {}) {
  const values = new Map([
    [DEVICE_KEY_STORAGE, 'Q'.repeat(43)],
    [PLAN, savedPlan],
    [PRIVATE_M3, 'synthetic-private-M3-never-sync'],
  ])
  const storage = {
    getItem(key) {
      onRead?.(key)
      return values.get(key) ?? null
    },
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
  return { storage, values }
}

test('control: an active cancellation signal allows a normal acknowledged foreground PUT', async () => {
  const controller = new AbortController()
  const { storage, values } = fixture()
  const calls = []
  const result = await pushSyncedState({
    storage,
    request: async init => { calls.push(init); return ack() },
  }, { signal: controller.signal })
  assert.equal(result, 'saved')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'PUT')
  assert.equal(JSON.parse(storage.getItem(SYNC_META_STORAGE)).revision, 1)
  assert.equal(values.get(PRIVATE_M3), 'synthetic-private-M3-never-sync')
})

test('P2: pre-aborted foreground sync must not issue any network PUT or mark local data synced', async () => {
  const controller = new AbortController()
  controller.abort()
  const { storage, values } = fixture()
  let networkCalls = 0
  const result = await pushSyncedState({
    storage,
    request: async () => { networkCalls++; return ack() },
  }, { signal: controller.signal })
  assert.equal(result, 'unavailable')
  assert.equal(networkCalls, 0, 'an already cancelled caller must not enqueue a PUT')
  assert.equal(storage.getItem(SYNC_META_STORAGE), null)
  assert.equal(values.get(PLAN), savedPlan)
  assert.equal(values.get(PRIVATE_M3), 'synthetic-private-M3-never-sync')
})

test('P2: cancellation during synchronous local snapshot collection must prevent the subsequent PUT', async () => {
  const controller = new AbortController()
  let cancelled = false
  const { storage, values } = fixture({
    onRead(key) {
      if (key === PLAN && !cancelled) {
        cancelled = true
        controller.abort()
      }
    },
  })
  let networkCalls = 0
  const result = await pushSyncedState({
    storage,
    request: async () => { networkCalls++; return ack() },
  }, { signal: controller.signal })
  assert.equal(result, 'unavailable')
  assert.equal(networkCalls, 0, 'a cancellation raised while building the snapshot must suppress the PUT')
  assert.equal(storage.getItem(SYNC_META_STORAGE), null)
  assert.equal(values.get(PLAN), savedPlan)
  assert.equal(values.get(PRIVATE_M3), 'synthetic-private-M3-never-sync')
})
