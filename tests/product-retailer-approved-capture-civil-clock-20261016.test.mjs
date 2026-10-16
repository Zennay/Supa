/** Product-owned synthetic-only regression for #3129. No HTTP requests run. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

const page = 'https://www.plus.nl/product/fictional-calendar-owner'
const html = '<html><body>FICTIONAL SOURCE; NOT A PRICE</body></html>'
const synthetic = capturedAt => ({
  source: { supermarket: 'plus', kind: 'product', url: page },
  capturedAt,
  permissionGate: {
    version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
    sources: ['plus', 'dekamarkt'].map(supermarket => ({
      supermarket, technicalStatus: 'proven',
      permissionStatus: 'permitted', productionEnabled: true,
      evidence: [{
        kind: 'written_permission',
        url: 'https://example.test/SYNTHETIC-OWNER-ONLY-NOT-LICENSE',
        finding: 'TEST DATA ONLY, NEVER REAL RETAILER AUTHORIZATION',
      }],
    })),
  },
  grant: {
    supermarket: 'plus', kind: 'product', sourceUrl: page,
    reviewed: true, termsReviewed: true,
    robotsReviewed: true, noAntiBotBypass: true,
  },
})
const mockResponse = () => new Response(html, {
  status: 200, headers: { 'content-type': 'text/html' },
})

const invalid = [
  '2026-02-30T12:00:00.000Z',
  '2026-04-31T12:00:00.000Z',
  '2025-02-29T12:00:00.000Z',
  '1900-02-29T12:00:00.000Z',
  '2026-02-31T12:00:00.000Z',
  '2026-01-00T12:00:00.000Z',
  '2026-01-32T12:00:00.000Z',
  '2026-01-01T24:00:00.000Z',
  '2026-01-01T12:60:00.000Z',
  '2026-01-01T12:00:60.000Z',
  '2026-01-01T12:00:00.0000Z',
]
for (const when of invalid) {
  test('invalid civil or noncanonical UTC clock never starts even fictional transport: ' + when, async () => {
    let calls = 0
    await assert.rejects(captureApprovedRetailerPage({
      ...synthetic(when), fetchFn: async () => { calls++; return mockResponse() },
    }), /Invalid source capture clock/)
    assert.equal(calls, 0)
  })
}

for (const when of [
  '2000-02-29T12:00:00.000Z',
  '2024-02-29T12:00:00.000Z',
  '2025-02-28T12:00:00.000Z',
  '2026-02-28T12:00:00.999Z',
]) {
  test('genuine civil Gregorian UTC clock preserves exact SHA-bound private provenance: ' + when, async () => {
    let calls = 0
    const result = await captureApprovedRetailerPage({
      ...synthetic(when), fetchFn: async () => { calls++; return mockResponse() },
    })
    assert.equal(calls, 1)
    assert.equal(result.source.capturedAt, when)
    assert.equal(result.source.sha256, createHash('sha256').update(html).digest('hex'))
    assert.equal(result.source.url, page)
    assert.equal(result.normalized, false)
    assert.equal(result.published, false)
    assert.equal(result.readyForIngestion, false)
  })
}

test('far-future calendar clock rejected even when date itself is real', async () => {
  let calls = 0
  await assert.rejects(captureApprovedRetailerPage({
    ...synthetic('2035-01-01T12:00:00.000Z'),
    fetchFn: async () => { calls++; return mockResponse() },
  }), /Invalid source capture clock/)
  assert.equal(calls, 0)
})

test('non-string caller timestamp refuses before any transport or user coercion', async () => {
  let calls = 0, coerced = 0
  const timestamp = { toString() { coerced++; return '2026-01-01T12:00:00.000Z' } }
  await assert.rejects(captureApprovedRetailerPage({
    ...synthetic(timestamp), fetchFn: async () => { calls++; return mockResponse() },
  }), /Authorized capture requires inert permission data|Invalid source capture clock/)
  assert.equal(calls, 0)
  assert.equal(coerced, 0)
})

test('explicit null, false and zero capture clocks cannot silently become now', async () => {
  let calls = 0
  for (const capturedAt of [null, false, 0, '']) {
    await assert.rejects(captureApprovedRetailerPage({
      ...synthetic(capturedAt),
      fetchFn: async () => { calls++; return mockResponse() },
    }), /Invalid source capture clock/)
  }
  assert.equal(calls, 0)
})

test('missing capturedAt may use the actual current time but never grants publication', async () => {
  let calls = 0
  const input = synthetic('2026-01-01T12:00:00.000Z')
  delete input.capturedAt
  const before = Date.now()
  const result = await captureApprovedRetailerPage({
    ...input, fetchFn: async () => { calls++; return mockResponse() },
  })
  const after = Date.now()
  assert.equal(calls, 1)
  const used = Date.parse(result.source.capturedAt)
  assert.ok(used >= before && used <= after)
  assert.equal(result.published, false)
  assert.equal(result.readyForIngestion, false)
})
