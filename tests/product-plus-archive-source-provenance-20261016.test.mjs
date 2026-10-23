import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
} from '../src/data/plusRenderedListings.ts'

const archives = [
  ['catalog', 'plus-rendered-catalog.v1.json', parsePlusRenderedCatalogEvidence],
  ['offers', 'plus-rendered-offers.v1.json', parsePlusRenderedOffersEvidence],
]
const load = async name => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))

for (const [name, fixture, parse] of archives) {
  test('historical sanitized PLUS ' + name + ' archive stays eligible only for offline observations', async () => {
    const row = await load(fixture)
    const output = parse(row)
    assert.equal(output.type, 'observations')
    assert.ok(output.observations.length > 0)
    for (const obs of output.observations) {
      assert.equal(obs.provenance.url, row.source.url)
      assert.equal(obs.provenance.capturedAt, row.source.capturedAt)
      assert.equal(obs.provenance.sha256, row.source.sha256)
    }
  })

  test('future PLUS ' + name + ' capture cannot masquerade as a reviewed historical event', async () => {
    for (const capturedAt of [
      '2099-10-04T18:53:02.645Z',
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ]) {
      const row = await load(fixture)
      row.source.capturedAt = capturedAt
      const output = parse(row)
      assert.equal(output.type, 'abstain', capturedAt)
      assert.equal(Object.hasOwn(output, 'observations'), false)
    }
  })

  test('PLUS ' + name + ' must not emit a noncanonical or credential-named source URL', async () => {
    for (const suffix of [
      '?access_token=fake', '?refresh_token=fake',
      '?utm_source=fictional', '#catalog-fragment',
    ]) {
      const row = await load(fixture)
      row.source.url += suffix
      const output = parse(row)
      assert.equal(output.type, 'abstain', suffix)
      assert.equal(Object.hasOwn(output, 'observations'), false)
    }
  })
}
