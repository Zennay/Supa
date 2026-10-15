import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const runner = new URL('../scripts/retailer-private-reviewed-manifest-replay.mjs', import.meta.url).pathname
async function withStagingDirectory(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-root-trust-'))
  try {
    await chmod(root, 0o700)
    for (const [i, name] of RETAILER_REVIEWED_FIXTURES.entries()) {
      const bytes = await readFile(new URL('../fixtures/m1/' + name, import.meta.url))
      await writeFile(join(root, 'capture-' + i + '.json'), bytes, {
        flag: 'wx', mode: 0o600,
      })
    }
    const result = await buildPrivateReviewedManifest(root)
    assert.equal(result.filesPinned, 6)
    await run(root)
  } finally {
    await chmod(root, 0o700).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
}

test('product private replay admits owner-only 0700 historical stage', () =>
  withStagingDirectory(async root => {
    const result = await replayPrivateReviewedCaptureDirectory(root)
    assert.equal(result.acceptedSources, 6)
    assert.equal(result.sixShapeCoverageComplete, true)
    assert.equal(result.permissionVerified, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.externalRequests, 0)
  }))

for (const [mode, label] of [
  [0o755, 'other-readable'],
  [0o733, 'other-writable'],
  [0o777, 'world-writable'],
  [0o750, 'group-traversable'],
  [0o770, 'group-writable'],
]) {
  test('product private replay refuses ' + label + ' staging 0' + mode.toString(8), () =>
    withStagingDirectory(async root => {
      await chmod(root, mode)
      await assert.rejects(replayPrivateReviewedCaptureDirectory(root),
        /Private reviewed retailer capture replay refused/)
    }))
}

test('product replay CLI rejects exposed directory before stdout/private data disclosure', () =>
  withStagingDirectory(async root => {
    await chmod(root, 0o777)
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', runner, '--dir', root],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Private reviewed retailer capture replay refused\s*$/)
    assert.equal(result.stderr.includes(root), false)
  }))
