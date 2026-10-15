import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import {
  auditPrivateCrossStoreEvidence, main,
} from '../scripts/qa-retailer-cross-store-source-coverage.mjs'

const early = '2026-10-04T20:00:00.000Z'
const later = '2026-10-15T00:00:00.000Z'
const audit = (catalog, asOf = early) =>
  auditPrivateCrossStoreEvidence(catalog, { asOf })

function facts(capture, name, amount, unit, time) {
  Object.assign(capture, {
    name, currentPriceCents: 123, currency: 'EUR',
    pack: { rawText: 'synthetic package only', amount, unit },
    offer: null, availability: 'unknown', capturedAt: time,
  })
}

async function twoStoreTwoKind() {
  const raw = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
  const plus = structuredClone(raw.products.find(p => p.retailerId === 'plus'))
  const deka = structuredClone(raw.products.find(p => p.retailerId === 'dekamarkt'))
  assert.ok(plus && deka)
  const stores = [
    [plus, 'Fictieve Halfvolle Melk', 1, 'l', 'https://www.plus.nl/producten'],
    [deka, 'Melk halfvolle fictieve', 1000, 'ml', 'https://www.dekamarkt.nl/producten'],
  ]
  for (const [p, name, amount, unit, url] of stores) {
    p.captures = [structuredClone(p.captures[0])]
    facts(p.captures[0], name, amount, unit, '2026-10-04T18:00:00.000Z')
    const next = structuredClone(p.captures[0])
    next.sourceKind = p.captures[0].sourceKind === 'catalog' ? 'product' : 'catalog'
    next.sourceUrl = url
    next.snapshotSha256 = 'f'.repeat(64)
    next.capturedAt = '2026-10-04T18:10:00.000Z'
    p.captures.push(next)
    p.consistency = 'consistent'
  }
  return { ...raw, products: [plus,deka], productCount: 2,
    captureCount: 4, conflictCount: 0 }
}

test('real historical six adapter fixtures produce aggregate-only review, no price or public match', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  const unchanged = structuredClone(catalog)
  const result = auditPrivateCrossStoreEvidence(catalog, { asOf: later })
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.verifiedEquivalentProducts, 0)
  assert.equal(result.verifiedPriceComparisons, 0)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.externalRequests, 0)
  assert.deepEqual(catalog, unchanged)
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\/|Zuivelmeester|sourceProductId|113651|currentPriceCents|snapshotSha256/i)
})

test('two independent source kinds on each retailer with synchronized clocks are stronger historical review evidence, NEVER verified products', async () => {
  const catalog = await twoStoreTwoKind()
  const result = audit(catalog)
  assert.equal(result.candidatePairs, 1)
  assert.equal(result.insufficientIndependentKinds, 0)
  assert.equal(result.misalignedCaptureWindows, 0)
  assert.equal(result.historicallyMultiSourceSupported, 1)
  assert.equal(result.withinHistoricalReviewClock, 1)
  assert.equal(result.staleRelativeToReviewClock, 0)
  assert.equal(result.verifiedEquivalentProducts, 0)
  assert.equal(result.verifiedPriceComparisons, 0)
})

test('single provenance kind in one supermarket downgrades candidate rather than approving', async () => {
  const catalog = await twoStoreTwoKind()
  catalog.products[0].captures.pop()
  catalog.captureCount--
  const result = audit(catalog)
  assert.equal(result.candidatePairs, 1)
  assert.equal(result.insufficientIndependentKinds, 1)
  assert.equal(result.historicallyMultiSourceSupported, 0)
})

test('two source kinds but geographically unrelated historical capture clocks are not corroboration', async () => {
  const catalog = await twoStoreTwoKind()
  catalog.products[0].captures[1].capturedAt = '2026-09-01T12:00:00.000Z'
  const result = audit(catalog)
  assert.equal(result.candidatePairs, 1)
  assert.equal(result.misalignedCaptureWindows, 1)
  assert.equal(result.historicallyMultiSourceSupported, 0)
})

test('historically synchronous evidence stays stale against a later audit clock', async () => {
  const result = audit(await twoStoreTwoKind(), later)
  assert.equal(result.historicallyMultiSourceSupported, 1)
  assert.equal(result.staleRelativeToReviewClock, 1)
  assert.equal(result.withinHistoricalReviewClock, 0)
  assert.equal(result.livePricesAvailable, false)
})

test('no cross-store pairing from mismatched packages, regardless of extra provenance', async () => {
  const catalog = await twoStoreTwoKind()
  for (const capture of catalog.products[1].captures) {
    capture.pack.amount = 500
  }
  const result = audit(catalog)
  assert.equal(result.candidatePairs, 0)
  assert.equal(result.historicallyMultiSourceSupported, 0)
})

test('public rights forgery, malformed captures and arbitrary audit clock reject with no trust promotion', async t => {
  const cases = [
    ['production flag', c => { c.productionEnabled = true }],
    ['published product', c => { c.products[0].publishable = true }],
    ['licensed product', c => { c.products[0].sourceRightsVerified = true }],
    ['future capture', c => { c.products[0].captures[0].capturedAt = '2035-10-04T18:00:00.000Z' }],
    ['invalid digest', c => { c.products[0].captures[0].snapshotSha256 = 'fictional' }],
    ['credentialed origin', c => { c.products[0].captures[0].sourceUrl = 'https://token:secret@www.plus.nl/producten' }],
    ['unbacked catalog count', c => { c.captureCount++ }],
  ]
  for (const [name, tamper] of cases) {
    await t.test(name, async () => {
      const catalog = await twoStoreTwoKind()
      tamper(catalog)
      assert.throws(() => audit(catalog), /Private retailer cross-store source coverage QA refused/)
    })
  }
  await assert.rejects(async () =>
    auditPrivateCrossStoreEvidence(await twoStoreTwoKind(), {
      asOf: '2026-02-30T12:00:00.000Z',
    }), /Private retailer cross-store source coverage QA refused/)
})

test('CLI cannot access external path, publish SKU or price, and returns the same aggregate report', async () => {
  let stdout = ''
  const report = await main([], x => { stdout += x })
  assert.deepEqual(JSON.parse(stdout), report)
  assert.doesNotMatch(stdout, /https?:\/\/|www\.plus\.nl|113651|Zuivelmeester|sourceProductId|priceCents/i)
  await assert.rejects(main(['--publish'], () => {}), /Private retailer cross-store source coverage QA refused/)
  const path = new URL('../scripts/qa-retailer-cross-store-source-coverage.mjs', import.meta.url).pathname
  const result = spawnSync(process.execPath, ['--experimental-strip-types',path], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 65536,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), report)
})
