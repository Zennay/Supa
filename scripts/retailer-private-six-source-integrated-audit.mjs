/**
 * SUPA M3: historical six-source -> guarded planner admission -> private
 * universal SQLite -> independent read-only integrity verification.
 *
 * Never retrieves retailer pages or makes current price/savings claims.
 * No raw prices, products, URLs, timestamps, database paths or credentials
 * are emitted to the operator console.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { snapshotBoundedPrivateCatalogInput } from './retailer-private-budgeted-catalog.mjs'
import { buildReviewedRetailerSqlite } from './retailer-build-reviewed-universal-sqlite.mjs'

const AUDITOR = fileURLToPath(new URL('./retailer-audit-private-sqlite.py', import.meta.url))
const ERROR = 'Private SUPA M3 historical pipeline refused; no prices or savings published'

function refuse() {
  throw new Error(ERROR)
}

/**
 * The builder validates the same six authentic historical adapter sources
 * against the canonical 11×2 needs before creating an exclusive private DB.
 * Python audits actual persisted rows read-only before reporting success.
 *
 * A denied audit leaves the newly written file private for operator inspection,
 * never emits an apparently successful report or silently overwrites evidence.
 */
export async function buildAndAuditHistoricalRetailerDatabase(destination) {
  let output
  try { output = await buildReviewedRetailerSqlite(destination) }
  catch { refuse() }
  if (output?.databaseCreated !== true ||
      output?.historicalOnly !== true ||
      output?.productionEnabled !== false ||
      output?.publicSavingsClaimEligible !== false ||
      output?.fullBasketFieldComparisonVerified !== false ||
      output?.sources !== 6 || output?.snapshots !== 6 ||
      output?.canonicalPlannerNeeds !== 11 ||
      output?.twoStoreReviewRows !== 22) refuse()

  let result, reviewed
  try {
    result = spawnSync('python3', [AUDITOR, '--db', destination], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024,
      windowsHide: true,
    })
    if (result.error || result.status !== 0 || result.stderr || !result.stdout) refuse()
    reviewed = JSON.parse(result.stdout)
  } catch { refuse() }

  if (reviewed?.mode !== 'historical-private-sqlite-readonly-audit' ||
      reviewed?.databaseIntegrityVerified !== true ||
      reviewed?.releaseDecision !== 'hold' ||
      reviewed?.sourceRightsVerified !== false ||
      reviewed?.actualRetailerPricesVerified !== false ||
      reviewed?.fullBasketFieldComparisonVerified !== false ||
      reviewed?.publicSavingsClaimEligible !== false ||
      reviewed?.productionEnabled !== false ||
      reviewed?.retailers !== 2 ||
      reviewed?.sourceKinds !== output.snapshots ||
      reviewed?.historicalObservations !== output.observations ||
      reviewed?.products !== output.products) refuse()

  return Object.freeze({
    schemaVersion: 1,
    mode: 'historical-six-source-integrated-private-audit',
    historicalOnly: true,
    reviewedSourceKinds: 6,
    canonicalPlannerNeeds: 11,
    twoStoreReviewRows: 22,
    historicalObservations: output.observations,
    historicalProducts: output.products,
    physicalDatabaseIntegrityVerified: true,
    actualRetailerPricesVerified: false,
    fullBasketFieldComparisonVerified: false,
    sourceRightsVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
    releaseDecision: 'hold',
  })
}

export async function main(argv = process.argv.slice(2),
    write = message => process.stdout.write(message)) {
  let safe
  try { safe = snapshotBoundedPrivateCatalogInput(argv) } catch { refuse() }
  if (!Array.isArray(safe) || safe.length !== 2 ||
      safe[0] !== '--out' || typeof safe[1] !== 'string') refuse()
  const summary = await buildAndAuditHistoricalRetailerDatabase(safe[1])
  write(JSON.stringify(summary) + '\n')
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(ERROR)
    process.exitCode = 2
  })
}
