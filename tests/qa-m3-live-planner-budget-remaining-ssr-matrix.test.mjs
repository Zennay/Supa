import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { euro } from '../src/lib/money.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent integer-cent status oracle. All basket prices are fictional.
// The rendered Planner must not borrow binary floating subtraction.
function money(cents) {
  const whole = Math.floor(cents / 100)
  return `${whole},${String(cents % 100).padStart(2, '0')}`
}
function props(budget, basketTotalCents, basketUnresolvedLineCount = 0) {
  return {
    budget, basketTotalCents, basketUnresolvedLineCount,
    activeDays: m2DefaultActiveDays,
    plannedMeals: m2InitialPlan,
    recipes: m2Recipes,
    onBudgetChange() { assert.fail('SSR must not save budget preferences') },
    onToggleDay() { assert.fail('SSR must not edit days') },
    onRecipeChange() { assert.fail('SSR must not swap meals') },
    onReset() { assert.fail('SSR must not reset the plan') },
  }
}

test('QA issue #1041: real rendered Planner uses cent-native status for 159 exact-price budget boundaries', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    const samples = new Set([0, 1, 1969, 2801, 2999, 3000, 3001, 3499, 3500, 3501, 3999, 4000, 4001, 9999])
    for (let n = 1; n <= 10_000; n += 191) samples.add(n)
    let checked = 0
    for (const budgetCents of [3000, 3500, 4000]) {
      for (const costCents of samples) {
        const expectedRemaining = budgetCents - costCents
        const html = renderToStaticMarkup(createElement(
          PlannerView, props(budgetCents / 100, costCents),
        ))
        const expected = expectedRemaining >= 0
          ? `${money(expectedRemaining)} over`
          : `${money(-expectedRemaining)} boven budget`
        assert.ok(html.includes(expected),
          `Budget ${budgetCents}c, basket ${costCents}c must show ${expected}, not an em dash`)
        assert.doesNotMatch(html, /Budgetgegevens controleren/)
        assert.doesNotMatch(html, /besparing bewezen/i)
        checked++
      }
    }
    assert.ok(checked >= 150, 'Grid must exercise more than the two original example prices')
  } finally {
    await vite.close()
  }
})

test('QA issue #1041: incomplete baskets never advertise a final remaining balance', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    for (const [knownCents, missing] of [[0, 1], [1969, 2], [3500, 1], [3501, 2], [4001, 11]]) {
      const html = renderToStaticMarkup(createElement(PlannerView, props(35, knownCents, missing)))
      assert.match(html, new RegExp(`${missing} mandregel(?:s)? open`))
      if (knownCents > 3500) {
        assert.ok(html.includes(`Minimaal ${money(knownCents - 3500)} boven budget`))
      } else {
        assert.doesNotMatch(html, /15,31 over|35,00 over|0,00 over/)
      }
      assert.doesNotMatch(html, /besparing bewezen/i)
    }
  } finally {
    await vite.close()
  }
})

test('QA issue #1041: strict euro formatter must keep rejecting real sub-cent inputs', () => {
  for (const subCent of [19.691, 35.005, -0.001, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.equal(euro.format(subCent), '—')
  }
  assert.match(euro.formatCents(1531), /15,31/)
  assert.match(euro.formatCents(501), /5,01/)
})
