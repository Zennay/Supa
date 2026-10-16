import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
} from '../src/data/plusRenderedListings.ts'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

// Sanitized, already archived historical evidence only; no HTTP or current
// retailer prices, and these fixtures do not confer source permissions.
const cases = [
  ['PLUS catalog', 'plus-rendered-catalog.v1.json', parsePlusRenderedCatalogEvidence],
  ['PLUS offers', 'plus-rendered-offers.v1.json', parsePlusRenderedOffersEvidence],
  ['Deka catalog', 'dekamarkt-catalog-melk.v1.json', parseDekaMarktSsrCatalogEvidence],
  ['Deka offers', 'dekamarkt-offers.v1.json', parseDekaMarktSsrOffersEvidence],
]

for (const [name, fixtureName, parse] of cases) {
  test(`${name}: only exact reviewed source URL bytes may yield archived observations`, async () => {
    const fixture = JSON.parse(await readFile(
      new URL(`../fixtures/m1/${fixtureName}`, import.meta.url),
      'utf8',
    ))

    const accepted = parse(fixture)
    assert.equal(accepted.type, 'observations', name)
    assert.ok(accepted.observations.length > 0)
    for (const observation of accepted.observations) {
      assert.equal(observation.provenance.url, fixture.source.url)
      assert.equal(observation.provenance.sha256, fixture.source.sha256)
      assert.equal(observation.provenance.capturedAt, fixture.source.capturedAt)
    }

    // URL.search/hash become '' for all three spellings; raw unreviewed bytes
    // must not be mistaken for the SHA-bound original source identity.
    for (const suffix of ['?', '#', '?#']) {
      const mutated = structuredClone(fixture)
      mutated.source.url += suffix
      const rejected = parse(mutated)
      assert.equal(rejected.type, 'abstain', `${name} ${suffix}`)
      assert.equal(Object.hasOwn(rejected, 'observations'), false)
    }
  })

  test(`${name}: the previously accepted canonical TLS :443 stays valid`, async () => {
    const fixture = JSON.parse(await readFile(
      new URL(`../fixtures/m1/${fixtureName}`, import.meta.url),
      'utf8',
    ))
    fixture.source.url = fixture.source.url.replace(
      /^(https:\/\/[^/]+)/, '$1:443',
    )
    assert.equal(parse(fixture).type, 'observations', name)
  })
}
