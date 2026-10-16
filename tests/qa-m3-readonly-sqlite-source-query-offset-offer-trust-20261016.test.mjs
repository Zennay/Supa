/**
 * Independent SUPA M3 QA 2/2 — directly callable read-only SQLite audit.
 * Frozen product owner #3248 at 861fc060c7e89902500b50377ef7b5002fb1ea18.
 * All SQLite fixtures and mutations are fictional, local and disposable.
 * No retailer network, real secret, customer record, rights or price claim.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AUDIT = resolve(ROOT, 'scripts/retailer-audit-private-sqlite.py')
const SCHEMA = readFileSync(resolve(ROOT, 'schema/retailer-universal-offline.v1.sql'), 'utf8')
const PY_CREATE = [
  'import os, sqlite3, sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript(sys.stdin.read())',
  "for retailer, host in [('plus','www.plus.nl'), ('dekamarkt','www.dekamarkt.nl')]:",
  "  sku=retailer+'-fictional'",
  '  db.execute("INSERT INTO products(retailer_id,source_product_id,display_name,search_name) VALUES (?,?,?,?)", (retailer,sku,"fictional food","fictional food"))',
  "  for kind in ('product','catalog','offers'):",
  '    s=db.execute("INSERT INTO source_snapshots(retailer_id,kind,source_url,captured_at,content_sha256) VALUES (?,?,?,?,?)", (retailer,kind,"https://"+host+"/fictional","2025-01-01T00:00:00Z","a"*64))',
  '    db.execute("INSERT INTO price_observations(snapshot_id,retailer_id,source_product_id,price_cents,currency,pack_unit,availability) VALUES (?,?,?,?,?,?,?)", (s.lastrowid,retailer,sku,123,"EUR","piece","unknown"))',
  'db.commit();db.close()',
  'os.chmod(sys.argv[1],0o600)',
].join('\n')
const PY_EDIT = [
  'import sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.execute(sys.argv[2])',
  'db.commit();db.close()',
].join('\n')
function python(args, input) {
  return spawnSync('python3', args, { input, encoding: 'utf8', timeout: 12000, maxBuffer: 65536 })
}
function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), 'supa-qa-audit-parity-'))
  try {
    const db = join(root, 'reviewed.sqlite')
    const seeded = python(['-c', PY_CREATE, db], SCHEMA)
    assert.equal(seeded.status, 0, seeded.stderr)
    const mutate = sql => {
      const result = python(['-c', PY_EDIT, db, sql])
      assert.equal(result.status, 0, result.stderr)
    }
    const audit = () => python([AUDIT, '--db', db])
    return action({ db, mutate, audit })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function accepted(result) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const data = JSON.parse(result.stdout)
  assert.equal(data.releaseDecision, 'hold')
  assert.equal(data.databaseIntegrityVerified, true)
  assert.equal(data.sourceRightsVerified, false)
  assert.equal(data.actualRetailerPricesVerified, false)
  assert.equal(data.fullBasketFieldComparisonVerified, false)
  assert.equal(data.publicSavingsClaimEligible, false)
  assert.equal(data.productionEnabled, false)
  assert.equal(data.sourceKinds, 6)
  assert.doesNotMatch(result.stdout, /https?:\/\/|fictional|access_token|123|source_url/i)
}
function denied(result) {
  assert.equal(result.status, 2, 'a falsely trusted archive must not produce a passing audit')
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^Private historical retailer SQLite audit refused; no data published\n$/)
  assert.doesNotMatch(result.stderr, /fictional|reviewed\.sqlite|Traceback|access_token|refresh_token/i)
}
function immutable(db, before) {
  assert.deepEqual(readFileSync(db), before, 'read-only audit must never alter database bytes')
  assert.equal(statSync(db).mode & 0o777, 0o600)
}
test('standalone M3 SQLite audit preserves authentic six synthetic source kinds and denies publication', () =>
  fixture(({ db, audit }) => {
    const before = readFileSync(db)
    accepted(audit())
    immutable(db, before)
  }))
test('standalone M3 SQLite audit accepts benign fictional review query and remains HOLD', () =>
  fixture(({ db, mutate, audit }) => {
    mutate("UPDATE source_snapshots SET source_url='https://www.plus.nl/fictional?campaign=historical_QA' WHERE retailer_id='plus' AND kind='product'")
    const before = readFileSync(db)
    accepted(audit())
    immutable(db, before)
  }))
for (const [name, key] of [
  ['refresh_token', 'refresh_token'],
  ['mixed-case ID_TOKEN', 'Id_ToKeN'],
  ['CLIENT_SECRET', 'CLIENT_SECRET'],
  ['leftover percent-encoded token component', '%61ccess_token'],
]) {
  test('standalone M3 SQLite audit must reject previously forbidden source credential alias: ' + name + ' [EXPECTED RED]', () =>
    fixture(({ db, mutate, audit }) => {
      const url = 'https://www.plus.nl/fictional?' + key + '=FICTIONAL_QA'
      mutate("UPDATE source_snapshots SET source_url='" + url + "' WHERE retailer_id='plus' AND kind='offers'")
      const before = readFileSync(db)
      denied(audit())
      immutable(db, before)
    }))
}
for (const [name, captured] of [
  ['UTC-offset beyond 14 hours', '2025-01-01T00:00:00+15:00'],
  ['14-hour-plus-one-minute UTC-offset', '2025-01-01T00:00:00+14:01'],
]) {
  test('standalone M3 SQLite audit rejects impossible source timezone: ' + name + ' [EXPECTED RED]', () =>
    fixture(({ db, mutate, audit }) => {
      mutate("UPDATE source_snapshots SET captured_at='" + captured + "' WHERE retailer_id='plus' AND kind='product'")
      const before = readFileSync(db)
      denied(audit())
      immutable(db, before)
    }))
}
test('standalone M3 SQLite audit refuses physical one-nanosecond reversed offer window [EXPECTED RED]', () =>
  fixture(({ db, mutate, audit }) => {
    mutate("UPDATE price_observations SET offer_label='FICTIONAL_QA', offer_price_cents=111, original_price_cents=222, offer_valid_from='2025-01-01T00:00:00.000000002Z', offer_valid_to='2025-01-01T00:00:00.000000001Z' WHERE retailer_id='plus'")
    const before = readFileSync(db)
    denied(audit())
    immutable(db, before)
  }))
test('standalone M3 SQLite audit preserves historical valid one-nanosecond offer window as HOLD', () =>
  fixture(({ db, mutate, audit }) => {
    mutate("UPDATE price_observations SET offer_label='FICTIONAL_QA', offer_price_cents=111, original_price_cents=222, offer_valid_from='2025-01-01T00:00:00.000000001Z', offer_valid_to='2025-01-01T00:00:00.000000002Z' WHERE retailer_id='plus'")
    const before = readFileSync(db)
    accepted(audit())
    immutable(db, before)
  }))
