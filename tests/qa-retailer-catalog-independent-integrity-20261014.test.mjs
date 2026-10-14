import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

/**
 * Independent quality-validation of PR #2622.
 * Synthetic observations only. No retailer network, user identifiers,
 * licensed-data claims or production permission are involved.
 *
 * The two "EXPECTED RED" cases deliberately enforce the product owner's
 * stated fail-closed guarantees, not a workaround in QA code.
 */
const NOW = Date.parse('2026-10-15T10:00:00.000Z')
const demand = Object.freeze([
  Object.freeze({ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }),
])

function observation(shop, price, overrides = {}) {
  const capturedAt = '2026-10-15T09:00:00.000Z'
  return {
    supermarket: shop,
    sourceProductId: 'milk-1',
    name: 'Halfvolle melk',
    currentPriceCents: price,
    currency: 'EUR',
    pack: { amount: 1000, unit: 'ml', rawText: '1 l' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket: shop,
      kind: 'product',
      url: shop === 'plus'
        ? 'https://www.plus.nl/product/fictional-milk'
        : 'https://www.dekamarkt.nl/producten/fictional-milk',
      capturedAt,
      sha256: 'c'.repeat(64),
    },
    ...overrides,
  }
}

const compare = (observations, nowMs = NOW) =>
  compareReviewedCatalogs({ requirements: demand, observations, nowMs })

function refusesWinner(result) {
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
}

test('independent baseline: 1.5 l requires two whole packs at each shop', () => {
  const original = [observation('plus', 129), observation('dekamarkt', 119)]
  const bytes = JSON.stringify(original)
  const result = compare(original)
  assert.equal(result.claimable, false)
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 20)
  assert.equal(result.lines[0].plus.packs, 2)
  assert.equal(result.lines[0].dekamarkt.packs, 2)
  assert.equal(result.lines[0].plus.totalCents, 258)
  assert.equal(result.lines[0].dekamarkt.totalCents, 238)
  assert.equal(JSON.stringify(original), bytes, 'operator evidence must not mutate')
})

test('valid equality and lower price at PLUS preserve zero and signed line delta', () => {
  for (const [plusCents, dekaCents, expectedStore, delta, saving] of [
    [0, 0, 'equal', 0, 0],
    [70, 80, 'plus', 20, 20],
    [80, 70, 'dekamarkt', -20, 20],
  ]) {
    const result = compare([
      observation('plus', plusCents), observation('dekamarkt', dekaCents),
    ])
    assert.equal(result.comparable, true)
    assert.equal(result.cheaperStore, expectedStore)
    assert.equal(result.lines[0].differenceCents, delta)
    assert.equal(result.savingsCents, saving)
    assert.equal(result.claimable, false)
  }
})

test('wrong-market provenance and missing product must not produce a winner', () => {
  const mismatch = observation('dekamarkt', 119, {
    provenance: observation('plus', 129).provenance,
  })
  refusesWinner(compare([observation('plus', 129), mismatch]))
  refusesWinner(compare([observation('plus', 129)]))
})

test('same-shop duplicate available offers must not select the cheapest silently', () => {
  const result = compare([
    observation('plus', 129),
    observation('plus', 119),
    observation('dekamarkt', 119),
  ])
  refusesWinner(result)
})

test('EXPECTED RED: unavailable second record of SAME product ID must invalidate winner', () => {
  const result = compare([
    observation('plus', 129),
    observation('plus', null, { availability: 'unavailable' }),
    observation('dekamarkt', 119),
  ])
  // A contradictory stock-state duplicate cannot be silently discarded.
  // Source validation currently skips unavailable rows before duplicate detection.
  refusesWinner(result)
})

test('EXPECTED RED: future ISO sub-millisecond observation must not become current price', () => {
  const result = compare([
    observation('plus', 129),
    observation('dekamarkt', 119, {
      provenance: {
        ...observation('dekamarkt', 119).provenance,
        capturedAt: '2026-10-15T10:00:00.000000001Z',
      },
    }),
  ])
  // Date.parse loses the 1ns future excess at the exact millisecond boundary.
  refusesWinner(result)
})

test('invalid amounts and impossible same-basket demand must not invent cents', () => {
  const valid = [observation('plus', 129), observation('dekamarkt', 119)]
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = compareReviewedCatalogs({
      requirements: [{ ...demand[0], amount }],
      observations: valid,
      nowMs: NOW,
    })
    refusesWinner(result)
  }
  assert.throws(
    () => compareReviewedCatalogs({ requirements: [...demand, ...demand],
      observations: valid, nowMs: NOW }),
    /duplicate/,
  )
})

test('EXPECTED RED: a 500ml label must not be priced as a declared 1000ml pack', () => {
  const input = [
    observation('plus', 129, {
      pack: { amount: 1000, unit: 'ml', rawText: '500 ml' },
    }),
    observation('dekamarkt', 119),
  ]
  const original = JSON.stringify(input)
  refusesWinner(compare(input))
  assert.equal(JSON.stringify(input), original, 'evidence must remain unchanged')
})

test('EXPECTED RED: a 1000ml label must not be priced as a declared 500ml pack', () => {
  refusesWinner(compare([
    observation('plus', 129, {
      pack: { amount: 500, unit: 'ml', rawText: '1 l' },
    }),
    observation('dekamarkt', 119),
  ]))
})
