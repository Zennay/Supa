import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { writePrivateRetailerCatalog } from '../scripts/retailer-private-catalog-store.mjs'

// Standalone contract for the directly exported writer. Synthetic mutations.
// Frozen merged P1 source; expected RED is NOT intended for merge.
async function privateCatalog() {
  return buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
}
async function inTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-export-'))
  try { await fn(join(dir, 'private-export.json')) }
  finally { await rm(dir, { force: true, recursive: true }) }
}

test('control: six approved offline fixture sources are saved with 0600 and no public product claims', async () => {
  await inTemp(async file => {
    const catalog = await privateCatalog()
    const result = await writePrivateRetailerCatalog(catalog, file)
    assert.equal(result.records, catalog.productCount)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.equal(catalog.productionEnabled, false)
    assert.equal(catalog.publicSavingsClaimEligible, false)
    assert.ok(catalog.products.every(p => !p.publishable && !p.sourceRightsVerified))
  })
})

test('direct private writer must refuse an individually publishable product hidden under private top-level metadata', async () => {
  await inTemp(async file => {
    const catalog = await privateCatalog()
    catalog.products[0].publishable = true
    await assert.rejects(
      writePrivateRetailerCatalog(catalog, file),
      /private|publish|unvalidated|refus|catalog/i,
      'top-level false flags cannot launder product-level publishable=true',
    )
    await assert.rejects(stat(file), { code: 'ENOENT' })
  })
})

test('direct private writer must refuse forged verified retailer rights and selected price despite private envelope', async () => {
  await inTemp(async file => {
    const catalog = await privateCatalog()
    catalog.products[0].sourceRightsVerified = true
    catalog.products[0].currentTrustedPriceCents = 1
    catalog.products[0].selectedSnapshotSha256 = 'f'.repeat(64)
    await assert.rejects(
      writePrivateRetailerCatalog(catalog, file),
      /private|verified|price|refus|catalog|unvalidated/i,
      'no downstream database export should persist a falsely selected trusted cent price',
    )
    await assert.rejects(stat(file), { code: 'ENOENT' })
  })
})

test('direct private writer must not persist credential-bearing capture URLs embedded in a forged nested capture', async () => {
  await inTemp(async file => {
    const catalog = await privateCatalog()
    catalog.products[0].captures[0].sourceUrl =
      'https://fictional:FAKE_SECRET_DO_NOT_STORE@www.plus.nl/producten'
    await assert.rejects(
      writePrivateRetailerCatalog(catalog, file),
      /private|credential|source|url|refus|catalog|unvalidated/i,
      'no userinfo or secrets should enter a persisted private product snapshot',
    )
    await assert.rejects(stat(file), { code: 'ENOENT' })
  })
})
