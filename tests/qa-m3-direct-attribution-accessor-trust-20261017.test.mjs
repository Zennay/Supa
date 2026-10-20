import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Direct application/runtime callers can pass objects that did not come from
// JSON. These are synthetic cents and fictional identifiers, not observed
// retailer prices or public savings evidence.
function validComparison() {
  return {
    outcome: 'better',
    claimable: true,
    baselineTotalCents: 100,
    candidateTotalCents: 90,
    deltaCents: -10,
    savingsCents: 10,
    reasons: [],
    lineDeltas: [{
      id: 'fictional-rice',
      ingredientLabel: 'Fictional rice',
      baselineLineTotalCents: 100,
      candidateLineTotalCents: 90,
      deltaCents: -10,
    }],
  }
}

function validEvidence() {
  return [{
    lineId: 'fictional-rice',
    effect: 'offer',
    deltaCents: -10,
    evidenceRef: 'fictional-offer-proof',
  }]
}

function assertFailClosed(result, label) {
  assert.equal(result.status, 'unknown', label)
  assert.equal(result.fullyAttributed, false, label)
  assert.equal(result.comparisonDeltaCents, null, label)
  assert.equal(result.effectTotals.unknownCents, null, label)
  assert.equal(result.effectTotals.offerCents, 0, label)
  assert.ok(result.reasons.length > 0, label)
  assert.doesNotMatch(JSON.stringify(result), /fictional-private-canary/)
}

test('positive direct attribution control accepts ordinary own-data financial ledger', () => {
  const result = attributeSavingsEffects({
    comparison: validComparison(),
    evidence: validEvidence(),
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.comparisonDeltaCents, -10)
  assert.equal(result.effectTotals.offerCents, -10)
  assert.equal(result.effectTotals.unknownCents, 0)
})

for (const [name, prepare] of [
  ['comparison.claimable', ({ comparison }) => [comparison, 'claimable', true]],
  ['comparison.deltaCents', ({ comparison }) => [comparison, 'deltaCents', -10]],
  ['comparison.lineDeltas', ({ comparison }) => [comparison, 'lineDeltas', comparison.lineDeltas]],
  ['line deltaCents', ({ comparison }) => [comparison.lineDeltas[0], 'deltaCents', -10]],
  ['evidence.lineId', ({ evidence }) => [evidence[0], 'lineId', 'fictional-rice']],
  ['evidence.deltaCents', ({ evidence }) => [evidence[0], 'deltaCents', -10]],
  ['evidence.evidenceRef', ({ evidence }) => [evidence[0], 'evidenceRef', 'fictional-offer-proof']],
]) {
  test(`QA P1: own-data -> accessor ${name} must not execute code or certify savings`, () => {
    const inputs = { comparison: validComparison(), evidence: validEvidence() }
    const [record, key, value] = prepare(inputs)
    let getterCalls = 0
    Object.defineProperty(record, key, {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls++
        return value
      },
    })
    let result
    assert.doesNotThrow(() => {
      result = attributeSavingsEffects(inputs)
    })
    assert.equal(getterCalls, 0, `${name}: private getter executed`)
    assertFailClosed(result, name)
  })
}

for (const name of ['comparison.claimable', 'line deltaCents', 'evidence.lineId']) {
  test(`QA P1: throwing accessor ${name} cannot crash direct attribution`, () => {
    const inputs = { comparison: validComparison(), evidence: validEvidence() }
    const [record, key] = name === 'comparison.claimable'
      ? [inputs.comparison, 'claimable']
      : name === 'line deltaCents'
        ? [inputs.comparison.lineDeltas[0], 'deltaCents']
        : [inputs.evidence[0], 'lineId']
    let getterCalls = 0
    Object.defineProperty(record, key, {
      enumerable: true,
      get() {
        getterCalls++
        throw new Error('fictional-private-canary')
      },
    })
    let result
    assert.doesNotThrow(() => {
      result = attributeSavingsEffects(inputs)
    }, 'untrusted accessor should not crash the caller')
    assert.equal(getterCalls, 0, 'accessor must not run')
    assertFailClosed(result, name)
  })
}
