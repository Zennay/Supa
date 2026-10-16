/**
 * Expected-red independent QA of the canonical permitted-capture date boundary.
 * All permission evidence and injected transports are FICTIONAL for Node tests.
 * This file never invokes a real network transport or licenses a source.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

function fictionalRequest(capturedAt) {
  const sourceUrl = 'https://www.plus.nl/product/fictional-capture-calendar-qa'
  return {
    source: { supermarket: 'plus', kind: 'product', url: sourceUrl },
    capturedAt,
    permissionGate: {
      version: 1, milestone: 'M1 Data Feasibility',
      reviewedAt: '2026-10-14',
      sources: ['plus', 'dekamarkt'].map(supermarket => ({
        supermarket, technicalStatus: 'proven',
        permissionStatus: 'permitted', productionEnabled: true,
        evidence: [{ kind: 'written_permission',
          url: 'https://example.test/fictional-never-valid-source-license',
          finding: 'FICTIONAL CI GRANT ONLY; NEVER CONTACT THE RETAILER' }],
      })),
    },
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
  }
}
const fakeHtml = '<html><body>FICTIONAL CI ONLY</body></html>'
const reply = () => new Response(fakeHtml, {
  status: 200, headers: { 'content-type': 'text/html' },
})

for (const badTimestamp of [
  '2026-02-30T12:00:00.000Z',
  '2026-04-31T12:00:00.000Z',
  '2025-02-29T12:00:00.000Z',
]) {
  test('capture must refuse impossible civil date BEFORE transport: ' + badTimestamp, async () => {
    let calls = 0
    const input = fictionalRequest(badTimestamp)
    await assert.rejects(captureApprovedRetailerPage({
      ...input,
      fetchFn: async () => { calls++; return reply() },
    }), /Invalid source capture clock/)
    assert.equal(calls, 0, 'no fictional transport may run for impossible dates')
  })
}

test('control: real 2024 leap day is valid offline source evidence but not an ingestion grant', async () => {
  let calls = 0
  const result = await captureApprovedRetailerPage({
    ...fictionalRequest('2024-02-29T12:00:00.000Z'),
    fetchFn: async () => { calls++; return reply() },
  })
  assert.equal(calls, 1)
  assert.equal(result.source.capturedAt, '2024-02-29T12:00:00.000Z')
  assert.equal(result.mode, 'authorized-one-page-capture-needs-review')
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.published, false)
  assert.equal(result.normalized, false)
})

test('control: future-dated capture far beyond the allowed clock tolerance refuses transport', async () => {
  let calls = 0
  await assert.rejects(captureApprovedRetailerPage({
    ...fictionalRequest('2035-01-01T12:00:00.000Z'),
    fetchFn: async () => { calls++; return reply() },
  }), /Invalid source capture clock/)
  assert.equal(calls, 0)
})
