import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent postrepair acceptance of the actual M3 study assessment path.
// Controlled M2 fixture prices are never real retailer observations.
function basket(id, delta) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${id}-${product.id}`,
      storeId: id,
      priceCents: Math.max(0, product.priceCents + delta),
    })),
    {
      id: `${id}-garam-50`,
      storeId: id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + delta,
    },
  ]
  const result = buildOneStoreBasket({
    store: { id, name: 'Synthetic test store' },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(result.unresolvedLineCount, 0)
  return result
}

function study(candidateDelta = -10) {
  return {
    schemaVersion: 1,
    studyId: 'qa-identity-2026',
    participantKey: 'synthetic-student-001',
    population: 'synthetic students',
    region: 'synthetic region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-identity-a',
      observedAt: '2026-10-12T10:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Controlled M2 fixture only, not retail evidence.',
      basket: basket('qa-study-a', 0),
    },
    candidate: {
      evidenceId: 'qa-identity-b',
      observedAt: '2026-10-12T11:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Controlled M2 fixture only, not retail evidence.',
      basket: basket('qa-study-b', candidateDelta),
    },
  }
}

function assertUnknownAssessment(result, matchingReason) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
  assert.match(result.reasons.join(' '), matchingReason)
  assert.equal(result.observationWindowHours, 1)
}

test('M3 assessment propagates unreadable store ID to nonclaimable report', () => {
  const value = study()
  value.baseline.basket.store.id = '\u200B \u034F'
  assertUnknownAssessment(
    assessWeeklyBasketStudy(value),
    /baseline basket has an invalid store identity/,
  )
})

test('M3 assessment propagates identical invisible matched labels to unknown', () => {
  const value = study()
  for (const side of ['baseline', 'candidate']) {
    const line = value[side].basket.lines.find((entry) => entry.status === 'matched')
    assert.ok(line)
    line.ingredientLabel = '\u2060\u200D\u0301'
  }
  assertUnknownAssessment(
    assessWeeklyBasketStudy(value),
    /basket contains invalid matched-line identity/,
  )
})

test('M3 assessment rejects an isolated surrogate product name', () => {
  const value = study()
  const line = value.baseline.basket.lines.find((entry) => entry.status === 'matched')
  assert.ok(line)
  line.productName = '\uD800'
  assertUnknownAssessment(
    assessWeeklyBasketStudy(value),
    /basket contains invalid matched-line identity/,
  )
})

test('M3 assessment keeps visible emoji, CJK and decomposed accents claimable', () => {
  const value = study(20)
  value.baseline.basket.store.id = '東京-🛒'
  for (const side of ['baseline', 'candidate']) {
    const line = value[side].basket.lines.find((entry) => entry.status === 'matched')
    assert.ok(line)
    line.ingredientLabel = 'cafe\u0301 日本語 👩‍🍳'
    line.productName = 'product 🥦'
  }
  const result = assessWeeklyBasketStudy(value)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'worse')
  assert.ok(result.comparison.savingsCents < 0)
  assert.equal(result.observationWindowHours, 1)
  assert.deepEqual(result.reasons, [])
})
