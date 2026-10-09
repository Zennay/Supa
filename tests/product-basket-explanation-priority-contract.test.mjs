import assert from 'node:assert/strict'
import test from 'node:test'

import {
  basketLineExplanation,
  comparisonWarningCopy,
  orderBasketLinesForReview,
} from '../src/features/basket/basketPresentation.ts'

test('specific matcher uncertainty outranks generic packaging details', () => {
  assert.equal(
    basketLineExplanation('unresolved', [
      'pack covers requirement',
      'no candidates',
      'score below trust threshold',
      'top candidates too close',
    ]),
    'Meerdere producten lijken even passend; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', [
      'basket quantity or price is not trusted',
      'candidate unavailable',
    ]),
    'Geen betrouwbaar beschikbaar product gevonden; kies zelf.',
  )
})

test('malformed or untrusted reason payloads never surface their contents', () => {
  for (const reasons of [
    null, undefined, 'no candidates', { message: 'no candidates' },
    ['no candidates', 42], [null, 'top candidates too close'],
  ]) {
    assert.equal(
      basketLineExplanation('unresolved', reasons),
      'SUPA kan hier niet betrouwbaar automatisch kiezen; kies zelf.',
    )
  }
})

test('warning copy never reports a savings figure for missing or malformed comparison context', () => {
  const warnings = [
    comparisonWarningCopy(0, 0, 0),
    comparisonWarningCopy(-1, Number.NaN, 0),
    comparisonWarningCopy(0, 0, 1),
  ]
  for (const warning of warnings) {
    assert.match(warning, /geen betrouwbaar prijsverschil|niet aan dezelfde betrouwbare vergelijkingsbasis/)
    assert.doesNotMatch(warning, /€|bespaar|goedkoper/i)
  }
})

test('review sorting preserves frozen lines and original groups', () => {
  const matched = Object.freeze({ id: 'a', status: 'matched' })
  const unresolved = Object.freeze({ id: 'b', status: 'unresolved' })
  const lines = Object.freeze([matched, unresolved])
  const result = orderBasketLinesForReview(lines)
  assert.deepEqual(result.map((line) => line.id), ['b', 'a'])
  assert.equal(result[0], unresolved)
  assert.equal(result[1], matched)
  assert.notEqual(result, lines)
  assert.deepEqual(lines.map((line) => line.id), ['a', 'b'])
})
