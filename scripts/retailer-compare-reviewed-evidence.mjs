import { lstat, open, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { compareReviewedRetailerEvidence } from '../src/data/reviewedRetailerEvidence.ts'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

const MAX_INPUT_BYTES = 5 * 1024 * 1024
async function readJsonFile(filename) {
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES) {
    throw new Error('Offline evidence file must be bounded and non-symlinked')
  }
  // Pin the file descriptor after lstat. O_NOFOLLOW prevents a concurrent
  // replacement of the final filename with a symlink, and O_NONBLOCK avoids
  // waiting on a FIFO substituted after the metadata check.
  const handle = await open(filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const pinned = await handle.stat()
    if (!pinned.isFile() || pinned.size > MAX_INPUT_BYTES) {
      throw new Error('Offline evidence file must be bounded and non-symlinked')
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error('Offline evidence too large')
    return JSON.parse(bytes.toString('utf8'))
  } finally {
    await handle.close()
  }
}

export async function compareSavedRetailerEvidence(
  requirementsFile, plusEvidenceFile, dekaEvidenceFile, nowMs = Date.now(),
) {
  // Validate the requested basket before opening either retailer evidence
  // file. Invalid/duplicate demands or impossible review clocks cannot form a
  // meaningful two-store comparison and must not trigger bulk source reads.
  const requirements = await readJsonFile(requirementsFile)
  compareReviewedCatalogs({ requirements, observations: [], nowMs })
  const [plus, deka] = await Promise.all([
    readJsonFile(plusEvidenceFile),
    readJsonFile(dekaEvidenceFile),
  ])
  const result = compareReviewedRetailerEvidence({
    requirements, evidence: [plus, deka], nowMs,
  })
  return {
    format: 'supa-offline-store-catalog-v1',
    warning: 'Offline archived evidence only; not a fresh retailer quote or public savings claim',
    ...result,
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [requirements, plus, deka, option, output] = argv
  if (argv.length !== 3 && !(argv.length === 5 && option === '--out')) {
    throw new Error('Usage: node --experimental-strip-types scripts/retailer-compare-reviewed-evidence.mjs requirements.json plus.json deka.json [--out private.json]')
  }
  const report = await compareSavedRetailerEvidence(requirements, plus, deka)
  const json = JSON.stringify(report, null, 2) + '\n'
  if (option === '--out') {
    await writeFile(output, json, { mode: 0o600, flag: 'wx' })
    console.log('Private archived catalog comparison created')
  } else {
    console.log(json)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
