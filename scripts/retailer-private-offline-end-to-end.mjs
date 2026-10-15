/**
 * One-command, OFFLINE, reviewer-controlled retailer evidence pipeline.
 *
 * Existing vetted JSON evidence -> content-digest manifest -> strict six
 * adapters -> universal historical capture registry -> aggregate health.
 * Never downloads HTML or selects/licences current retailer prices.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPrivateReviewedManifest } from './retailer-private-reviewed-manifest-builder.mjs'
import { replayPrivateReviewedCaptureDirectory } from './retailer-private-reviewed-manifest-replay.mjs'

const fail = () => { throw new Error('Private offline retailer pipeline refused') }

/** Execute exactly once for a newly prepared 0700 offline evidence directory. */
export async function runPrivateRetailerPipeline(directory, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'referenceTime')) fail()
  let created, replay
  try {
    // Manifest creation is atomic/no overwrite and checks the same real
    // retailer adapters; the replay re-reads every pinned JSON byte.
    created = await buildPrivateReviewedManifest(directory)
    replay = await replayPrivateReviewedCaptureDirectory(directory, options)
  } catch { fail() }
  if (created?.manifestCreated !== true || replay?.sources !== created.filesPinned ||
      replay?.sixShapeCoverageComplete !== true ||
      replay?.permissionVerified !== false ||
      replay?.productionEnabled !== false ||
      replay?.publicSavingsClaimEligible !== false) fail()
  return {
    schemaVersion: 1,
    mode: 'private-offline-retailer-staged-pipeline',
    manifestCreated: true,
    pinnedSources: created.filesPinned,
    acceptedSources: replay.acceptedSources,
    observations: replay.observations,
    products: replay.products,
    captureEvents: replay.captureEvents,
    conflictsNeedingReview: replay.conflictCount,
    staleSources: replay.staleSources,
    humanReviewRequired: true,
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    livePricesAvailable: false,
    externalRequests: 0,
  }
}

/**
 * Replay an existing operator-reviewed manifest without modifying or
 * regenerating any evidence bytes. Safe for deterministic VPS job retries.
 * An unpinned/mutated source, missing shape or private permission change
 * refuses the entire verification; never falls back to a live request.
 */
export async function verifyPrivateRetailerPipeline(directory, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'referenceTime')) fail()
  let replay
  try {
    replay = await replayPrivateReviewedCaptureDirectory(directory, options)
  } catch { fail() }
  if (!replay || replay.sources < 6 || replay.sources > 32 ||
      replay.acceptedSources !== replay.sources ||
      replay.sixShapeCoverageComplete !== true ||
      replay.permissionVerified !== false ||
      replay.productionEnabled !== false ||
      replay.publicSavingsClaimEligible !== false ||
      replay.livePricesAvailable !== false ||
      replay.externalRequests !== 0) fail()
  return {
    schemaVersion: 1,
    mode: 'private-offline-retailer-verified-pipeline',
    manifestCreated: false,
    manifestVerified: true,
    pinnedSources: replay.sources,
    acceptedSources: replay.acceptedSources,
    observations: replay.observations,
    products: replay.products,
    captureEvents: replay.captureEvents,
    conflictsNeedingReview: replay.conflictCount,
    staleSources: replay.staleSources,
    humanReviewRequired: true,
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    livePricesAvailable: false,
    externalRequests: 0,
  }
}
export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || argv[0] !== '--dir' ||
      !(argv.length === 2 || (argv.length === 3 && argv[2] === '--verify'))) fail()
  const summary = argv.length === 3
    ? await verifyPrivateRetailerPipeline(argv[1])
    : await runPrivateRetailerPipeline(argv[1])
  write(JSON.stringify(summary, null, 2) + '\n')
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private offline retailer pipeline refused')
    process.exitCode = 2
  })
}
