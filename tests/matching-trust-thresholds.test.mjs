import assert from 'node:assert/strict'
import test from 'node:test'

import { matchIngredient } from '../src/domain/matching.ts'

const requirement = {
  id: 'milk',
  query: 'halfvolle melk',
  amount: 1,
  unit: 'l',
}

const exactCandidate = {
  id: 'milk-1l',
  name: 'Halfvolle melk',
  packAmount: 1,
  packUnit: 'l',
  packCount: 1,
  available: true,
}

test('non-finite matching thresholds fail closed before scoring', () => {
  for (const options of [
    { minimumScore: Number.NaN },
    { minimumScore: Number.POSITIVE_INFINITY },
    { minimumMargin: Number.NaN },
    { minimumMargin: Number.POSITIVE_INFINITY },
  ]) {
    const decision = matchIngredient(requirement, [exactCandidate], options)

    assert.equal(decision.type, 'abstain')
    assert.deepEqual(decision.reasons, ['matching trust thresholds invalid'])
    assert.equal(decision.score, null)
  }
})

test('non-positive matching thresholds cannot disable trust gates', () => {
  for (const options of [
    { minimumScore: 0 },
    { minimumScore: -100 },
    { minimumMargin: 0 },
    { minimumMargin: -1 },
  ]) {
    const decision = matchIngredient(
      requirement,
      [
        exactCandidate,
        { ...exactCandidate, id: 'milk-1l-tie' },
      ],
      options,
    )

    assert.equal(decision.type, 'abstain')
    assert.deepEqual(decision.reasons, ['matching trust thresholds invalid'])
  }
})

test('positive finite custom trust thresholds remain supported', () => {
  const decision = matchIngredient(
    requirement,
    [exactCandidate],
    { minimumScore: 70, minimumMargin: 5 },
  )

  assert.equal(decision.type, 'match')
  assert.equal(decision.productId, exactCandidate.id)
})
