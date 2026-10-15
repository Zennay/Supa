import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

const cli = new URL('../scripts/qa-retailer-sqlite-six-kind-preflight.py', import.meta.url).pathname
const run = database => spawnSync('python3', [cli, '--database', database], {
  encoding: 'utf8', timeout: 20000, maxBuffer: 128 * 1024,
})
const change = (database, sql) => spawnSync('python3', [
  '-c', 'import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);db.executescript(sys.argv[2]);db.commit();db.close()',
  database, sql,
], { encoding: 'utf8', timeout: 15000 })

async function pilot(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-physical-money-'))
  const db = join(dir, 'private.sqlite')
  try {
    const imported = await buildReviewedRetailerSqlite(db)
    assert.equal(imported.snapshots, 6)
    assert.equal(imported.products, 13)
    assert.equal(imported.observations, 16)
    assert.equal((await stat(db)).mode & 0o777, 0o600)
    await fn(db)
  } finally { await rm(dir, { recursive: true, force: true }) }
}
function refused(result) {
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stdout, '', 'bad historical facts cannot emit even a partial quality summary')
  assert.match(result.stderr, /^Private retailer six-kind QA preflight refused\s*$/)
  assert.doesNotMatch(result.stderr, /https?:\/\/|Zuivelmeester|private\.sqlite|9007199254740992|supa-physical-money-/)
}

test('historical PLUS and DekaMarkt current adapter SQLite values remain admitted with private-only flags', () =>
  pilot(async db => {
    const result = run(db)
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.snapshots, 6)
    assert.equal(report.products, 13)
    assert.equal(report.observations, 16)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.doesNotMatch(result.stdout, /price_cents|offer_price_cents|Zuivelmeester|https?:\/\//)
  }))

test('tampered persisted money, packs and offer chronology cannot pass six-kind preflight', async t => {
  const cases = [
    ['unsafe current integer cents', 'UPDATE price_observations SET price_cents=9007199254740992 WHERE price_cents IS NOT NULL;'],
    ['unsafe discounted integer cents', 'UPDATE price_observations SET offer_price_cents=9007199254740992 WHERE offer_label IS NOT NULL;'],
    ['unsafe original integer cents', 'UPDATE price_observations SET original_price_cents=9007199254740992 WHERE offer_label IS NOT NULL;'],
    ['unbounded finite package amount', 'UPDATE price_observations SET pack_amount=1e99 WHERE pack_amount IS NOT NULL;'],
    ['unbounded raw package label', "UPDATE price_observations SET pack_text='" + 'X'.repeat(300) + "' WHERE pack_text IS NOT NULL;"],
    ['invalid calendar day in offer validity', "UPDATE price_observations SET offer_valid_from='2026-02-30T12:00:00Z' WHERE offer_label IS NOT NULL;"],
    ['reversed historical offer window', "UPDATE price_observations SET offer_valid_from='2026-10-09T12:00:00Z',offer_valid_to='2026-10-01T12:00:00Z' WHERE offer_label IS NOT NULL;"],
    ['money without offer identity', "UPDATE price_observations SET offer_label=NULL WHERE offer_price_cents IS NOT NULL;"],
  ]
  for (const [label, mutation] of cases) {
    await t.test(label, () => pilot(async db => {
      const edited = change(db, mutation)
      assert.equal(edited.status, 0, edited.stderr)
      refused(run(db))
    }))
  }
})
