import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { assessRetailerDiscovery } from './m5-audit-retailer-discovery.mjs'

// These thirteen banners form the explicitly scoped first inventory checklist
// in #2069/PWQ-316. It is NOT a list of licensed feeds, adapters, or
// necessarily every Dutch store/franchise. No internet request is made here.
export const CORE_MARKET_BANNERS = Object.freeze([
  'albert-heijn', 'aldi', 'boni', 'dekamarkt', 'dirk', 'hoogvliet',
  'jumbo', 'lidl', 'picnic', 'plus', 'poiesz', 'spar', 'vomar',
])

export function assessCoreRetailerCoverage(document) {
  // Validate the entire exact schema and every no-permission constraint with
  // the owning discovery module; do not implement a competing permissions gate.
  const audited = assessRetailerDiscovery(document)
  const known = new Set(audited.sources.map((source) => source.id))
  const missing = CORE_MARKET_BANNERS.filter((id) => !known.has(id))
  const extra = audited.sources.map((source) => source.id)
    .filter((id) => !CORE_MARKET_BANNERS.includes(id)).sort()
  const coreCovered = missing.length === 0

  return {
    contractVersion: 1,
    purpose: 'offline_candidate_inventory_completeness_only',
    milestone: 'M3 active; M5 not eligible',
    requiredCount: CORE_MARKET_BANNERS.length,
    coveredRequiredCount: CORE_MARKET_BANNERS.length - missing.length,
    missingRequiredIds: missing,
    additionalCandidateIds: extra,
    candidateCount: audited.sourceCount,
    coreCovered,
    rightsVerified: false,
    productionReady: false,
    m5Eligible: false,
    nextAction: coreCovered
      ? 'Manual source rights, robots, regional scope and explicit owner approvals still required'
      : 'Restore missing research-only candidate banners before expanding discovery',
  }
}

// Capture-set change detection is a reviewer aid, not proof that snapshots
// represent distinct dates, licensed data, or a usable ingestion source.
export function compareCoreRetailerInventories(currentDocument, previousDocument) {
  if (currentDocument === previousDocument ||
      currentDocument?.sources === previousDocument?.sources) {
    throw new Error('Distinct inventory inputs required for offline comparison')
  }
  const current = assessCoreRetailerCoverage(currentDocument)
  const previous = assessCoreRetailerCoverage(previousDocument)
  const currentIds = new Set(currentDocument.sources.map((source) => source.id))
  const previousIds = new Set(previousDocument.sources.map((source) => source.id))
  const addedCandidateIds = [...currentIds].filter((id) => !previousIds.has(id)).sort()
  const removedCandidateIds = [...previousIds].filter((id) => !currentIds.has(id)).sort()
  return {
    contractVersion: 1,
    purpose: 'offline_market_inventory_change_review_only',
    addedCandidateIds,
    removedCandidateIds,
    coreCovered: current.coreCovered,
    missingRequiredIds: current.missingRequiredIds,
    previousCandidateCount: previous.candidateCount,
    currentCandidateCount: current.candidateCount,
    changed: addedCandidateIds.length > 0 || removedCandidateIds.length > 0,
    humanReviewRequired: addedCandidateIds.length > 0 || removedCandidateIds.length > 0,
    historicalEvidenceVerified: false,
    rightsVerified: false,
    productionReady: false,
    m5Eligible: false,
  }
}

async function main(argv = process.argv.slice(2)) {
  const comparison = argv.length === 3 && argv[1] === '--baseline' &&
    argv[0] && argv[2] && !argv[0].startsWith('-') && !argv[2].startsWith('-')
  const single = argv.length <= 1 && argv.every((arg) => !arg.startsWith('-'))
  if (!comparison && !single) {
    throw new Error('Invalid offline coverage arguments')
  }
  const file = argv[0]
    ? argv[0]
    : new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
  const document = JSON.parse(await readFile(file, 'utf8'))
  const report = comparison
    ? compareCoreRetailerInventories(document, JSON.parse(await readFile(argv[2], 'utf8')))
    : assessCoreRetailerCoverage(document)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (!report.coreCovered || (comparison && report.removedCandidateIds.length > 0)) {
    process.exitCode = 2
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch {
    // Never echo a caller-supplied local path or private input contents.
    process.stderr.write('Invalid offline retailer coverage input\n')
    process.exitCode = 2
  }
}
