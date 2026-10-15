import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, stat, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { writePrivateRetailerCatalog } from '../scripts/retailer-private-catalog-store.mjs'

test('universal private database export writes strict 0600 JSON, preserves evidence, and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-private-retail-'))
  try {
    const catalog = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
    const path = join(root, 'private', 'reviewed-snapshot.json')
    const outcome = await writePrivateRetailerCatalog(catalog, path)
    const info = await stat(path)
    assert.equal(info.mode & 0o777, 0o600)
    assert.equal(outcome.records, catalog.productCount)
    assert.ok(outcome.bytes > 0)
    const recovered = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(recovered, catalog)
    assert.equal(recovered.productionEnabled, false)
    assert.ok(recovered.products.every(p => p.publishable === false && p.currentTrustedPriceCents === null))
    await assert.rejects(
      writePrivateRetailerCatalog(catalog, path), /Private catalog export failed/
    )
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), catalog)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects symlinked output parent, dangerous file names and public eligible catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-private-retail-'))
  try {
    const batch = await loadReviewedRepositoryFixtures()
    const catalog = buildUniversalRetailerCatalog(batch)
    const link = join(root, 'redirect')
    await symlink(root, link, 'dir')
    await assert.rejects(
      writePrivateRetailerCatalog(catalog, join(link, 'data.json')), /symlinked M3 output parent/
    )
    await assert.rejects(
      writePrivateRetailerCatalog({ ...catalog, productionEnabled: true }, join(root, 'enabled.json')), /Refusing non-private/
    )
    await assert.rejects(
      writePrivateRetailerCatalog(catalog, join(root, '.hidden.json')), /Invalid private catalog filename/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
