import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthorizedRetailerCaptureSession } from '../scripts/retailer-authorized-capture-session.mjs'

const approved = (retailer = 'plus') => {
  const url = retailer === 'plus'
    ? 'https://www.plus.nl/producten'
    : 'https://www.dekamarkt.nl/producten/melk'
  const source = { supermarket: retailer,
    kind: retailer === 'plus' ? 'catalog' : 'product', url }
  return {
    source,
    permissionGate: {
      version: 1, milestone: 'M1 Data Feasibility',
      reviewedAt: '2026-10-14',
      sources: ['plus', 'dekamarkt'].map(supermarket => ({
        supermarket, technicalStatus: 'proven',
        permissionStatus: 'permitted', productionEnabled: true,
        evidence: [{ kind: 'written_permission',
          url: 'https://example.test/synthetic-test-not-a-license',
          finding: 'SYNTHETIC NODE TEST ONLY; not source authorization.' }],
      })),
    },
    grant: {
      supermarket: retailer, kind: source.kind, sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: '2026-10-14T12:00:00.000Z',
  }
}
const html = '<html><body><div class="product-card">synthetic</div></body></html>'
const ok = async () => new Response(html, {
  status: 200, headers: { 'content-type': 'text/html' },
})

test('real unapproved M1 rights prevent transport and consume zero quota', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  const input = approved()
  input.permissionGate.sources[0].permissionStatus = 'permission_required'
  input.permissionGate.sources[0].productionEnabled = false
  let called = 0
  await assert.rejects(session.captureOne({
    ...input, fetchFn: async () => { called++; return ok() },
  }), /Explicit retailer source permission required/)
  assert.equal(called, 0)
  assert.equal(session.status().stores.plus.attemptedCaptures, 0)
})

test('one authorized mocked capture per host; immediate repeats refused by host rate budget', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  let calls = 0
  const capture = async retailer => session.captureOne({
    ...approved(retailer),
    fetchFn: async (...args) => {
      calls++
      assert.equal(args[1].credentials, 'omit')
      assert.equal(args[1].redirect, 'error')
      return ok()
    },
  })
  const plus = await capture('plus')
  const deka = await capture('dekamarkt')
  assert.equal(plus.html, html)
  assert.equal(deka.html, html)
  assert.equal(plus.published, false)
  assert.equal(deka.readyForIngestion, false)
  await assert.rejects(capture('plus'), /Retailer capture session refused/)
  assert.equal(calls, 2)
  assert.equal(session.status().stores.plus.attemptedCaptures, 1)
  assert.equal(session.status().stores.dekamarkt.attemptedCaptures, 1)
  assert.equal(session.status().scheduledCaptureEnabled, false)
})

test('HTTP 403/429 permanently hard-stop that host within this session, no rotation', async () => {
  for (const code of [403, 429]) {
    const session = createAuthorizedRetailerCaptureSession()
    let calls = 0
    const fn = async () => { calls++; return new Response('', { status: code }) }
    await assert.rejects(session.captureOne({ ...approved(), fetchFn: fn }),
      /Retailer refused or rate-limited capture/)
    assert.equal(session.status().stores.plus.hardStopped, true)
    await assert.rejects(session.captureOne({ ...approved(), fetchFn: fn }),
      /Retailer capture session refused/)
    assert.equal(calls, 1)
    assert.equal(session.status().proxyRotationEnabled, false)
    assert.equal(session.status().automaticRetries, 0)
  }
})

test('three successes consume per-host quota even when time passes', async t => {
  const tick = Date.parse('2026-10-15T12:00:00.000Z')
  let ms = tick
  t.mock.method(Date, 'now', () => ms)
  const session = createAuthorizedRetailerCaptureSession()
  let calls = 0
  for (let i = 0; i < 3; i++) {
    await session.captureOne({
      ...approved(), fetchFn: async () => { calls++; return ok() },
    })
    ms += 11_000
  }
  await assert.rejects(session.captureOne({
    ...approved(), fetchFn: async () => { calls++; return ok() },
  }), /Retailer capture session refused/)
  assert.equal(calls, 3)
  assert.equal(session.status().stores.plus.quotaExhausted, true)
})

test('transport errors impose cooldown, no immediate automatic retry', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  let calls = 0
  const fn = async () => { calls++; throw Error('synthetic secret/credential marker') }
  await assert.rejects(session.captureOne({ ...approved(), fetchFn: fn }),
    /^Error: Retailer capture session refused$/)
  await assert.rejects(session.captureOne({ ...approved(), fetchFn: fn }),
    /Retailer capture session refused/)
  assert.equal(calls, 1)
  assert.equal(session.status().stores.plus.hardStopped, false)
})

test('in-flight promise reserves host without waiting or launching a second request', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  let release
  let started
  const entered = new Promise(resolve => { started = resolve })
  const transport = () => {
    started()
    return new Promise(resolve => { release = () => resolve(ok()) })
  }
  const first = session.captureOne({ ...approved(), fetchFn: transport })
  await entered
  assert.equal(session.status().stores.plus.busy, true)
  let secondCalled = false
  await assert.rejects(session.captureOne({
    ...approved(), fetchFn: async () => { secondCalled = true; return ok() },
  }), /Retailer capture session refused/)
  assert.equal(secondCalled, false)
  release()
  await first
  assert.equal(session.status().stores.plus.busy, false)
})

