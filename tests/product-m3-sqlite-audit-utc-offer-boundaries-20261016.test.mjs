/**
 * Product-owned acceptance around the immutable QA #3256 RED→GREEN replay.
 * Only fictional historical local SQLite data; never calls retailer endpoints.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const script = resolve(root, 'scripts/retailer-audit-private-sqlite.py')
const schema = readFileSync(resolve(root, 'schema/retailer-universal-offline.v1.sql'), 'utf8')
const seed = [
  'import os,sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  "for retailer,host in [('plus','www.plus.nl'),('dekamarkt','www.dekamarkt.nl')]:",
  "  sku=retailer+'-fictional'",
  "  db.execute('INSERT INTO products(retailer_id,source_product_id,display_name,search_name) VALUES (?,?,?,?)',(retailer,sku,'fictional food','fictional food'))",
  "  for kind in ('product','catalog','offers'):",
  "    row=db.execute('INSERT INTO source_snapshots(retailer_id,kind,source_url,captured_at,content_sha256) VALUES (?,?,?,?,?)',(retailer,kind,'https://'+host+'/fictional','2025-01-01T00:00:00Z','a'*64))",
  "    db.execute('INSERT INTO price_observations(snapshot_id,retailer_id,source_product_id,price_cents,currency,pack_unit,availability) VALUES (?,?,?,?,?,?,?)',(row.lastrowid,retailer,sku,123,'EUR','piece','unknown'))",
  'db.commit();db.close()',
  'os.chmod(sys.argv[1],0o600)',
].join('\n')
function python(args, input) {
  return spawnSync('python3', args, { input, encoding: 'utf8', timeout: 12000 })
}
function fixture(action) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-private-audit-product-edge-'))
  try {
    const db = join(dir, 'fictional.sqlite')
    const setup = python(['-c', seed, db], schema)
    assert.equal(setup.status, 0, setup.stderr)
    const edit = sql => {
      const changed = python(['-c', [
        'import sqlite3,sys',
        'db=sqlite3.connect(sys.argv[1])',
        'db.execute(sys.argv[2])',
        'db.commit();db.close()',
      ].join('\n'), db, sql])
      assert.equal(changed.status, 0, changed.stderr)
    }
    const audit = () => python([script, '--db', db])
    return action({ db, dir, edit, audit })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
function verify(result, accepted) {
  assert.equal(result.status, accepted ? 0 : 2, result.stderr)
  if (accepted) {
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.releaseDecision, 'hold')
    assert.equal(report.productionEnabled, false)
    assert.equal(report.sourceRightsVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.databaseIntegrityVerified, true)
    assert.doesNotMatch(result.stdout, /fictional|123|www\.plus|https?:\/\//)
  } else {
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'Private historical retailer SQLite audit refused; no data published\n')
  }
}
const captured = [
  ['maximum allowed +14:00 offset', '2025-01-01T00:00:00+14:00', true],
  ['maximum allowed -14:00 offset', '2025-01-01T00:00:00-14:00', true],
  ['outside allowed -14:01', '2025-01-01T00:00:00-14:01', false],
  ['impossible Gregorian day', '2025-02-29T00:00:00Z', false],
  ['year-one timezone UTC overflow must refuse generically', '0001-01-01T00:00:00+14:00', false],
]
for (const [label, clock, allowed] of captured) {
  test('standalone SQLite source clock: ' + label, () => fixture(({ db, dir, edit, audit }) => {
    edit("UPDATE source_snapshots SET captured_at='" + clock + "' WHERE retailer_id='plus' AND kind='product'")
    const before = readFileSync(db)
    const names = readdirSync(dir)
    verify(audit(), allowed)
    assert.deepEqual(readFileSync(db), before)
    assert.deepEqual(readdirSync(dir), names)
    assert.equal(statSync(db).mode & 0o777, 0o600)
  }))
}
const offerCases = [
  ['same physical 1ns instant at UTC and +02', '2025-01-01T08:00:00.000000001Z',
    '2025-01-01T10:00:00.000000001+02:00', true],
  ['reversed 1ns across +02 and UTC', '2025-01-01T10:00:00.000000002+02:00',
    '2025-01-01T08:00:00.000000001Z', false],
  ['open ended historical offer', '2025-01-01T08:00:00Z', null, true],
  ['unknown start with historical end', null, '2025-01-01T08:00:00Z', true],
  ['future dated historical offer', '2099-01-01T00:00:00Z', null, false],
  ['impossible date in offer', '2025-02-29T00:00:00Z', null, false],
  ['offer with offset beyond 14 hours', '2025-01-01T00:00:00+15:00', null, false],
]
for (const [label, from, to, allowed] of offerCases) {
  test('standalone SQLite persisted offer: ' + label, () => fixture(({ db, dir, edit, audit }) => {
    const sqlValue = value => value === null ? 'NULL' : "'" + value + "'"
    edit("UPDATE price_observations SET offer_valid_from=" + sqlValue(from) +
      ",offer_valid_to=" + sqlValue(to) + " WHERE retailer_id='plus'")
    const before = readFileSync(db)
    const names = readdirSync(dir)
    verify(audit(), allowed)
    assert.deepEqual(readFileSync(db), before)
    assert.deepEqual(readdirSync(dir), names)
  }))
}
