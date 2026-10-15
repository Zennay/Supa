import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm, symlink, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { replayPrivateReviewedCaptureDirectory, main } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'
import { RETAILER_REVIEWED_FIXTURES, loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

async function sandbox() {
  const directory = await mkdtemp(join(tmpdir(), 'supa-review-captures-'))
  const manifest = {
    schemaVersion: 1, mode: 'private-reviewed-retailer-batch',
    productionEnabled: false, permissionVerified: false,
    publicSavingsClaimEligible: false, sources: [],
  }
  for (const file of RETAILER_REVIEWED_FIXTURES) {
    const bytes = await readFile(new URL('../fixtures/m1/' + file, import.meta.url))
    const record = JSON.parse(bytes.toString('utf8'))
    const name = 'capture-' + manifest.sources.length + '.json'
    await writeFile(join(directory, name), bytes, { mode: 0o600, flag: 'wx' })
    manifest.sources.push({
      file: name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      key: record.source.supermarket + ':' + record.source.kind,
    })
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), {
    mode: 0o600, flag: 'wx',
  })
  return { directory, manifest }
}
async function rewriteManifest(directory, manifest) {
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 })
}
const cleanup = directory => rm(directory, { recursive: true, force: true })

describe('product: operator-controlled SHA-pinned reviewed retail batch', () => {
  it('replays exactly six real historical retailer fixtures through the real adapters', async () => {
    const { directory } = await sandbox()
    try {
      const result = await replayPrivateReviewedCaptureDirectory(directory)
      const expected = await loadReviewedRepositoryFixtures()
      assert.equal(result.sources, 6)
      assert.equal(result.acceptedSources, 6)
      assert.equal(result.observations, expected.summary.observations)
      assert.ok(result.products > 0)
      assert.ok(result.captureEvents > 0)
      assert.equal(result.sixShapeCoverageComplete, true)
      assert.equal(result.humanReviewRequired, true)
      assert.equal(result.productionEnabled, false)
      assert.equal(result.permissionVerified, false)
      assert.equal(result.publicSavingsClaimEligible, false)
      assert.equal(result.externalRequests, 0)
    } finally { await cleanup(directory) }
  })
  it('prints only aggregate, never source provenance, product names or cents', async () => {
    const { directory } = await sandbox()
    try {
      let stdout = ''
      const result = await main(['--dir', directory], text => { stdout += text })
      assert.deepEqual(JSON.parse(stdout), result)
      assert.equal(stdout.includes('www.plus.nl'), false)
      assert.equal(stdout.includes('www.dekamarkt.nl'), false)
      assert.equal(stdout.includes('currentPriceCents'), false)
      const source = await loadReviewedRepositoryFixtures()
      for (const row of source.results) {
        for (const observation of row.observations) {
          assert.equal(stdout.includes(observation.provenance.sha256), false)
          assert.equal(stdout.includes(observation.name), false)
          assert.equal(stdout.includes(observation.provenance.url), false)
        }
      }
    } finally { await cleanup(directory) }
  })
  it('rejects modified evidence bytes, even when JSON remains syntactically valid', async () => {
    const { directory } = await sandbox()
    try {
      const filename = join(directory, 'capture-0.json')
      const original = await readFile(filename, 'utf8')
      await writeFile(filename, original + '\n', { mode: 0o600 })
      await assert.rejects(replayPrivateReviewedCaptureDirectory(directory), /refused/)
    } finally { await cleanup(directory) }
  })
  it('rejects absent approved shape and all contradictory permission/public status flags', async () => {
    for (const edit of [
      m => { m.sources.pop() },
      m => { m.permissionVerified = true },
      m => { m.productionEnabled = true },
      m => { m.publicSavingsClaimEligible = true },
      m => { m.mode = 'production-enabled' },
      m => { m.sources[0].key = 'plus:nonexistent' },
    ]) {
      const { directory, manifest } = await sandbox()
      try {
        edit(manifest)
        await rewriteManifest(directory, manifest)
        await assert.rejects(replayPrivateReviewedCaptureDirectory(directory), /refused/)
      } finally { await cleanup(directory) }
    }
  })
  it('rejects both duplicate filenames and an unexpected traversal path', async () => {
    for (const edit of [
      m => { m.sources[1].file = m.sources[0].file },
      m => { m.sources[1].file = '../outside.json' },
      m => { m.sources[0].file = 'manifest.json' },
    ]) {
      const { directory, manifest } = await sandbox()
      try {
        edit(manifest)
        await rewriteManifest(directory, manifest)
        await assert.rejects(replayPrivateReviewedCaptureDirectory(directory), /refused/)
      } finally { await cleanup(directory) }
    }
  })
  it('refuses group/world-readable input or a symbolic link', async () => {
    const { directory, manifest } = await sandbox()
    try {
      await chmod(join(directory, 'capture-1.json'), 0o644)
      await assert.rejects(replayPrivateReviewedCaptureDirectory(directory), /refused/)
      await chmod(join(directory, 'capture-1.json'), 0o600)
      const link = join(directory, 'alias.json')
      await symlink(join(directory, 'capture-0.json'), link)
      manifest.sources[0].file = 'alias.json'
      await rewriteManifest(directory, manifest)
      await assert.rejects(replayPrivateReviewedCaptureDirectory(directory), /refused/)
    } finally { await cleanup(directory) }
  })
  it('refuses missing manifest and extra untrusted root properties', async () => {
    const { directory, manifest } = await sandbox()
    try {
      manifest.secretToken = 'test-only'
      await rewriteManifest(directory, manifest)
      await assert.rejects(replayPrivateReviewedCaptureDirectory(directory), /refused/)
    } finally { await cleanup(directory) }
  })
  it('refuses public/live CLI flags without disclosing private paths to stdout', async () => {
    let output = ''
    await assert.rejects(main(['--publish'], text => { output += text }), /refused/)
    assert.equal(output, '')
  })
})
