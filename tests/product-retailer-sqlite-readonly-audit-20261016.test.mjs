import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const audit = resolve(root, 'scripts/retailer-audit-private-sqlite.py')
const schema = readFileSync(resolve(root, 'schema/retailer-universal-offline.v1.sql'), 'utf8')
const FIXTURE = [
  'import os, sqlite3, sys',
  'db = sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  "for retailer, host in [('plus','www.plus.nl'), ('dekamarkt','www.dekamarkt.nl')]:",
  "    sku = retailer + '-fake-sku'",
  '    db.execute("INSERT INTO products (retailer_id,source_product_id,display_name,search_name) VALUES (?,?,?,?)",',
  "               (retailer,sku,'synthetic product','synthetic product'))",
  "    for kind in ('product','catalog','offers'):",
  '        cursor = db.execute("INSERT INTO source_snapshots (retailer_id,kind,source_url,captured_at,content_sha256) VALUES (?,?,?,?,?)",',
  "                            (retailer,kind,'https://' + host + '/fictional','2025-01-01T00:00:00Z','a'*64))",
  '        db.execute("INSERT INTO price_observations (snapshot_id,retailer_id,source_product_id,price_cents,currency,pack_unit,availability) VALUES (?,?,?,?,?,?,?)",',
  "                   (cursor.lastrowid,retailer,sku,123,'EUR','piece','unknown'))",
  'db.commit()',
  'db.close()',
  'os.chmod(sys.argv[1], 0o600)',
].join('\n')
function run(args) {
  return spawnSync('python3', [audit, ...args], { encoding: 'utf8', timeout: 10_000 })
}
function makeDatabase(directory) {
  const db = join(directory, 'reviewed.db')
  const seeded = spawnSync('python3', ['-c', FIXTURE, db], {
    input: schema, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(seeded.status, 0, seeded.stderr)
  return db
}
function edit(db, sql) {
  const cmd = [
    'import sqlite3,sys',
    'db=sqlite3.connect(sys.argv[1])',
    'db.execute(sys.argv[2])',
    'db.commit()',
    'db.close()',
  ].join('\n')
  const updated = spawnSync('python3', ['-c', cmd, db, sql], {
    encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(updated.status, 0, updated.stderr)
}
function scoped(action) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-m3-private-db-audit-'))
  try { return action(directory, makeDatabase(directory)) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}
function denied(result) {
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^Private historical retailer SQLite audit refused; no data published\n$/)
  assert.doesNotMatch(result.stderr, /reviewed\.db|fictional|123|Traceback|SQLite format/)
}

test('real persisted synthetic six-shape historical database gets only aggregate private HOLD', () => scoped((directory, db) => {
  const before = readFileSync(db)
  const files = readdirSync(directory)
  const result = run(['--db', db])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const data = JSON.parse(result.stdout)
  assert.deepEqual({
    retailers: data.retailers,
    shapes: data.sourceKinds,
    products: data.products,
    observations: data.historicalObservations,
  }, { retailers: 2, shapes: 6, products: 2, observations: 6 })
  assert.equal(data.databaseIntegrityVerified, true)
  assert.equal(data.releaseDecision, 'hold')
  for (const key of [
    'sourceRightsVerified', 'actualRetailerPricesVerified',
    'fullBasketFieldComparisonVerified', 'publicSavingsClaimEligible', 'productionEnabled',
  ]) assert.equal(data[key], false)
  assert.doesNotMatch(result.stdout, /123|synthetic|fictional|http|reviewed\.db|capturedAt/)
  assert.deepEqual(readFileSync(db), before)
  assert.deepEqual(readdirSync(directory), files)
  assert.equal(statSync(db).mode & 0o777, 0o600)
}))

test('permission and production-claim metadata cannot be promoted by offline audit', () => scoped((_, db) => {
  edit(db, "UPDATE metadata SET value='true' WHERE key='production_enabled'")
  denied(run(['--db', db]))
}))

test('an incorrectly promoted retailer permission status is refused', () => scoped((_, db) => {
  edit(db, "UPDATE retailer_sources SET permission_status='permitted' WHERE retailer_id='plus'")
  denied(run(['--db', db]))
}))

test('matching foreign keys do not hide observations attributed to the wrong retailer', () => scoped((_, db) => {
  edit(db, "UPDATE price_observations SET snapshot_id=(SELECT id FROM source_snapshots WHERE retailer_id='dekamarkt' AND kind='product') WHERE retailer_id='plus' AND snapshot_id=(SELECT id FROM source_snapshots WHERE retailer_id='plus' AND kind='product')")
  denied(run(['--db', db]))
}))

test('a missing sixth historical source kind is not a complete six-store-shape batch', () => scoped((_, db) => {
  edit(db, "DELETE FROM source_snapshots WHERE retailer_id='plus' AND kind='offers'")
  denied(run(['--db', db]))
}))

test('symbolic links, unsafe permissions, corrupted SQLite and bad argv fail closed with no output', () => scoped((directory, db) => {
  const alias = join(directory, 'alias.db')
  symlinkSync(db, alias)
  denied(run(['--db', alias]))
  denied(run(['--db', join(directory, 'nonexistent.db')]))
  denied(run(['--db', db, '--extra']))
  denied(run(['--db', db.replace('reviewed.db', 'bad\nname.db')]))
  chmodSync(db, 0o644)
  denied(run(['--db', db]))
  chmodSync(db, 0o600)
  const corrupt = join(directory, 'corrupt.db')
  writeFileSync(corrupt, 'not a database', { mode: 0o600 })
  denied(run(['--db', corrupt]))
}))
