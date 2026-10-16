/**
 * Independent M3 quality-validation: DIRECT Python offline SQLite importer's
 * physical offer validity chronology, including precision finer than Python
 * datetime's microseconds. Frozen owner #3235 0d3273efd1c06ca7b8f36e34b678a6a26ea58ac6.
 * No internet, actual offer rights, customer data, or current savings claim.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const IMPORTER = fileURLToPath(new URL('../scripts/retailer-import-universal-sqlite.py', import.meta.url))
const REFUSED = /Universal offline retailer database import refused; nothing published/

async function withFixtureOffer(from, to, verify) {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  const row = batch.results.find(x => x.key === 'plus:offers')
  assert.ok(row?.accepted && row.observations.length > 0)
  const original = structuredClone(batch)
  row.observations[0].offer = {
    label: 'FICTIONAL_QA_OFFLINE_OFFER',
    mechanics: null,
    originalPriceCents: 220,
    offerPriceCents: 180,
    validFrom: from,
    validTo: to,
  }
  const pinned = structuredClone(batch)
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-python-offer-time-'))
  try {
    const input = join(dir, 'reviewed.json')
    const output = join(dir, 'historical.sqlite')
    await writeFile(input, JSON.stringify(batch), { mode: 0o600, flag: 'wx' })
    const processResult = spawnSync('python3', [IMPORTER, '--input', input, '--out', output], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024,
    })
    await verify(processResult, output, batch)
    assert.deepEqual(batch, pinned, 'import must never mutate in-memory review source')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  assert.notDeepEqual(batch, original, 'the mutated offer must be synthetic')
}
const noDb = async path => assert.rejects(stat(path), { code: 'ENOENT' })

test('direct Python importer admits a physically ordered historical synthetic offer, never public savings', async () => {
  await withFixtureOffer('2026-10-14T10:00:00.000000001Z',
    '2026-10-14T10:00:00.000000002Z', async (child, output) => {
      assert.equal(child.status, 0, child.stderr)
      const report = JSON.parse(child.stdout)
      assert.equal(report.created, true)
      assert.equal(report.snapshots, 6)
      assert.equal(report.productionEnabled, false)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal((await stat(output)).mode & 0o777, 0o600)
      assert.doesNotMatch(child.stdout, /FICTIONAL_QA_OFFLINE_OFFER|180|220|https?:\/\//i)
    })
})

for (const [label, start, end] of [
  ['one-nanosecond reversed zero-microsecond offer',
    '2026-10-14T10:00:00.000000001Z', '2026-10-14T10:00:00.000000000Z'],
  ['sub-microsecond reversed 999-to-001 nanosecond offer',
    '2026-10-14T10:00:00.000000999Z', '2026-10-14T10:00:00.000000001Z'],
]) {
  test('direct Python importer rejects ' + label + ' [EXPECTED RED]', async () => {
    await withFixtureOffer(start, end, async (child, output) => {
      assert.notEqual(child.status, 0,
        '9-digit ISO offer validity cannot be reduced to microseconds before comparing')
      assert.equal(child.stdout, '')
      assert.match(child.stderr, REFUSED)
      assert.doesNotMatch(child.stderr, /FICTIONAL_QA_OFFLINE_OFFER|https?:\/\/|2026-10-14/i)
      await noDb(output)
    })
  })
}

test('invalid calendar dates still fail without creating a SQLite database', async () => {
  await withFixtureOffer('2026-02-30T10:00:00Z',
    '2026-10-14T10:00:00Z', async (child, output) => {
      assert.notEqual(child.status, 0)
      assert.match(child.stderr, REFUSED)
      assert.equal(child.stdout, '')
      await noDb(output)
    })
})
