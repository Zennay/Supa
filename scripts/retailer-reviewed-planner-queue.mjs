/**
 * Product-core verification of offline historical retailer products against
 * the canonical 11 M3 planner needs. Prints only aggregate counts: no raw
 * capture, SKU, source URL, price, person, savings or retailer web request.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildReviewedCatalogPlannerQueue } from '../src/domain/reviewedCatalogPlannerQueue.ts'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'

export function reviewedPlannerQueueSummary(queue) {
  if (queue?.mode !== 'historical-catalog-human-review-only' ||
      queue.productionEnabled !== false ||
      queue.publicSavingsClaimEligible !== false ||
      queue.completeFieldEvidence !== false ||
      !Array.isArray(queue.rows) ||
      queue.rows.length < 2 ||
      queue.rows.length % 2 !== 0) {
    throw new Error('Unsafe reviewed planner queue summary')
  }
  let proposed = 0
  let unresolved = 0
  for (const row of queue.rows) {
    if (row.status === 'suggested-for-manual-review' && row.candidate !== null) proposed++
    else if (row.status === 'unresolved' && row.candidate === null) unresolved++
    else throw new Error('Inconsistent historical review row')
  }
  return {
    mode: 'historical-catalog-human-review-only',
    planningNeeds: queue.rows.length / 2,
    retailerRows: queue.rows.length,
    suggestedForManualReview: proposed,
    unresolved,
    sources: 2,
    livePricesAvailable: false,
    externalRequests: 0,
    publicSavingsClaimEligible: false,
  }
}
export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error('Offline planner review takes no external arguments')
  }
  const batch = await loadReviewedRepositoryFixtures()
  if (batch?.summary?.sources !== 6 ||
      batch?.summary?.rejectedSources !== 0 ||
      batch?.summary?.productionEnabled !== false ||
      batch?.summary?.permissionVerified !== false) {
    throw new Error('Only six known unlicensed historical fixture sources are accepted')
  }
  const catalog = buildUniversalRetailerCatalog(batch)
  const queue = buildReviewedCatalogPlannerQueue(catalog, buildObservationSheet().requirements)
  const summary = reviewedPlannerQueueSummary(queue)
  write(JSON.stringify(summary) + '\n')
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private historical catalog planner preview refused; no price comparison generated')
    process.exitCode = 2
  })
}
