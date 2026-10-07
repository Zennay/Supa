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
    { ...requirement, query: 42 },
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

test('direct matcher rejects blank requirement identity and query before scoring', () => {
  for (const malformedRequirement of [
    { ...requirement, id: '' },
    { ...requirement, id: '   ' },
    { ...requirement, query: '' },
    { ...requirement, query: '   ' },
  ]) {
    expectAbstain(
      matchIngredient(malformedRequirement, [candidate]),
      'matching requirement invalid',
    )
  }
})

test('direct matcher rejects blank candidate identity and name before scoring', () => {
  for (const malformedCandidate of [
    { ...candidate, id: '' },
    { ...candidate, id: '   ' },
    { ...candidate, name: '' },
    { ...candidate, name: '   ' },
  ]) {
    expectAbstain(
      matchIngredient(requirement, [malformedCandidate]),
      'matching candidate data invalid',
    )
  }
})

test('direct matcher rejects whitespace-padded runtime identities before scoring', () => {
  for (const paddedRequirementId of [' milk', 'milk ', '\tmilk']) {
    expectAbstain(
      matchIngredient({ ...requirement, id: paddedRequirementId }, [candidate]),
      'matching requirement invalid',
    )
  }

  for (const paddedCandidateId of [' milk-1l', 'milk-1l ', '\tmilk-1l']) {
    expectAbstain(
      matchIngredient(requirement, [{ ...candidate, id: paddedCandidateId }]),
      'matching candidate data invalid',
    )
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
    { ...candidate, name: 42 },
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

test('matcher preserves the true oversupply ratio for sub-unit requirements', () => {
  const decision = matchIngredient(
    {
      id: 'paprika-powder',
      query: 'paprika powder',
      amount: 0.5,
      unit: 'g',
    },
    [
      {
        id: 'paprika-powder-1g',
        name: 'Powder paprika',
        packAmount: 1,
        packUnit: 'g',
        packCount: 1,
        available: true,
      },
    ],
  )

  assert.equal(decision.type, 'abstain')
  assert.equal(decision.score, 60)
  assert.deepEqual(decision.reasons, [
    '2/2 query tokens present',
    'pack covers requirement',
    'score below trust threshold',
  ])
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
