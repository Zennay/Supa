import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { buildDynamicReviewedWeek } from '../src/domain/reviewedCatalogPlannedWeek.ts'
import { reviewedPlannerQueueSummary } from './retailer-reviewed-planner-queue.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'

// A real, custom week selection over proven fixture recipes: a reusable
// product path, not a fabricated user observation, live store query or quote.
function selectedDays(argv) {
  if (!Array.isArray(argv) || (argv.length !== 0 &&
      (argv.length !== 2 || argv[0] !== '--days' ||
      typeof argv[1] !== 'string' || !argv[1]))) {
    throw new Error('Invalid private planned-week review arguments')
  }
  if (argv.length === 0) return [...m2DefaultActiveDays]
  const days = argv[1].split(',')
  const allowed = new Set(m2DefaultActiveDays)
  if (days.length < 1 || days.length > 7 ||
      new Set(days).size !== days.length ||
      days.some(day => !allowed.has(day))) {
    throw new Error('Select distinct currently planned fixture day labels only')
  }
  return days
}

export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  const days = selectedDays(argv)
  const batch = await loadReviewedRepositoryFixtures()
  if (batch.summary.sources !== 6 || batch.summary.rejectedSources !== 0 ||
      batch.summary.productionEnabled !== false ||
      batch.summary.permissionVerified !== false) {
    throw new Error('Untrusted offline retailer fixture sources')
  }
  const catalog = buildUniversalRetailerCatalog(batch)
  const week = buildDynamicReviewedWeek({
    catalog, plan: m2InitialPlan, recipes: m2Recipes, activeDays: days,
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
