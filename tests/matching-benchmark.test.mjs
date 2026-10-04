import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  evaluateMatchingBenchmark,
  matchIngredient,
} from '../src/domain/matching.ts'

const fixtureUrl = new URL('../fixtures/matching/benchmark.v1.json', import.meta.url)
const cases = JSON.parse(await readFile(fixtureUrl, 'utf8'))

test('matching benchmark meets M1 safety baseline', () => {
  const { metrics } = evaluateMatchingBenchmark(cases)

  assert.equal(metrics.total, 13)
  assert.ok(metrics.accuracy >= 0.9)
  assert.ok(metrics.matchAccuracy >= 0.85)
  assert.equal(metrics.abstentionAccuracy, 1)
  assert.equal(metrics.falsePositiveMatches, 0)
})

test('ambiguous candidates abstain instead of hiding uncertainty', () => {
  const benchmarkCase = cases.find(
    (candidate) => candidate.id === 'ambiguous-identical-candidates',
  )
  assert.ok(benchmarkCase)

  const decision = matchIngredient(
    benchmarkCase.requirement,
    benchmarkCase.candidates,
  )
  assert.equal(decision.type, 'abstain')
  assert.match(decision.reasons.join(' '), /too close/)
})


test('known unit family is enforced even when amount is unknown', () => {
  const benchmarkCase = cases.find(
    (candidate) => candidate.id === 'known-unit-null-amount-mismatch',
  )
  assert.ok(benchmarkCase)

  const decision = matchIngredient(
    benchmarkCase.requirement,
    benchmarkCase.candidates,
  )
  assert.equal(decision.type, 'abstain')
  assert.match(decision.reasons.join(' '), /unit family mismatch/)
})

test('invalid requirement quantities fail closed before scoring', () => {
  const zeroCase = cases.find(
    (candidate) => candidate.id === 'invalid-requirement-zero-amount',
  )
  assert.ok(zeroCase)

  const zeroDecision = matchIngredient(zeroCase.requirement, zeroCase.candidates)
  assert.equal(zeroDecision.type, 'abstain')
  assert.match(zeroDecision.reasons.join(' '), /requirement amount invalid/)

  const infiniteDecision = matchIngredient(
    {
      id: 'invalid-infinite-requirement',
      query: 'halfvolle melk',
      amount: Number.POSITIVE_INFINITY,
      unit: 'ml',
    },
    zeroCase.candidates,
  )
  assert.equal(infiniteDecision.type, 'abstain')
  assert.match(infiniteDecision.reasons.join(' '), /requirement amount invalid/)
})

test('invalid candidate pack quantities cannot become trusted matches', () => {
  const benchmarkCase = cases.find(
    (candidate) => candidate.id === 'invalid-candidate-negative-pack',
  )
  assert.ok(benchmarkCase)

  const decision = matchIngredient(
    benchmarkCase.requirement,
    benchmarkCase.candidates,
  )
  assert.equal(decision.type, 'abstain')
  assert.match(decision.reasons.join(' '), /candidate pack amount invalid/)
})
