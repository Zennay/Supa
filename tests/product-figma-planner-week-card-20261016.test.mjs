import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

test('actual Planner renders the Figma week control with real plan and preference state', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { HiFiPlannerWeekCard } = await vite.ssrLoadModule('/src/features/planner/HiFiPlannerWeekCard.tsx')
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    const renderCard = activeDays => renderToStaticMarkup(createElement(HiFiPlannerWeekCard, {
      plannedMeals: m2InitialPlan, activeDays,
      onToggleDay() { assert.fail('SSR cannot mutate the plan') },
    }))
    const selected = renderCard(['Ma', 'Wo'])
    assert.match(selected, /data-figma-node="3359:4900"/)
    assert.match(selected, /Weekplanning/)
    assert.match(selected, /2 van 4 dagen geselecteerd/)
    assert.equal((selected.match(/aria-pressed="true"/g) ?? []).length, 2)
    assert.equal((selected.match(/aria-pressed="false"/g) ?? []).length, 2)
    assert.equal((selected.match(/class="hifi-planner-day selected"/g) ?? []).length, 2)
    assert.match(selected, /Maandag \d+ uit planning halen/)
    assert.match(selected, /Dinsdag \d+ aan planning toevoegen/)
    assert.doesNotMatch(selected, /bespaar tot 40%|€[0-9]|Nick Bergen/)
    // Only the first open day (Di) carries Figma's green add marker.
    assert.equal((selected.match(/hifi-planner-day-number next-open/g) ?? []).length, 1)
    assert.match(selected, /aria-label="Dinsdag \d+ aan planning toevoegen"[^>]*><span class="hifi-planner-day-label">D<\/span><span class="hifi-planner-day-number next-open">/)

    const none = renderCard([])
    assert.match(none, /0 van 4 dagen geselecteerd/)
    assert.equal((none.match(/aria-pressed="true"/g) ?? []).length, 0)

    const page = renderToStaticMarkup(createElement(PlannerView, {
      budget: 35, activeDays: ['Ma', 'Wo'], plannedMeals: m2InitialPlan,
      recipes: m2Recipes, basketTotalCents: 1969, basketUnresolvedLineCount: 0,
      onBudgetChange() {}, onToggleDay() {}, onRecipeChange() {}, onReset() {},
    }))
    assert.match(page, /data-figma-node="3359:4900"/)
    assert.match(page, /aria-label="Recept voor de gekozen dag"/)
    assert.match(page, /aria-label="Kies je weekbudget"/)
    assert.match(page, /aria-label="Geplande maaltijden"/)
    assert.match(page, /Weekplanning/)
  } finally {
    await vite.close()
  }
})
