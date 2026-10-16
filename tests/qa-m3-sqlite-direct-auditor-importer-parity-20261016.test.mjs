/**
 * Independent SUPA M3 QA: direct persisted-SQL auditor must not upgrade data
 * rejected by the trusted six-source Python importer into "integrity verified".
 * Frozen product-owned P1 repair #3262 at
 * 08be311155c374e8595a5af7f2a87a01809771a6.
 *
 * Each source is fictional, locally created and disposable. No retailer HTTP,
 * customer records, credentials, license promotion or savings claims.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AUDITOR = resolve(ROOT, 'scripts/retailer-audit-private-sqlite.py')
const SCHEMA = readFileSync(resolve(ROOT, 'schema/retailer-universal-offline.v1.sql'), 'utf8')
const PY_SEED = [
  'import os, sqlite3, sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  "for retailer,host in [('plus','www.plus.nl'),('dekamarkt','www.dekamarkt.nl')]:",
  "  sku=retailer+'-fictional'",
  '  db.execute("INSERT INTO products(retailer_id,source_product_id,display_name,search_name) VALUES (?,?,?,?)", (retailer,sku,"fictional food","fictional food"))',
  "  for kind in ('product','catalog','offers'):",
  '    row=db.execute("INSERT INTO source_snapshots(retailer_id,kind,source_url,captured_at,content_sha256) VALUES (?,?,?,?,?)", (retailer,kind,"https://"+host+"/fictional","2025-01-01T00:00:00Z","a"*64))',
  '    db.execute("INSERT INTO price_observations(snapshot_id,retailer_id,source_product_id,price_cents,currency,pack_unit,availability) VALUES (?,?,?,?,?,?,?)", (row.lastrowid,retailer,sku,123,"EUR","piece","unknown"))',
  'db.commit();db.close()',
  'os.chmod(sys.argv[1], 0o600)',
].join('\n')
const PY_MUTATE = [
  'import sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  'db.commit();db.close()',
].join('\n')
function python(args, input) {
  return spawnSync('python3', args, {
    input, encoding: 'utf8', timeout: 12_000, maxBuffer: 65_536,
  })
}
function sandbox(action) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-qa-sqlite-importer-parity-'))
  const path = join(directory, 'private-history.sqlite')
  try {
    const seeded = python(['-c', PY_SEED, path], SCHEMA)
    assert.equal(seeded.status, 0, seeded.stderr)
    return action(path, directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
function inspect(db, directory, expected) {
  const bytes = readFileSync(db)
  const names = readdirSync(directory)
  const result = python([AUDITOR, '--db', db])
  assert.equal(result.status, expected ? 0 : 2,
    'persisted records rejected by the importer must not be falsely certified')
  if (expected) {
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.databaseIntegrityVerified, true)
    assert.equal(report.releaseDecision, 'hold')
    assert.equal(report.sourceRightsVerified, false)
    assert.equal(report.actualRetailerPricesVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.doesNotMatch(result.stdout, /private-history|fictional|123|https?:\/\//)
  } else {
    assert.equal(result.stdout, '', 'invalid SQL must not yield aggregate success')
    assert.equal(result.stderr,
      'Private historical retailer SQLite audit refused; no data published\n')
    assert.doesNotMatch(result.stderr, /private-history|fictional|Traceback|price_cents/)
  }
  assert.deepEqual(readFileSync(db), bytes, 'audit must never mutate original SQLite bytes')
  assert.deepEqual(readdirSync(directory), names, 'audit must not create WAL/journal or sidecars')
  assert.equal(statSync(db).mode & 0o777, 0o600)
}
function mutate(db, sql) {
  const result = python(['-c', PY_MUTATE, db], sql)
  assert.equal(result.status, 0, result.stderr)
}

test('real local synthetic six-kind SQL positive stays read-only and private HOLD', () =>
  sandbox((db, directory) => inspect(db, directory, true)))

const INVALID = [
  ['unsafe integer current price exceeds direct importer ceiling',
    'UPDATE price_observations SET price_cents=9007199254740992 WHERE retailer_id="plus";'],
  ['unsafe integer offer price exceeds direct importer ceiling',
    'UPDATE price_observations SET offer_price_cents=9007199254740992 WHERE retailer_id="plus";'],
  ['pack quantity exactly at direct importer forbidden upper bound',
    'UPDATE price_observations SET pack_amount=1000000000000 WHERE retailer_id="plus";'],
  ['empty product name refused by importer despite consistent SQL keys',
    'UPDATE products SET display_name="" WHERE retailer_id="plus";'],
  ['noncanonical source product identity remains relationally linked',
    'UPDATE products SET source_product_id="fictional product id" WHERE retailer_id="plus";\n' +
    'UPDATE price_observations SET source_product_id="fictional product id" WHERE retailer_id="plus";'],
]
for (const [name, sql] of INVALID) {
  test('direct historical SQL integrity must refuse importer-invalid persisted value: ' + name + ' [EXPECTED RED]', () =>
    sandbox((db, directory) => {
      mutate(db, sql)
      inspect(db, directory, false)
    }))
}
