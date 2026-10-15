import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

async function makePair(first, second, reverse = false) {
  const source = (await loadReviewedRepositoryFixtures()).results.find(x => x.key === 'plus:product')
  assert.ok(source?.accepted)
  const results = [first, second].map((timestamp, index) => {
    const observation = structuredClone(source.observations[0])
    observation.provenance.capturedAt = timestamp
    observation.provenance.sha256 = (index === 0 ? 'a' : 'b').repeat(64)
    return { key: 'plus:product', accepted: true, observations: [observation] }
  })
  return buildUniversalRetailerCatalog({
    summary: { mode: 'reviewed-offline-only' },
    results: reverse ? results.reverse() : results,
  })
}

test('product: one-nanosecond distinct physical instants preserve chronology in both input orders', async () => {
  const older = '2026-10-14T10:00:00.000000001Z'
  const newer = '2026-10-14T10:00:00.000000002Z'
  assert.equal(Date.parse(older), Date.parse(newer))
  for (const reversed of [false, true]) {
    const catalog = await makePair(older, newer, reversed)
    assert.deepEqual(catalog.products[0].captures.map(x => x.capturedAt), [older, newer])
    assert.equal(catalog.products[0].currentTrustedPriceCents, null)
    assert.equal(catalog.products[0].selectedSnapshotSha256, null)
    assert.equal(catalog.productionEnabled, false)
    assert.equal(catalog.publicSavingsClaimEligible, false)
  }
})

test('product: same physical instant in Z and +02:00 uses deterministic lexical tie-breaker', async () => {
  const a = '2026-10-14T10:00:00.123456789Z'
  const b = '2026-10-14T12:00:00.123456789+02:00'
  assert.equal(Date.parse(a), Date.parse(b))
  const expected = [a, b].sort((x, y) => x.localeCompare(y))
  for (const reversed of [false, true]) {
    const catalog = await makePair(a, b, reversed)
    assert.deepEqual(catalog.products[0].captures.map(x => x.capturedAt), expected)
    assert.equal(catalog.products[0].captures.length, 2)
    assert.equal(catalog.products[0].publishable, false)
  }
})

test('product: impossible civil offsets and seconds reject direct catalog inputs', async () => {
  for (const invalid of [
    '2026-10-14T10:00:00+14:01',
    '2026-10-14T10:00:00-15:00',
    '2026-10-14T10:00:00+23:00',
    '2026-10-14T10:00:60Z',
    '2026-02-29T10:00:00Z',
    '2026-04-31T10:00:00Z',
  ]) {
    const source = (await loadReviewedRepositoryFixtures()).results.find(x => x.key === 'plus:product')
    const observation = structuredClone(source.observations[0])
    observation.provenance.capturedAt = invalid
    assert.throws(() => buildUniversalRetailerCatalog({
      summary: { mode: 'reviewed-offline-only' },
      results: [{ key: 'plus:product', accepted: true, observations: [observation] }],
    }), /invalid|captur|calendar|offset/i, invalid)
  }
})

test('product: six untouched real historical M1 evidence inputs remain private only', async () => {
  const report = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
  assert.equal(report.sourceCount, 6)
  assert.equal(report.status, 'private-review-only')
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  for (const item of report.products) {
    assert.equal(item.currentTrustedPriceCents, null)
    assert.equal(item.sourceRightsVerified, false)
    assert.equal(item.publishable, false)
  }
})
