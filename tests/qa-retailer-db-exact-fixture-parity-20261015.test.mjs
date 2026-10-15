import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'
import { checkReviewedSqliteExactParity, main } from '../scripts/qa-retailer-reviewed-db-exact-parity.mjs'

const cli = new URL('../scripts/qa-retailer-reviewed-db-exact-parity.mjs', import.meta.url).pathname
const py = (database, sql) => spawnSync('python3', [
  '-c',
  'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.executescript(sys.argv[2]);c.commit();c.close()',
  database, sql,
], { encoding: 'utf8', timeout: 10000 })
const run = path => spawnSync(process.execPath,
  ['--experimental-strip-types', cli, '--database', path],
  { encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 })

async function privateDb(fn) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-private-parity-'))
  const database = join(folder, 'reviewed.sqlite')
  try {
    const built = await buildReviewedRetailerSqlite(database)
    assert.equal(built.snapshots, 6)
    assert.equal(built.observations, 16)
    assert.equal((await stat(database)).mode & 0o777, 0o600)
    await fn({ folder, database })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}
function assertDenied(outcome) {
  assert.equal(outcome.status, 2, outcome.stderr)
  assert.equal(outcome.stdout, '')
  assert.match(outcome.stderr, /^Private historical retailer source\/SQLite parity refused\s*$/)
  assert.doesNotMatch(outcome.stderr, /https?:\/\/|\\/tmp\\/|Zuivelmeester|price_cents|source_product_id/i)
}

test('exact historical PLUS and DekaMarkt source facts survive adapter -> SQLite without promotion or mutation', () =>
  privateDb(async ({ database }) => {
    const original = await readFile(database)
    const summary = await checkReviewedSqliteExactParity(database)
    assert.deepEqual(summary, {
      mode: 'private-historical-retailer-source-parity-qa',
      matchesOriginalFixtures: true,
      capturedSources: 6,
      retailerCount: 2,
      verifiedObservations: 16,
      historicalOnly: true,
      productionEnabled: false,
      publicSavingsClaimEligible: false,
    })
    const chunks = []
    assert.deepEqual(await main(['--database', database], text => chunks.push(text)), summary)
    assert.deepEqual(JSON.parse(chunks.join('')), summary)
    const result = run(database)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), summary)
    assert.doesNotMatch(result.stdout, /https?:\/\/|Zuivelmeester|dekamarkt.nl|sourceProductId|price|sha256|offer_label/i)
    assert.deepEqual(await readFile(database), original, 'attestation must be read-only')
  }))

test('valid-format forged snapshot SHA fails exact-content provenance despite the six-kind count remaining intact', () =>
  privateDb(async ({ database }) => {
    const modified = py(database, "UPDATE source_snapshots SET content_sha256=lower(hex(zeroblob(32))) WHERE kind='offers' AND retailer_id='plus';")
    assert.equal(modified.status, 0, modified.stderr)
    assertDenied(run(database))
  }))

test('tampered historical cents/availability fail exact source-fact parity without public data output', () =>
  privateDb(async ({ database }) => {
    const modified = py(database, "UPDATE price_observations SET price_cents=price_cents+1, availability='unknown' WHERE retailer_id='dekamarkt' AND price_cents IS NOT NULL;")
    assert.equal(modified.status, 0, modified.stderr)
    assertDenied(run(database))
  }))

test('missing observation row cannot masquerade as a full six-source parity proof', () =>
  privateDb(async ({ database }) => {
    const modified = py(database, 'DELETE FROM price_observations WHERE rowid = (SELECT min(rowid) FROM price_observations);')
    assert.equal(modified.status, 0, modified.stderr)
    assertDenied(run(database))
  }))

test('symlinked DB and non-private database reject before opening or returning evidence', () =>
  privateDb(async ({ database, folder }) => {
    const link = join(folder, 'alias.sqlite')
    await symlink(database, link)
    assertDenied(run(link))
    const out = run(database + '-missing')
    assertDenied(out)
  }))
