import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const replayCli = new URL('../scripts/retailer-private-reviewed-manifest-replay.mjs', import.meta.url).pathname
async function stagePrivateBatch() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-dir-trust-'))
  await chmod(root, 0o700)
  for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
    const evidence = await readFile(new URL('../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
    await writeFile(join(root, 'capture-' + i + '.json'), evidence, { flag: 'wx', mode: 0o600 })
  }
  await buildPrivateReviewedManifest(root)
  return root
}
async function discard(root) {
  await chmod(root, 0o700).catch(() => {})
  await rm(root, { recursive: true, force: true })
}

test('QA root-trust control: a private 0700 review directory is replayable only as historical review', async () => {
  const root = await stagePrivateBatch()
  try {
    const result = await replayPrivateReviewedCaptureDirectory(root)
    assert.equal(result.sources, 6)
    assert.equal(result.sixShapeCoverageComplete, true)
    assert.equal(result.permissionVerified, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.externalRequests, 0)
  } finally { await discard(root) }
})

for (const [mode, reason] of [
  [0o755, 'other users can list filenames and traverse the directory'],
  [0o733, 'other users can insert or replace staged files in the directory'],
  [0o777, 'other users can list, traverse and modify the staged directory'],
]) {
  test('QA root-trust refusal: staged 0' + mode.toString(8) + ' must not be accepted (' + reason + ')', async () => {
    const root = await stagePrivateBatch()
    try {
      await chmod(root, mode)
      // The manifest has correct hashes and private 0600 files, but the
      // enclosing directory no longer has the generator's required trust mode.
      await assert.rejects(replayPrivateReviewedCaptureDirectory(root), /refused/)
    } finally { await discard(root) }
  })
}

test('QA CLI root-trust: world-writable staged directory fails before producing any output', async () => {
  const root = await stagePrivateBatch()
  try {
    await chmod(root, 0o777)
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', replayCli, '--dir', root],
      { encoding: 'utf8', timeout: 40_000, maxBuffer: 256 * 1024 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Private reviewed retailer capture replay refused/)
    assert.doesNotMatch(result.stderr, /capture-|\.json|https?:\/\/|sha256|sourceProductId/i)
  } finally { await discard(root) }
})
