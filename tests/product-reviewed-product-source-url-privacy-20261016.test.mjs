import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { ingestReviewedEvidence, ingestReviewedBatch } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const names = [
  'plus-rendered-product-halfvolle-melk.v1.json',
  'dekamarkt-product-halfvolle-melk.v1.json',
]
async function historical(name) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}
test('all product identity URL refusals precede source adapters and never expose details', async () => {
  for (const name of names) {
    const original = await historical(name)
    assert.equal(ingestReviewedEvidence(original).accepted, true)
    for (const changed of [
      original.source.url + '?ref=fictional',
      original.source.url + '#',
      original.source.url + '?',
      original.source.url.replace('https://', 'http://'),
      original.source.url.replace('https://', 'https://fictional-user@'),
      original.source.url.replace('.nl/', '.nl:8443/'),
    ]) {
      const row = structuredClone(original)
      row.source.url = changed
      const result = ingestReviewedEvidence(row)
      assert.equal(result.accepted, false, name + ' must refuse URL: ' + changed.split('?')[0].split('#')[0])
      assert.equal(result.reason, 'unsafe-product-source-url')
      assert.deepEqual(result.observations, [])
    }
  }
})

test('rejected credential-url sources do not enable partial private price publication', async () => {
  const records = await Promise.all(names.map(historical))
  for (const record of records) record.source.url += '?access_token=FAKE'
  const out = ingestReviewedBatch(records)
  assert.equal(out.summary.acceptedSources, 0)
  assert.equal(out.summary.observations, 0)
  assert.equal(out.summary.permissionVerified, false)
  assert.equal(out.summary.productionEnabled, false)
  assert.equal(out.summary.publicSavingsClaimEligible, false)
  assert.ok(out.results.every(row => !row.accepted && row.observations.length === 0))
})
