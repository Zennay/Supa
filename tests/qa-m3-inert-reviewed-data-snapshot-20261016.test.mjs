import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { snapshotInertReviewedRetailerInputs } from
  '../scripts/qa-m3-inert-reviewed-data-snapshot.mjs'
import { assessPrivateM3RetailerIngestion } from
  '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import { loadReviewedRepositoryFixtures } from
  '../scripts/retailer-reviewed-ingest-engine.mjs'

// Synthetic in-memory input boundary tests, NOT physical retailer evidence.
const AT = '2026-10-16T00:00:00.000Z'
const denied = /Inert historical retailer QA snapshot refused/
async function inputs() {
  return {
    permissionGate: JSON.parse(await readFile(
      new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8')),
    batch: structuredClone(await loadReviewedRepositoryFixtures()),
  }
}
function checkInert(data) {
  const before = data.batch && Object.getOwnPropertyDescriptor(data.batch, 'results')?.value
  const cloned = snapshotInertReviewedRetailerInputs(data.permissionGate, data.batch)
  assert.notEqual(cloned.batch, data.batch)
  assert.notEqual(cloned.permissionGate, data.permissionGate)
  assert.equal(cloned.batch.results.length, 6)
  assert.equal(Object.isFrozen(cloned), true)
  assert.equal(Object.isFrozen(cloned.batch), true)
  assert.equal(Object.isFrozen(cloned.batch.results), true)
  assert.equal(Object.isFrozen(cloned.batch.results[0].observations[0].provenance), true)
  if (before) assert.equal(data.batch.results, before)
  return cloned
}
function rejectWithoutInvocation(data, calls) {
  assert.throws(() => snapshotInertReviewedRetailerInputs(
    data.permissionGate, data.batch), denied)
  assert.equal(calls.value, 0, 'no caller-owned getter/Proxy trap may execute')
}

test('original reviewed PLUS/Deka fixtures become immutable and retain all genuine M3 HOLD facts', async () => {
  const data = await inputs()
  const previous = structuredClone(data)
  const snapshot = checkInert(data)
  const report = assessPrivateM3RetailerIngestion(
    snapshot.permissionGate, snapshot.batch, { referenceTime: AT })
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.currentStockCoverageVerified, false)
  assert.equal(report.liveRequests, 0)
  assert.deepEqual(data, previous, 'snapshot must not mutate original data')
})

test('top-level source batch accessor is refused without getter invocation', async () => {
  const data = await inputs()
  const calls = { value: 0 }
  const original = data.batch.results
  Object.defineProperty(data.batch, 'results', {
    enumerable: true, get() { calls.value++; return original },
  })
  rejectWithoutInvocation(data, calls)
})

test('top-level source Proxy is refused without get/getOwnPropertyDescriptor traps', async () => {
  const data = await inputs()
  const calls = { value: 0 }
  data.batch = new Proxy(data.batch, {
    get(target, prop, receiver) {
      calls.value++
      return Reflect.get(target, prop, receiver)
    },
    getOwnPropertyDescriptor(target, prop) {
      calls.value++
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  })
  rejectWithoutInvocation(data, calls)
})

test('nested observations getter is refused without reading source rows', async () => {
  const data = await inputs()
  const calls = { value: 0 }
  const original = data.batch.results[0].observations
  Object.defineProperty(data.batch.results[0], 'observations', {
    get() { calls.value++; return original },
  })
  rejectWithoutInvocation(data, calls)
})

test('deep provenance capturedAt getter is refused with zero invocation', async () => {
  const data = await inputs()
  const calls = { value: 0 }
  const provenance = data.batch.results[0].observations[0].provenance
  const original = provenance.capturedAt
  Object.defineProperty(provenance, 'capturedAt', {
    get() { calls.value++; return original },
  })
  rejectWithoutInvocation(data, calls)
})

test('source permission register Proxy is refused before any trap', async () => {
  const data = await inputs()
  const calls = { value: 0 }
  data.permissionGate = new Proxy(data.permissionGate, {
    get(target, prop, receiver) {
      calls.value++
      return Reflect.get(target, prop, receiver)
    },
    ownKeys(target) {
      calls.value++
      return Reflect.ownKeys(target)
    },
  })
  rejectWithoutInvocation(data, calls)
})

test('array accessors, sparse source slot and array-adjacent properties are refused', async () => {
  for (const mutation of [
    batch => { delete batch.results[2] },
    batch => {
      Object.defineProperty(batch.results, '0', {
        get() { throw Error('forbidden getter') },
      })
    },
    batch => { batch.results.x = 'non-JSON extra array field' },
  ]) {
    const data = await inputs()
    mutation(data.batch)
    assert.throws(() => snapshotInertReviewedRetailerInputs(
      data.permissionGate, data.batch), denied)
  }
})

test('non-JSON numeric and cyclical inputs fail closed; source records stay untouched', async () => {
  for (const mutation of [
    batch => { batch.summary.observations = Number.POSITIVE_INFINITY },
    batch => { batch.results[0].observations[0].currentPriceCents = Number.NaN },
    batch => { batch.summary.hiddenCycle = batch },
  ]) {
    const data = await inputs()
    mutation(data.batch)
    assert.throws(() => snapshotInertReviewedRetailerInputs(
      data.permissionGate, data.batch), denied)
  }
})

test('nested source too many records or non-plain objects are refused without side effects', async () => {
  const large = await inputs()
  large.batch.results = new Array(10_001).fill(large.batch.results[0])
  assert.throws(() => snapshotInertReviewedRetailerInputs(
    large.permissionGate, large.batch), denied)
  const nonPlain = await inputs()
  nonPlain.batch.results[0].observations[0].provenance = new Date()
  assert.throws(() => snapshotInertReviewedRetailerInputs(
    nonPlain.permissionGate, nonPlain.batch), denied)
})
