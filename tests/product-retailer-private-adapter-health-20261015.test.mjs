import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluatePrivateAdapterHealth, main,
} from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const copy = value => structuredClone(value)
const latestClock = batch => new Date(
  Math.max(...batch.results.flatMap(row =>
    row.observations.map(observation => Date.parse(observation.provenance.capturedAt)))) + 60 * 60 * 1000,
).toISOString()

describe('product: six-adapter offline source health (private / no network)', () => {
  it('processes the six actual historical reviewed PLUS/Deka shapes', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    const report = evaluatePrivateAdapterHealth(batch, { referenceTime: latestClock(batch) })
    assert.equal(report.sources, 6)
    assert.equal(report.acceptedSources, 6)
    assert.equal(report.rejectedSources, 0)
    assert.deepEqual(report.missingSourceKinds, [])
    assert.equal(report.sixShapeCoverageComplete, true)
    assert.ok(report.products > 0)
    assert.ok(report.observations >= 6)
    assert.ok(report.captureEvents > 0)
    for (const store of ['plus', 'dekamarkt']) {
      for (const kind of ['product', 'catalog', 'offers']) {
        const slot = report.byShape[store + ':' + kind]
        assert.equal(slot.accepted, 1)
        assert.ok(slot.observations >= 1)
      }
    }
    assert.equal(report.permissionVerified, false)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.livePricesAvailable, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.externalRequests, 0)
    assert.ok(report.operatorActions.includes('obtain-written-retailer-source-rights'))
    assert.ok(report.operatorActions.includes('collect-genuine-two-store-m3-basket-evidence'))
  })

  it('produces only aggregate source-shape diagnostics, no retail facts or URLs', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    const report = evaluatePrivateAdapterHealth(batch, { referenceTime: latestClock(batch) })
    const output = JSON.stringify(report)
    for (const row of batch.results) {
      for (const fact of row.observations) {
        assert.equal(output.includes(fact.provenance.url), false)
        assert.equal(output.includes(fact.provenance.sha256), false)
        assert.equal(output.includes(fact.name), false)
      }
    }
    assert.equal(output.includes('www.plus.nl'), false)
    assert.equal(output.includes('www.dekamarkt.nl'), false)
    assert.equal(output.includes('currentPriceCents'), false)
  })

  it('turns a rejected adapter shape into review work rather than silently treating it as complete', async () => {
    const batch = copy(await loadReviewedRepositoryFixtures())
    const candidate = batch.results[0]
    const original = candidate.observations.length
    const retailer = candidate.key.split(':')[0]
    candidate.accepted = false
    candidate.reason = 'adapter-abstained'
    candidate.observations = []
    batch.summary.acceptedSources--
    batch.summary.rejectedSources++
    batch.summary.observations -= original
    batch.summary.retailerCounts[retailer] -= original
    const result = evaluatePrivateAdapterHealth(batch, { referenceTime: latestClock(batch) })
    assert.equal(result.acceptedSources, 5)
    assert.equal(result.rejectedSources, 1)
    assert.deepEqual(result.missingSourceKinds, [candidate.key])
    assert.equal(result.sixShapeCoverageComplete, false)
    assert.ok(result.operatorActions.includes('review-rejected-adapter-inputs'))
    assert.ok(result.operatorActions.includes('review-missing-source-shapes'))
  })

  it('detects genuinely old historical snapshots without claiming they are live', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    const date = new Date(Date.parse(latestClock(batch)) + 50 * 24 * 3600 * 1000).toISOString()
    const report = evaluatePrivateAdapterHealth(batch, { referenceTime: date })
    assert.equal(report.staleSources, 6)
    assert.equal(report.historicalFreshnessWithinWindow, false)
    assert.ok(report.operatorActions.includes('review-capture-freshness'))
    assert.equal(report.livePricesAvailable, false)
  })

  it('keeps immutable results for a chosen audit clock', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    const referenceTime = latestClock(batch)
    assert.deepEqual(
      evaluatePrivateAdapterHealth(batch, { referenceTime }),
      evaluatePrivateAdapterHealth(copy(batch), { referenceTime }),
    )
  })

  it('refuses contradictory batch counters and unsupported permission flags', async () => {
    const original = await loadReviewedRepositoryFixtures()
    for (const mutation of [
      b => { b.summary.sources++ },
      b => { b.summary.observations++ },
      b => { b.summary.acceptedSources-- },
      b => { b.summary.retailerCounts.plus++ },
      b => { b.summary.permissionVerified = true },
      b => { b.summary.productionEnabled = true },
      b => { b.summary.publicSavingsClaimEligible = true },
    ]) {
      const batch = copy(original)
      mutation(batch)
      assert.throws(() => evaluatePrivateAdapterHealth(batch, {
        referenceTime: latestClock(batch),
      }), /refused/)
    }
  })

  it('refuses forged or unbound capture provenance, even with consistent summary counts', async () => {
    const original = await loadReviewedRepositoryFixtures()
    for (const mutation of [
      b => { b.results[0].observations[0].provenance.sha256 = 'invalid-sha256' },
      b => { b.results[0].observations[0].supermarket = 'dekamarkt' },
      b => { b.results[0].key = 'plus:unknown' },
      b => { b.results[0].reason = 'allowed-but-wrong' },
    ]) {
      const batch = copy(original)
      mutation(batch)
      assert.throws(() => evaluatePrivateAdapterHealth(batch, {
        referenceTime: latestClock(batch),
      }), /refused/)
    }
  })

  it('rejects duplicate physical source captures within the batch', async () => {
    const batch = copy(await loadReviewedRepositoryFixtures())
    const duplicate = copy(batch.results[0])
    batch.results.push(duplicate)
    batch.summary.sources++
    batch.summary.acceptedSources++
    batch.summary.observations += duplicate.observations.length
    batch.summary.retailerCounts[duplicate.key.split(':')[0]] += duplicate.observations.length
    assert.throws(() => evaluatePrivateAdapterHealth(batch, {
      referenceTime: latestClock(batch),
    }), /refused/)
  })

  it('refuses forged reference clocks, future source records and unbounded age arguments', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    const earliest = Math.min(...batch.results.flatMap(row =>
      row.observations.map(fact => Date.parse(fact.provenance.capturedAt))))
    assert.throws(() => evaluatePrivateAdapterHealth(batch, {
      referenceTime: new Date(earliest - 1).toISOString(),
    }), /refused/)
    assert.throws(() => evaluatePrivateAdapterHealth(batch, {
      referenceTime: 'not-an-iso-instant',
    }), /refused/)
    for (const maxAgeHours of [-1, 0, 721, 1.5, '24']) {
      assert.throws(() => evaluatePrivateAdapterHealth(batch, {
        referenceTime: latestClock(batch), maxAgeHours,
      }), /refused/)
    }
  })

  it('refuses incomplete or sparse arrays before source catalog normalization', async () => {
    const original = await loadReviewedRepositoryFixtures()
    const empty = copy(original)
    empty.results = []
    assert.throws(() => evaluatePrivateAdapterHealth(empty), /refused/)
    const sparse = copy(original)
    delete sparse.results[0]
    assert.throws(() => evaluatePrivateAdapterHealth(sparse), /refused/)
    const missingFact = copy(original)
    delete missingFact.results[0].observations[0]
    assert.throws(() => evaluatePrivateAdapterHealth(missingFact, {
      referenceTime: latestClock(original),
    }), /refused/)
  })

  it('does not permit extra CLI arguments or print on rejected CLI input', async () => {
    let printed = ''
    await assert.rejects(main(['--publish'], text => { printed += text }), /refused/)
    assert.equal(printed, '')
  })
})
