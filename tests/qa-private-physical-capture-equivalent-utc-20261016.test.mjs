import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { auditPhysicalRetailerCaptures } from '../scripts/retailer-private-capture-identity-audit.mjs'

// Independent QA2 on frozen private-only product audit. Genuine checked-in
// historical source; synthetic local alternate ISO offsets, zero external I/O.
async function plus() {
  return JSON.parse(await readFile(
    new URL('../fixtures/m1/plus-rendered-product-halfvolle-melk.v1.json', import.meta.url),
    'utf8',
  ))
}

test('single genuine historic PLUS source remains private, with rights/publication flags denied', async () => {
  const r = auditPhysicalRetailerCaptures([await plus()])
  assert.equal(r.reviewedSources, 1)
  assert.equal(r.uniquePhysicalCaptures, 1)
  assert.equal(r.productionEnabled, false)
  assert.equal(r.permissionVerified, false)
  assert.equal(r.publicSavingsClaimEligible, false)
})

test('Z and +02:00 textual capture clocks representing the same instant cannot count as two physical captures', async () => {
  const original = await plus()
  const alias = structuredClone(original)
  alias.source.id += '-alternate-zone'
  alias.source.capturedAt = '2026-10-04T20:08:57.837+02:00'
  assert.equal(Date.parse(original.source.capturedAt), Date.parse(alias.source.capturedAt))
  assert.notEqual(original.source.capturedAt, alias.source.capturedAt)
  assert.throws(
    () => auditPhysicalRetailerCaptures([original, alias]),
    /Duplicate physical/,
  )
})

test('Z and +00:00 textual aliases of one archived source also cannot inflate source coverage', async () => {
  const original = await plus()
  const alias = structuredClone(original)
  alias.source.id += '-utc-offset-alias'
  alias.source.capturedAt = original.source.capturedAt.replace(/Z$/, '+00:00')
  assert.equal(Date.parse(original.source.capturedAt), Date.parse(alias.source.capturedAt))
  assert.throws(
    () => auditPhysicalRetailerCaptures([original, alias]),
    /Duplicate physical/,
  )
})

test('two distinct physical instants under different offsets remain separately auditable', async () => {
  const original = await plus()
  const later = structuredClone(original)
  later.source.id += '-different-physical-time'
  later.source.capturedAt = '2026-10-04T20:08:57.837+01:00'
  assert.equal(Date.parse(later.source.capturedAt) - Date.parse(original.source.capturedAt), 3_600_000)
  const r = auditPhysicalRetailerCaptures([original, later])
  assert.equal(r.uniquePhysicalCaptures, 2)
  assert.equal(r.productionEnabled, false)
  assert.equal(r.publicSavingsClaimEligible, false)
})
