/**
 * One-command, OFFLINE, reviewer-controlled retailer evidence pipeline.
 *
 * Existing vetted JSON evidence -> content-digest manifest -> strict six
 * adapters -> universal historical capture registry -> aggregate health.
 * Never downloads HTML or selects/licences current retailer prices.
 */
import { resolve } from 'node:path'
import { types as nodeTypes } from 'node:util'
import { pathToFileURL } from 'node:url'
import { buildPrivateReviewedManifest } from './retailer-private-reviewed-manifest-builder.mjs'
import { replayPrivateReviewedCaptureDirectory } from './retailer-private-reviewed-manifest-replay.mjs'

const fail = () => { throw new Error('Private offline retailer pipeline refused') }

/**
 * Validate the explicit audit clock BEFORE one-shot manifest creation.
 * This grammar matches the downstream historical adapter-health clock:
 * optional seconds, nanosecond fractions, and bounded civil UTC offsets.
 * An explicit undefined/invalid value must never become an implicit now.
 */
function validReferenceTime(value) {
  if (typeof value !== 'string') return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts) return false
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day ||
      Number(parts[4]) > 23 || Number(parts[5]) > 59 ||
      Number(parts[6] ?? 0) > 59) return false
  const timezone = parts[8]
  if (timezone !== 'Z') {
    const [hours, minutes] = timezone.slice(1).split(':').map(Number)
    if (hours > 14 || minutes > 59 ||
        (hours === 14 && minutes !== 0)) return false
  }
  return Number.isFinite(Date.parse(value))
}

/**
 * Snapshot only inert own data from the exported operator API. Neither
 * prototype accessors, own getters, nor Proxy traps may run before source I/O.
 */
function ownReviewerOptions(options) {
  if (options === null || typeof options !== 'object' ||
      nodeTypes.isProxy(options) || Array.isArray(options)) fail()
  const prototype = Object.getPrototypeOf(options)
  if (prototype !== Object.prototype && prototype !== null) fail()
  const keys = Reflect.ownKeys(options)
  if (keys.some(key => key !== 'referenceTime')) fail()
  if (keys.length === 0) return {}
  const descriptor = Object.getOwnPropertyDescriptor(options, 'referenceTime')
  if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
      !validReferenceTime(descriptor.value)) fail()
  return { referenceTime: descriptor.value }
}

/** Require ordinary own data array slots before reading programmatic argv. */
function ownCliArgs(argv) {
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype ||
      (argv.length !== 2 && argv.length !== 3)) fail()
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(argv, index)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'string') fail()
    values.push(descriptor.value)
  }
  if (values[0] !== '--dir' ||
      (values.length === 3 && values[2] !== '--verify')) fail()
  return values
}

/** Execute exactly once for a newly prepared 0700 offline evidence directory. */
export async function runPrivateRetailerPipeline(directory, options = {}) {
  const reviewerOptions = ownReviewerOptions(options)
  let created, replay
  try {
    // Manifest creation is atomic/no overwrite and checks the same real
    // retailer adapters; the replay re-reads every pinned JSON byte.
    created = await buildPrivateReviewedManifest(directory)
    replay = await replayPrivateReviewedCaptureDirectory(directory, reviewerOptions)
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
  const reviewerOptions = ownReviewerOptions(options)
  let replay
  try {
    replay = await replayPrivateReviewedCaptureDirectory(directory, reviewerOptions)
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
  const ownArgs = ownCliArgs(argv)
  const summary = ownArgs.length === 3
    ? await verifyPrivateRetailerPipeline(ownArgs[1])
    : await runPrivateRetailerPipeline(ownArgs[1])
  write(JSON.stringify(summary, null, 2) + '\n')
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private offline retailer pipeline refused')
    process.exitCode = 2
  })
}
