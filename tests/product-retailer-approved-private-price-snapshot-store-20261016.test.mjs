import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'
import { writePrivateRetailerPriceSnapshot } from
  '../scripts/retailer-approved-private-price-snapshot-store.mjs'

// No real retailer URLs requested: only fictional in-memory Response.
const url = 'https://www.plus.nl/product/fictional-packet-111'
const product = (availability = 'InStock') => ({
  '@context': 'https://schema.org', '@type': 'Product', name: 'Fictional ingredient', url, sku: '111',
  weight: { value: '600 g' },
  offers: { '@type': 'Offer', price: '3.25', priceCurrency: 'EUR',
    availability: 'https://schema.org/' + availability },
})
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/only-fake-permission',
      finding: 'Fictional in-memory test; not a real retailer grant.' }],
  })),
}
async function sourceCandidate(availability = 'InStock') {
  const html = '<script type="application/ld+json">' +
    JSON.stringify(product(availability)) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate: gate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 60_000).toISOString(),
    fetchFn: async () => new Response(html, { status: 200,
      headers: { 'content-type': 'text/html' } }),
  })
}
async function temp(testContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'supa-private-retailer-test-'))
  testContext.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

test('approved HTML price candidate is actually archived as private 0600 evidence, never published', async t => {
  const dir = await temp(t)
  const item = await sourceCandidate()
  assert.equal(item.status, 'candidate_needs_review')
  const outfile = path.join(dir, 'review-20261016.json')
  const result = await writePrivateRetailerPriceSnapshot([item], outfile)
  assert.equal(result.count, 1)
  assert.equal(result.candidateCount, 1)
  assert.equal(result.productionEnabled, false)
  const stats = await stat(outfile)
  assert.equal(stats.mode & 0o777, 0o600)
  const saved = JSON.parse(await readFile(outfile, 'utf8'))
  assert.equal(saved.mode, 'private-unreviewed-retailer-price-candidates')
  assert.equal(saved.entries[0].observation.currentPriceCents, 325)
  assert.equal(saved.entries[0].observation.pack.amount, 600)
  assert.equal(saved.entries[0].observation.provenance.url, url)
  assert.equal(saved.verifiedCurrentCheckoutPrices, 0)
  assert.equal(saved.sourceRightsForPublicationVerified, false)
  assert.equal(saved.published, false)
  assert.equal(saved.publicSavingsClaimEligible, false)
})

test('known unavailable product creates traceable but unpriced review record', async t => {
  const dir = await temp(t)
  const item = await sourceCandidate('OutOfStock')
  assert.equal(item.status, 'review_required')
  assert.equal(item.observation, null)
  const output = path.join(dir, 'rejected.json')
  const result = await writePrivateRetailerPriceSnapshot([item], output)
  assert.equal(result.reviewRequiredCount, 1)
  const saved = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(saved.entries[0].reason, 'availability_unverified')
  assert.equal(saved.entries[0].observation, null)
})

test('operator historical evidence is never overwritten, including duplicate path', async t => {
  const dir = await temp(t)
  const output = path.join(dir, 'review.json')
  const item = await sourceCandidate()
  await writePrivateRetailerPriceSnapshot([item], output)
  const original = await readFile(output, 'utf8')
  await assert.rejects(writePrivateRetailerPriceSnapshot([item], output),
    /archive refused/)
  assert.equal(await readFile(output, 'utf8'), original)
})

test('duplicate source snapshot cannot silently count as two prices', async t => {
  const dir = await temp(t)
  const item = await sourceCandidate()
  const output = path.join(dir, 'duplicated.json')
  await assert.rejects(writePrivateRetailerPriceSnapshot([item, item], output),
    /archive refused/)
  await assert.rejects(stat(output), { code: 'ENOENT' })
})

test('forged public permission/verified checkout/stock or price is rejected before any disk write', async t => {
  const dir = await temp(t)
  const original = await sourceCandidate()
  const changes = [
    { ...original, productionEnabled: true },
    { ...original, published: true },
    { ...original, publicSavingsClaimEligible: true },
    { ...original, verifiedCurrentCheckoutPrice: true },
    { ...original, source: { ...original.source, sha256: '0'.repeat(64) } },
    { ...original, observation: { ...original.observation,
      currentPriceCents: 1.99 } },
    { ...original, observation: { ...original.observation,
      availability: 'unknown' } },
  ]
  for (let i = 0; i < changes.length; i++) {
    const output = path.join(dir, 'forged-' + i + '.json')
    await assert.rejects(writePrivateRetailerPriceSnapshot([changes[i]], output),
      /archive refused/)
    await assert.rejects(stat(output), { code: 'ENOENT' })
  }
})

test('hostile getters and Proxy inputs are rejected without executing caller code', async t => {
  const dir = await temp(t)
  const original = await sourceCandidate()
  let invoked = 0
  const accessor = { ...original }
  Object.defineProperty(accessor, 'source', {
    get() { invoked++; throw new Error('PRIVATE_SOURCE_NO_READ') },
  })
  const items = [[accessor], new Proxy([original], {})]
  for (let i = 0; i < items.length; i++) {
    await assert.rejects(writePrivateRetailerPriceSnapshot(items[i],
      path.join(dir, 'unsafe-' + i + '.json')), /archive refused/)
  }
  assert.equal(invoked, 0)
})

test('symlinked parent of private review output is rejected without altering real target', async t => {
  const dir = await temp(t)
  const real = path.join(dir, 'real')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(real)
  await symlink(real, path.join(dir, 'alias'))
  const item = await sourceCandidate()
  await assert.rejects(writePrivateRetailerPriceSnapshot([item],
    path.join(dir, 'alias', 'private.json')))
  await assert.rejects(stat(path.join(real, 'private.json')), { code: 'ENOENT' })
})
