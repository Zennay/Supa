/**
 * M3 opt-in offline bridge: six archived PLUS/Deka source captures -> strict
 * civil-clock/physical identity admission -> unpublishable catalog ->
 * real selected fixture meals -> cross-retailer human review queue.
 *
 * This is deliberately NOT a live price comparator, approved crawler,
 * public quote, or evidence that a basket saves money.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { buildDynamicReviewedWeek } from '../src/domain/reviewedCatalogPlannedWeek.ts'
import { snapshotInertReviewedEvidence } from './retailer-inert-json-admission.mjs'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from './retailer-reviewed-ingest-engine.mjs'
import { buildCivilClockCheckedPrivateCatalog } from './retailer-private-civil-clock-preflight.mjs'

const refuse = () => { throw new Error('Private historical planned-week bridge refused') }
const stores = ['plus', 'dekamarkt']
const DUTCH_DAYS = new Set(['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'])

function selectedDays(input) {
  const days = snapshotInertReviewedEvidence(input)
  const allowed = DUTCH_DAYS
  if (!Array.isArray(days) || days.length < 1 || days.length > 7 ||
      new Set(days).size !== days.length ||
      days.some(day => typeof day !== 'string' || !allowed.has(day))) refuse()
  return days
}

/**
 * A caller may optionally provide a real, already-curated local planner and
 * recipe set. Detach both together with the same inert-JSON boundary as source
 * admission; never read executable getters or caller proxies. Only this
 * private review path accepts custom plans, not the fixture-only CLI.
 */
function privatePlannerInputs(options) {
  if (options === undefined) {
    return { plan: m2InitialPlan, recipes: m2Recipes, source: 'm2-fixture' }
  }
  const input = snapshotInertReviewedEvidence(options)
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 2 ||
      !Object.hasOwn(input, 'plan') || !Object.hasOwn(input, 'recipes') ||
      !Array.isArray(input.plan) || !Array.isArray(input.recipes) ||
      input.plan.length < 1 || input.plan.length > 14 ||
      input.recipes.length < 1 || input.recipes.length > 100 ||
      input.recipes.some(recipe => !recipe || typeof recipe !== 'object' ||
        !Array.isArray(recipe.ingredients) || recipe.ingredients.length > 32)) refuse()
  return { plan: input.plan, recipes: input.recipes, source: 'custom-private' }
}

/** Strictly offline, no prices or retailer HTTP. Returns a private review only. */
export function buildCivilClockCheckedPrivatePlannedWeek(records, days = m2DefaultActiveDays, options) {
  if (arguments.length < 1 || arguments.length > 3) refuse()
  const activeDays = selectedDays(days)
  const { plan, recipes, source } = privatePlannerInputs(options)
  // No direct unreviewed ingestion path: reject the entire batch first.
  const catalog = buildCivilClockCheckedPrivateCatalog(records)
  if (catalog.sourceCount !== 6 || catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false ||
      catalog.status !== 'private-review-only' ||
      !Array.isArray(catalog.products) || catalog.products.length === 0) refuse()
  const week = buildDynamicReviewedWeek({
    catalog, plan, recipes, activeDays,
  })
  const rows = week.preview.rows
  if (!Array.isArray(rows) || rows.length !== week.uniqueIngredientNeeds * stores.length ||
      week.preview.productionEnabled !== false ||
      week.preview.publicSavingsClaimEligible !== false ||
      week.preview.completeFieldEvidence !== false ||
      week.livePriceClaimsAllowed !== false) refuse()
  for (const store of stores) {
    const storeRows = rows.filter(row => row.retailerId === store)
    if (storeRows.length !== week.uniqueIngredientNeeds) refuse()
    const ids = storeRows.map(row => row.ingredientId)
    if (new Set(ids).size !== ids.length ||
        storeRows.some(row => !['unresolved', 'suggested-for-manual-review'].includes(row.status) ||
          (row.status === 'unresolved' ? row.candidate !== null : row.candidate === null))) refuse()
  }
  // Do not expose the historical catalog or its possibly sensitive price,
  // URL, capture clock, source hash, or product identifiers in CLI output.
  const perRetailer = Object.fromEntries(stores.map(store => {
    const own = rows.filter(row => row.retailerId === store)
    return [store, {
      suggestedForManualReview: own.filter(row => row.status === 'suggested-for-manual-review').length,
      unresolved: own.filter(row => row.status === 'unresolved').length,
    }]
  }))
  return {
    privateReview: week,
    summary: {
      mode: 'historical-planned-week-private-review-only',
      reviewedArchivedSources: catalog.sourceCount,
      selectedPlanSource: source,
      historicalProductGroups: catalog.productCount,
      activeDays: week.activeDayCount,
      ingredientNeeds: week.uniqueIngredientNeeds,
      retailerReviewRows: week.retailerReviewRows,
      perRetailer,
      requiresCurrentHumanObservation: true,
      sourcePermissionVerified: false,
      productionReady: false,
      livePricesAvailable: false,
      publicSavingsClaimEligible: false,
      externalRequests: 0,
    },
  }
}

function cliDays(argv) {
  const values = snapshotInertReviewedEvidence(argv)
  if (!Array.isArray(values) ||
      (values.length !== 0 &&
        (values.length !== 2 || values[0] !== '--days' || typeof values[1] !== 'string'))) refuse()
  if (values.length === 0) return [...m2DefaultActiveDays]
  const days = selectedDays(values[1].split(','))
  if (days.some(day => !m2DefaultActiveDays.includes(day))) refuse()
  return days
}

/** Aggregate-only CLI over six fixed sanitized historical files. */
export async function main(argv = process.argv.slice(2), write = value => process.stdout.write(value)) {
  const days = cliDays(argv)
  if (typeof write !== 'function') refuse()
  const root = new URL('../fixtures/m1/', import.meta.url)
  const records = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
  const { summary } = buildCivilClockCheckedPrivatePlannedWeek(records, days)
  write(JSON.stringify(summary) + '\n')
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private historical planned-week bridge refused')
    process.exitCode = 2
  })
}
