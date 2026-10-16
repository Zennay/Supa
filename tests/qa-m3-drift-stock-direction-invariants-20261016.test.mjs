import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { rehearsePrivateM3RetailerDrift } from '../scripts/retailer-private-m3-capture-drift-rehearsal.mjs'

// QA-owned differential acceptance for the merged offline dual-archive M3
// product engine. No HTTP, new retailer captures, user observations or writes.
const AT = '2026-10-16T00:00:00.000Z'
const SHAPES = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const rights = async () => JSON.parse(await readFile(
  new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
  'utf8'))

async function scenario(previousStatus, nextStatus) {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const first = previous.results.find(row => row.key === 'plus:product')
  assert.ok(first && first.observations.length > 0)
  for (const row of first.observations) row.availability = previousStatus
  const current = structuredClone(previous)
  const changed = current.results.find(row => row.key === 'plus:product')
  const capturedAt = changed.observations[0].provenance.capturedAt
  const later = new Date(Date.parse(capturedAt) + 86_400_000).toISOString()
  for (const row of changed.observations) {
    row.availability = nextStatus
    row.provenance.capturedAt = later
    row.provenance.sha256 = 'd'.repeat(64)
  }
  const pristine = structuredClone({ previous, current })
  const report = rehearsePrivateM3RetailerDrift(
    await rights(), previous, current, { referenceTime: AT })
  assert.deepEqual({ previous, current }, pristine, 'archived data cannot be mutated')
  assert.equal(report.historicalSourceShapes, 6)
  assert.deepEqual(report.perShape.map(x => x.retailer + ':' + x.kind), SHAPES)
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.sourceRightsStillNeeded, true)
  assert.equal(report.humanM3BasketEvidenceStillNeeded, true)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.currentPriceVerified, false)
  assert.equal(report.currentAvailabilityVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRequests, 0)
  assert.equal(report.manualSourceReviewRequired, true)
  assert.equal(report.alertShapeCount, 1)
  assert.ok(report.operatorAlertKinds.includes('review-archived-product-fact-changes'))
  for (const row of report.perShape.slice(1)) {
    assert.equal(row.historicalChangedFactFields, 0)
    assert.equal(row.archiveStockUnknownDelta, 0)
    assert.equal(row.archiveStockUnavailableDelta, 0)
    assert.deepEqual(row.reviewSignals, [])
  }
  const json = JSON.stringify(report)
  assert.doesNotMatch(json, /https?:\/\/|sourceProductId|sourceUrl|sha256|priceCents|sourceName|retailerProductId/i)
  for (const source of current.results) {
    for (const row of source.observations) {
      assert.equal(json.includes(row.provenance.sha256), false)
      assert.equal(json.includes(row.provenance.url), false)
      assert.equal(json.includes(row.sourceProductId), false)
    }
  }
  return { report, count: first.observations.length, selected: report.perShape[0] }
}

test('offline archived stock becoming unknown generates exactly the one-source unknown alert', async () => {
  const { report, count, selected } = await scenario('available', 'unknown')
  assert.equal(selected.archiveStockUnknownDelta, count)
  assert.equal(selected.archiveStockUnavailableDelta, 0)
  assert.ok(selected.reviewSignals.includes('more-unknown-archived-availability'))
  assert.ok(report.operatorAlertKinds.includes('more-unknown-archived-availability'))
  assert.ok(!report.operatorAlertKinds.includes('more-unavailable-archived-products'))
})

test('offline archived products becoming unavailable generate stock-out review, not unknown', async () => {
  const { report, count, selected } = await scenario('available', 'unavailable')
  assert.equal(selected.archiveStockUnknownDelta, 0)
  assert.equal(selected.archiveStockUnavailableDelta, count)
  assert.ok(selected.reviewSignals.includes('more-unavailable-archived-products'))
  assert.ok(!report.operatorAlertKinds.includes('more-unknown-archived-availability'))
})

test('historical availability recovery never masquerades as new stock-out evidence or current inventory', async () => {
  const { report, count, selected } = await scenario('unavailable', 'available')
  assert.equal(selected.archiveStockUnavailableDelta, -count)
  assert.equal(selected.archiveStockUnknownDelta, 0)
  assert.deepEqual(report.operatorAlertKinds, ['review-archived-product-fact-changes'])
  assert.deepEqual(selected.reviewSignals, ['review-archived-product-fact-changes'])
  assert.equal(report.currentAvailabilityVerified, false)
})

test('historical unknown becoming unavailable is a stock-out, not an unknown-stock spike', async () => {
  const { report, count, selected } = await scenario('unknown', 'unavailable')
  assert.equal(selected.archiveStockUnknownDelta, -count)
  assert.equal(selected.archiveStockUnavailableDelta, count)
  assert.ok(report.operatorAlertKinds.includes('more-unavailable-archived-products'))
  assert.ok(!report.operatorAlertKinds.includes('more-unknown-archived-availability'))
})

