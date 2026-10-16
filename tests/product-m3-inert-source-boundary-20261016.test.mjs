import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { snapshotInertPrivateM3Sources } from
  '../scripts/retailer-private-m3-inert-source-boundary.mjs'
import { assessPrivateM3RetailerIngestion } from
  '../scripts/retailer-private-m3-ingestion-preflight.mjs'

// Synthetic JavaScript object mutations only; historical original fixtures
// are not rewritten, scraped again or promoted to current retail prices.
const AT = '2026-10-16T00:00:00.000Z'
const refusal = /refused/
async function inputs() {
  return {
    rights: JSON.parse(await readFile(new URL(
      '../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8')),
    batch: structuredClone(await loadReviewedRepositoryFixtures()),
  }
}
const run = data => assessPrivateM3RetailerIngestion(
  data.rights, data.batch, { referenceTime: AT })
function neverCalled(data, mutate) {
  let calls = 0
  mutate(data, () => { calls++; throw Error('caller code should never run') })
  assert.throws(() => run(data), refusal)
  assert.equal(calls, 0)
}

test('real PLUS/Deka six-source historical data is copied, immutable, and still never ready for public pricing', async () => {
  const data = await inputs()
  const control = structuredClone(data)
  const snapshot = snapshotInertPrivateM3Sources(data.rights, data.batch)
  assert.notEqual(snapshot.batch, data.batch)
  assert.notEqual(snapshot.permissionGate, data.rights)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.batch), true)
  assert.equal(Object.isFrozen(snapshot.batch.results[0].observations[0].provenance), true)
  assert.deepEqual(data, control)
  const report = run(data)
  assert.equal(report.acceptedSourceShapes, 6)
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.currentStockCoverageVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRequests, 0)
  assert.deepEqual(data, control)
})

test('exported product API refuses original five nested accessor and Proxy cases without invoking caller code', async () => {
  const modifiers = [
    (d, call) => {
      const old = d.batch.results
      Object.defineProperty(d.batch, 'results', { get() { call(); return old } })
    },
    (d, call) => {
      d.batch = new Proxy(d.batch, {
        get() { call() },
        getOwnPropertyDescriptor() { call() },
        getPrototypeOf() { call() },
      })
    },
    (d, call) => {
      const old = d.batch.results[0].observations
      Object.defineProperty(d.batch.results[0], 'observations', {
        get() { call(); return old },
      })
    },
    (d, call) => {
      const provenance = d.batch.results[0].observations[0].provenance
      const old = provenance.capturedAt
      Object.defineProperty(provenance, 'capturedAt', {
        get() { call(); return old },
      })
    },
    (d, call) => {
      d.rights = new Proxy(d.rights, {
        get() { call() },
        ownKeys() { call() },
        getOwnPropertyDescriptor() { call() },
      })
    },
  ]
  for (const modify of modifiers) neverCalled(await inputs(), modify)
})

test('nested source Proxy, provenance Proxy and retailer permission row accessor cannot execute', async () => {
  for (const modifier of [
    (d, call) => {
      d.batch.results[0] = new Proxy(d.batch.results[0], {
        get() { call() }, getOwnPropertyDescriptor() { call() },
      })
    },
    (d, call) => {
      d.batch.results[0].observations[0].provenance =
        new Proxy(d.batch.results[0].observations[0].provenance, {
          get() { call() }, ownKeys() { call() },
        })
    },
    (d, call) => {
      const source = d.rights.sources[0]
      const old = source.permissionStatus
      Object.defineProperty(source, 'permissionStatus', {
        get() { call(); return old },
      })
    },
  ]) neverCalled(await inputs(), modifier)
})

test('snapshot detects sparse slots, own array getters, adjacent array properties and symbol keys', async () => {
  for (const modifier of [
    d => { delete d.batch.results[1] },
    d => {
      Object.defineProperty(d.batch.results, '0', { get() {
        throw Error('should never invoke')
      } })
    },
    d => { d.batch.results.debug = 'untrusted' },
    d => { d.batch.results[0][Symbol('private')] = 'invisible' },
  ]) {
    const data = await inputs()
    modifier(data)
    assert.throws(() => run(data), refusal)
  }
})

test('non-JSON values, non-plain objects, cyclical source facts and oversized arrays fail closed', async () => {
  for (const modifier of [
    d => { d.batch.summary.observations = Number.POSITIVE_INFINITY },
    d => { d.batch.results[0].observations[0].currentPriceCents = Number.NaN },
    d => { d.batch.summary.circular = d.batch },
    d => { d.rights.sources[0].permissionStatus = undefined },
    d => { d.batch.results[0].observations[0].provenance = new Date() },
    d => { d.batch.results = new Array(10_001).fill(d.batch.results[0]) },
    d => { d.rights.testExtra = () => {} },
  ]) {
    const data = await inputs()
    modifier(data)
    assert.throws(() => run(data), refusal)
  }
})

test('caller mutation after snapshot cannot alter validated prices, rights or provenance', async () => {
  const data = await inputs()
  const snap = snapshotInertPrivateM3Sources(data.rights, data.batch)
  const original = snap.batch.results[0].observations[0].provenance.capturedAt
  const originalStatus = snap.permissionGate.sources[0].permissionStatus
  const originalPrice = snap.batch.results[0].observations[0].currentPriceCents
  data.batch.results[0].observations[0].provenance.capturedAt = '2026-10-16T23:59:59.000Z'
  data.batch.results[0].observations[0].currentPriceCents = 99999
  data.rights.sources[0].permissionStatus = 'permitted'
  assert.equal(snap.batch.results[0].observations[0].provenance.capturedAt, original)
  assert.equal(snap.batch.results[0].observations[0].currentPriceCents, originalPrice)
  assert.equal(snap.permissionGate.sources[0].permissionStatus, originalStatus)
  assert.throws(() => { snap.batch.results[0].observations[0].currentPriceCents = 1 },
    TypeError)
  const safeReport = assessPrivateM3RetailerIngestion(
    snap.permissionGate, snap.batch, { referenceTime: AT })
  assert.equal(safeReport.releaseDecision, 'hold')
  assert.equal(safeReport.permissionVerified, false)
})

test('inert snapshot cannot bypass source-rights or count consistency guards', async () => {
  const data = await inputs()
  data.batch.summary.permissionVerified = true
  assert.throws(() => run(data))
  const other = await inputs()
  other.batch.summary.observations++
  assert.throws(() => run(other))
  const options = await inputs()
  let calls = 0
  const fake = {}
  Object.defineProperty(fake, 'referenceTime', {
    get() { calls++; return AT },
  })
  assert.throws(() => assessPrivateM3RetailerIngestion(
    options.rights, options.batch, fake), refusal)
  assert.equal(calls, 0)
})
