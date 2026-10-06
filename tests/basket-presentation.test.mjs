import assert from 'node:assert/strict'
import test from 'node:test'

import {
  basketCostDisclosure,
  basketLineExplanation,
  basketReviewSummary,
  comparisonWarningCopy,
  orderBasketLinesForReview,
} from '../src/features/basket/basketPresentation.ts'

test('basket cost disclosure exposes an exact total only when every line is resolved', () => {
  const display = basketCostDisclosure(3008, 0)

  assert.equal(display.state, 'complete')
  assert.equal(display.headline, 'Deterministisch mandtotaal')
  assert.equal(display.unresolvedLineCount, 0)
  assert.match(display.amountLabel, /30,08/)
  assert.doesNotMatch(display.amountLabel, /^min\./)
})

test('basket cost disclosure labels matched cost as a minimum when lines remain unresolved', () => {
  const display = basketCostDisclosure(3008, 2)

  assert.equal(display.state, 'minimum')
  assert.equal(display.headline, 'Bekend mandminimum')
  assert.equal(display.unresolvedLineCount, 2)
  assert.match(display.amountLabel, /^min\./)
  assert.match(display.amountLabel, /30,08/)
})

test('basket cost disclosure fails closed on an invalid unresolved count', () => {
  for (const count of [-1, Number.NaN]) {
    const display = basketCostDisclosure(3008, count)

    assert.equal(display.state, 'minimum')
    assert.equal(display.unresolvedLineCount, 1)
  }
})

test('basket review summary is explicit only when attention is needed', () => {
  assert.equal(basketReviewSummary(0), null)
  assert.equal(
    basketReviewSummary(1),
    '1 productkeuze vraagt jouw controle. Die staat bovenaan.',
  )
  assert.equal(
    basketReviewSummary(3),
    '3 productkeuzes vragen jouw controle. Die staan bovenaan.',
  )
  assert.equal(
    basketReviewSummary(Number.NaN),
    'Er zijn productkeuzes die jouw controle vragen. Die staan bovenaan.',
  )
})

test('basket review ordering moves unresolved choices first without reordering either group', () => {
  const lines = [
    { id: 'matched-a', status: 'matched' },
    { id: 'open-a', status: 'unresolved' },
    { id: 'matched-b', status: 'matched' },
    { id: 'open-b', status: 'unresolved' },
  ]

  assert.deepEqual(
    orderBasketLinesForReview(lines).map((line) => line.id),
    ['open-a', 'open-b', 'matched-a', 'matched-b'],
  )
  assert.deepEqual(lines.map((line) => line.id), [
    'matched-a',
    'open-a',
    'matched-b',
    'open-b',
  ])
})

test('comparison warning explains unresolved product choices without leaking domain diagnostics', () => {
  assert.equal(
    comparisonWarningCopy(1, 2, 4),
    '3 productkeuzes moeten nog worden opgelost voordat SUPA een prijsverschil betrouwbaar kan tonen.',
  )
  assert.equal(
    comparisonWarningCopy(0, 1, 2),
    '1 productkeuze moet nog worden opgelost voordat SUPA een prijsverschil betrouwbaar kan tonen.',
  )
})

test('comparison warning uses a neutral user-facing fallback for other integrity blockers', () => {
  assert.equal(
    comparisonWarningCopy(0, 0, 2),
    'Deze manden voldoen nog niet aan dezelfde betrouwbare vergelijkingsbasis.',
  )
  assert.equal(
    comparisonWarningCopy(0, 0, 0),
    'SUPA kan voor deze manden nog geen betrouwbaar prijsverschil tonen.',
  )
})

test('matched basket lines use product-facing copy instead of matcher scores', () => {
  assert.equal(
    basketLineExplanation('matched', [
      'query phrase present',
      'pack closely covers requirement',
    ]),
    'Automatisch gekozen op basis van ingrediënt en verpakking.',
  )
})

test('unresolved basket lines explain common uncertainty in user language', () => {
  assert.equal(
    basketLineExplanation('unresolved', [
      'pack covers requirement',
      'score below trust threshold',
    ]),
    'Geen productmatch is zeker genoeg; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', ['top candidates too close']),
    'Meerdere producten lijken even passend; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', ['no candidates']),
    'Geen passend product gevonden; kies zelf.',
  )
  assert.equal(
    basketLineExplanation('unresolved', ['basket quantity or price is not trusted']),
    'Hoeveelheid of verpakking is niet betrouwbaar genoeg; kies zelf.',
  )
})

test('unknown matcher diagnostics stay hidden behind a safe generic explanation', () => {
  assert.equal(
    basketLineExplanation('unresolved', ['future internal matcher reason']),
    'SUPA kan hier niet betrouwbaar automatisch kiezen; kies zelf.',
  )
})
