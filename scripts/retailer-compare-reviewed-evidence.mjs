import { lstat, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { compareReviewedRetailerEvidence } from '../src/data/reviewedRetailerEvidence.ts'

const MAX_INPUT_BYTES = 5 * 1024 * 1024
async function readJsonFile(filename) {
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES) {
    throw new Error('Offline evidence file must be bounded and non-symlinked')
  }
  const bytes = await readFile(filename)
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error('Offline evidence too large')
  return JSON.parse(bytes.toString('utf8'))
}

export async function compareSavedRetailerEvidence(
  requirementsFile, plusEvidenceFile, dekaEvidenceFile, nowMs = Date.now(),
) {
  const [requirements, plus, deka] = await Promise.all([
    readJsonFile(requirementsFile),
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
