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

test('no implicit fetch or scheduler is available', async () => {
  const session = createAuthorizedRetailerCaptureSession()
  await assert.rejects(session.captureOne(approved()),
    /Retailer capture session refused/)
  assert.equal(session.status().stores.plus.attemptedCaptures, 0)
})
