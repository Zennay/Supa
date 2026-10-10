import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { euro } from '../src/lib/money.ts'
import {
  basketCostDisclosure,
  comparisonLineHighlights,
  comparisonLineBreakdown,
} from '../src/features/basket/basketPresentation.ts'

const largeCents = 9_007_199_253_740_993

test('basket headline and minimum keep exact safe integer cents without euro float coercion (#832)', () => {
  const canonical = euro.formatCents(largeCents)
  assert.notEqual(canonical, '—')
  assert.match(canonical, /,93$/)
  assert.notEqual(Math.round(largeCents / 100 * 100), largeCents)

  const complete = basketCostDisclosure(largeCents, 0)
  assert.equal(complete.state, 'complete')
  assert.equal(complete.amountLabel, canonical)

  const incomplete = basketCostDisclosure(largeCents, 2)
  assert.equal(incomplete.state, 'minimum')
  assert.equal(incomplete.amountLabel, 'min. ' + canonical)
  assert.equal(incomplete.unresolvedLineCount, 2)

  assert.equal(basketCostDisclosure(2359, 0).amountLabel, euro.formatCents(2359))
  assert.equal(basketCostDisclosure(0, 0).amountLabel, euro.formatCents(0))
})

test('M3 largest basket rule deltas use exact cents without changing direction or order', () => {
  const comparison = {
    claimable: true,
    outcome: 'better',
    savingsCents: largeCents,
    deltaCents: -largeCents,
    reasons: [],
    lineDeltas: [
      { id: 'large', ingredientLabel: 'Synthetic large row', deltaCents: -largeCents },
      { id: 'ordinary', ingredientLabel: 'Synthetic ordinary row', deltaCents: 101 },
      { id: 'none', ingredientLabel: 'Zero row', deltaCents: 0 },
    ],
  }

  const highlights = comparisonLineHighlights(comparison)
  assert.deepEqual(highlights.map(item => item.id), ['large', 'ordinary'])
  assert.equal(highlights[0].amountLabel, euro.formatCents(largeCents))
  assert.equal(highlights[0].direction, 'lower')
  assert.equal(highlights[1].amountLabel, euro.formatCents(101))
  assert.equal(highlights[1].direction, 'higher')

  const breakdown = comparisonLineBreakdown(comparison.lineDeltas)
  assert.equal(breakdown[0].amountLabel, euro.formatCents(largeCents))
  assert.equal(breakdown[0].direction, 'lower')
  assert.equal(breakdown[1].amountLabel, euro.formatCents(101))
  assert.equal(breakdown[1].direction, 'higher')

  assert.deepEqual(comparisonLineHighlights({ ...comparison, claimable: false, outcome: 'unknown' }), [])
  assert.deepEqual(comparisonLineHighlights({
    ...comparison,
    lineDeltas: [{ id: 'unsafe', ingredientLabel: 'Bad', deltaCents: Number.MAX_SAFE_INTEGER + 1 }],
  }), [])
})

test('BasketView title and individual matched rows consume canonical cent formatter', async () => {
  const source = await readFile(
    new URL('../src/features/basket/BasketView.tsx', import.meta.url), 'utf8',
  )
  assert.match(source, /basketComparisonHeadline\(comparison, comparisonCandidate\)/)
  assert.doesNotMatch(source, /comparison\.savingsCents \?\? 0/)
  assert.match(source, /euro\.formatCents\(line\.lineTotalCents\)/)
  assert.doesNotMatch(source, /euro\.format\([^)]*\/ 100\)/)
  assert.match(source, /Geen actuele winkelprijzen of bewezen besparing\./)
  assert.match(source, /comparisonCanShowMoney \?/)
  assert.match(source, /comparisonCanShowMoney\s*\?\s*comparisonLineHighlights\(comparison\)\s*:\s*\[\]/)
})

test('malformed basket cent values remain non-price, not rounded into apparent precision', () => {
  for (const cents of [Number.NaN, Number.POSITIVE_INFINITY, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, 13.3]) {
    assert.equal(euro.formatCents(cents), '—')
  }
  assert.equal(basketCostDisclosure(Number.NaN, 0).amountLabel, '—')
})
