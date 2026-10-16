/**
 * One command: six independently reviewed historical retailer snapshots ->
 * six strict source adapters -> universal, provenance-preserving SQLite.
 *
 * No HTTP, browser, proxy or retail permission promotion. Does not expose
 * captured prices or raw product evidence in CLI output.
 */
import { mkdtemp, writeFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { snapshotBoundedPrivateCatalogInput } from './retailer-private-budgeted-catalog.mjs'
import { assessHistoricalM3FullBasketReadiness } from './retailer-private-m3-full-basket-preflight.mjs'

const IMPORTER = fileURLToPath(new URL('./retailer-import-universal-sqlite.py', import.meta.url))

function refuse() {
  throw new Error('Historical reviewed retailer import refused; no live prices or public claims generated')
}
async function verifyNewFileTarget(path) {
  // The exported JS API receives caller strings directly. Reject invalid
  // filesystem characters before resolve/lstat: Node's native path errors
  // can otherwise echo the attempted private destination in a TypeError.
  // Fail closed on other OS errors too; never propagate their path detail.
  if (typeof path !== 'string' || !path.trim() || path.startsWith('-') ||
      path.length > 4096 || /[\u0000-\u001f\u007f]/u.test(path)) refuse()
  let target
  try { target = resolve(path) } catch { refuse() }
  let parent = target
  while (true) {
    try {
      const info = await lstat(parent)
      if (info.isSymbolicLink()) refuse()
      if (parent === target) refuse()
    } catch (error) {
      if (error?.code !== 'ENOENT') refuse()
    }
    const next = dirname(parent)
    if (next === parent) break
    parent = next
  }
  return target
}

export async function buildReviewedRetailerSqlite(outputPath) {
  const target = await verifyNewFileTarget(outputPath)
  const batch = await loadReviewedRepositoryFixtures()
  if (batch?.summary?.productionEnabled !== false ||
      batch?.summary?.permissionVerified !== false ||
      batch?.summary?.publicSavingsClaimEligible !== false ||
      batch?.summary?.sources !== 6 || batch?.summary?.rejectedSources !== 0) refuse()

  // Check the *complete* historical six-adapter → catalog → exact 11×2
  // full-basket review route before creating any private database files.
  // This never verifies actual shop prices, basket equivalence or source
  // rights and cannot promote any archived capture to a public product.
  let preflight
  try { preflight = assessHistoricalM3FullBasketReadiness(batch) }
  catch { refuse() }
  if (preflight.releaseDecision !== 'hold' ||
      preflight.canonicalPlannerNeeds !== 11 ||
      preflight.twoStoreReviewRows !== 22 ||
      preflight.observationCount !== batch.summary.observations ||
      preflight.retailerReuseRightsVerified !== false ||
      preflight.fullBasketFieldComparisonVerified !== false ||
      preflight.publicSavingsClaimEligible !== false) refuse()
  const temporary = await mkdtemp(join(tmpdir(), 'supa-offline-retailer-db-'))
  try {
    const input = join(temporary, 'reviewed-adapter-output.json')
    await writeFile(input, JSON.stringify(batch), { mode: 0o600, flag: 'wx' })
    const result = spawnSync('python3', [
      IMPORTER, '--input', input, '--out', target,
    ], { timeout: 30_000, encoding: 'utf8', maxBuffer: 64 * 1024 })
    if (result.status !== 0) refuse()
    let stats
    try { stats = JSON.parse(result.stdout) } catch { refuse() }
    if (stats?.created !== true || stats?.productionEnabled !== false ||
        stats?.publicSavingsClaimEligible !== false ||
        stats?.snapshots !== 6 || stats?.observations !== batch.summary.observations) refuse()
    return {
      mode: 'historical-reviewed-fixtures-to-private-sqlite',
      sources: batch.summary.sources, observations: stats.observations,
      products: stats.products, snapshots: stats.snapshots,
      databaseCreated: true, externalNetworkUsed: false,
      historicalOnly: true, productionEnabled: false,
      canonicalPlannerNeeds: preflight.canonicalPlannerNeeds,
      twoStoreReviewRows: preflight.twoStoreReviewRows,
      fullBasketFieldComparisonVerified: false,
      publicSavingsClaimEligible: false,
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
export async function main(argv = process.argv.slice(2)) {
  // Direct in-process callers must not make us execute argv Proxy/getters
  // before the offline path and source checks. No write on refused args.
  let args
  try { args = snapshotBoundedPrivateCatalogInput(argv) } catch { refuse() }
  if (!Array.isArray(args) || args.length !== 2 ||
      args[0] !== '--out' || typeof args[1] !== 'string') refuse()
  const summary = await buildReviewedRetailerSqlite(args[1])
  console.log(JSON.stringify(summary))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Historical reviewed retailer database build refused; nothing published')
    process.exitCode = 1
  })
}
