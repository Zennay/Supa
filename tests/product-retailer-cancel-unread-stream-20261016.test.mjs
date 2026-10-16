import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

// All mock permissions and response bodies are FICTIONAL, not source rights.
const url = 'https://www.plus.nl/producten'
const rights = () => ({
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fake-only-no-license',
      finding: 'FICTIONAL NODE MOCK, NEVER LIVE RETAILER PERMISSION' }],
  })),
})
const request = (fetchFn, permissionGate = rights()) => ({
  source: { supermarket: 'plus', kind: 'catalog', url },
  permissionGate,
  grant: { supermarket: 'plus', kind: 'catalog', sourceUrl: url,
    reviewed: true, termsReviewed: true, robotsReviewed: true,
    noAntiBotBypass: true },
  capturedAt: '2026-10-15T12:00:00.000Z',
  fetchFn,
})
function tracked(chunks) {
  let cancels = 0, reads = 0
  const values = [...chunks]
  const body = new ReadableStream({
    pull(controller) {
      reads++
      if (values.length) controller.enqueue(values.shift())
      else controller.close()
    },
    cancel() { cancels++ },
  })
  return { body, get cancels() { return cancels }, get reads() { return reads } }
}

test('body over 2 MiB cancels unread upstream instead of merely releasing a lock', async () => {
  const source = tracked([
    new Uint8Array(1024 * 1024),
    new Uint8Array(1024 * 1024 + 1),
    new Uint8Array(20),
  ])
  await assert.rejects(captureApprovedRetailerPage(request(async () =>
    new Response(source.body, { status: 200,
      headers: { 'content-type': 'text/html' } }))), /Snapshot exceeds size budget/)
  assert.equal(source.cancels, 1)
})

test('oversized declared length cancels already-open response body without reading content', async () => {
  const source = tracked([new Uint8Array(32)])
  await assert.rejects(captureApprovedRetailerPage(request(async () =>
    new Response(source.body, { status: 200, headers: {
      'content-type': 'text/html',
      'content-length': String(2 * 1024 * 1024 + 1),
    } }))), /Declared snapshot exceeds size budget/)
  assert.equal(source.cancels, 1)
})

test('wrong HTML media type cancels upstream response without a price claim', async () => {
  const source = tracked([new Uint8Array(128)])
  await assert.rejects(captureApprovedRetailerPage(request(async () =>
    new Response(source.body, { status: 200,
      headers: { 'content-type': 'application/json' } }))), /Source did not return HTML/)
  assert.equal(source.cancels, 1)
})

test('403 and 429 stop and cancel transport bodies without rotation', async () => {
  for (const status of [403, 429]) {
    const source = tracked([new Uint8Array(32)])
    await assert.rejects(captureApprovedRetailerPage(request(async () =>
      new Response(source.body, { status }))), /refused or rate-limited/)
    assert.equal(source.cancels, 1)
  }
})

test('redirected/non-200 response refuses and closes upstream body', async () => {
  const source = tracked([new Uint8Array(32)])
  await assert.rejects(captureApprovedRetailerPage(request(async () =>
    new Response(source.body, { status: 302 }))), /failed or redirected/)
  assert.equal(source.cancels, 1)
})

test('exact 2MiB completes private SHA-bound HTML capture without canceling success', async () => {
  const original = Buffer.alloc(2 * 1024 * 1024, 65)
  const source = tracked([new Uint8Array(original.subarray(0, 800_000)),
    new Uint8Array(original.subarray(800_000))])
  const result = await captureApprovedRetailerPage(request(async () =>
    new Response(source.body, { status: 200,
      headers: { 'content-type': 'text/html' } })))
  assert.equal(source.cancels, 0)
  assert.equal(result.bytes, original.length)
  assert.equal(result.source.sha256, createHash('sha256').update(original).digest('hex'))
  assert.equal(result.published, false)
  assert.equal(result.readyForIngestion, false)
})

test('actual unlicensed M1 source refuses before a transport or body is created', async () => {
  let called = 0
  const gate = rights()
  gate.sources[0].permissionStatus = 'permission_required'
  gate.sources[0].productionEnabled = false
  await assert.rejects(captureApprovedRetailerPage(request(async () => {
    called++
    throw new Error('unexpected transport')
  }, gate)), /Explicit retailer source permission required/)
  assert.equal(called, 0)
})
