/** One offline QA command: six reviewed historical retailer sources -> 0600 SQLite
 * -> strict six-kind QA preflight -> historical age/field quality -> anonymous
 * totals. It never opens retailer HTTP or publishes any current price/claim.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildReviewedRetailerSqlite } from './retailer-build-reviewed-universal-sqlite.mjs'

const GATE = fileURLToPath(new URL('./qa-retailer-sqlite-six-kind-preflight.py', import.meta.url))
const HEALTH = fileURLToPath(new URL('./qa-retailer-sqlite-health-report.py', import.meta.url))
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/
const STATS = ['captureKinds', 'snapshots', 'staleSnapshots', 'futureRelativeToAssessment',
  'observations', 'unknownPrices', 'unknownAvailability', 'uncertainPackages', 'pricedOffersPresent']

function reject() {
  throw new Error('Offline retailer quality bundle refused; no prices or current claims generated')
}
function asOfDate(raw) {
  if (typeof raw !== 'string' || !DATE.test(raw) ||
      !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw.replace('Z', '.000Z') ||
      Date.parse(raw) > Date.now()) reject()
  return raw
}
function readJson(script, argv) {
  const result = spawnSync('python3', [script, ...argv], {
    timeout: 25_000, encoding: 'utf8', maxBuffer: 128 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  if (result.error || result.status !== 0 || result.stderr || !result.stdout) reject()
  try { return JSON.parse(result.stdout) } catch { reject() }
}
function number(value) {
  return Number.isSafeInteger(value) && value >= 0
}
export async function buildOfflineQualityBundle(asOf = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')) {
  const reviewClock = asOfDate(asOf)
  const temp = await mkdtemp(join(tmpdir(), 'supa-qa-offline-bundle-'))
  try {
    const db = join(temp, 'historical-six-source.db')
    const built = await buildReviewedRetailerSqlite(db)
    if (built?.sources !== 6 || built.snapshots !== 6 || built.historicalOnly !== true ||
      built.databaseCreated !== true || built.productionEnabled !== false ||
      built.publicSavingsClaimEligible !== false || built.externalNetworkUsed !== false) reject()
    const accepted = readJson(GATE, ['--database', db])
    const health = readJson(HEALTH, ['--database', db, '--as-of', reviewClock])
    if (accepted?.accepted !== true || accepted.sourceKinds !== 6 ||
      accepted.productionEnabled !== false || accepted.publicSavingsClaimEligible !== false ||
      health?.sourceKinds !== 6 || health.historicalOnly !== true ||
      health.productionEnabled !== false || health.trustedCurrentPrices !== false ||
      health.publicSavingsClaimEligible !== false ||
      health.assessmentClock !== reviewClock ||
      health.snapshots !== accepted.snapshots || health.snapshots !== built.snapshots ||
      health.products !== accepted.products || health.products !== built.products ||
      health.observations !== accepted.observations ||
      health.observations !== built.observations ||
      !health.stores || Object.keys(health.stores).sort().join(',') !== 'dekamarkt,plus') reject()
    const storeQuality = {}
    for (const name of ['dekamarkt', 'plus']) {
      const entry = health.stores[name]
      if (!entry || STATS.some(key => !number(entry[key])) ||
        entry.captureKinds !== 3 || entry.snapshots < 1 || entry.observations < 1) reject()
      storeQuality[name] = Object.fromEntries(STATS.map(key => [key, entry[key]]))
    }
    return {
      mode: 'historical-offline-retailer-quality-bundle',
      assessmentClock: reviewClock,
      sourceKinds: 6,
      snapshots: health.snapshots,
      products: health.products,
      observations: health.observations,
      storeQuality,
      historicalOnly: true,
      externalRequests: 0,
      productionEnabled: false,
      publicSavingsClaimEligible: false,
      trustedCurrentPrices: false,
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || (argv.length !== 0 &&
    (argv.length !== 2 || argv[0] !== '--as-of'))) reject()
  const data = await buildOfflineQualityBundle(argv.length ? argv[1] : undefined)
  write(JSON.stringify(data) + '\n')
  return data
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Offline retailer quality bundle refused; no data or prices published')
    process.exitCode = 2
  })
}
