/**
 * SUPA M3 independent offline release-readiness attestation.
 *
 * This intentionally CANNOT authorize online retailer collection. It verifies
 * the actual checked-in PLUS/DekaMarkt permission posture independently of
 * historical six-shape SQLite parity/quality controls and emits count-only
 * operator evidence. Genuine 11x2 field baskets and a trusted VPS run are
 * separate human/runtime gates, never inferred from these fixtures.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'
import { buildOfflineQualityBundle } from './qa-retailer-offline-quality-bundle.mjs'

const CANONICAL = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const REFUSAL = 'Private SUPA M3 readiness attestation refused'
const fail = () => { throw new Error(REFUSAL) }
const ALLOWED = Object.freeze({
  plus: 'permission_required',
  dekamarkt: 'unresolved',
})
const finiteCount = value => Number.isSafeInteger(value) && value >= 0

/**
 * Pure independent source-gate assertion. Never accept an alternate source
 * register from CLI; the project register is always read from this checkout.
 * When the project genuinely gains rights, this historical HOLD contract
 * fails until a separately reviewed new release attestation is implemented.
 */
export function assertHistoricalOnlyRights(gate) {
  let evaluated
  try { evaluated = evaluateSourcePermissionGate(gate) } catch { fail() }
  if (evaluated.productionReady !== false ||
      evaluated.expectedSources?.length !== 2 ||
      !Array.isArray(gate?.sources) || gate.sources.length !== 2 ||
      evaluated.blockers?.length !== 2) fail()
  const status = Object.create(null)
  for (const source of gate.sources) {
    if (!Object.hasOwn(ALLOWED, source.supermarket) ||
        Object.hasOwn(status, source.supermarket) ||
        source.permissionStatus !== ALLOWED[source.supermarket] ||
        source.productionEnabled !== false) fail()
    status[source.supermarket] = source.permissionStatus
  }
  if (Object.keys(status).length !== 2) fail()
  return [
    { retailer: 'dekamarkt', permission: status.dekamarkt, productionEnabled: false },
    { retailer: 'plus', permission: status.plus, productionEnabled: false },
  ]
}

export async function attestM3OfflineReadiness(asOf = '2026-10-15T00:00:00Z') {
  // First enforce actual source rights, before work or reading any archive.
  let rights
  try { rights = JSON.parse(await readFile(CANONICAL, 'utf8')) } catch { fail() }
  const blockedRetailers = assertHistoricalOnlyRights(rights)
  let bundle
  try { bundle = await buildOfflineQualityBundle(asOf) } catch { fail() }
  if (bundle.mode !== 'historical-offline-retailer-quality-bundle' ||
      bundle.assessmentClock !== asOf || bundle.sourceKinds !== 6 ||
      bundle.sourceFactParityVerified !== true ||
      bundle.verifiedOriginalObservations !== 16 ||
      bundle.snapshots !== 6 || bundle.products !== 13 ||
      bundle.observations !== 16 || bundle.historicalOnly !== true ||
      bundle.trustedCurrentPrices !== false ||
      bundle.externalRequests !== 0 || bundle.productionEnabled !== false ||
      bundle.publicSavingsClaimEligible !== false ||
      !bundle.storeQuality ||
      Object.keys(bundle.storeQuality).sort().join(',') !== 'dekamarkt,plus') fail()
  const byStore = {}
  for (const retailer of ['dekamarkt', 'plus']) {
    const stats = bundle.storeQuality[retailer]
    if (!stats || !Object.values(stats).every(finiteCount) ||
        stats.captureKinds !== 3 || stats.snapshots !== 3 ||
        stats.observations < 1) fail()
    byStore[retailer] = Object.freeze({
      archivedSourceKinds: stats.captureKinds,
      archivedSnapshots: stats.snapshots,
      archivedObservations: stats.observations,
      historicalStaleSnapshots: stats.staleSnapshots,
    })
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'supa-m3-offline-evidence-and-rights-attestation',
    assessmentClock: asOf,
    verdict: 'HOLD',
    archivedSixShapeParityVerified: true,
    archivedProductCount: bundle.products,
    archivedObservationCount: bundle.observations,
    archivedSnapshotCount: bundle.snapshots,
    offlineQualityByRetailer: byStore,
    canonicalPermissionPosture: blockedRetailers,
    productionIngestionAuthorized: false,
    publicCurrentPriceClaimsAuthorized: false,
    fieldBasketElevenByTwoVerified: false,
    observedSavingsClaimVerified: false,
    permanentVpsRunnerVerified: false,
    externalRequests: 0,
    containsProductIdentifiersOrPrices: false,
  })
}

export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || (argv.length !== 0 &&
      (argv.length !== 2 || argv[0] !== '--as-of' || typeof argv[1] !== 'string'))) fail()
  const result = await attestM3OfflineReadiness(argv.length ? argv[1] : undefined)
  write(JSON.stringify(result) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(REFUSAL)
    process.exitCode = 2
  })
}
