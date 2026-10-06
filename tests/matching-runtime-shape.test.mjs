import assert from 'node:assert/strict'
import test from 'node:test'

import { matchIngredient } from '../src/domain/matching.ts'

const requirement = {
  id: 'milk',
  query: 'halfvolle melk',
  amount: 1,
  unit: 'l',
}

const candidate = {
  id: 'milk-1l',
  name: 'Halfvolle melk',
  packAmount: 1,
  packUnit: 'l',
  packCount: 1,
  available: true,
}

function expectAbstain(value, reason) {
  assert.equal(value.type, 'abstain')
  assert.equal(value.score, null)
  assert.equal(value.runnerUpScore, null)
  assert.deepEqual(value.reasons, [reason])
}

test('direct matcher rejects malformed requirement identity, query and unit without throwing', () => {
  for (const malformedRequirement of [
    null,
    {},
    { ...requirement, id: '   ' },
    { ...requirement, query: 42 },
    { ...requirement, query: '   ' },
    { ...requirement, unit: 'litres' },
    { ...requirement, amount: '1' },
  ]) {
    assert.doesNotThrow(() => {
      expectAbstain(
        matchIngredient(malformedRequirement, [candidate]),
        'matching requirement invalid',
      )
    })
  }
})

test('direct matcher rejects a non-array candidate collection without throwing', () => {
  for (const malformedCandidates of [null, {}, 'candidate', 1]) {
    assert.doesNotThrow(() => {
      expectAbstain(
        matchIngredient(requirement, malformedCandidates),
        'matching candidates invalid',
      )
    })
  }
})

test('direct matcher rejects malformed candidate structure before scoring', () => {
  for (const malformedCandidate of [
    null,
    {},
    { ...candidate, id: 42 },
    { ...candidate, id: '   ' },
    { ...candidate, name: 42 },
    { ...candidate, name: '   ' },
    { ...candidate, packAmount: '1' },
    { ...candidate, packUnit: 'litres' },
    { ...candidate, packCount: '2' },
    { ...candidate, available: 'false' },
  ]) {
    assert.doesNotThrow(() => {
      expectAbstain(
        matchIngredient(requirement, [malformedCandidate]),
        'matching candidate data invalid',
      )
    })
  }
})

test('direct matcher rejects duplicate candidate identities', () => {
  expectAbstain(
    matchIngredient(requirement, [
      candidate,
      { ...candidate, name: 'Halfvolle melk voordeelpak' },
    ]),
    'matching candidate identities ambiguous',
  )
})

test('null runtime options fail closed instead of throwing', () => {
  assert.doesNotThrow(() => {
    expectAbstain(
      matchIngredient(requirement, [candidate], null),
      'matching trust thresholds invalid',
    )
  })
})

test('valid matching behavior remains unchanged', () => {
  const decision = matchIngredient(requirement, [candidate])

  assert.equal(decision.type, 'match')
  assert.equal(decision.productId, candidate.id)
  assert.equal(decision.score, 110)
})
