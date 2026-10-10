import assert from 'node:assert/strict'
import test from 'node:test'

import { assessControlledSourceBasketReadiness } from '../src/data/controlledSourceBasketReadiness.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Entirely SYNTHETIC source observations. The real M2 four-meal demand is
// reused ONLY as the planner input; zero M2 products are supplied as prices.
const baselineStore = { id: 'synthetic-plus', supermarket: 'plus' }
const candidateStore = { id: 'synthetic-deka', supermarket: 'dekamarkt' }
const capturedAt = '2026-10-10T12:00:00Z'

const safeM2Products = [
  ...m2Products.filter(product => product.id !== 'basmati-1kg' && product.id !== 'curry-50'),
  {
    id: 'garam-50', name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139,
  },
]
assert.equal(safeM2Products.length, 10)

function sourceRecord(supermarket, p) {
  const sourcePack = p.packUnit === 'piece'
    ? `${p.packAmount} stuk`
    : `${p.packAmount} ${p.packUnit}`
  return {
    supermarket,
    sourceProductId: p.id,
    name: p.name,
    currentPriceCents: p.priceCents,
    currency: 'EUR',
    pack: { rawText: sourcePack, amount: p.packAmount, unit: p.packUnit },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket,
      kind: 'product',
      url: supermarket === 'plus'
        ? `https://www.plus.nl/synthetic-${p.id}`
        : `https://www.dekamarkt.nl/synthetic-${p.id}`,
      capturedAt,
      sha256: 'e'.repeat(64),
    },
  }
}

function storeSource(supermarket) {
  const riceIsMultipack = supermarket === 'dekamarkt'
  const rice = {
    id: 'rice-pack',
    name: 'Basmati rijst',
    packAmount: riceIsMultipack ? 500 : 1,
    packUnit: riceIsMultipack ? 'g' : 'kg',
    priceCents: riceIsMultipack ? 299 : 249,
  }
  const products = safeM2Products.map(p => sourceRecord(supermarket, p))
  const riceObservation = sourceRecord(supermarket, rice)
  if (riceIsMultipack) {
    riceObservation.pack.rawText = '6 x 500 g'
  }
  return [...products, riceObservation]
}

function request(baselineObservations, candidateObservations) {
  return {
    baselineStore, candidateStore,
    baselineStoreName: 'Synthetic PLUS', candidateStoreName: 'Synthetic DekaMarkt',
    baselineObservations, candidateObservations,
    referenceTime: capturedAt,
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  }
}

test('all 11 actual M2 demands require 11 controlled synthetic source records EACH, without fixture fallback', () => {
  const plus = storeSource('plus')
  const deka = storeSource('dekamarkt')
  const input = request(plus, deka)
  const original = structuredClone(input)
  assert.equal(plus.length, 11)
  assert.equal(deka.length, 11)

  const result = assessControlledSourceBasketReadiness(input)
  assert.equal(result.status, 'structural-pass')
  assert.equal(result.releaseEligible, false)
  assert.equal(result.baseline.selectedMealCount, 4)
  assert.equal(result.candidate.selectedMealCount, 4)
  assert.equal(result.baseline.lines.length, 11)
  assert.equal(result.candidate.lines.length, 11)
  assert.equal(result.baseline.unresolvedLineCount, 0)
  assert.equal(result.candidate.unresolvedLineCount, 0)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.candidateMinusBaselineCents, 50)

  const candidateRice = result.candidate.lines.find(line => line.id === 'basmati-rice')
  assert.equal(candidateRice.status, 'matched')
  assert.equal(candidateRice.pack.count, 6)
  assert.equal(candidateRice.packs, 1)
  assert.equal(candidateRice.lineTotalCents, 299)
  assert.deepEqual(input, original)
})

test('removing any one of 11 source lines from one retailer invalidates the whole week, not just that product', () => {
  const plus = storeSource('plus')
  const deka = storeSource('dekamarkt')
  for (let i = 0; i < 11; i++) {
    assert.equal(
      assessControlledSourceBasketReadiness(request(
        plus.filter((_, index) => index !== i), deka,
      )).status,
      'structural-fail',
      `PLUS missing source index ${i}`,
    )
    assert.equal(
      assessControlledSourceBasketReadiness(request(
        plus, deka.filter((_, index) => index !== i),
      )).status,
      'structural-fail',
      `DekaMarkt missing source index ${i}`,
    )
  }
})

test('a single malformed or stale item makes a full source catalog ineligible', () => {
  const plus = storeSource('plus')
  const deka = storeSource('dekamarkt')
  deka[2].provenance.capturedAt = '2026-10-09T11:59:59Z'
  assert.equal(assessControlledSourceBasketReadiness(request(plus, deka)).status, 'structural-fail')
  const dekaCorrect = storeSource('dekamarkt')
  dekaCorrect[2].pack.amount = 999
  assert.equal(assessControlledSourceBasketReadiness(request(plus, dekaCorrect)).status, 'structural-fail')
})
