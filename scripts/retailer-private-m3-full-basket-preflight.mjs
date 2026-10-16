/**
 * M3 product-core: one-command, genuinely offline historical retailer →
 * canonical full-basket planner preflight. No network, price publication or
 * false 11×2 physical field-study claims. Only aggregate-safe output.
 *
 * Six real archived reviewed sources → bounded inert input → health →
 * immutable private catalog → canonical 11-needs × two retailers queue.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildReviewedCatalogPlannerQueue } from '../src/domain/reviewedCatalogPlannerQueue.ts'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { snapshotBoundedPrivateCatalogInput,
  buildBudgetedPrivateRetailerCatalog } from './retailer-private-budgeted-catalog.mjs'
import { evaluatePrivateAdapterHealth } from './retailer-private-adapter-health.mjs'
import { reviewedPlannerQueueSummary } from './retailer-reviewed-planner-queue.mjs'

const refuse = () => { throw new Error('Private M3 offline full-basket preflight refused') }
const SIX = Object.freeze([
  'plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers',
])

/**
 * Takes only in-memory, previously adapter-reviewed evidence. An inert full
 * snapshot MUST happen before looking at caller-provided source or audit clock;
 * no caller getter, Proxy, inherited property or non-JSON primitive may run.
 */
export function assessHistoricalM3FullBasketReadiness(batch, options = {}) {
  let source
  try { source = snapshotBoundedPrivateCatalogInput({ batch, options }) }
  catch { refuse() }
  const { batch: reviewed, options: settings } = source
  if (!settings || Array.isArray(settings) ||
      Object.keys(settings).some(k => k !== 'referenceTime' && k !== 'maxAgeHours') ||
      !reviewed || Array.isArray(reviewed) ||
      reviewed.summary?.mode !== 'reviewed-offline-only' ||
      reviewed.summary?.sources !== 6 ||
      reviewed.summary?.acceptedSources !== 6 ||
      reviewed.summary?.rejectedSources !== 0 ||
      reviewed.summary?.productionEnabled !== false ||
      reviewed.summary?.permissionVerified !== false ||
      reviewed.summary?.publicSavingsClaimEligible !== false ||
      !Array.isArray(reviewed.results) ||
      reviewed.results.length !== 6 ||
      new Set(reviewed.results.map(r => r?.key)).size !== 6 ||
      SIX.some(k => !reviewed.results.some(r => r.key === k && r.accepted === true))) {
    refuse()
  }

  let catalog, health, summary
  try {
    catalog = buildBudgetedPrivateRetailerCatalog(reviewed)
    health = evaluatePrivateAdapterHealth(reviewed, settings)
    const demand = buildObservationSheet().requirements
    const queue = buildReviewedCatalogPlannerQueue(catalog, demand)
    summary = reviewedPlannerQueueSummary(queue)
  } catch { refuse() }

  // Independent transformations must agree on real source events, counts,
  // stock/price uncertainty, and identical needs across both stores.
  if (catalog.status !== 'private-review-only' ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false ||
      catalog.sourceCount !== 6 || catalog.productCount < 1 ||
      catalog.captureCount !== health.observations ||
      health.sources !== 6 || health.acceptedSources !== 6 ||
      health.rejectedSources !== 0 ||
      health.sixShapeCoverageComplete !== true ||
      health.productionEnabled !== false ||
      health.permissionVerified !== false ||
      health.publicSavingsClaimEligible !== false ||
      health.externalRequests !== 0 ||
      summary.sources !== 2 ||
      summary.planningNeeds !== 11 ||
      summary.retailerRows !== 22 ||
      summary.suggestedForManualReview + summary.unresolved !== 22 ||
      summary.publicSavingsClaimEligible !== false) refuse()

  return Object.freeze({
    schemaVersion: 1,
    mode: 'historical-six-source-full-basket-review',
    historicalOnly: true,
    sourceKinds: Object.freeze([...SIX]),
    sourceCount: 6,
    acceptedSourceCount: 6,
    observationCount: health.observations,
    privateCatalogProducts: catalog.productCount,
    privateCatalogCaptures: catalog.captureCount,
    conflictingHistoricalProducts: catalog.conflictCount,
    staleHistoricalSources: health.staleSources,
    canonicalPlannerNeeds: summary.planningNeeds,
    twoStoreReviewRows: summary.retailerRows,
    manualSuggestions: summary.suggestedForManualReview,
    unresolvedReviewRows: summary.unresolved,
    fullBasketFieldComparisonVerified: false,
    actualRetailerPriceOrStockVerified: false,
    retailerReuseRightsVerified: false,
    humanReviewRequired: true,
    releaseDecision: 'hold',
    productionEnabled: false,
    livePricesAvailable: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  })
}

/** Zero-argument private operator report; no raw SKU, URL, cent, or offer. */
export async function main(argv = process.argv.slice(2),
    write = message => process.stdout.write(message)) {
  let args
  try { args = snapshotBoundedPrivateCatalogInput(argv) } catch { refuse() }
  if (!Array.isArray(args) || args.length !== 0) refuse()
  const batch = await loadReviewedRepositoryFixtures()
  const report = assessHistoricalM3FullBasketReadiness(batch)
  write(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private M3 offline full-basket preflight refused')
    process.exitCode = 2
  })
}
