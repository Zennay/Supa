import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { RETAILER_REVIEWED_FIXTURES, loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const builderCli = new URL('../scripts/retailer-private-reviewed-manifest-builder.mjs', import.meta.url).pathname
const replayCli = new URL('../scripts/retailer-private-reviewed-manifest-replay.mjs', import.meta.url).pathname
const expectedKeys = new Set([
  'plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers',
])
async function stage() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-pinned-chain-'))
  await chmod(root, 0o700)
  for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
    const bytes = await readFile(new URL('../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
    await writeFile(join(root, 'capture-' + i + '.json'), bytes, { flag: 'wx', mode: 0o600 })
  }
  return root
}
const clean = root => rm(root, { force: true, recursive: true })
const cli = (file, root, args = []) => spawnSync(process.execPath,
  ['--experimental-strip-types', file, '--dir', root, ...args],
  { encoding: 'utf8', timeout: 45_000, maxBuffer: 128 * 1024 })

test('QA integration: staged genuine six-shape archives -> immutable manifest -> replay retains exact accepted totals', async () => {
  const root = await stage()
  try {
    const original = await loadReviewedRepositoryFixtures()
    const made = await buildPrivateReviewedManifest(root)
    const manifestBytes = await readFile(join(root, 'manifest.json'))
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    const report = await replayPrivateReviewedCaptureDirectory(root)
    assert.equal(made.filesPinned, 6)
    assert.equal(made.sourceKinds, 6)
    assert.equal(report.sources, 6)
    assert.equal(report.acceptedSources, 6)
    assert.equal(report.observations, original.summary.observations)
    assert.equal(report.sixShapeCoverageComplete, true)
    assert.deepEqual(new Set(manifest.sources.map(s => s.key)), expectedKeys)
    for (const row of manifest.sources) {
      const bytes = await readFile(join(root, row.file))
      assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'))
      assert.equal((await stat(join(root, row.file))).mode & 0o077, 0)
    }
    assert.equal((await stat(join(root, 'manifest.json'))).mode & 0o077, 0)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.permissionVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.livePricesAvailable, false)
    assert.equal(report.externalRequests, 0)
    assert.deepEqual(await readFile(join(root, 'manifest.json')), manifestBytes)
  } finally { await clean(root) }
})

test('QA integration: actual two-process CLI roundtrip has anonymous stdout and does not change evidence', async () => {
  const root = await stage()
  try {
    const before = await Promise.all((await readdir(root)).sort().map(n => readFile(join(root, n))))
    const make = cli(builderCli, root)
    assert.equal(make.error, undefined)
    assert.equal(make.status, 0, make.stderr)
    const replay = cli(replayCli, root)
    assert.equal(replay.error, undefined)
    assert.equal(replay.status, 0, replay.stderr)
    const first = JSON.parse(make.stdout)
    const second = JSON.parse(replay.stdout)
    assert.equal(first.filesPinned, 6)
    assert.equal(second.acceptedSources, 6)
    assert.equal(second.publicSavingsClaimEligible, false)
    assert.equal(second.externalRequests, 0)
    const outputs = make.stdout + replay.stdout + make.stderr + replay.stderr
    assert.doesNotMatch(outputs, /https?:\/\/|currentPriceCents|offerPriceCents|sourceProductId|capture-[0-9]+\.json|sha256|secret|token/i)
    const after = await Promise.all((await readdir(root)).filter(x => x !== 'manifest.json').sort().map(n => readFile(join(root, n))))
    assert.deepEqual(after, before)
  } finally { await clean(root) }
})

test('QA integration: any staged byte mutation after a successful pin prevents replay and leaks no stdout', async () => {
  const root = await stage()
  try {
    await buildPrivateReviewedManifest(root)
    const path = join(root, 'capture-3.json')
    const before = await readFile(path)
    await writeFile(path, Buffer.concat([before, Buffer.from(' ')]), { mode: 0o600 })
    const denied = cli(replayCli, root)
    assert.equal(denied.status, 2)
    assert.equal(denied.stdout, '')
    assert.match(denied.stderr, /Private reviewed retailer capture replay refused/)
    assert.doesNotMatch(denied.stderr, /capture-3|https?:\/\/|sha256|currentPriceCents/i)
    await assert.rejects(replayPrivateReviewedCaptureDirectory(root), /refused/)
  } finally { await clean(root) }
})

test('QA integration: source bytes are unchanged if manifest creation refuses an unsafe staged source', async () => {
  const root = await stage()
  try {
    const bad = join(root, 'capture-4.json')
    const bytes = await readFile(bad)
    await chmod(bad, 0o644)
    await assert.rejects(buildPrivateReviewedManifest(root), /refused/)
    assert.deepEqual(await readFile(bad), bytes)
    assert.ok(!(await readdir(root)).includes('manifest.json'))
  } finally { await clean(root) }
})

test('QA integration: neither a second manifest creation nor a publishing flag can mutate a pinned batch', async () => {
  const root = await stage()
  try {
    await buildPrivateReviewedManifest(root)
    const before = await readFile(join(root, 'manifest.json'))
    const refused = cli(builderCli, root)
    assert.equal(refused.status, 2)
    assert.equal(refused.stdout, '')
    const publicAttempt = cli(replayCli, root, ['--publish'])
    assert.equal(publicAttempt.status, 2)
    assert.equal(publicAttempt.stdout, '')
    assert.deepEqual(await readFile(join(root, 'manifest.json')), before)
    assert.equal((await replayPrivateReviewedCaptureDirectory(root)).publicSavingsClaimEligible, false)
  } finally { await clean(root) }
})
