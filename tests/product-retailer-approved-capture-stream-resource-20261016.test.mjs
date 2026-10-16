/**
 * Product owner stream resource regressions. All grants and transports below
 * are IN-MEMORY FICTIONAL and never confer PLUS or DekaMarkt source rights.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

const URL = 'https://www.plus.nl/producten'
const request = (overrides = {}) => ({
  source: { supermarket: 'plus', kind: 'catalog', url: URL },
  capturedAt: '2026-10-15T12:00:00.000Z',
  permissionGate: {
    version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
    sources: ['plus', 'dekamarkt'].map(supermarket => ({
      supermarket, technicalStatus: 'proven',
      permissionStatus: supermarket === 'plus' ? 'permitted' : 'unresolved',
      productionEnabled: supermarket === 'plus',
      evidence: [{
        kind: supermarket === 'plus' ? 'written_permission' : 'official_terms',
        url: 'https://example.test/fictional-operator-only',
        finding: 'FICTIONAL NODE UNIT DATA. NO RETAILER AUTHORIZATION',
      }],
    })),
  },
  grant: {
    supermarket: 'plus', kind: 'catalog', sourceUrl: URL,
    reviewed: true, termsReviewed: true, robotsReviewed: true,
    noAntiBotBypass: true,
  },
  ...overrides,
})
function tracked(chunks) {
  const all = [...chunks]
  let cancellations = 0
  const body = new ReadableStream({
    pull(controller) {
      if (all.length) controller.enqueue(all.shift())
      else controller.close()
    },
    cancel() { cancellations++ },
  })
  return { body, canceled: () => cancellations }
}
function approvedResponse(body, headers = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  })
}

test('product: actual 2MiB+1 streamed bytes cancel unread source, never emit raw HTML', async () => {
  const stream = tracked([
    new Uint8Array(1024 * 1024).fill(60),
    new Uint8Array(1024 * 1024 + 1).fill(61),
    new Uint8Array(256).fill(62),
  ])
  let requested = 0
  await assert.rejects(captureApprovedRetailerPage(request({
    fetchFn: async () => { requested++; return approvedResponse(stream.body) },
  })), /Snapshot exceeds size budget/)
  assert.equal(requested, 1)
  assert.equal(stream.canceled(), 1)
})

test('product: 2MiB+1 declared Content-Length cancels before reading response body', async () => {
  let read = 0
  let canceled = 0
  const source = new ReadableStream({
    pull(controller) { read++; controller.enqueue(new Uint8Array(30)); },
    cancel() { canceled++ },
  })
  await assert.rejects(captureApprovedRetailerPage(request({
    fetchFn: async () => approvedResponse(source, {
      'content-length': String(2 * 1024 * 1024 + 1),
    }),
  })), /Declared snapshot exceeds size budget/)
  assert.equal(canceled, 1)
  // ReadableStream may have pulled ahead once from its internal queue;
  // cancellation, not an unreliable prefetch counter, proves resource cleanup.
  assert.ok(read <= 1)
})

test('product: non-HTML content-type rejects and cancels unconsumed source', async () => {
  const stream = tracked([new Uint8Array([123, 125])])
  await assert.rejects(captureApprovedRetailerPage(request({
    fetchFn: async () => approvedResponse(stream.body, {
      'content-type': 'application/json',
    }),
  })), /Source did not return HTML/)
  assert.equal(stream.canceled(), 1)
})

test('product: exactly 2MiB hash and source provenance preserved, no cancellation', async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 65)
  const stream = tracked([
    new Uint8Array(bytes.subarray(0, 19_999)),
    new Uint8Array(bytes.subarray(19_999)),
  ])
  const result = await captureApprovedRetailerPage(request({
    fetchFn: async () => approvedResponse(stream.body),
  }))
  assert.equal(result.bytes, bytes.length)
  assert.equal(result.html.length, bytes.length)
  assert.equal(result.source.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.published, false)
  assert.equal(result.normalized, false)
  assert.equal(stream.canceled(), 0)
})

test('product: real permission_required gate still refuses before any mock transport', async () => {
  const input = request()
  input.permissionGate.sources[0].permissionStatus = 'permission_required'
  input.permissionGate.sources[0].productionEnabled = false
  let calls = 0
  await assert.rejects(captureApprovedRetailerPage({
    ...input, fetchFn: async () => { calls++; throw Error('must never call') },
  }), /Explicit retailer source permission required/)
  assert.equal(calls, 0)
})

for (const [status, expression] of [
  [403, /Retailer refused or rate-limited capture/],
  [429, /Retailer refused or rate-limited capture/],
  [302, /Retailer capture failed or redirected/],
]) {
  test('product: HTTP ' + status + ' cancels unread body without retry, proxy or source reuse', async () => {
    const stream = tracked([new Uint8Array(256).fill(65)])
    let calls = 0
    await assert.rejects(captureApprovedRetailerPage(request({
      fetchFn: async () => {
        calls++
        return new Response(stream.body, {
          status, headers: { 'content-type': 'text/html' },
        })
      },
    })), expression)
    assert.equal(calls, 1)
    assert.equal(stream.canceled(), 1)
  })
}
