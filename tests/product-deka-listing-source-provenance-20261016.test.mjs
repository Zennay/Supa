import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

// These are already checked-in sanitized historical M1 capture structures.
// Never scrape, fabricate a current price, or assert permission based on them.
const sources = [
  ['catalog','dekamarkt-catalog-melk.v1.json',parseDekaMarktSsrCatalogEvidence],
  ['offers','dekamarkt-offers.v1.json',parseDekaMarktSsrOffersEvidence],
]
const read = async path => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + path, import.meta.url), 'utf8'))

for (const [kind, file, parse] of sources) {
  test('Deka ' + kind + ' original sanitized source remains immutable private historical observation', async () => {
    const archive = await read(file)
    const result = parse(archive)
    assert.equal(result.type, 'observations')
    assert.ok(result.observations.length > 0)
    for (const row of result.observations) {
      assert.equal(row.provenance.url, archive.source.url)
      assert.equal(row.provenance.capturedAt, archive.source.capturedAt)
      assert.equal(row.provenance.sha256, archive.source.sha256)
    }
  })

  test('Deka ' + kind + ' must refuse impossible future archive capture', async () => {
    for (const time of [
      '2099-10-04T18:53:02.645Z',
      new Date(Date.now() + 10 * 60_000).toISOString(),
    ]) {
      const archive = await read(file)
      archive.source.capturedAt = time
      const result = parse(archive)
      assert.equal(result.type, 'abstain', time)
      assert.equal(Object.hasOwn(result, 'observations'), false)
    }
  })

  test('Deka ' + kind + ' must reject non-reviewed query, credential-named or fragment source identity', async () => {
    for (const ending of [
      '?access_token=fictional', '?refresh_token=fictional',
      '?utm_source=unreviewed', '#wrong-page',
    ]) {
      const archive = await read(file)
      archive.source.url += ending
      const result = parse(archive)
      assert.equal(result.type, 'abstain', ending)
      assert.equal(Object.hasOwn(result, 'observations'), false)
    }
  })

  test('Deka ' + kind + ' canonical TLS port 443 remains valid but 8443 is not', async () => {
    const archive = await read(file)
    const base = archive.source.url
    archive.source.url = base.replace('https://www.dekamarkt.nl/','https://www.dekamarkt.nl:443/')
    assert.equal(parse(archive).type, 'observations')
    archive.source.url = base.replace('https://www.dekamarkt.nl/','https://www.dekamarkt.nl:8443/')
    assert.equal(parse(archive).type, 'abstain')
  })
}