test('future-dated supposedly reviewed source is never accepted as current evidence', async () => {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const current = structuredClone(previous)
  const first = current.results.find(x => x.key === 'plus:product')
  for (const row of first.observations) {
    row.provenance.capturedAt = '2035-01-01T00:00:00.000Z'
    row.provenance.sha256 = 'e'.repeat(64)
  }
  const original = structuredClone(current)
  const gate = await rights()
  assert.throws(() => rehearsePrivateM3RetailerDrift(
    gate, previous, current, { referenceTime: AT }), /refused/i)
  assert.deepEqual(current, original)
})

test('two stores can degrade in different ways without leaking stock signals between source kinds', async () => {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const impacted = ['plus:product', 'dekamarkt:product']
  for (const source of previous.results) {
    if (impacted.includes(source.key)) {
      assert.ok(source.observations.length > 0)
      for (const observation of source.observations) observation.availability = 'available'
    }
  }
  const current = structuredClone(previous)
  const counts = new Map()
  for (const source of current.results) {
    if (!impacted.includes(source.key)) continue
    counts.set(source.key, source.observations.length)
    for (const observation of source.observations) {
      observation.availability = source.key === 'plus:product' ? 'unknown' : 'unavailable'
      observation.provenance.capturedAt =
        new Date(Date.parse(observation.provenance.capturedAt) + 86_400_000).toISOString()
      observation.provenance.sha256 = source.key === 'plus:product'
        ? 'a'.repeat(64) : 'f'.repeat(64)
    }
  }
  const report = rehearsePrivateM3RetailerDrift(
    await rights(), previous, current, { referenceTime: AT })
  assert.equal(report.alertShapeCount, 2)
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.currentAvailabilityVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  const plus = report.perShape.find(row => row.retailer === 'plus' && row.kind === 'product')
  const deka = report.perShape.find(row => row.retailer === 'dekamarkt' && row.kind === 'product')
  assert.equal(plus.archiveStockUnknownDelta, counts.get('plus:product'))
  assert.equal(plus.archiveStockUnavailableDelta, 0)
  assert.equal(deka.archiveStockUnavailableDelta, counts.get('dekamarkt:product'))
  assert.equal(deka.archiveStockUnknownDelta, 0)
  assert.ok(plus.reviewSignals.includes('more-unknown-archived-availability'))
  assert.ok(!plus.reviewSignals.includes('more-unavailable-archived-products'))
  assert.ok(deka.reviewSignals.includes('more-unavailable-archived-products'))
  assert.ok(!deka.reviewSignals.includes('more-unknown-archived-availability'))
  for (const row of report.perShape.filter(x => x.kind !== 'product')) {
    assert.equal(row.historicalChangedFactFields, 0)
    assert.deepEqual(row.reviewSignals, [])
  }
})

test('identical historical six-shape archives must not invent drift when input row order differs', async () => {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const current = structuredClone(previous)
  current.results.reverse()
  const report = rehearsePrivateM3RetailerDrift(
    await rights(), previous, current, { referenceTime: AT })
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.historicalSourceShapes, 6)
  assert.equal(report.alertShapeCount, 0)
  assert.equal(report.archivedChangedFactFields, 0)
  assert.deepEqual(report.operatorAlertKinds, [])
  assert.ok(report.perShape.every(row =>
    row.historicalChangedFactFields === 0 &&
    row.archiveStockUnknownDelta === 0 &&
    row.archiveStockUnavailableDelta === 0))
})

test('integrated historical drift API rejects active source values without invoking getter or Proxy traps', async () => {
  const base = structuredClone(await loadReviewedRepositoryFixtures())
  const gate = await rights()
  let calls = 0
  const ownGetter = structuredClone(base)
  Object.defineProperty(ownGetter.results[0].observations[0].provenance, 'capturedAt', {
    configurable: true,
    enumerable: true,
    get() { calls++; throw new Error('untrusted-clock-getter') },
  })
  assert.throws(() => rehearsePrivateM3RetailerDrift(
    gate, base, ownGetter, { referenceTime: AT }), /refused/i)
  const proxy = new Proxy(structuredClone(base), {
    get() { calls++; throw new Error('untrusted-batch-proxy') },
    ownKeys() { calls++; throw new Error('untrusted-batch-proxy') },
  })
  assert.throws(() => rehearsePrivateM3RetailerDrift(
    gate, base, proxy, { referenceTime: AT }), /refused/i)
  assert.equal(calls, 0)
})

