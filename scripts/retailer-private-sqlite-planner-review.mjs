/**
 * PROOF of real persisted universal retailer SQLite -> true meal-plan demand
 * -> existing matchIngredient engine, all in a throwaway private workspace.
 *
 * stdout ONLY safe aggregate counts. Read-only Python process IPC contains
 * historical product names temporarily, never prices or source URLs.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { m2Recipes } from '../src/data/m2Fixture.ts'
import { buildDynamicReviewedWeek } from '../src/domain/reviewedCatalogPlannedWeek.ts'
import { buildReviewedRetailerSqlite } from './retailer-build-reviewed-universal-sqlite.mjs'
import { reviewedPlannerQueueSummary } from './retailer-reviewed-planner-queue.mjs'
import { selectedFixtureWeek } from './retailer-reviewed-custom-week.mjs'

const READER = fileURLToPath(new URL('./retailer-private-sqlite-planner-reader.py', import.meta.url))

export async function buildPersistedReviewedWeek(argv = []) {
  // Share the same strict fixture-only recipe choices with the in-memory preview.
  // Refuse unapproved input BEFORE allocating a private SQLite workspace.
  const { days, plan } = selectedFixtureWeek(argv)
  const folder = await mkdtemp(join(tmpdir(), 'supa-private-retailer-review-'))
  try {
    const database = join(folder, 'catalog-private.db')
    const saved = await buildReviewedRetailerSqlite(database)
    if (saved.productionEnabled !== false ||
        saved.publicSavingsClaimEligible !== false ||
        saved.externalNetworkUsed !== false ||
        saved.databaseCreated !== true ||
        saved.sources !== 6 || saved.snapshots !== 6) {
      throw new Error('Only complete private offline catalog snapshots can be reviewed')
    }
    const reader = spawnSync('python3', [READER, '--database', database], {
      timeout: 20_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    if (reader.status !== 0 || reader.error) {
      throw new Error('Private persisted retailer review refused')
    }
    let catalog
    try { catalog = JSON.parse(reader.stdout) }
    catch { throw new Error('Private reviewed catalog IPC is malformed') }
    const week = buildDynamicReviewedWeek({
      catalog, plan, recipes: m2Recipes, activeDays: days,
    })
    const summary = reviewedPlannerQueueSummary(week.preview)
    return {
      mode: 'persisted-private-sqlite-to-dynamic-planner-review',
      sourceSnapshots: saved.snapshots,
      persistedProducts: saved.products,
      selectedMealDays: week.activeDayCount,
      ingredientNeeds: week.uniqueIngredientNeeds,
      retailerReviewRows: week.retailerReviewRows,
      proposedForManualReview: summary.suggestedForManualReview,
      unresolved: summary.unresolved,
      productionEnabled: false,
      publicSavingsClaimEligible: false,
      livePricesAvailable: false,
      externalRequests: 0,
    }
  } finally {
    await rm(folder, { force: true, recursive: true })
  }
}

export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  const summary = await buildPersistedReviewedWeek(argv)
  write(JSON.stringify(summary) + '\n')
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private SQLite/planner review refused; no live prices or retailer requests used')
    process.exitCode = 2
  })
}
