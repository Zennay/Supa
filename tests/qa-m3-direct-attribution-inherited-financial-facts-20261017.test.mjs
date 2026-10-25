import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Synthetic direct JS callers, entirely independent of actual supermarket
// prices, customer fields and any production retailer HTTP.
function canonical() {
  return {
    comparison: {
      claimable: true,
      outcome: 'better',
      baselineTotalCents: 130,
      candidateTotalCents: 120,
      deltaCents: -10,
      savingsCents: 10,
      reasons: [],
      lineDeltas: [{
        id: 'synthetic-rice',
        ingredientLabel: 'Synthetic rice',
        baselineLineTotalCents: 130,
        candidateLineTotalCents: 120,
        deltaCents: -10,
      }],
    },
    evidence: [{
      lineId: 'synthetic-rice',
      effect: 'offer',
      deltaCents: -10,
      evidenceRef: 'synthetic-offer-reference',
    }],
  }
}

function asInherited(record, key) {
  const value = record[key]
  const prototype = Object.create(Object.getPrototypeOf(record))
  Object.defineProperty(prototype, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  })
  Object.setPrototypeOf(record, prototype)
  delete record[key]
  assert.equal(Object.hasOwn(record, key), false)
  assert.equal(record[key], value, 'synthetic prototype was not installed')
}

test('positive: canonical null-prototype own records remain accepted without prototype requirement', () => {
  const inputs = canonical()
  inputs.comparison = Object.assign(Object.create(null), inputs.comparison)
  inputs.comparison.lineDeltas[0] = Object.assign(
    Object.create(null), inputs.comparison.lineDeltas[0],
  )
  inputs.evidence[0] = Object.assign(Object.create(null), inputs.evidence[0])
  const result = attributeSavingsEffects(inputs)
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.comparisonDeltaCents, -10)
  assert.equal(result.effectTotals.offerCents, -10)
})

for (const [name, select, field] of [
  ['comparison.claimable', args => args.comparison, 'claimable'],
  ['comparison.deltaCents', args => args.comparison, 'deltaCents'],
  ['comparison.baselineTotalCents', args => args.comparison, 'baselineTotalCents'],
  ['comparison.lineDeltas', args => args.comparison, 'lineDeltas'],
  ['comparison.reasons', args => args.comparison, 'reasons'],
  ['line.id', args => args.comparison.lineDeltas[0], 'id'],
  ['line.deltaCents', args => args.comparison.lineDeltas[0], 'deltaCents'],
  ['evidence.lineId', args => args.evidence[0], 'lineId'],
  ['evidence.effect', args => args.evidence[0], 'effect'],
  ['evidence.deltaCents', args => args.evidence[0], 'deltaCents'],
  ['evidence.evidenceRef', args => args.evidence[0], 'evidenceRef'],
]) {
  test(`QA P1: inherited ${name} is not persisted financial evidence`, () => {
    const inputs = canonical()
    const record = select(inputs)
    asInherited(record, field)
    const report = attributeSavingsEffects(inputs)
    assert.equal(report.status, 'unknown', name)
    assert.equal(report.fullyAttributed, false, name)
    assert.equal(report.comparisonDeltaCents, null, name)
    assert.equal(report.effectTotals.unknownCents, null, name)
    assert.equal(report.effectTotals.offerCents, 0, name)
    assert.ok(report.reasons.length, name)
  })
}
