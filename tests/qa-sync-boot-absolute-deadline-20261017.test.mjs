import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

// Bundle the actual TypeScript entrypoint in memory using the installed Vite
// toolchain. This runs the product implementation, not a shadow copy, and also
// works on Node installations compiled without native TypeScript stripping.
const { outputFiles } = await build({
  entryPoints: [new URL('../src/lib/syncBoot.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  write: false, logLevel: 'silent',
})
const { syncBeforeRender } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

function mockBrowser(t, request) {
  const originals = Object.fromEntries(['window', 'document', 'fetch', 'setInterval', 'clearInterval'].map(k => [k, globalThis[k]]))
  t.after(() => { for (const [k, v] of Object.entries(originals)) {
    if (v === undefined) delete globalThis[k]
    else globalThis[k] = v
  } })
  const values = new Map([['supa:device-key:v1', 'Q'.repeat(43)], ['supa:planner-preferences:v2', '{"budget":35,"activeDays":["Ma"],"recipeByDay":{}}'], ['supa:m3-observation-draft:v1', 'private-synthetic-not-for-sync']])
  let intervals = 0
  globalThis.window = { localStorage: {
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: k => values.delete(k),
  } }
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.fetch = request
  globalThis.setInterval = () => { intervals++; return 1 }
  globalThis.clearInterval = () => {}
  return { values, intervals: () => intervals }
}

async function settleWithin(promise, ms = 350) {
  let timer
  try {
    return await Promise.race([
      promise.then(() => 'settled', () => 'settled'),
      new Promise(resolve => { timer = setTimeout(() => resolve('stalled'), ms) }),
    ])
  } finally { clearTimeout(timer) }
}

test('positive: normal unavailable sync GET does not block bootstrap or expose M3 draft', async t => {
  const mock = mockBrowser(t, async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }))
  assert.equal(await settleWithin(syncBeforeRender(15)), 'settled')
  assert.equal(mock.intervals(), 1, 'background retry should start after the boot attempt')
  assert.equal(mock.values.get('supa:m3-observation-draft:v1'), 'private-synthetic-not-for-sync')
})

test('P1: an abort-ignoring pending fetch may not keep first render stuck past waitMs', async t => {
  const mock = mockBrowser(t, () => new Promise(() => {}))
  assert.equal(await settleWithin(syncBeforeRender(15)), 'settled',
    'the deadline must resolve bootstrap even if an injected transport ignores AbortSignal')
  assert.equal(mock.intervals(), 1, 'offline background retry must still be registered')
  assert.equal(mock.values.get('supa:m3-observation-draft:v1'), 'private-synthetic-not-for-sync')
})

test('P1: an indefinitely streaming JSON body may not stall bootstrap after abort', async t => {
  const mock = mockBrowser(t, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"revision":1')) }
    // No close: a stuck body reader whose synthetic stream ignores abort.
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  assert.equal(await settleWithin(syncBeforeRender(15)), 'settled',
    'response.json() can hang even after a fetch Response arrives')
  assert.equal(mock.intervals(), 1)
  assert.equal(mock.values.get('supa:m3-observation-draft:v1'), 'private-synthetic-not-for-sync')
})