test('direct caller inherited and accessor properties cannot activate transport', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  let getterCalls = 0, networkCalls = 0
  const input = approved()
  Object.defineProperty(input, 'fetchFn', {
    enumerable: true, get() { getterCalls++; return async () => { networkCalls++ } },
  })
  await assert.rejects(session.captureOne(input),
    /Retailer capture session refused/)
  const inherited = Object.create({ fetchFn: async () => { networkCalls++ } })
  Object.assign(inherited, approved())
  await assert.rejects(session.captureOne(inherited),
    /Retailer capture session refused/)
  await assert.rejects(session.captureOne(new Proxy(approved(), {})),
    /Retailer capture session refused/)
  assert.equal(getterCalls, 0)
  assert.equal(networkCalls, 0)
})

test('stream body remains host-locked until source integrity read completes', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  let streamController
  let streamStarted
  const entered = new Promise(resolve => { streamStarted = resolve })
  const stream = new ReadableStream({
    start(controller) { streamController = controller },
  })
  const first = session.captureOne({
    ...approved(),
    fetchFn: async () => {
      streamStarted()
      return new Response(stream, { status: 200,
        headers: { 'content-type': 'text/html' } })
    },
  })
  await entered
  // Let the async body reader block on a still-open stream.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.status().stores.plus.busy, true)
  let extraNetwork = false
  await assert.rejects(session.captureOne({
    ...approved(), fetchFn: async () => { extraNetwork = true; return ok() },
  }), /Retailer capture session refused/)
  assert.equal(extraNetwork, false)
  streamController.enqueue(new TextEncoder().encode(html))
  streamController.close()
  const result = await first
  assert.equal(result.html, html)
  assert.equal(session.status().stores.plus.busy, false)
})

test('nested permission getter is never executed before transport', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  const input = approved()
  let getterCalls = 0, calls = 0
  Object.defineProperty(input.grant, 'reviewed', {
    enumerable: true,
    get() { getterCalls++; return true },
  })
  await assert.rejects(session.captureOne({
    ...input, fetchFn: async () => { calls++; return ok() },
  }), /Authorized capture requires inert permission data/)
  assert.equal(getterCalls, 0)
  assert.equal(calls, 0)
  assert.equal(session.status().stores.plus.attemptedCaptures, 0)
})

test('no implicit fetch or scheduler is available', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  await assert.rejects(session.captureOne(approved()),
    /Retailer capture session refused/)
  assert.equal(session.status().stores.plus.attemptedCaptures, 0)
})

test('verified capture counter only increments after complete HTML integrity checks', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  let calls = 0
  const invalid = async () => {
    calls++
    return new Response('{"synthetic":true}', {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  await assert.rejects(session.captureOne({
    ...approved(), fetchFn: invalid,
  }), /Source did not return HTML/)
  const refused = session.status().stores.plus
  assert.equal(refused.successfulHttpResponses, 1)
  assert.equal(refused.verifiedCaptures, 0)
  assert.equal(refused.busy, false)
  assert.equal(refused.attemptedCaptures, 1)
  assert.equal(calls, 1)
  assert.equal(session.status().publicPricePublicationEnabled, false)
})

test('real completed mock HTML increments verification only for that retailer', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  const before = session.status()
  assert.equal(before.stores.plus.verifiedCaptures, 0)
  assert.equal(before.stores.dekamarkt.verifiedCaptures, 0)
  const result = await session.captureOne({
    ...approved('dekamarkt'), fetchFn: ok,
  })
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.published, false)
  const after = session.status()
  assert.equal(after.stores.dekamarkt.successfulHttpResponses, 1)
  assert.equal(after.stores.dekamarkt.verifiedCaptures, 1)
  assert.equal(after.stores.plus.verifiedCaptures, 0)
  assert.equal(after.stores.plus.successfulHttpResponses, 0)
})

test('failed HTML stream does not count as verified even if headers were 200', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  const badBody = async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('synthetic stream failure')) },
  }), { status: 200, headers: { 'content-type': 'text/html' } })
  await assert.rejects(session.captureOne({
    ...approved(), fetchFn: badBody,
  }))
  assert.equal(session.status().stores.plus.successfulHttpResponses, 1)
  assert.equal(session.status().stores.plus.verifiedCaptures, 0)
  assert.equal(session.status().stores.plus.busy, false)
})

test('200 body validation failures impose 60-second cooldown beyond normal 10-second interval', async t => {
  let now = Date.parse('2026-10-15T12:00:00.000Z')
  t.mock.method(Date, 'now', () => now)
  const session = createAuthorizedRetailerCaptureSession()
  let transportCalls = 0
  const request = () => session.captureOne({
    ...approved(),
    fetchFn: async () => {
      transportCalls++
      if (transportCalls === 1) {
        return new Response('not HTML', {
          status: 200, headers: { 'content-type': 'text/plain' },
        })
      }
      return ok()
    },
  })
  await assert.rejects(request(), /Source did not return HTML/)
  assert.equal(session.status().stores.plus.verifiedCaptures, 0)
  now += 11_000
  // One normal host gap has elapsed, but the failed BODY has not cooled down.
  await assert.rejects(request(), /Retailer capture session refused/)
  assert.equal(transportCalls, 1)
  now += 50_000
  const recovered = await request()
  assert.equal(recovered.published, false)
  assert.equal(recovered.readyForIngestion, false)
  assert.equal(transportCalls, 2)
  assert.equal(session.status().stores.plus.successfulHttpResponses, 2)
  assert.equal(session.status().stores.plus.verifiedCaptures, 1)
  assert.equal(session.status().stores.plus.attemptedCaptures, 2)
})
