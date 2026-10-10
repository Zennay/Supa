import assert from 'node:assert/strict'
import test from 'node:test'

import { basketLineExplanation } from '../src/features/basket/basketPresentation.ts'

const genericFallback = 'SUPA kan hier niet betrouwbaar automatisch kiezen; kies zelf.'

test('basket explanation fails closed for malformed unresolved reason containers', () => {
  for (const reasons of [null, {}, 'no candidates', 42, true, [null], ['no candidates', null]]) {
    let explanation
    assert.doesNotThrow(() => {
      explanation = basketLineExplanation('unresolved', reasons)
    })
    assert.equal(explanation, genericFallback)
  }
})

test('basket explanation preserves known unresolved diagnostic copy', () => {
  assert.equal(
    basketLineExplanation('unresolved', ['top candidates too close']),
    'Meerdere producten lijken even passend; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', ['no candidates']),
    'Geen passend product gevonden; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', ['pack amount invalid']),
    'Hoeveelheid of verpakking is niet betrouwbaar genoeg; kies zelf.',
  )
})

test('basket explanation keeps matched copy independent of diagnostic shape', () => {
  assert.equal(
    basketLineExplanation('matched', null),
    'Automatisch gekozen op basis van ingrediënt en verpakking.',
  )
})
