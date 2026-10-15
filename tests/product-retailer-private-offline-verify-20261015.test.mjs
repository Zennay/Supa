import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { main, runPrivateRetailerPipeline, verifyPrivateRetailerPipeline } from '../scripts/retailer-private-offline-end-to-end.mjs'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'

async function stage() {
  const dir = await mkdtemp(join(tmpdir(), 'supa-offline-reverify-'))
  for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
    const bytes = await readFile(new URL('../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
    await writeFile(join(dir, 'capture-' + i + '.json'), bytes, { mode: 0o600, flag: 'wx' })
  }
  return dir
}

describe('product: private manifest verification is read-only and safe to retry', () => {
  it('replays all six previously pinned reviewed sources without touching the manifest', async () => {
    const dir = await stage()
    try {
      const created = await runPrivateRetailerPipeline(dir)
      const before = await readFile(join(dir, 'manifest.json'))
      const filesBefore = await readdir(dir)
      const verified = await verifyPrivateRetailerPipeline(dir)
      const second = await verifyPrivateRetailerPipeline(dir)
      assert.deepEqual(second, verified)
      assert.equal(verified.mode, 'private-offline-retailer-verified-pipeline')
      assert.equal(verified.manifestCreated, false)
      assert.equal(verified.manifestVerified, true)
      for (const key of ['pinnedSources', 'acceptedSources', 'observations',
        'products', 'captureEvents', 'conflictsNeedingReview', 'staleSources']) {
        assert.equal(verified[key], created[key], key)
      }
      assert.equal(verified.pinnedSources, 6)
      assert.equal(verified.humanReviewRequired, true)
      assert.equal(verified.permissionVerified, false)
      assert.equal(verified.productionEnabled, false)
      assert.equal(verified.publicSavingsClaimEligible, false)
      assert.equal(verified.livePricesAvailable, false)
      assert.equal(verified.externalRequests, 0)
      assert.deepEqual(await readFile(join(dir, 'manifest.json')), before)
      assert.deepEqual(await readdir(dir), filesBefore)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('CLI verifies existing evidence with counts only, without silently turning it into a new manifest', async () => {
    const dir = await stage()
    try {
      await runPrivateRetailerPipeline(dir)
      let output = ''
      const result = await main(['--dir', dir, '--verify'], text => { output += text })
      assert.deepEqual(JSON.parse(output), result)
      assert.equal(result.manifestCreated, false)
      assert.equal(result.manifestVerified, true)
      for (const prohibited of ['capture-', 'sourceProductId', 'currentPriceCents',
        'https://', 'EUR', 'sha256', 'permissionVerified": true']) {
        assert.equal(output.includes(prohibited), false, prohibited)
      }
      // Original one-shot mode still refuses a second creation, protecting
      // existing manifest bytes and explicit operator intent.
      await assert.rejects(main(['--dir', dir], () => {}), /refused/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('refuses verification without a manifest and does not create any files', async () => {
    const dir = await stage()
    try {
      const before = await readdir(dir)
      await assert.rejects(verifyPrivateRetailerPipeline(dir), /refused/)
      await assert.rejects(main(['--dir', dir, '--verify'], () => {}), /refused/)
      assert.deepEqual(await readdir(dir), before)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('refuses modified source bytes, leaving the originally pinned manifest untouched', async () => {
    const dir = await stage()
    try {
      await runPrivateRetailerPipeline(dir)
      const before = await readFile(join(dir, 'manifest.json'))
      await writeFile(join(dir, 'capture-0.json'), '{"fictional":"mutated"}\n', { mode: 0o600 })
      await assert.rejects(verifyPrivateRetailerPipeline(dir), /refused/)
      assert.deepEqual(await readFile(join(dir, 'manifest.json')), before)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('rejects publishing flags and unrelated options before touching disk', async () => {
    const dir = await stage()
    try {
      let stdout = ''
      await assert.rejects(main(['--dir', dir, '--verify', '--publish'],
        text => { stdout += text }), /refused/)
      await assert.rejects(verifyPrivateRetailerPipeline(dir,
        { publicSavingsClaimEligible: true }), /refused/)
      assert.equal(stdout, '')
      assert.equal((await readdir(dir)).includes('manifest.json'), false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
