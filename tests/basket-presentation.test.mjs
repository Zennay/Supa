import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  basketCostDisclosure,
  basketLineExplanation,
  basketReviewSummary,
  comparisonLineHighlightCopy,
  comparisonLineHighlights,
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

test('comparison line highlights surface the largest trustworthy rule deltas without causal claims', () => {
  const highlights = comparisonLineHighlights({
    claimable: true,
    outcome: 'better',
    baselineTotalCents: 3000,
    candidateTotalCents: 2600,
    deltaCents: -400,
    savingsCents: 400,
    reasons: [],
    lineDeltas: [
      {
        id: 'rice',
        ingredientLabel: 'Basmati rijst',
        baselineLineTotalCents: 500,
        candidateLineTotalCents: 450,
        deltaCents: -50,
      },
      {
        id: 'chicken',
        ingredientLabel: 'Kipdij',
        baselineLineTotalCents: 900,
        candidateLineTotalCents: 650,
        deltaCents: -250,
      },
      {
        id: 'tomato',
        ingredientLabel: 'Tomaten',
        baselineLineTotalCents: 300,
        candidateLineTotalCents: 400,
        deltaCents: 100,
      },
      {
        id: 'salt',
        ingredientLabel: 'Zout',
        baselineLineTotalCents: 80,
        candidateLineTotalCents: 80,
        deltaCents: 0,
      },
    ],
  }, 2)

  assert.deepEqual(highlights.map((item) => item.id), ['chicken', 'tomato'])
  assert.equal(highlights[0].direction, 'lower')
  assert.equal(highlights[1].direction, 'higher')
  assert.match(highlights[0].amountLabel, /2,50/)
  assert.match(highlights[1].amountLabel, /1,00/)
})

test('comparison line copy states the observed rule delta without inventing a cause', () => {
  const lower = {
    id: 'rice',
    ingredientLabel: 'Basmati rijst',
    direction: 'lower',
    amountLabel: '€ 0,50',
  }
  const higher = { ...lower, direction: 'higher', amountLabel: '€ 0,25' }

  assert.equal(
    comparisonLineHighlightCopy(lower, 'DekaMarkt'),
    'DekaMarkt is op deze mandregel € 0,50 lager.',
  )
  assert.equal(
    comparisonLineHighlightCopy(higher, 'DekaMarkt'),
    'DekaMarkt is op deze mandregel € 0,25 hoger.',
  )
  assert.equal(
    comparisonLineHighlightCopy(lower, '   '),
    'De kandidaatwinkel is op deze mandregel € 0,50 lager.',
  )
  assert.doesNotMatch(
    comparisonLineHighlightCopy(lower, 'DekaMarkt'),
    /aanbieding|verpakking|planning|oorzaak/i,
  )
})

test('comparison line highlights fail closed for non-claimable comparisons and unsafe deltas', () => {
  const comparison = {
    claimable: false,
    outcome: 'unknown',
    baselineTotalCents: 3000,
    candidateTotalCents: 2600,
    deltaCents: null,
    savingsCents: null,
    reasons: ['incomplete basket'],
    lineDeltas: [
      {
        id: 'rice',
        ingredientLabel: 'Basmati rijst',
        baselineLineTotalCents: 500,
        candidateLineTotalCents: 450,
        deltaCents: -50,
      },
    ],
  }

  assert.deepEqual(comparisonLineHighlights(comparison), [])
  assert.deepEqual(
    comparisonLineHighlights({
      ...comparison,
      claimable: true,
      outcome: 'better',
      reasons: [],
      lineDeltas: [
        {
          ...comparison.lineDeltas[0],
          deltaCents: Number.MAX_SAFE_INTEGER + 1,
        },
      ],
    }),
    [],
  )
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

test('basket disclosure text is user-facing, source-honest, and free of milestone jargon (#580)', async () => {
  const source = await readFile(new URL('../src/features/basket/BasketView.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bM[23]\b|testfixture|controlled testdata|productie-liveprijs/i)
  assert.equal((source.match(/Geen actuele winkelprijzen of bewezen besparing\./g) || []).length, 2)
  assert.match(source, /geen actuele winkelprijzen of bewezen besparing/)
  assert.match(source, /bekende minimum, geen/)
  assert.match(source, /comparisonCanShowMoney \?/)
  assert.match(source, /comparison-warning/)
})

test('corrupt basket cent totals never advertise a deterministic amount or minimum', () => {
  for (const cents of [null, undefined, '100', -1, 1.25, Number.NaN,
    Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    for (const unresolved of [0, 2]) {
      const shown = basketCostDisclosure(cents, unresolved)
      assert.equal(shown.state, 'unknown')
      assert.equal(shown.headline, 'Mandtotaal niet beschikbaar')
      assert.equal(shown.amountLabel, '—')
      assert.equal(shown.unresolvedLineCount, unresolved)
    }
  }

  const known = basketCostDisclosure(0, 0)
  assert.equal(known.state, 'complete')
  assert.notEqual(known.amountLabel, '—')
  const minimum = basketCostDisclosure(500, 2)
  assert.equal(minimum.state, 'minimum')
  assert.match(minimum.amountLabel, /^min\./)
})

test('BasketView states invalid basket amounts are unavailable rather than claiming a minimum', async () => {
  const source = await readFile(new URL('../src/features/basket/BasketView.tsx', import.meta.url), 'utf8')
  assert.match(source, /basketCost\.state === 'unknown'/)
  assert.match(source, /Het mandbedrag is niet betrouwbaar genoeg voor een totaal of/)
  assert.match(source, /Geen actuele winkelprijzen/)
  assert.match(source, /data-basket-total-state=\{basketCost\.state\}/)
  assert.match(source, /data-comparison-outcome=\{comparisonCanShowMoney/)
})
