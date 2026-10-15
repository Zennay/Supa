/**
 * Offline operator command: compare two separately selected, already reviewed
 * PLUS/Deka SHA-pinned private evidence directories. No HTTP, scraper, public
 * price or savings claim, scheduler, or implicit store source authorization.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPrivateReviewedCaptureBatch } from './retailer-private-reviewed-manifest-replay.mjs'
import { comparePrivateRetailerFactChanges } from './retailer-private-fact-change-review.mjs'

const fail = () => { throw new Error('Private retailer reviewed directory diff refused') }

/**
 * Strictly one baseline and one candidate; never a URL, root download, flag
 * to publish, unpinned directory, or same resolved path on both sides.
 */
export async function compareReviewedDirectories(beforeDirectory, afterDirectory, {
  referenceTime = new Date().toISOString(),
} = {}) {
  if (typeof beforeDirectory !== 'string' || !beforeDirectory.trim() ||
      beforeDirectory.length > 500 || beforeDirectory.startsWith('-') ||
      typeof afterDirectory !== 'string' || !afterDirectory.trim() ||
      afterDirectory.length > 500 || afterDirectory.startsWith('-') ||
      resolve(beforeDirectory) === resolve(afterDirectory) ||
      typeof referenceTime !== 'string') fail()
  const [previous, current] = await Promise.all([
    loadPrivateReviewedCaptureBatch(beforeDirectory, { referenceTime }),
    loadPrivateReviewedCaptureBatch(afterDirectory, { referenceTime }),
  ])
  const report = comparePrivateRetailerFactChanges(previous, current, { referenceTime })
  if (report.productionEnabled !== false || report.sourceRightsVerified !== false ||
      report.livePricesAvailable !== false ||
      report.publicSavingsClaimEligible !== false ||
      report.externalRequests !== 0) fail()
  return report
}

export async function main(argv = process.argv.slice(2),
  write = value => process.stdout.write(value)) {
  if (!Array.isArray(argv) ||
      !(argv.length === 4 || argv.length === 6) ||
      argv[0] !== '--before-dir' || argv[2] !== '--after-dir' ||
      (argv.length === 6 && argv[4] !== '--at')) fail()
  const options = argv.length === 6 ? { referenceTime: argv[5] } : {}
  const result = await compareReviewedDirectories(argv[1], argv[3], options)
  write(JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer reviewed directory diff refused')
    process.exitCode = 2
  })
}
