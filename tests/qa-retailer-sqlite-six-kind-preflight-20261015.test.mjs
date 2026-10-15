import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

// Test a real data gate using only existing locally reviewed six source fixtures.
const cli = new URL('../scripts/qa-retailer-sqlite-six-kind-preflight.py', import.meta.url).pathname
const py = args => spawnSync('python3', args, { encoding: 'utf8', timeout: 25_000, maxBuffer: 1024 * 1024 })
const audit = db => py([cli, '--database', db])
const change = (db, script) => py(['-c',
  'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.executescript(sys.argv[2]); db.commit(); db.close()',
  db, script,
])
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-pilot-gate-'))
  const db = join(dir, 'six-private.db')
  try {
    await buildReviewedRetailerSqlite(db)
    assert.equal((await stat(db)).mode & 0o777, 0o600)
    await fn(db, dir)
  } finally { await rm(dir, { force: true, recursive: true }) }
}
function rejects(output) {
  assert.equal(output.status, 2, output.stderr)
  assert.equal(output.stdout, '', 'untrusted pilot must not emit partial counts')
  assert.match(output.stderr, /^Private retailer six-kind QA preflight refused\s*$/)
  assert.doesNotMatch(output.stderr, /https?:\/\/|\/tmp\/|six-private\.db|FAKE_SECRET/)
}

test('all six real offline retailer kinds pass with immutable counts and source-privacy, without modifying SQLite', () => fixture(async (db, dir) => {
  const original = await readFile(db)
  const outcome = audit(db)
  assert.equal(outcome.status, 0, outcome.stderr)
  const summary = JSON.parse(outcome.stdout)
  assert.deepEqual(summary, {
    mode: 'offline-retailer-six-kind-qa-only', accepted: true,
    sourceKinds: 6, snapshots: 6, products: 13, observations: 16,
    retailerKinds: { dekamarkt: 3, plus: 3 },
    productionEnabled: false, publicSavingsClaimEligible: false,
  })
  assert.deepEqual(await readFile(db), original)
  assert.deepEqual(await readdir(dir), ['six-private.db'])
  assert.doesNotMatch(outcome.stdout, /price|sourceUrl|capturedAt|productName|https?:\/\//i)
}))

test('a missing retailer cannot pass despite two retailer_sources declarations', () => fixture(async db => {
  const changed = change(db, "DELETE FROM price_observations WHERE retailer_id='dekamarkt'; DELETE FROM products WHERE retailer_id='dekamarkt'; DELETE FROM source_snapshots WHERE retailer_id='dekamarkt';")
  assert.equal(changed.status, 0, changed.stderr)
  rejects(audit(db))
}))

test('missing offers snapshots or per-kind price observations are not a complete pilot', () => fixture(async db => {
  const changed = change(db, "DELETE FROM price_observations WHERE snapshot_id IN (SELECT id FROM source_snapshots WHERE kind='offers'); DELETE FROM source_snapshots WHERE kind='offers';")
  assert.equal(changed.status, 0, changed.stderr)
  rejects(audit(db))
}))

test('tampered private rights and public flags cannot be promoted by QA summary', () => fixture(async db => {
  const changed = change(db, "UPDATE retailer_sources SET permission_status='permitted' WHERE retailer_id='plus'; UPDATE metadata SET value='true' WHERE key='public_savings_claim_eligible';")
  assert.equal(changed.status, 0, changed.stderr)
  rejects(audit(db))
}))

test('future capture provenance is refused despite valid source host and digest', () => fixture(async db => {
  const changed = change(db, "UPDATE source_snapshots SET captured_at='2035-01-01T00:00:00Z' WHERE retailer_id='plus';")
  assert.equal(changed.status, 0, changed.stderr)
  rejects(audit(db))
}))

test('broken cross-retailer observation ownership is refused without database modification by reader', () => fixture(async db => {
  const changed = change(db, "PRAGMA foreign_keys=OFF; UPDATE price_observations SET retailer_id='plus' WHERE retailer_id='dekamarkt';")
  // Changing all rows may trip the unique PK; the schema should stop this
  // before the QA gate, or if accepted the gate must refuse.
  if (changed.status === 0) rejects(audit(db))
  else assert.notEqual(changed.status, 0)
}))

test('credential-shaped query parameters are refused even with a valid PLUS HTTPS hostname', () => fixture(async db => {
  const changed = change(db, "UPDATE source_snapshots SET source_url='https://www.plus.nl/producten?access_token=FAKE_SECRET' WHERE retailer_id='plus';")
  assert.equal(changed.status, 0, changed.stderr)
  rejects(audit(db))
}))

test('encoded and mixed-case retailer URL query credentials are rejected without echoing secrets', () => fixture(async db => {
  const changed = change(db, "UPDATE source_snapshots SET source_url='https://www.plus.nl/producten?API%5FKEY=FAKE_SECRET' WHERE retailer_id='plus';")
  assert.equal(changed.status, 0, changed.stderr)
  rejects(audit(db))
}))
