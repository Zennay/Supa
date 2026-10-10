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

// Synthetic-only QA for the existing open #1127 observed-study runtime boundary.
// This does NOT provide any genuine PLUS, DekaMarkt or participant observations.
function observedBasket(store, priceDelta = 0) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + priceDelta,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Synthetic garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDelta,
    },
  ]
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function study() {
  return {
    schemaVersion: 1,
    studyId: 'qa-nested-2026-40',
    participantKey: 'qa-nested-001',
    population: 'synthetic QA only',
    region: 'fictional-region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-nested-plus',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic and unavailable outside tests',
      basket: observedBasket({ id: 'qa-plus', name: 'Synthetic PLUS' }),
    },
    candidate: {
      evidenceId: 'qa-nested-deka',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic and unavailable outside tests',
      basket: observedBasket({ id: 'qa-deka', name: 'Synthetic DekaMarkt' }, -10),
    },
  }
}

function firstMatchedLine(value, side) {
  const line = value[side].basket.lines.find((entry) => entry.status === 'matched')
  assert.ok(line, `expected one controlled matched ${side} line`)
  return line
}

function assertUnknownWithoutTrust(value, name) {
  const before = structuredClone(value)
  let result
  assert.doesNotThrow(() => {
    result = assessWeeklyBasketStudy(value)
  }, `${name}: trusted assessment must not propagate a TypeError`)
  assert.equal(result.claimable, false, name)
  assert.equal(result.comparison.outcome, 'unknown', name)
  assert.equal(result.comparison.savingsCents, null, name)
  assert.equal(result.comparison.deltaCents, null, name)
  assert.deepEqual(result.comparison.lineDeltas, [], name)
  assert.equal(result.attribution.fullyAttributed, false, name)
  assert.equal(result.attribution.effectTotals.unknownCents, null, name)
  assert.ok(result.reasons.length > 0, `${name}: actionable safe explanation required`)
  assert.equal(result.observationWindowHours, null, `${name}: no trusted window for corrupt evidence`)
  assert.deepEqual(value, before, `${name}: no runtime input mutation`)
}

test('valid synthetic evidence with intact matched product records stays claimable', () => {
  const value = study()
  const before = structuredClone(value)
  const result = assessWeeklyBasketStudy(value)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1.25)
  assert.deepEqual(value, before)
})

for (const side of ['baseline', 'candidate']) {
  for (const [name, mutate] of [
    ['null matched pack', (line) => { line.pack = null }],
    ['absent matched pack', (line) => { delete line.pack }],
    ['null matched requirement', (line) => { line.requirement = null }],
    ['absent matched requirement', (line) => { delete line.requirement }],
  ]) {
    test(`M3 assessment refuses ${side} ${name} rather than crashing`, () => {
      const value = study()
      mutate(firstMatchedLine(value, side))
      assertUnknownWithoutTrust(value, `${side}: ${name}`)
    })
  }
}
