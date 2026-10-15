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

const REVIEW_STORES = ['plus', 'dekamarkt']
const REVIEW_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const REVIEW_ROW_KEYS = ['retailerId', 'ingredientId', 'ingredientLabel', 'required', 'status', 'candidate', 'reasons']
const REVIEW_CANDIDATE_KEYS = ['canonicalKey', 'productName', 'packAmount', 'packUnit', 'matchScore', 'captureCount']
const ownsExactly = (value, keys) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const safeReviewId = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,170}$/.test(value)

export function reviewedPlannerQueueSummary(queue) {
  if (!ownsExactly(queue, [
    'mode', 'sourceStatus', 'productionEnabled', 'publicSavingsClaimEligible',
    'completeFieldEvidence', 'needsHumanSourceReview', 'rows',
  ]) ||
      queue.mode !== 'historical-catalog-human-review-only' ||
      queue.sourceStatus !== 'private-review-only' ||
      queue.needsHumanSourceReview !== true ||
      queue.productionEnabled !== false ||
      queue.publicSavingsClaimEligible !== false ||
      queue.completeFieldEvidence !== false ||
      !Array.isArray(queue.rows) ||
      queue.rows.length < 2 || queue.rows.length > 200 ||
      queue.rows.length % 2 !== 0) {
    throw new Error('Unsafe reviewed planner queue summary')
  }
  const identities = new Map(REVIEW_STORES.map(store => [store, new Map()]))
  let proposed = 0
  let unresolved = 0
  for (let i = 0; i < queue.rows.length; i++) {
    if (!Object.hasOwn(queue.rows, i)) throw new Error('Unsafe sparse review rows')
    const row = queue.rows[i]
    if (!ownsExactly(row, REVIEW_ROW_KEYS) ||
        !REVIEW_STORES.includes(row.retailerId) ||
        !safeReviewId(row.ingredientId) ||
        typeof row.ingredientLabel !== 'string' || !row.ingredientLabel.trim() ||
        !ownsExactly(row.required, ['amount', 'unit']) ||
        !Number.isFinite(row.required.amount) || row.required.amount <= 0 ||
        !REVIEW_UNITS.has(row.required.unit) ||
        !Array.isArray(row.reasons) || row.reasons.length !== 1) {
      throw new Error('Unsafe reviewed planner row')
    }
    const demands = identities.get(row.retailerId)
    if (demands.has(row.ingredientId)) {
      throw new Error('Duplicate retailer demand in review queue')
    }
    demands.set(row.ingredientId, JSON.stringify([row.ingredientLabel, row.required.amount, row.required.unit]))
    if (row.status === 'unresolved' && row.candidate === null &&
        row.reasons[0] === 'no unambiguous reviewed historical product suggestion') {
      unresolved++
    } else if (row.status === 'suggested-for-manual-review' &&
        row.reasons[0] === 'historical product suggestion only; verify quantity, availability, identity and current price manually' &&
        ownsExactly(row.candidate, REVIEW_CANDIDATE_KEYS) &&
        typeof row.candidate.canonicalKey === 'string' &&
        row.candidate.canonicalKey.startsWith(row.retailerId + ':') &&
        safeReviewId(row.candidate.canonicalKey) &&
        typeof row.candidate.productName === 'string' && row.candidate.productName.trim() &&
        Number.isFinite(row.candidate.packAmount) && row.candidate.packAmount > 0 &&
        REVIEW_UNITS.has(row.candidate.packUnit) &&
        Number.isFinite(row.candidate.matchScore) &&
        row.candidate.matchScore >= 65 && row.candidate.matchScore <= 200 &&
        Number.isSafeInteger(row.candidate.captureCount) &&
        row.candidate.captureCount >= 1 && row.candidate.captureCount <= 32) {
      proposed++
    } else {
      throw new Error('Unsafe historical review candidate or status')
    }
  }
  const plus = identities.get('plus')
  const deka = identities.get('dekamarkt')
  if (plus.size !== queue.rows.length / 2 || deka.size !== plus.size ||
      [...plus].some(([id, shape]) => deka.get(id) !== shape)) {
    throw new Error('Missing or inconsistent two-retailer review coverage')
  }
  return {
    mode: 'historical-catalog-human-review-only',
    planningNeeds: plus.size,
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
