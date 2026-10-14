import assert from 'node:assert/strict'
import test from 'node:test'

import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Pure synthetic comparison data: no retailer observation or real prices.
function comparison(overrides = {}) {
  return {
    outcome: 'same',
    claimable: true,
    baselineTotalCents: 199,
    candidateTotalCents: 199,
    deltaCents: 0,
    savingsCents: 0,
    lineDeltas: [{
      id: 'synthetic-ingredient',
      ingredientLabel: 'Invented ingredient',
      baselineLineTotalCents: 199,
      candidateLineTotalCents: 199,
      deltaCents: 0,
    }],
    reasons: [],
    ...overrides,
  }
}

function assertNoFabricatedAttribution(result) {
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.packSizeCents, 0)
  assert.equal(result.effectTotals.offerCents, 0)
  assert.equal(result.effectTotals.planningCents, 0)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.ok(result.reasons.length > 0)
}

test('M3 direct attribution refuses a nominally claimable empty 0-cent basket comparison', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      baselineTotalCents: 0,
      candidateTotalCents: 0,
      lineDeltas: [],
    }),
    evidence: [],
  })
  assertNoFabricatedAttribution(result)
  assert.match(result.reasons.join(' '), /basket|line|ingredient/i)
})

test('M3 actual empty-week comparator cannot manufacture complete effect attribution', () => {
  const empty = storeId => ({
    store: { id: storeId, name: storeId },
    selectedMealCount: 0,
    lines: [],
    matchedLineCount: 0,
    unresolvedLineCount: 0,
    totalCents: 0,
  })
  const result = attributeSavingsEffects({
    comparison: compareFullBaskets({
      baseline: empty('plus-synthetic'),
      candidate: empty('deka-synthetic'),
    }),
    evidence: [],
  })
  assertNoFabricatedAttribution(result)
})

for (const [label, lineDeltas] of [
  ['null', null],
  ['non-array object', { 0: { id: 'synthetic-ingredient' } }],
  ['missing field', undefined],
]) {
  test(`M3 direct attribution rejects ${label} comparison lines without throwing`, () => {
    const result = attributeSavingsEffects({
      comparison: comparison({ lineDeltas }),
      evidence: [],
    })
    assertNoFabricatedAttribution(result)
  })
}

test('M3 genuine nonempty but mathematically equal synthetic comparison can be fully attributed', () => {
  const result = attributeSavingsEffects({ comparison: comparison(), evidence: [] })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.comparisonDeltaCents, 0)
  assert.equal(result.effectTotals.unknownCents, 0)
})

test('M3 nonempty favorable comparison with unexplained difference remains partial', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      outcome: 'better',
      baselineTotalCents: 300,
      candidateTotalCents: 250,
      deltaCents: -50,
      savingsCents: 50,
      lineDeltas: [{
        id: 'synthetic-ingredient',
        ingredientLabel: 'Invented ingredient',
        baselineLineTotalCents: 300,
        candidateLineTotalCents: 250,
        deltaCents: -50,
      }],
    }),
    evidence: [],
  })
  assert.equal(result.status, 'partial')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, -50)
})

test('M3 already unclaimable comparison remains unknown even with malformed line array', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      outcome: 'unknown',
      claimable: false,
      deltaCents: null,
      savingsCents: null,
      lineDeltas: null,
    }),
    evidence: [],
  })
  assertNoFabricatedAttribution(result)
})
