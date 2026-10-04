import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parseDekaMarktSsrProductEvidence } from '../src/data/dekaMarktSsrProduct.ts'

const fixtureUrl = new URL(
  '../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json',
  import.meta.url,
)

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'))
}

test('parses exact public DekaMarkt SSR evidence into a trusted observation', async () => {
  const evidence = await fixture()
  const result = parseDekaMarktSsrProductEvidence(evidence)

  assert.equal(result.type, 'observation')
  assert.equal(result.observation.supermarket, 'dekamarkt')
  assert.equal(result.observation.sourceProductId, '115873')
  assert.equal(result.observation.name, 'Zuivelmeester Halfvolle melk')
  assert.equal(result.observation.currentPriceCents, 85)
  assert.deepEqual(result.observation.pack, {
    rawText: '1 liter',
    amount: 1,
    unit: 'l',
  })
  assert.equal(result.observation.availability, 'available')
  assert.equal(
    result.observation.provenance.sha256,
    '33af1a3f0117c22401309507627d04fc8e8b1044a88180c6230c7cdee8e8c670',
  )
})

test('DekaMarkt evidence fails closed on Nuxt/JSON-LD price disagreement', async () => {
  const evidence = await fixture()
  evidence.jsonLdProduct.offers.Price = 0.99

  assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
    type: 'abstain',
    reason: 'DekaMarkt JSON-LD does not corroborate Nuxt product identity/price',
  })
})

test('DekaMarkt evidence rejects unsafe acquisition metadata', async () => {
  const evidence = await fixture()
  evidence.captureEvidence.safety.antiBotBypass = true

  assert.deepEqual(parseDekaMarktSsrProductEvidence(evidence), {
    type: 'abstain',
    reason: 'DekaMarkt evidence violates the bounded capture contract',
  })
})
