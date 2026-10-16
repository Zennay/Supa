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

function selectedDays(input) {
  const days = snapshotInertReviewedEvidence(input)
  const allowed = new Set(m2DefaultActiveDays)
  if (!Array.isArray(days) || days.length < 1 || days.length > 7 ||
      new Set(days).size !== days.length ||
      days.some(day => typeof day !== 'string' || !allowed.has(day))) refuse()
  return days
}

/** Strictly offline, no prices or retailer HTTP. Returns a private review only. */
export function buildCivilClockCheckedPrivatePlannedWeek(records, days = m2DefaultActiveDays) {
  if (arguments.length < 1 || arguments.length > 2) refuse()
  const activeDays = selectedDays(days)
  // No direct unreviewed ingestion path: reject the entire batch first.
  const catalog = buildCivilClockCheckedPrivateCatalog(records)
  if (catalog.sourceCount !== 6 || catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false ||
      catalog.status !== 'private-review-only' ||
      !Array.isArray(catalog.products) || catalog.products.length === 0) refuse()
  const week = buildDynamicReviewedWeek({
    catalog, plan: m2InitialPlan, recipes: m2Recipes, activeDays,
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
  return selectedDays(values[1].split(','))
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
