/**
 * Product-owner regression for #3266/#3267: a physical SQLite archive can
 * bypass importer validation through direct writes and affinity conversions.
 * Synthetic 6-shape private data only; NO retailer traffic or customer data.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AUDITOR = resolve(ROOT, 'scripts/retailer-audit-private-sqlite.py')
const SCHEMA = readFileSync(resolve(ROOT, 'schema/retailer-universal-offline.v1.sql'), 'utf8')
const SEED = [
  'import os,sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  "for retailer,host in [('plus','www.plus.nl'),('dekamarkt','www.dekamarkt.nl')]:",
  "  product=retailer+'-imaginary'",
  "  db.execute('INSERT INTO products(retailer_id,source_product_id,display_name,search_name) VALUES (?,?,?,?)',(retailer,product,'imaginary rice','imaginary rice'))",
  "  for kind in ('catalog','offers','product'):",
  "    row=db.execute('INSERT INTO source_snapshots(retailer_id,kind,source_url,captured_at,content_sha256) VALUES (?,?,?,?,?)',(retailer,kind,'https://'+host+'/fiction','2025-01-01T00:00:00Z','a'*64))",
  "    db.execute('INSERT INTO price_observations(snapshot_id,retailer_id,source_product_id,price_cents,currency,pack_amount,pack_unit,availability) VALUES (?,?,?,?,?,?,?,?)',(row.lastrowid,retailer,product,123,'EUR',250,'g','unknown'))",
  'db.commit();db.close()',
  'os.chmod(sys.argv[1],0o600)',
].join('\n')
const MUTATE = [
  'import sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  'db.commit();db.close()',
].join('\n')
const python = (args, input) => spawnSync('python3', args, {
  input, encoding: 'utf8', maxBuffer: 65536, timeout: 15000,
})
function withFixture(action) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-audit-fact-parity-'))
  const db = join(directory, 'fictional.sqlite')
  try {
    const seed = python(['-c', SEED, db], SCHEMA)
    assert.equal(seed.status, 0, seed.stderr)
    action(directory, db)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
function checkAudit(directory, db, shouldPass) {
  const original = readFileSync(db)
  const files = readdirSync(directory)
  const result = python([AUDITOR, '--db', db])
  assert.equal(result.status, shouldPass ? 0 : 2,
    'direct audit must share the importer canonical trust boundary')
  if (shouldPass) {
    const report = JSON.parse(result.stdout)
    assert.equal(report.databaseIntegrityVerified, true)
    assert.equal(report.releaseDecision, 'hold')
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(result.stderr, '')
  } else {
    assert.equal(result.stdout, '')
    assert.equal(result.stderr,
      'Private historical retailer SQLite audit refused; no data published\n')
  }
  assert.deepEqual(readFileSync(db), original)
  assert.deepEqual(readdirSync(directory), files)
  assert.equal(statSync(db).mode & 0o777, 0o600)
}
test('canonical historical six-source SQL remains verified as PRIVATE HOLD', () =>
  withFixture((directory, db) => checkAudit(directory, db, true)))

for (const [name, mutation] of [
  ['fractional REAL current cents', "UPDATE price_observations SET price_cents=123.5 WHERE retailer_id='plus';"],
  ['unsafe INTEGER current cents', "UPDATE price_observations SET price_cents=9007199254740992 WHERE retailer_id='plus';"],
  ['unsafe INTEGER offer cents', "UPDATE price_observations SET offer_price_cents=9007199254740992 WHERE retailer_id='plus';"],
  ['fractional REAL original offer cents', "UPDATE price_observations SET original_price_cents=245.25 WHERE retailer_id='plus';"],
  ['TEXT amount through SQLite REAL affinity', "UPDATE price_observations SET pack_amount='imaginary-grams' WHERE retailer_id='plus';"],
  ['pack upper boundary 1e12', "UPDATE price_observations SET pack_amount=1000000000000 WHERE retailer_id='plus';"],
  ['empty product title', "UPDATE products SET display_name='' WHERE retailer_id='plus';"],
  ['noncanonical relational product ID',
    "UPDATE products SET source_product_id='imaginary product id' WHERE retailer_id='plus';\n" +
    "UPDATE price_observations SET source_product_id='imaginary product id' WHERE retailer_id='plus';"],
  ['wrong search name despite valid display', "UPDATE products SET search_name='unrelated label' WHERE retailer_id='plus';"],
  ['oversized offer label', "UPDATE price_observations SET offer_label='" + 'q'.repeat(1025) + "' WHERE retailer_id='plus';"],
  ['oversized pack source text', "UPDATE price_observations SET pack_text='" + 'p'.repeat(257) + "' WHERE retailer_id='plus';"],
]) {
  test('direct SQLite auditor refuses persisted importer-invalid ' + name, () =>
    withFixture((directory, db) => {
      const mutationResult = python(['-c', MUTATE, db], mutation)
      assert.equal(mutationResult.status, 0, mutationResult.stderr)
      checkAudit(directory, db, false)
    }))
}
