import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm, symlink, chmod, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { buildPrivateReviewedManifest, main } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { RETAILER_REVIEWED_FIXTURES, loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

async function sandbox() {
  const directory = await mkdtemp(join(tmpdir(), 'supa-manifest-builder-'))
  for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
    const bytes = await readFile(new URL('../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
    await writeFile(join(directory, 'capture-' + i + '.json'), bytes, { mode: 0o600, flag: 'wx' })
  }
  return directory
}
describe('product: operator-generated private six-shape reviewed manifest', () => {
  it('pins genuine six known historical adapter fixture bytes and correct schema', async () => {
    const dir = await sandbox()
    try {
      const result = await buildPrivateReviewedManifest(dir)
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
      assert.equal(result.filesPinned, 6)
      assert.equal(result.sourceKinds, 6)
      assert.equal(manifest.sources.length, 6)
      assert.equal(manifest.mode, 'private-reviewed-retailer-batch')
      assert.equal(manifest.productionEnabled, false)
      assert.equal(manifest.permissionVerified, false)
      assert.equal(manifest.publicSavingsClaimEligible, false)
      assert.deepEqual(manifest.sources.map(r => r.file), [
        'capture-0.json','capture-1.json','capture-2.json',
        'capture-3.json','capture-4.json','capture-5.json',
      ])
      const sourceKinds = new Set()
      for (const row of manifest.sources) {
        const bytes = await readFile(join(dir, row.file))
        assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'))
        const source = JSON.parse(bytes.toString('utf8')).source
        assert.equal(row.key, source.supermarket + ':' + source.kind)
        sourceKinds.add(row.key)
      }
      assert.equal(sourceKinds.size, 6)
      assert.equal((await stat(join(dir, 'manifest.json'))).mode & 0o077, 0)
      assert.equal(result.externalRequests, 0)
      assert.equal(result.publicSavingsClaimEligible, false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('never overwrites an existing manifest on repeated run', async () => {
    const dir = await sandbox()
    try {
      await buildPrivateReviewedManifest(dir)
      const before = await readFile(join(dir, 'manifest.json'))
      await assert.rejects(buildPrivateReviewedManifest(dir), /refused/)
      assert.deepEqual(await readFile(join(dir, 'manifest.json')), before)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('refuses tampered reviewed source structure without creating any manifest', async () => {
    const dir = await sandbox()
    try {
      const file = join(dir, 'capture-0.json')
      const record = JSON.parse(await readFile(file, 'utf8'))
      record.version = 88
      await writeFile(file, JSON.stringify(record), { mode: 0o600 })
      await assert.rejects(buildPrivateReviewedManifest(dir), /refused/)
      await assert.rejects(readFile(join(dir, 'manifest.json')))
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('refuses missing one of the six source-kind adapters', async () => {
    const dir = await sandbox()
    try {
      const file = join(dir, 'capture-0.json')
      const record = JSON.parse(await readFile(file, 'utf8'))
      record.source.kind = 'offers'
      await writeFile(file, JSON.stringify(record), { mode: 0o600 })
      await assert.rejects(buildPrivateReviewedManifest(dir), /refused/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('refuses readable-by-others or symlinked reviewed JSON files', async () => {
    const dir = await sandbox()
    try {
      const file = join(dir, 'capture-0.json')
      await chmod(file, 0o644)
      await assert.rejects(buildPrivateReviewedManifest(dir), /refused/)
      await chmod(file, 0o600)
      const alias = join(dir, 'capture-alias.json')
      await symlink(file, alias)
      await assert.rejects(buildPrivateReviewedManifest(dir), /refused/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('refuses too few reviewed files or malformed UTF-8', async () => {
    const dir = await sandbox()
    try {
      await writeFile(join(dir, 'capture-0.json'), Buffer.from([0xff,0xfe]), { mode: 0o600 })
      await assert.rejects(buildPrivateReviewedManifest(dir), /refused/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('CLI prints no names, prices, URLs or source digest', async () => {
    const dir = await sandbox()
    try {
      let stdout = ''
      const result = await main(['--dir', dir], text => { stdout += text })
      assert.equal(JSON.parse(stdout).filesPinned, 6)
      assert.deepEqual(JSON.parse(stdout), result)
      const batch = await loadReviewedRepositoryFixtures()
      for (const row of batch.results) {
        for (const observation of row.observations) {
          assert.equal(stdout.includes(observation.provenance.url), false)
          assert.equal(stdout.includes(observation.provenance.sha256), false)
          assert.equal(stdout.includes(observation.name), false)
        }
      }
      assert.equal(stdout.includes('capture-'), false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('CLI fails without printing on unsupported publishing options', async () => {
    let printed = ''
    await assert.rejects(main(['--publish'], text => { printed += text }), /refused/)
    assert.equal(printed, '')
  })
})
