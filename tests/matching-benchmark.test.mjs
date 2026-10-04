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

  assert.equal(metrics.total, 11)
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
