import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

const importer = new URL('../scripts/retailer-import-universal-sqlite.py', import.meta.url).pathname
const py = args => spawnSync('python3', args, { encoding: 'utf8', timeout: 20_000 })
async function sandbox(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-p1-e2e-'))
  try { return await fn(dir) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
function query(db, sql) {
  const code = 'import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute(sys.argv[2]).fetchall()))'
  const result = py(['-c', code, db, sql])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('real six reviewed offline PLUS/Deka fixtures round-trip from adapter to normalized catalog and private SQLite', async () => sandbox(async dir => {
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(batch.summary.acceptedSources, 6)
  assert.equal(batch.summary.rejectedSources, 0)
  const universal = buildUniversalRetailerCatalog(batch)
  const before = JSON.stringify(batch)
  const input = join(dir, 'real-reviewed-batch.json')
  const db = join(dir, 'real-reviewed.sqlite')
  await writeFile(input, before, { mode: 0o600, flag: 'wx' })
  const imported = py([importer, '--input', input, '--out', db])
  assert.equal(imported.status, 0, 'actual six bundled fixtures must import or the adapter→database bridge is not functional: ' + imported.stderr)
  const summary = JSON.parse(imported.stdout)
  assert.equal(summary.created, true)
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.products, universal.productCount)
  assert.equal(summary.observations, batch.summary.observations)
  assert.equal(summary.observations, universal.captureCount)
  assert.equal(query(db, 'SELECT COUNT(*) FROM products')[0][0], universal.productCount)
  assert.equal(query(db, 'SELECT COUNT(*) FROM price_observations')[0][0], universal.captureCount)
  assert.equal(query(db, 'SELECT COUNT(*) FROM source_snapshots')[0][0], 6)
  assert.equal(query(db, 'SELECT COUNT(*) FROM source_snapshots WHERE retailer_id IN ("plus","dekamarkt")')[0][0], 6)
  assert.deepEqual(query(db, 'SELECT DISTINCT retailer_id FROM products ORDER BY retailer_id'), [['dekamarkt'], ['plus']])
  assert.deepEqual(query(db, 'SELECT value FROM metadata WHERE key="production_enabled"'), [['false']])
  assert.equal((await stat(db)).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(batch), before, 'database conversion must not mutate source observations')
  assert.ok(universal.products.every(p => !p.publishable && p.currentTrustedPriceCents === null))
}))

test('real reviewed batch with a revoked acceptance cannot produce a partial misleading database', async () => sandbox(async dir => {
  const batch = await loadReviewedRepositoryFixtures()
  batch.results[0].accepted = false
  const input = join(dir, 'revoked-batch.json')
  const db = join(dir, 'must-not-exist.sqlite')
  await writeFile(input, JSON.stringify(batch), { mode: 0o600 })
  const output = py([importer, '--input', input, '--out', db])
  assert.notEqual(output.status, 0)
  await assert.rejects(stat(db), { code: 'ENOENT' })
}))
