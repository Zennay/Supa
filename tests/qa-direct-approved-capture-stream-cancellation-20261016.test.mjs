import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

// Offline-only fixtures. This fake gate/grant is NOT permission to request
// PLUS, DekaMarkt or any other retailer's live pages.
const url = 'https://www.plus.nl/producten'
const source = { supermarket: 'plus', kind: 'catalog', url }
const permissionGate = {
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-16',
  sources: [
    {
      supermarket: 'plus',
      technicalStatus: 'proven',
      permissionStatus: 'permitted',
      productionEnabled: true,
      evidence: [{
        kind: 'written_permission',
        url: 'https://example.test/fictional-local-only-grant',
        finding: 'FAKE GRANT FOR UNIT TESTS ONLY. NEVER REAL RETAILER RIGHTS.',
      }],
    },
    {
      supermarket: 'dekamarkt',
      technicalStatus: 'proven',
      permissionStatus: 'unresolved',
      productionEnabled: false,
      evidence: [{
        kind: 'official_terms',
        url: 'https://www.dekamarkt.nl/algemene-voorwaarden',
        finding: 'No production rights.',
      }],
    },
  ],
}
const grant = {
  supermarket: 'plus',
  kind: 'catalog',
  sourceUrl: url,
  reviewed: true,
  termsReviewed: true,
  robotsReviewed: true,
  noAntiBotBypass: true,
}

function trackedStream(chunks) {
  const pending = [...chunks]
  let canceled = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (pending.length) controller.enqueue(pending.shift())
      else controller.close()
    },
    cancel() { canceled++ },
  })
  return { stream, cancellationCount: () => canceled }
}
async function captureWith(stream, headers = {}) {
  const response = new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  })
  return captureApprovedRetailerPage({
    source, permissionGate, grant,
    capturedAt: '2026-10-15T12:00:00.000Z',
    fetchFn: async (requested) => {
      assert.equal(requested, url)
      return response
    },
  })
}

test('QA expected RED: >2MiB streamed HTML cancels unread upstream body on observed overflow', async () => {
  // A body can advertise no length (or an incorrect small length).
  // Releasing a reader lock alone does not tell fetch to stop delivering bytes.
  const { stream, cancellationCount } = trackedStream([
    new Uint8Array(1024 * 1024).fill(60),
    new Uint8Array(1024 * 1024 + 1).fill(62),
    new Uint8Array(128).fill(65),
  ])
  await assert.rejects(captureWith(stream), /exceeds size budget/)
  assert.equal(cancellationCount(), 1,
    'the over-budget response must be canceled, not merely reader.releaseLock()-ed')
})

test('QA expected RED: oversized declared length cancels response without consuming HTML', async () => {
  const { stream, cancellationCount } = trackedStream([
    new Uint8Array(32).fill(65),
  ])
  await assert.rejects(
    captureWith(stream, { 'content-length': String(2 * 1024 * 1024 + 1) }),
    /Declared snapshot exceeds size budget/,
  )
  assert.equal(cancellationCount(), 1,
    'preflight Content-Length refusal must also close the already-open response body')
})

test('QA positive: exactly 2MiB accepted with byte-accurate hash and no forced cancellation', async () => {
  const body = Buffer.alloc(2 * 1024 * 1024, 65)
  const { stream, cancellationCount } = trackedStream([
    new Uint8Array(body.subarray(0, 100_000)),
    new Uint8Array(body.subarray(100_000)),
  ])
  const capture = await captureWith(stream)
  assert.equal(capture.bytes, 2 * 1024 * 1024)
  assert.equal(capture.source.sha256, createHash('sha256').update(body).digest('hex'))
  assert.equal(capture.html.length, body.length)
  assert.equal(capture.permissionVerifiedForThisRequest, true)
  assert.equal(capture.readyForIngestion, false)
  assert.equal(capture.published, false)
  assert.equal(cancellationCount(), 0)
})

test('QA positive: actual unlicensed source rights refuse before a mock transport is used', async () => {
  let called = 0
  const realGate = structuredClone(permissionGate)
  realGate.sources[0].permissionStatus = 'permission_required'
  realGate.sources[0].productionEnabled = false
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: realGate, grant,
    fetchFn: async () => { called++; throw new Error('MUST NEVER CALL') },
  }), /Explicit retailer source permission required/)
  assert.equal(called, 0)
})
