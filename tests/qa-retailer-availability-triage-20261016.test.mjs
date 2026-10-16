import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  reviewPrivateRetailerAvailability, main,
} from '../scripts/qa-retailer-availability-triage.mjs'

const AT = '2026-10-16T00:00:00.000Z'
const snapshot = async () => structuredClone(await loadReviewedRepositoryFixtures())
const audit = batch => reviewPrivateRetailerAvailability(batch, { referenceTime: AT })
const rejected = /Private retailer availability QA refused/
const script = fileURLToPath(new URL(
  '../scripts/qa-retailer-availability-triage.mjs', import.meta.url))

function releaseHold(report) {
  assert.equal(report.mode, 'private-reviewed-retailer-availability-qa')
  assert.equal(report.historicalOnly, true)
  assert.equal(report.currentStockVerified, false)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.liveRequests, 0)
  assert.equal(report.unavailableProductsNotPurchasable, true)
}

test('six actual historical retailer capture shapes yield exact independently checked availability totals', async () => {
  const batch = await snapshot()
  const before = structuredClone(batch)
  const report = audit(batch)
  const health = evaluatePrivateAdapterHealth(batch, { referenceTime: AT })
  releaseHold(report)
  assert.equal(report.acceptedHistoricalSourceShapes, 6)
  assert.equal(report.perShape.length, 6)
  assert.equal(report.historicalObservations, health.observations)
  assert.equal(Object.values(report.availability).reduce((a, b) => a + b, 0),
    health.observations)
  for (const row of report.perShape) {
    const kind = row.retailer + ':' + row.kind
    assert.equal(row.unknown, health.byShape[kind].unknownAvailability, kind)
    assert.equal(row.historicalObservations, health.byShape[kind].observations)
    assert.equal(row.available + row.unavailable + row.unknown, row.historicalObservations)
    assert.equal(row.currentStockVerified, false)
  }
  assert.deepEqual(batch, before, 'the reviewer cannot mutate source evidence')
})

test('every unknown stock record remains UNKNOWN, never purchased or publicly in stock', async () => {
  const batch = await snapshot()
  for (const row of batch.results) {
    for (const ob of row.observations) ob.availability = 'unknown'
  }
  const report = audit(batch)
  releaseHold(report)
  assert.deepEqual(report.availability, {
    available: 0, unavailable: 0, unknown: report.historicalObservations,
  })
  assert.equal(report.needsHumanAvailabilityReview, true)
  assert.ok(report.perShape.every(x =>
    x.unknown === x.historicalObservations && x.currentStockVerified === false))
})

test('every unavailable historical row remains explicitly unavailable, not a purchasable basket', async () => {
  const batch = await snapshot()
  for (const row of batch.results) {
    for (const ob of row.observations) ob.availability = 'unavailable'
  }
  const report = audit(batch)
  releaseHold(report)
  assert.deepEqual(report.availability, {
    available: 0, unavailable: report.historicalObservations, unknown: 0,
  })
  assert.equal(report.needsHumanAvailabilityReview, true)
})

test('one archived source-shape stock change affects only the matching retailer/kind totals', async () => {
  const batch = await snapshot()
  const baseline = audit(batch)
  const first = batch.results[0]
  const old = first.observations[0].availability
  first.observations[0].availability = old === 'unknown' ? 'unavailable' : 'unknown'
  const result = audit(batch)
  releaseHold(result)
  const changed = first.key
  for (const row of result.perShape) {
    const original = baseline.perShape.find(x =>
      x.retailer === row.retailer && x.kind === row.kind)
    assert.ok(original)
    if (row.retailer + ':' + row.kind !== changed) assert.deepEqual(row, original)
    else assert.notDeepEqual(row, original)
  }
  assert.equal(result.historicalObservations, baseline.historicalObservations)
})

test('forged permission/counters, missing source, sparse rows and unknown stock states fail closed', async () => {
  const original = await snapshot()
  for (const mutation of [
    b => { b.summary.permissionVerified = true },
    b => { b.summary.productionEnabled = true },
    b => { b.summary.sources += 1 },
    b => { b.summary.retailerCounts.plus++ },
    b => { b.results.pop() },
    b => { delete b.results[0] },
    b => { b.results[0].observations[0].availability = 'preorder' },
    b => { b.results[0].key = 'plus:invalid-kind' },
  ]) {
    const batch = structuredClone(original)
    mutation(batch)
    assert.throws(() => audit(batch), rejected)
  }
})

test('no product name, URL, source hash, raw ID or cents ever leaves QA aggregates', async () => {
  const batch = await snapshot()
  const report = audit(batch)
  const output = JSON.stringify(report)
  releaseHold(report)
  assert.doesNotMatch(output, /https?:|sourceProductId|sourceUrl|currentPriceCents|offerPriceCents|snapshotSha256|sha256/i)
  for (const source of batch.results) {
    for (const ob of source.observations) {
      assert.equal(output.includes(ob.name), false)
      assert.equal(output.includes(ob.provenance.url), false)
      assert.equal(output.includes(ob.provenance.sha256), false)
      assert.equal(output.includes(ob.sourceProductId), false)
    }
  }
})

test('inert option/CLI refusal does not evaluate getters or proxy traps', async () => {
  const batch = await snapshot()
  let calls = 0
  const getter = {}
  Object.defineProperty(getter, 'referenceTime', {
    get() { calls++; throw new Error('must not invoke getter') },
  })
  assert.throws(() => reviewPrivateRetailerAvailability(batch, getter), rejected)
  const proxy = new Proxy({}, {
    get() { calls++; throw new Error('must not invoke trap') },
    getPrototypeOf() { calls++; throw new Error('must not invoke trap') },
  })
  assert.throws(() => reviewPrivateRetailerAvailability(batch, proxy), rejected)
  const argv = ['--at', AT]
  Object.defineProperty(argv, '1', {
    get() { calls++; throw new Error('must not read argv getter') },
  })
  await assert.rejects(main(argv), rejected)
  assert.equal(calls, 0)
})

test('real executable uses bundled offline records and refuses publish/network parameters', async () => {
  const captured = []
  const report = await main(['--at', AT], value => captured.push(value))
  assert.equal(captured.length, 1)
  assert.deepEqual(JSON.parse(captured[0]), report)
  releaseHold(report)
  const good = spawnSync(process.execPath,
    ['--experimental-strip-types', script, '--at', AT],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024 })
  assert.equal(good.status, 0, good.stderr)
  assert.equal(good.stderr, '')
  assert.deepEqual(JSON.parse(good.stdout), report)
  for (const args of [['--publish'], ['--url', 'https://www.plus.nl'], ['--at', '2035-01-01T00:00:00.000Z']]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 })
    assert.equal(child.status, 2)
    assert.equal(child.stdout, '')
    assert.equal(child.stderr.trim(), 'Private retailer availability QA refused')
  }
})
