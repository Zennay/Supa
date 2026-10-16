/**
 * Supplementary independent QA: SQLite dynamic type affinity must not turn
 * non-canonical monetary/pack values into an integrity-verified archive.
 * Parent QA #3265's original five authentic RED tests remain byte-unchanged.
 * Frozen product #3262 SHA 08be311155c374e8595a5af7f2a87a01809771a6.
 *
 * Disposable synthetic private historical SQLite only; zero retailer HTTP.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AUDIT = resolve(ROOT, 'scripts/retailer-audit-private-sqlite.py')
const SQL = readFileSync(resolve(ROOT, 'schema/retailer-universal-offline.v1.sql'), 'utf8')
const SEED = [
  'import os,sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  "for retailer,host in [('plus','www.plus.nl'),('dekamarkt','www.dekamarkt.nl')]:",
  "  p=retailer+'-fictional'",
  "  db.execute('INSERT INTO products(retailer_id,source_product_id,display_name,search_name) VALUES (?,?,?,?)',(retailer,p,'fictional food','fictional food'))",
  "  for kind in ('catalog','offers','product'):",
  "    s=db.execute('INSERT INTO source_snapshots(retailer_id,kind,source_url,captured_at,content_sha256) VALUES (?,?,?,?,?)',(retailer,kind,'https://'+host+'/fictional','2025-01-01T00:00:00Z','a'*64))",
  "    db.execute('INSERT INTO price_observations(snapshot_id,retailer_id,source_product_id,price_cents,currency,pack_amount,pack_unit,availability) VALUES (?,?,?,?,?,?,?,?)',(s.lastrowid,retailer,p,123,'EUR',250,'g','unknown'))",
  'db.commit(); db.close()',
  'os.chmod(sys.argv[1],0o600)',
].join('\n')
const EDIT = [
  'import sqlite3,sys',
  'c=sqlite3.connect(sys.argv[1])',
  'c.execute(sys.argv[2])',
  'c.commit();c.close()',
].join('\n')
function python(args, input) {
  return spawnSync('python3', args,
    { input, encoding: 'utf8', timeout: 12_000, maxBuffer: 65_536 })
}
function fixture(action) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-qa-affinity-'))
  try {
    const db = join(directory, 'fictional-private.sqlite')
    const seeded = python(['-c', SEED, db], SQL)
    assert.equal(seeded.status, 0, seeded.stderr)
    return action(directory, db)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
function evaluate(folder, db, allowed) {
  const original = readFileSync(db)
  const entries = readdirSync(folder)
  const result = python([AUDIT, '--db', db])
  assert.equal(result.status, allowed ? 0 : 2,
    'read-only auditor may only certify persisted canonical integer money and numeric packs')
  if (allowed) {
    const report = JSON.parse(result.stdout)
    assert.equal(report.databaseIntegrityVerified, true)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.releaseDecision, 'hold')
    assert.equal(result.stderr, '')
  } else {
    assert.equal(result.stdout, '')
    assert.equal(result.stderr,
      'Private historical retailer SQLite audit refused; no data published\n')
  }
  assert.deepEqual(readFileSync(db), original)
  assert.deepEqual(readdirSync(folder), entries)
  assert.equal(statSync(db).mode & 0o777, 0o600)
}
test('SQLite affinity positive: canonical integer cents and numeric grams retain private HOLD', () =>
  fixture((folder, db) => evaluate(folder, db, true)))

for (const [name, sql] of [
  ['fractional current cents (SQLite REAL) must not count as canonical money',
    'UPDATE price_observations SET price_cents=123.5 WHERE retailer_id="plus"'],
  ['fractional original cents (SQLite REAL) must not count as canonical money',
    'UPDATE price_observations SET original_price_cents=245.25 WHERE retailer_id="plus"'],
  ['text stored in numeric pack field must not count as a physical quantity',
    "UPDATE price_observations SET pack_amount='fictional-grams' WHERE retailer_id='plus'"],
]) {
  test('standalone historic SQL audit rejects SQLite affinity escape: ' + name + ' [EXPECTED RED]', () =>
    fixture((folder, db) => {
      const edited = python(['-c', EDIT, db, sql])
      assert.equal(edited.status, 0, 'SQLite must physically allow the mutation for a valid trust-gap test: ' + edited.stderr)
      evaluate(folder, db, false)
    }))
}
