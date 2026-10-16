import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

// Read the immutable reviewed M1 fixtures. Altered IDs below are fictional
// in-memory QA cases, never physical retailer captures or current prices.
async function source(name) {
  return JSON.parse(await readFile(
    new URL('../fixtures/m1/' + name, import.meta.url), 'utf8',
  ))
}

test('Deka catalog: original distinct identities stay accepted', async () => {
  const result = parseDekaMarktSsrCatalogEvidence(
    await source('dekamarkt-catalog-melk.v1.json'))
  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 3)
  assert.equal(result.abstained, 0)
})

test('Deka catalog: duplicate physical product IDs fail closed across distinct entries', async () => {
  const evidence = await source('dekamarkt-catalog-melk.v1.json')
  // Second product ID now falsely points at first; all other facts unchanged.
  evidence.nuxtPayload[14] = evidence.nuxtPayload[6]
  assert.deepEqual(parseDekaMarktSsrCatalogEvidence(evidence), {
    type: 'abstain',
    reason: 'DekaMarkt catalog contains duplicate product identities',
  })
})

test('Deka offers: original distinct identities stay accepted', async () => {
  const result = parseDekaMarktSsrOffersEvidence(
    await source('dekamarkt-offers.v1.json'))
  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 3)
  assert.equal(result.abstained, 0)
})

test('Deka offers: two different offer groups claiming same product ID fail closed', async () => {
  const evidence = await source('dekamarkt-offers.v1.json')
  // Product and product-information references both dereference index 26.
  evidence.nuxtPayload[26] = evidence.nuxtPayload[11]
  assert.deepEqual(parseDekaMarktSsrOffersEvidence(evidence), {
    type: 'abstain',
    reason: 'DekaMarkt offers contain duplicate product identities',
  })
})
