import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile, chmod, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { runPrivateRetailerPipeline } from '../scripts/retailer-private-offline-end-to-end.mjs'

// Independent QA of the PRODUCT-OWNED --verify feature on frozen #3077.
// Only local pre-reviewed archival M1 fixtures, never a retailer network.
const referenceTime = '2026-10-15T21:00:00.000Z'
const binary = new URL('../scripts/retailer-private-offline-end-to-end.mjs', import.meta.url).pathname

async function reviewedStage() {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-verify-immutable-'))
  try {
    for (const [index, fixture] of RETAILER_REVIEWED_FIXTURES.entries()) {
      const bytes = await readFile(new URL('../fixtures/m1/' + fixture, import.meta.url))
      await writeFile(join(directory, 'capture-' + index + '.json'), bytes,
        { mode: 0o600, flag: 'wx' })
    }
    await runPrivateRetailerPipeline(directory, { referenceTime })
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function pinnedFileSnapshot(directory) {
  const files = (await readdir(directory)).sort()
  const snapshot = []
  for (const name of files) {
    const path = join(directory, name)
    const metadata = await lstat(path)
    const bytes = await readFile(path)
    snapshot.push({
      name,
      inode: metadata.ino,
      nlink: metadata.nlink,
      bytes: metadata.size,
      mode: metadata.mode & 0o777,
      mtimeMs: metadata.mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  return snapshot
}

function cli(args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', binary, ...args],
    { encoding: 'utf8', timeout: 25000 })
}

test('QA: actual repeated --verify CLI is strictly read-only over every SHA-pinned private file, not merely manifest contents', async () => {
  const directory = await reviewedStage()
  try {
    const baseline = await pinnedFileSnapshot(directory)
    assert.equal(baseline.length, 7, 'six reviewed captures plus manifest only')
    for (const entry of baseline) {
      assert.equal(entry.mode, 0o600)
      assert.equal(entry.nlink, 1)
    }
    for (let i = 0; i < 2; i++) {
      const result = cli(['--dir', directory, '--verify'])
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      const report = JSON.parse(result.stdout)
      assert.equal(report.mode, 'private-offline-retailer-verified-pipeline')
      assert.equal(report.manifestCreated, false)
      assert.equal(report.manifestVerified, true)
      assert.equal(report.pinnedSources, 6)
      assert.equal(report.permissionVerified, false)
      assert.equal(report.productionEnabled, false)
      assert.equal(report.livePricesAvailable, false)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(report.externalRequests, 0)
      for (const forbidden of ['https://www.plus.nl', 'https://www.dekamarkt.nl',
        'sourceProductId', 'currentPriceCents', 'capture-0.json', 'sha256:']) {
        assert.equal(result.stdout.includes(forbidden), false)
      }
      assert.deepEqual(await pinnedFileSnapshot(directory), baseline,
        'no inode, mode, link count, mtime, filename, size or evidence SHA may change')
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('QA: corrupt evidence file permissions force fixed stderr/empty stdout and never auto-repair original private bytes', async () => {
  const directory = await reviewedStage()
  try {
    await chmod(join(directory, 'capture-0.json'), 0o644)
    const tampered = await pinnedFileSnapshot(directory)
    const result = cli(['--dir', directory, '--verify'])
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Private offline retailer pipeline refused/)
    assert.equal(result.stderr.includes(directory), false)
    assert.equal(result.stderr.includes('https://www.plus.nl'), false)
    assert.deepEqual(await pinnedFileSnapshot(directory), tampered)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('QA: executable --verify rejects extra publish flag before opening or changing staged evidence', async () => {
  const directory = await reviewedStage()
  try {
    const before = await pinnedFileSnapshot(directory)
    const result = cli(['--dir', directory, '--verify', '--publish'])
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Private offline retailer pipeline refused/)
    assert.equal(result.stderr.includes(directory), false)
    assert.deepEqual(await pinnedFileSnapshot(directory), before)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
