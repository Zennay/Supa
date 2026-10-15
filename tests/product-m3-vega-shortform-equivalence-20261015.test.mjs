import test from 'node:test'
import assert from 'node:assert/strict'
import { matchIngredient } from '../src/domain/matching.ts'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Fictional offline goods, prices and source URLs. No retailer network,
// dietary suitability guarantee, real price claim or field observation.
const nowMs = Date.parse('2026-10-15T12:00:00Z')
const capturedAt = '2026-10-15T11:00:00Z'

const required = (query) => ({
  id: 'ingredient-1', query, amount: 400, unit: 'g',
})
const candidate = (name) => ({
  id: 'mock-sku', name, packAmount: 400, packUnit: 'g',
  packCount: 1, available: true,
})
const observation = (supermarket, name, cents) => ({
  supermarket,
  name,
  sourceProductId: 'mock-sku',
  currentPriceCents: cents,
  currency: 'EUR',
  pack: { rawText: '400 g', amount: 400, unit: 'g' },
  availability: 'available',
  offer: null,
  provenance: {
    supermarket,
    kind: 'product',
    url: supermarket === 'plus'
      ? 'https://www.plus.nl/product/fictional-meat'
      : 'https://www.dekamarkt.nl/producten/fictional-meat',
    sha256: 'b'.repeat(64),
    capturedAt,
  },
})
function compare(query, plusName, dekaName) {
  return compareReviewedCatalogs({
    requirements: [required(query)],
    observations: [
      observation('plus', plusName, 399),
      observation('dekamarkt', dekaName, 199),
    ],
    nowMs,
  })
}
function withhold(result) {
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.lines[0].differenceCents, null)
}

for (const [query, conventional, different] of [
  ['rundergehakt', 'Rundergehakt', 'Vega rundergehakt'],
  ['rundergehakt', 'Rundergehakt', 'Vleesvrij rundergehakt'],
  ['rundergehakt', 'Rundergehakt', 'Vleesvrije rundergehakt'],
  ['kipfilet', 'Kipfilet', 'Vega kipfilet'],
  ['kipfilet', 'Kipfilet', 'Vleesvrije kipfilet'],
]) {
  test('matcher excludes explicit meat-free variant: ' + different, () => {
    const decision = matchIngredient(required(query), [candidate(different)])
    assert.equal(decision.type, 'abstain')
    assert.match(decision.reasons.join(' '), /different dietary product variant/)
  })
  test('M3 same-demand comparison refuses false cheaper store: ' + different, () => {
    withhold(compare(query, conventional, different))
  })
}

test('explicit Dutch vega requirement matches the same short-form vega product', () => {
  const decision = matchIngredient(required('Vega rundergehakt'), [
    candidate('Vega rundergehakt'),
  ])
  assert.equal(decision.type, 'match')
  const result = compare('Vega rundergehakt', 'Vega rundergehakt', 'Vega rundergehakt')
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 200)
  assert.equal(result.claimable, false)
})

test('explicit vega requirement refuses unqualified animal-meat candidate', () => {
  const decision = matchIngredient(required('Vega rundergehakt'), [
    candidate('Rundergehakt'),
  ])
  assert.equal(decision.type, 'abstain')
  withhold(compare('Vega rundergehakt', 'Vega rundergehakt', 'Rundergehakt'))
})

test('unqualified animal meat in both stores keeps fictional preview working', () => {
  const result = compare('rundergehakt', 'Rundergehakt', 'Rundergehakt')
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 200)
  assert.equal(result.claimable, false)
})
