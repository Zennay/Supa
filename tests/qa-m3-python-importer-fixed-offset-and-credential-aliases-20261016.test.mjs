/**
 * Independent M3 QA 2/2: post-fix Python-only edge cases not covered by the
 * original eight RED tests. On frozen owner #3254 b330c7d15fbbb3757fe6c2f6d97235b83cfe2456.
 * Six already-reviewed offline PLUS/Deka local fixtures are cloned. No HTTP,
 * real tokens, current retailer prices, user evidence or public savings.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const PYTHON = fileURLToPath(new URL('../scripts/retailer-import-universal-sqlite.py', import.meta.url))
const REFUSAL = /Universal offline retailer database import refused; nothing published/

async function runFixture(change, accepted) {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  change(batch)
  const immutable = structuredClone(batch)
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-py-utc-parity-'))
  try {
    const input = join(root, 'archive.json')
    const output = join(root, 'private.sqlite')
    await writeFile(input, JSON.stringify(batch), { flag: 'wx', mode: 0o600 })
    const child = spawnSync('python3', [PYTHON, '--input', input, '--out', output], {
      timeout: 30000, maxBuffer: 65536, encoding: 'utf8',
    })
    if (accepted) {
      assert.equal(child.status, 0, child.stderr)
      const summary = JSON.parse(child.stdout)
      assert.equal(summary.created, true)
      assert.equal(summary.snapshots, 6)
      assert.equal(summary.productionEnabled, false)
      assert.equal(summary.publicSavingsClaimEligible, false)
      assert.equal((await stat(output)).mode & 0o777, 0o600)
      assert.doesNotMatch(child.stdout, /https?:\/\/|FICTIONAL_QA|access_token|sourceProductId|priceCents/i)
    } else {
      assert.notEqual(child.status, 0, 'unsafe direct Python importer input must refuse')
      assert.equal(child.stdout, '')
      assert.match(child.stderr, REFUSAL)
      assert.doesNotMatch(child.stderr, /https?:\/\/|FICTIONAL_QA|archive\.json|private\.sqlite/i)
      await assert.rejects(stat(output), { code: 'ENOENT' })
    }
    assert.deepEqual(batch, immutable, 'no caller evidence mutation')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}
function setOffer(batch, from, to) {
  const entry = batch.results.find(row => row.key === 'plus:offers')
  assert.ok(entry?.observations.length)
  entry.observations[0].offer = {
    label: 'FICTIONAL_QA_LOCAL_OFFER',
    originalPriceCents: 220,
    offerPriceCents: 180,
    validFrom: from,
    validTo: to,
  }
}
function query(batch, key) {
  const entry = batch.results.find(row => row.key === 'plus:product')
  assert.ok(entry?.observations.length)
  for (const observation of entry.observations) {
    const url = new URL(observation.provenance.url)
    url.searchParams.append(key, 'FICTIONAL_QA_NOT_CREDENTIAL')
    observation.provenance.url = url.href
  }
}

for (const [name, from, to, accepted] of [
  ['same physical instant across UTC and plus-two offset',
    '2026-10-14T10:00:00.000000001Z', '2026-10-14T12:00:00.000000001+02:00', true],
  ['one-nanosecond forward across midnight and offset',
    '2026-10-14T23:59:59.999999999Z', '2026-10-15T02:00:00.000000000+02:00', true],
  ['one-nanosecond reverse despite later-looking local time',
    '2026-10-14T10:00:00.000000002Z', '2026-10-14T12:00:00.000000001+02:00', false],
  ['one-nanosecond reverse despite changing back to UTC',
    '2026-10-14T12:00:00.000000002+02:00', '2026-10-14T10:00:00.000000001Z', false],
  ['one-nanosecond reverse across calendar-day offset',
    '2026-10-14T23:59:59.999999999Z', '2026-10-15T01:59:59.999999998+02:00', false],
]) {
  test('direct Python fixed M3 chronology: ' + name, async () =>
    runFixture(batch => setOffer(batch, from, to), accepted))
}

for (const [label, key] of [
  ['case-varied refresh-token alias', 'ReFrEsH_ToKeN'],
  ['case-varied API credential alias', 'API_KEY'],
  ['case-varied client secret', 'CLIENT_SECRET'],
  ['percent-decoding residue not accepted as a benign metadata key', '%61ccess_token'],
]) {
  test('direct Python fixed M3 query trust refuses ' + label, async () =>
    runFixture(batch => query(batch, key), false))
}

test('direct Python historical importer accepts harmless percent-encoded campaign key without granting rights', async () =>
  runFixture(batch => query(batch, 'campaign'), true))
