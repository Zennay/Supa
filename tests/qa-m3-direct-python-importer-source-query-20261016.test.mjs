/**
 * Independent SUPA M3 quality-validation 2/2:
 * DIRECT Python SQLite importer credential-query provenance boundary.
 *
 * Frozen product owner #3235 0d3273efd1c06ca7b8f36e34b678a6a26ea58ac6.
 * The normal JS builder checks URL-query credentials earlier; this tests the
 * separate, directly exported Python CLI, without changing product code.
 * Uses ONLY six previously reviewed offline local fixtures and fictional
 * in-memory string mutations, temporary private files, zero retailer traffic.
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
const PRIVATE_REFUSAL = /Universal offline retailer database import refused; nothing published/

const originalBatch = async () => structuredClone(await loadReviewedRepositoryFixtures())
async function executeInPrivateSandbox(batch, verify) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-python-sqlite-query-'))
  try {
    const input = join(dir, 'previously-reviewed.json')
    const destination = join(dir, 'must-not-trust.sqlite')
    await writeFile(input, JSON.stringify(batch), { mode: 0o600, flag: 'wx' })
    const child = spawnSync('python3', [IMPORTER, '--input', input, '--out', destination], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024,
    })
    await verify(child, destination)
  } finally { await rm(dir, { recursive: true, force: true }) }
}

function mutateReviewedCaptureQuery(batch, query) {
  const row = batch.results.find(item => item.key === 'plus:product')
  assert.ok(row?.accepted && row.observations.length > 0)
  for (const observation of row.observations) {
    const url = new URL(observation.provenance.url)
    url.search = (url.search ? url.search + '&' : '?') + query
    observation.provenance.url = url.href
  }
}
async function assertDbAbsent(path) {
  await assert.rejects(stat(path), { code: 'ENOENT' })
}

test('direct Python importer admits only six real archived shapes to a new private historical database', async () => {
  const batch = await originalBatch()
  const immutable = structuredClone(batch)
  await executeInPrivateSandbox(batch, async (child, destination) => {
    assert.equal(child.status, 0, child.stderr)
    const report = JSON.parse(child.stdout)
    assert.equal(report.created, true)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.snapshots, 6)
    assert.equal(report.observations, batch.summary.observations)
    assert.equal((await stat(destination)).mode & 0o777, 0o600)
    assert.doesNotMatch(child.stdout, /https?:\/\/|access_token|sourceProductId|source_url|price_cents/i)
  })
  assert.deepEqual(batch, immutable)
})

test('direct Python importer accepts harmless fictional query metadata without acquiring usage rights', async () => {
  const batch = await originalBatch()
  mutateReviewedCaptureQuery(batch, 'campaign=FICTIONAL_QA')
  await executeInPrivateSandbox(batch, async (child, destination) => {
    assert.equal(child.status, 0, child.stderr)
    const report = JSON.parse(child.stdout)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.snapshots, 6)
    assert.equal((await stat(destination)).mode & 0o777, 0o600)
    assert.doesNotMatch(child.stdout, /FICTIONAL_QA|campaign|https?:\/\//i)
  })
})

for (const [label, query] of [
  ['lowercase token query name', 'access_token=FAKE_QA_NOT_A_SECRET'],
  ['mixed-case token query name', 'AcCeSs_ToKeN=FAKE_QA_NOT_A_SECRET'],
  ['percent-encoded token query name', 'A%43CESS%5FTOKEN=FAKE_QA_NOT_A_SECRET'],
]) {
  test('direct Python importer must reject ' + label + ' before DB publication [EXPECTED RED]', async () => {
    const batch = await originalBatch()
    mutateReviewedCaptureQuery(batch, query)
    const before = structuredClone(batch)
    await executeInPrivateSandbox(batch, async (child, destination) => {
      assert.notEqual(child.status, 0,
        'must not persist a credential-bearing URL just because hostname is valid')
      assert.equal(child.stdout, '', 'failed direct importer must never emit source details')
      assert.match(child.stderr, PRIVATE_REFUSAL)
      assert.doesNotMatch(child.stderr, /FAKE_QA|access_token|https?:\/\/|previously-reviewed\.json/i)
      await assertDbAbsent(destination)
    })
    assert.deepEqual(batch, before)
  })
}
