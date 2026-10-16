import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { ingestReviewedEvidence, ingestReviewedBatch } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent QA2, synthetic aliases for local checked-in sanitized historical
// captures only. No retailer HTTP, license changes or public basket price.
const fixtures = {
  plus: 'plus-rendered-product-halfvolle-melk.v1.json',
  deka: 'dekamarkt-product-halfvolle-melk.v1.json',
}
async function fixture(name) {
  return JSON.parse(await readFile(
    new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}
function sourceFingerprint(record) {
  const { supermarket, kind, url, capturedAt, sha256 } = record.source
  return JSON.stringify({ supermarket, kind, url, capturedAt, sha256, evidenceType: record.evidenceType })
}

test('distinct genuine PLUS and Deka historical captures are independently accepted without rights elevation', async () => {
  const records = [await fixture(fixtures.plus), await fixture(fixtures.deka)]
  assert.notEqual(sourceFingerprint(records[0]), sourceFingerprint(records[1]))
  const batch = ingestReviewedBatch(records)
  assert.equal(batch.summary.acceptedSources, 2)
  assert.equal(batch.summary.rejectedSources, 0)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
})

test('single renamed internal capture id retains valid independent historical observation', async () => {
  const original = await fixture(fixtures.plus)
  const renamed = structuredClone(original)
  renamed.source.id += '-synthetic-alias'
  assert.equal(sourceFingerprint(original), sourceFingerprint(renamed))
  assert.equal(ingestReviewedEvidence(renamed).accepted, true)
  assert.ok(ingestReviewedEvidence(original).observations.length > 0)
})

for (const [retailer, filename] of Object.entries(fixtures)) {
  test(retailer + ' batch must not count identical immutable capture twice under two different IDs', async () => {
    const original = await fixture(filename)
    const alias = structuredClone(original)
    alias.source.id += '-synthetic-alias'
    assert.notEqual(original.source.id, alias.source.id)
    assert.equal(sourceFingerprint(original), sourceFingerprint(alias))
    assert.equal(JSON.stringify(original).includes('synthetic-alias'), false)
    assert.throws(
      () => ingestReviewedBatch([original, alias]),
      /Duplicate reviewed/,
      'one immutable capture hash/time/page cannot count as two independent sources',
    )
  })
}

test('two store captures plus one disguised duplicate PLUS cannot falsely increase acceptedSource totals', async () => {
  const plus = await fixture(fixtures.plus)
  const deka = await fixture(fixtures.deka)
  const alias = structuredClone(plus)
  alias.source.id = 'separate-id-but-same-immutable-capture'
  assert.equal(sourceFingerprint(plus), sourceFingerprint(alias))
  assert.throws(
    () => ingestReviewedBatch([plus, deka, alias]),
    /Duplicate reviewed/,
  )
})
