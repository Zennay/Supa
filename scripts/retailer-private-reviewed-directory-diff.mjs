/**
 * Offline operator command: compare two separately selected, already reviewed
 * PLUS/Deka SHA-pinned private evidence directories. No HTTP, scraper, public
 * price or savings claim, scheduler, or implicit store source authorization.
 */
import { resolve } from 'node:path'
import { types as nodeTypes } from 'node:util'
import { pathToFileURL } from 'node:url'
import { loadPrivateReviewedCaptureBatch } from './retailer-private-reviewed-manifest-replay.mjs'
import { comparePrivateRetailerFactChanges } from './retailer-private-fact-change-review.mjs'

const fail = () => { throw new Error('Private retailer reviewed directory diff refused') }

/**
 * The module is also called directly by workers with JavaScript values. Pin
 * the own primitive audit clock, never destructure a caller-owned object:
 * prototype getters, own accessors and Proxy traps must not run during review.
 */
function safeCompareOptions(options) {
  if (options === null || typeof options !== 'object' ||
      nodeTypes.isProxy(options) || Array.isArray(options)) fail()
  const prototype = Object.getPrototypeOf(options)
  if (prototype !== Object.prototype && prototype !== null) fail()
  const keys = Reflect.ownKeys(options)
  if (keys.some(key => key !== 'referenceTime')) fail()
  if (keys.length === 0) return { referenceTime: new Date().toISOString() }
  const property = Object.getOwnPropertyDescriptor(options, 'referenceTime')
  if (!property || !Object.hasOwn(property, 'value') ||
      typeof property.value !== 'string') fail()
  return { referenceTime: property.value }
}

/** Read only dense own string data argv slots before deciding to touch disk. */
function safeDirectoryDiffArgs(argv) {
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype ||
      !(argv.length === 4 || argv.length === 6)) fail()
  const values = []
  for (let index = 0; index < argv.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(argv, index)
    if (!slot || !Object.hasOwn(slot, 'value') ||
        typeof slot.value !== 'string') fail()
    values.push(slot.value)
  }
  if (values[0] !== '--before-dir' || values[2] !== '--after-dir' ||
      (values.length === 6 && values[4] !== '--at')) fail()
  return values
}

/**
 * Strictly one baseline and one candidate; never a URL, root download, flag
 * to publish, unpinned directory, or same resolved path on both sides.
 */
export async function compareReviewedDirectories(beforeDirectory, afterDirectory, options = {}) {
  const { referenceTime } = safeCompareOptions(options)
  if (typeof beforeDirectory !== 'string' || !beforeDirectory.trim() ||
      beforeDirectory.length > 500 || beforeDirectory.startsWith('-') ||
      typeof afterDirectory !== 'string' || !afterDirectory.trim() ||
      afterDirectory.length > 500 || afterDirectory.startsWith('-') ||
      resolve(beforeDirectory) === resolve(afterDirectory) ||
      typeof referenceTime !== 'string') fail()
  // A nonexistent/private input path must not reveal its exact name in a
  // programmatic caller exception. Keep the same generic CLI refusal even
  // when the existing underlying SHA-pinned loader fails.
  let report
  try {
    const [previous, current] = await Promise.all([
      loadPrivateReviewedCaptureBatch(beforeDirectory, { referenceTime }),
      loadPrivateReviewedCaptureBatch(afterDirectory, { referenceTime }),
    ])
    report = comparePrivateRetailerFactChanges(previous, current, { referenceTime })
  } catch { fail() }
  if (report.productionEnabled !== false || report.sourceRightsVerified !== false ||
      report.livePricesAvailable !== false ||
      report.publicSavingsClaimEligible !== false ||
      report.externalRequests !== 0) fail()
  return report
}

export async function main(argv = process.argv.slice(2),
  write = value => process.stdout.write(value)) {
  const values = safeDirectoryDiffArgs(argv)
  const options = values.length === 6 ? { referenceTime: values[5] } : {}
  const result = await compareReviewedDirectories(values[1], values[3], options)
  write(JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer reviewed directory diff refused')
    process.exitCode = 2
  })
}