test('metamorphic matrix: every retailer/source kind independently reports unknown vs unavailable deterioration', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const gate = await rights()
  for (const key of SHAPES) {
    for (const nextStatus of ['unknown', 'unavailable']) {
      const previous = structuredClone(original)
      const earlier = previous.results.find(source => source.key === key)
      assert.ok(earlier && earlier.observations.length > 0, 'genuine archived source ' + key)
      for (const row of earlier.observations) row.availability = 'available'
      const current = structuredClone(previous)
      const changed = current.results.find(source => source.key === key)
      for (const row of changed.observations) {
        row.availability = nextStatus
        row.provenance.capturedAt =
          new Date(Date.parse(row.provenance.capturedAt) + 86_400_000).toISOString()
        row.provenance.sha256 = nextStatus === 'unknown' ? 'c'.repeat(64) : 'd'.repeat(64)
      }
      const report = rehearsePrivateM3RetailerDrift(
        gate, previous, current, { referenceTime: AT })
      assert.equal(report.releaseDecision, 'hold', key + ': ' + nextStatus)
      assert.equal(report.liveRequests, 0)
      assert.equal(report.permissionVerified, false)
      assert.equal(report.currentAvailabilityVerified, false)
      assert.equal(report.alertShapeCount, 1, key + ': ' + nextStatus)
      const selected = report.perShape.find(row => row.retailer + ':' + row.kind === key)
      assert.ok(selected)
      const expectedSignal = nextStatus === 'unknown'
        ? 'more-unknown-archived-availability' : 'more-unavailable-archived-products'
      const rejectedSignal = nextStatus === 'unknown'
        ? 'more-unavailable-archived-products' : 'more-unknown-archived-availability'
      assert.equal(nextStatus === 'unknown'
        ? selected.archiveStockUnknownDelta : selected.archiveStockUnavailableDelta,
      earlier.observations.length, key)
      assert.ok(selected.reviewSignals.includes(expectedSignal), key + ': ' + nextStatus)
      assert.ok(!selected.reviewSignals.includes(rejectedSignal), key + ': ' + nextStatus)
      assert.ok(report.perShape.filter(row => row.retailer + ':' + row.kind !== key)
        .every(row => row.archiveStockUnknownDelta === 0 &&
          row.archiveStockUnavailableDelta === 0 && row.reviewSignals.length === 0),
      'unmodified retailer/source partitions must be stable: ' + key)
    }
  }
})

test('issue #3080: 1ms OLDER catalog with completely disjoint SKU identities is refused', async () => {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const current = structuredClone(previous)
  const catalog = current.results.find(row => row.key === 'plus:catalog')
  assert.ok(catalog && catalog.observations.length > 0)
  const originalClock = catalog.observations[0].provenance.capturedAt
  assert.equal(originalClock, '2026-10-04T18:53:02.645Z')
  for (const observation of catalog.observations) {
    observation.sourceProductId = 'historic-regression-' + observation.sourceProductId
    // The QA offer preflight currently admits only millisecond-precision Z clocks.\n    // One physical millisecond before the original remains a valid chronology test.
    observation.provenance.capturedAt = '2026-10-04T18:53:02.644Z'
    observation.provenance.sha256 = 'a'.repeat(64)
  }
  const frozen = structuredClone(current)
  const gate = await rights()
  assert.throws(() => rehearsePrivateM3RetailerDrift(
    gate, previous, current, { referenceTime: AT }), /refused/i)
  assert.deepEqual(current, frozen, 'no source evidence may be modified on refusal')
})

test('issue #3080: 1ms LATER changed catalog with disjoint identities stays review-only', async () => {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const current = structuredClone(previous)
  const catalog = current.results.find(row => row.key === 'plus:catalog')
  assert.ok(catalog && catalog.observations.length > 0)
  const originalCount = catalog.observations.length
  for (const observation of catalog.observations) {
    observation.sourceProductId = 'historic-regression-' + observation.sourceProductId
    observation.provenance.capturedAt = '2026-10-04T18:53:02.646Z'
    observation.provenance.sha256 = 'b'.repeat(64)
  }
  const report = rehearsePrivateM3RetailerDrift(
    await rights(), previous, current, { referenceTime: AT })
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.permissionVerified, false)
  assert.equal(report.currentPriceVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRequests, 0)
  assert.equal(report.alertShapeCount, 1)
  const row = report.perShape.find(x => x.retailer === 'plus' && x.kind === 'catalog')
  assert.equal(row.addedArchivedProducts, originalCount)
  assert.equal(row.missingArchivedProducts, originalCount)
  assert.ok(row.reviewSignals.includes('review-archived-product-fact-changes'))
  assert.equal(row.currentlyArchivedAt, '2026-10-04T18:53:02.646Z')
  assert.ok(report.perShape.filter(x => x.retailer !== 'plus' || x.kind !== 'catalog')
    .every(x => x.historicalChangedFactFields === 0 && x.reviewSignals.length === 0))
})
