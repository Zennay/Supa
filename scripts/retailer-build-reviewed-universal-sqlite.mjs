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

const IMPORTER = fileURLToPath(new URL('./retailer-import-universal-sqlite.py', import.meta.url))

function refuse() {
  throw new Error('Historical reviewed retailer import refused; no live prices or public claims generated')
}
async function verifyNewFileTarget(path) {
  if (typeof path !== 'string' || !path.trim() || path.startsWith('-')) refuse()
  const target = resolve(path)
  let parent = target
  while (true) {
    try {
      const info = await lstat(parent)
      if (info.isSymbolicLink()) refuse()
      if (parent === target) refuse()
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
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
      publicSavingsClaimEligible: false,
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--out') refuse()
  const summary = await buildReviewedRetailerSqlite(argv[1])
  console.log(JSON.stringify(summary))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Historical reviewed retailer database build refused; nothing published')
    process.exitCode = 1
  })
}
