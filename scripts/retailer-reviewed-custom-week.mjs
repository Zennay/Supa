import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { types as nodeTypes } from 'node:util'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { buildDynamicReviewedWeek } from '../src/domain/reviewedCatalogPlannedWeek.ts'
import { reviewedPlannerQueueSummary } from './retailer-reviewed-planner-queue.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'

// A real, custom week selection over proven fixture recipes: a reusable
// product path, not a fabricated user observation, live store query or quote.
/**
 * Allow a person to swap among the three controlled local M2 demo recipes
 * on already-planned days. This changes physical ingredient demand only;
 * historical retailer candidates remain unpriced and review-only.
 *
 * --days Ma,Do                 retains the default recipes on these days
 * --plan Ma:pasta,Do:teriyaki  selects replacement recipes for these days
 *
 * Both flags are deliberately exclusive. Arbitrary days/recipes and external
 * recipes are not permitted until their source/ingredient rights are reviewed.
 */
export function selectedFixtureWeek(argv = []) {
  // Only inert own data may choose a frozen study week. A Proxy can
  // intercept indexed GET without changing its underlying descriptors.
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv)) {
    throw new Error('Only approved private planned-week review arguments are accepted')
  }
  const length = Object.getOwnPropertyDescriptor(argv, 'length')?.value
  if (length !== 0 && length !== 2) {
    throw new Error('Only approved private planned-week review arguments are accepted')
  }
  let flag
  let value
  if (length === 2) {
    const flagProperty = Object.getOwnPropertyDescriptor(argv, '0')
    const valueProperty = Object.getOwnPropertyDescriptor(argv, '1')
    if (!flagProperty || !Object.hasOwn(flagProperty, 'value') ||
        !valueProperty || !Object.hasOwn(valueProperty, 'value')) {
      throw new Error('Only own data arguments are accepted for private planned-week review')
    }
    flag = flagProperty.value
    value = valueProperty.value
    if ((flag !== '--days' && flag !== '--plan') ||
        typeof value !== 'string' || !value) {
      throw new Error('Only approved private planned-week review arguments are accepted')
    }
  }
  const allowedDays = new Set(m2DefaultActiveDays)
  const allowedRecipes = new Set(m2Recipes.map(recipe => recipe.id))
  if (length === 0) {
    return {
      days: [...m2DefaultActiveDays],
      plan: m2InitialPlan.map(meal => ({ ...meal })),
    }
  }

  const entries = value.split(',')
  if (entries.length < 1 || entries.length > m2DefaultActiveDays.length ||
      new Set(entries).size !== entries.length) {
    throw new Error('Only distinct currently planned fixture days are accepted')
  }

  if (flag === '--days') {
    if (entries.some(day => !allowedDays.has(day))) {
      throw new Error('Only currently planned fixture day labels are accepted')
    }
    return {
      days: m2DefaultActiveDays.filter(day => entries.includes(day)),
      plan: m2InitialPlan.map(meal => ({ ...meal })),
    }
  }

  const chosen = new Map()
  for (const entry of entries) {
    const match = /^([A-Za-z]{2}):([a-z][a-z0-9-]{0,39})$/.exec(entry)
    if (!match || !allowedDays.has(match[1]) || !allowedRecipes.has(match[2]) ||
        chosen.has(match[1])) {
      throw new Error('Only one approved fixture recipe per planned day is allowed')
    }
    chosen.set(match[1], match[2])
  }
  return {
    days: m2DefaultActiveDays.filter(day => chosen.has(day)),
    plan: m2InitialPlan.map(meal => ({
      day: meal.day,
      recipeId: chosen.get(meal.day) ?? meal.recipeId,
    })),
  }
}

export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  const { days, plan } = selectedFixtureWeek(argv)
  const batch = await loadReviewedRepositoryFixtures()
  if (batch.summary.sources !== 6 || batch.summary.rejectedSources !== 0 ||
      batch.summary.productionEnabled !== false ||
      batch.summary.permissionVerified !== false) {
    throw new Error('Untrusted offline retailer fixture sources')
  }
  const catalog = buildUniversalRetailerCatalog(batch)
  const week = buildDynamicReviewedWeek({
    catalog, plan, recipes: m2Recipes, activeDays: days,
  })
  const summary = reviewedPlannerQueueSummary(week.preview)
  const aggregate = {
    mode: week.mode,
    activeDays: week.activeDayCount,
    selectedMeals: week.selectedMealCount,
    uniqueIngredientNeeds: week.uniqueIngredientNeeds,
    retailerReviewRows: week.retailerReviewRows,
    proposedForManualReview: summary.suggestedForManualReview,
    unresolved: summary.unresolved,
    livePricesAvailable: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  }
  write(JSON.stringify(aggregate) + '\n')
  return aggregate
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private planned-week review refused; no live retailer data or price claim produced')
    process.exitCode = 2
  })
}
