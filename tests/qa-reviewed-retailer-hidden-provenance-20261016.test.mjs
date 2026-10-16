import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { snapshotInertReviewedEvidence } from '../scripts/retailer-inert-json-admission.mjs'
import {
  ingestReviewedEvidence,
  ingestReviewedBatch,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent QA on the frozen product-core offline admission owner.
// ALL evidence is checked-in historical/sanitized local JSON. No HTTP, renderer,
// source-rights change, production pricing, customer data, or external I/O.
async function plus() {
  return JSON.parse(await readFile(
    new URL('../fixtures/m1/plus-rendered-product-halfvolle-melk.v1.json', import.meta.url),
    'utf8',
  ))
}

function hide(record, path, key) {
  let obj = record
  for (const step of path) obj = obj[step]
  assert.equal(Object.hasOwn(obj, key), true)
  Object.defineProperty(obj, key, { enumerable: false })
  assert.equal(Object.prototype.propertyIsEnumerable.call(obj, key), false)
  return record
}

test('inert admission never resurrects invisible own provenance into enumerable JSON', () => {
  const hidden = { source: { id: 'reviewed-capture' }, kind: 'local' }
  hide(hidden, [], 'source')
  assert.equal(JSON.stringify(hidden), '{"kind":"local"}')
  // A source field absent from the portable JSON must never appear trusted.
  assert.throws(
    () => snapshotInertReviewedEvidence(hidden),
    /inert JSON/,
  )
})

test('single reviewed PLUS ingestion refuses a non-enumerable source object', async () => {
  const record = hide(await plus(), [], 'source')
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(record)), 'source'), false)
  assert.throws(
    () => ingestReviewedEvidence(record),
    /inert JSON/,
  )
})

test('batch reviewed PLUS ingestion refuses a non-enumerable source identity', async () => {
  const record = hide(await plus(), ['source'], 'id')
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(record)).source, 'id'), false)
  assert.throws(
    () => ingestReviewedBatch([record]),
    /inert JSON/,
  )
})

test('reviewed PLUS ingestion refuses non-enumerable browser source safety attestations', async () => {
  const record = hide(await plus(), ['browserEvidence'], 'safety')
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(record)).browserEvidence, 'safety'), false)
  assert.throws(
    () => ingestReviewedEvidence(record),
    /inert JSON/,
  )
})

test('normal JSON and non-writable but enumerable own provenance remain accepted privately', async () => {
  const fromJson = await plus()
  assert.equal(ingestReviewedEvidence(fromJson).accepted, true)
  const frozen = await plus()
  Object.defineProperty(frozen, 'source', {
    value: frozen.source,
    enumerable: true,
    configurable: false,
    writable: false,
  })
  assert.equal(ingestReviewedEvidence(frozen).accepted, true)
  const batch = ingestReviewedBatch([fromJson])
  assert.equal(batch.summary.acceptedSources, 1)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
})
