import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { normalizePackText } from '../src/data/normalize.ts'
import { parseDekaMarktSsrProductEvidence } from '../src/data/dekaMarktSsrProduct.ts'
import { parsePlusRenderedProductEvidence } from '../src/data/plusRenderedProduct.ts'

// Controlled fixture mutation only. No retailer request, observation or savings claim.
async function loadFixture(name) {
  return JSON.parse(
    await readFile(new URL(`../fixtures/m1/${name}`, import.meta.url), 'utf8'),
  )
}

function assertMultipackPreserved(result, expected) {
  assert.equal(result.type, 'observation', 'controlled source fixture should parse')
  const pack = result.observation.pack
  assert.equal(pack.rawText, expected.rawText)
  assert.equal(pack.amount, expected.amount)
  assert.equal(pack.unit, expected.unit)
  assert.equal(
    pack.count,
    expected.count,
    'source observation must not silently discard normalized multipack count (#168)',
  )
}

test('normalizer distinguishes single pack from six-pack before source projection', () => {
  assert.deepEqual(normalizePackText('6 x 1 l'), {
    rawText: '6 x 1 l',
    count: 6,
    amount: 1,
    unit: 'l',
  })
  assert.deepEqual(normalizePackText('2 x 500 ml'), {
    rawText: '2 x 500 ml',
    count: 2,
    amount: 500,
    unit: 'ml',
  })
})

test('DekaMarkt SSR adapter must retain the six-pack count in raw observation (#168)', async () => {
  const evidence = await loadFixture('dekamarkt-product-halfvolle-melk.v1.json')
  evidence.nuxtPayload[8] = '6 x 1 l'

  const result = parseDekaMarktSsrProductEvidence(evidence)
  assertMultipackPreserved(result, {
    rawText: '6 x 1 l',
    amount: 1,
    unit: 'l',
    count: 6,
  })
  assert.equal(result.observation.currentPriceCents, 85)
})

test('PLUS rendered Schema.org adapter must retain multipack count (#168)', async () => {
  const evidence = await loadFixture('plus-rendered-product-halfvolle-melk.v1.json')
  evidence.jsonLd.weight.value = '2 x 500 ml'

  const result = parsePlusRenderedProductEvidence(evidence)
  assertMultipackPreserved(result, {
    rawText: '2 x 500 ml',
    amount: 500,
    unit: 'ml',
    count: 2,
  })
  assert.equal(result.observation.currentPriceCents, 85)
})

test('single-pack controlled fixtures remain valid while multipack contract is repaired', async () => {
  const deka = parseDekaMarktSsrProductEvidence(
    await loadFixture('dekamarkt-product-halfvolle-melk.v1.json'),
  )
  const plus = parsePlusRenderedProductEvidence(
    await loadFixture('plus-rendered-product-halfvolle-melk.v1.json'),
  )
  assert.equal(deka.type, 'observation')
  assert.equal(plus.type, 'observation')
  assert.equal(deka.observation.pack.amount, 1)
  assert.equal(deka.observation.pack.unit, 'l')
  assert.equal(plus.observation.pack.amount, 1000)
  assert.equal(plus.observation.pack.unit, 'ml')
})

test('DekaMarkt adapter fails closed on a multipack count above safe integer range', async () => {
  const evidence = await loadFixture('dekamarkt-product-halfvolle-melk.v1.json')
  evidence.nuxtPayload[8] = '9007199254740992 x 1 l'
  assert.equal(parseDekaMarktSsrProductEvidence(evidence).type, 'abstain')
})
