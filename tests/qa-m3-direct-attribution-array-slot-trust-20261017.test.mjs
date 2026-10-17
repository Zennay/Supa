import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// All details are entirely invented. Direct runtime array provenance must
// resist own-accessor and prototype-inherited physical slots without running
// caller JavaScript or certifying a fictional monetary delta.
function inputs() {
  return {
    comparison: {
      claimable: true,
      outcome: 'better',
      baselineTotalCents: 105,
      candidateTotalCents: 100,
      deltaCents: -5,
      savingsCents: 5,
      reasons: [],
      lineDeltas: [{
        id: 'fictional-lime',
        ingredientLabel: 'Fictional lime',
        baselineLineTotalCents: 105,
        candidateLineTotalCents: 100,
        deltaCents: -5,
      }],
    },
    evidence: [{
      lineId: 'fictional-lime',
      effect: 'offer',
      deltaCents: -5,
      evidenceRef: 'fictional-source',
    }],
  }
}

function assertUnknown(result, label) {
  assert.equal(result.status, 'unknown', label)
  assert.equal(result.fullyAttributed, false, label)
  assert.equal(result.comparisonDeltaCents, null, label)
  assert.equal(result.effectTotals.unknownCents, null, label)
  assert.equal(result.effectTotals.offerCents, 0, label)
}

test('positive: own dense array items and standard direct-call evidence remain accepted', () => {
  const result = attributeSavingsEffects(inputs())
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.effectTotals.offerCents, -5)
})

for (const [name, select] of [
  ['physical lineDeltas', arg => arg.comparison.lineDeltas],
  ['attribution evidence', arg => arg.evidence],
]) {
  test(`QA P1: accessor at ${name}[0] must never execute or certify savings`, () => {
    const input = inputs()
    const rows = select(input)
    const realRow = rows[0]
    let reads = 0
    Object.defineProperty(rows, '0', {
      configurable: true, enumerable: true,
      get() { reads++; return realRow },
    })
    let result
    assert.doesNotThrow(() => {
      result = attributeSavingsEffects(input)
    })
    assert.equal(reads, 0, name)
    assertUnknown(result, name)
  })

  test(`QA P1: throwing ${name}[0] cannot crash direct attribution`, () => {
    const input = inputs()
    const rows = select(input)
    let reads = 0
    Object.defineProperty(rows, '0', {
      configurable: true, enumerable: true,
      get() { reads++; throw new Error('fictional-private-canary') },
    })
    let result
    assert.doesNotThrow(() => {
      result = attributeSavingsEffects(input)
    })
    assert.equal(reads, 0, name)
    assertUnknown(result, name)
    assert.doesNotMatch(JSON.stringify(result), /fictional-private-canary/)
  })

  test(`QA P1: prototype-inherited ${name}[0] must never authenticate a row`, () => {
    const input = inputs()
    const rows = select(input)
    const realRow = rows[0]
    delete rows[0]
    const parent = Object.create(Array.prototype)
    Object.defineProperty(parent, '0', { value: realRow, enumerable: true })
    Object.setPrototypeOf(rows, parent)
    assert.equal(Object.hasOwn(rows, '0'), false)
    let result
    assert.doesNotThrow(() => {
      result = attributeSavingsEffects(input)
    })
    assertUnknown(result, name)
  })
}

test('QA P1: sparse physical attribution lines must hide unverifiable financial cents', () => {
  const input = inputs()
  delete input.comparison.lineDeltas[0]
  assertUnknown(attributeSavingsEffects(input), 'sparse lines')
})

test('positive: sparse evidence cannot become an attributed offer, even when basket delta is independently known', () => {
  const input = inputs()
  delete input.evidence[0]
  const result = attributeSavingsEffects(input)
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.comparisonDeltaCents, -5, 'valid basket comparison is independently known')
  assert.equal(result.effectTotals.offerCents, 0)
  assert.equal(result.effectTotals.unknownCents, null)
})
