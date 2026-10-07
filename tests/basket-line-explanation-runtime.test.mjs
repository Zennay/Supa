import assert from 'node:assert/strict'
import test from 'node:test'

import { basketLineExplanation } from '../src/features/basket/basketPresentation.ts'

test('basket explanation fails closed on malformed runtime reason containers', () => {
  for (const reasons of [null, {}, 'internal reason', 42, [null], [42]]) {
    assert.doesNotThrow(() => basketLineExplanation('unresolved', reasons))
    assert.equal(
      basketLineExplanation('unresolved', reasons),
      'SUPA kan hier niet betrouwbaar automatisch kiezen; kies zelf.',
    )
  }
})

test('basket explanation preserves known diagnostics after runtime validation', () => {
  assert.equal(
    basketLineExplanation('unresolved', ['top candidates too close']),
    'Meerdere producten lijken even passend; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', ['basket quantity or price is not trusted']),
    'Hoeveelheid of verpakking is niet betrouwbaar genoeg; kies zelf.',
  )
})

test('basket explanation preserves valid diagnostics inside mixed runtime arrays', () => {
  assert.equal(
    basketLineExplanation('unresolved', [null, 'no candidates', 42]),
    'Geen passend product gevonden; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', [
      { internal: true },
      'basket quantity or price is not trusted',
    ]),
    'Hoeveelheid of verpakking is niet betrouwbaar genoeg; kies zelf.',
  )
})

test('matched basket explanation does not depend on runtime diagnostics', () => {
  assert.equal(
    basketLineExplanation('matched', null),
    'Automatisch gekozen op basis van ingrediënt en verpakking.',
  )
})
