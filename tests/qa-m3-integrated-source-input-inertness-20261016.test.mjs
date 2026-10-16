import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assessPrivateM3RetailerIngestion } from
  '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import { loadReviewedRepositoryFixtures } from
  '../scripts/retailer-reviewed-ingest-engine.mjs'

// Separate add-only acceptance on the frozen product-owner #3107 source.
// The API says it takes already-reviewed data, not arbitrary active JS objects.
// All mutations are synthetic in-process probes, not real retailer captures.
const AT = '2026-10-16T00:00:00.000Z'
async function inputs() {
  return {
    rights: JSON.parse(await readFile(
      new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8')),
    batch: structuredClone(await loadReviewedRepositoryFixtures()),
  }
}
function assess(rights, batch) {
  return assessPrivateM3RetailerIngestion(rights, batch, { referenceTime: AT })
}
function assertRefusalWithoutExecuting(fn, counter, label) {
  assert.throws(fn, undefined, label + ' must refuse caller-supplied active input')
  assert.equal(counter.calls, 0, label + ' must not execute caller-owned code')
}

test('historical valid inert source batch remains accepted only as private HOLD', async () => {
  const { rights, batch } = await inputs()
  const before = structuredClone(batch)
  const result = assess(rights, batch)
  assert.equal(result.releaseDecision, 'hold')
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.liveRequests, 0)
  assert.deepEqual(batch, before)
})

test('top-level batch.results own getter is refused before invoking caller code', async () => {
  const { rights, batch } = await inputs()
  const existing = batch.results
  const counter = { calls: 0 }
  Object.defineProperty(batch, 'results', {
    configurable: true, enumerable: true,
    get() { counter.calls++; return existing },
  })
  assertRefusalWithoutExecuting(() => assess(rights, batch), counter, 'batch.results getter')
})

test('top-level Proxy-wrapped reviewed batch is refused before any Proxy trap', async () => {
  const { rights, batch } = await inputs()
  const counter = { calls: 0 }
  const proxy = new Proxy(batch, {
    get(target, key, receiver) {
      counter.calls++
      return Reflect.get(target, key, receiver)
    },
    getOwnPropertyDescriptor(target, key) {
      counter.calls++
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  assertRefusalWithoutExecuting(() => assess(rights, proxy), counter, 'batch Proxy')
})

test('source result observations own getter is refused without executing it', async () => {
  const { rights, batch } = await inputs()
  const source = batch.results[0]
  const observations = source.observations
  const counter = { calls: 0 }
  Object.defineProperty(source, 'observations', {
    configurable: true, enumerable: true,
    get() { counter.calls++; return observations },
  })
  assertRefusalWithoutExecuting(() => assess(rights, batch),
    counter, 'nested source observations getter')
})

test('source provenance clock getter is refused before historical source inspection', async () => {
  const { rights, batch } = await inputs()
  const provenance = batch.results[0].observations[0].provenance
  const time = provenance.capturedAt
  const counter = { calls: 0 }
  Object.defineProperty(provenance, 'capturedAt', {
    configurable: true, enumerable: true,
    get() { counter.calls++; return time },
  })
  assertRefusalWithoutExecuting(() => assess(rights, batch), counter,
    'nested provenance clock getter')
})

test('Proxy-wrapped source permission register cannot execute traps before validation', async () => {
  const { rights, batch } = await inputs()
  const counter = { calls: 0 }
  const proxy = new Proxy(rights, {
    get(target, key, receiver) {
      counter.calls++
      return Reflect.get(target, key, receiver)
    },
    getOwnPropertyDescriptor(target, key) {
      counter.calls++
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  assertRefusalWithoutExecuting(() => assess(proxy, batch), counter,
    'source permission Proxy')
})

test('already-enforced options getter controls remain inert positive trust-boundary check', async () => {
  const { rights, batch } = await inputs()
  const counter = { calls: 0 }
  const opts = {}
  Object.defineProperty(opts, 'referenceTime', {
    get() { counter.calls++; return AT },
  })
  assert.throws(() => assessPrivateM3RetailerIngestion(rights, batch, opts))
  assert.equal(counter.calls, 0)
})
