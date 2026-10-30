import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureAndArchiveApprovedRetailerProduct } from
  '../scripts/retailer-approved-price-archive-run.mjs'

const url = 'https://www.plus.nl/product/test-771'
const syntheticProduct = stock => ({
  '@context': 'https://schema.org', '@type': 'Product', sku: '771', url,
  name: 'Synthetic product, not on sale',
  weight: { value: '250 g' },
  offers: { '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/' + stock },
})
const source = { supermarket: 'plus', kind: 'product', url }
const grant = { ...source, sourceUrl: url,
  reviewed: true, termsReviewed: true, robotsReviewed: true,
  noAntiBotBypass: true }
delete grant.url
const syntheticPermissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-license-only',
      finding: 'Not actual consent; in-memory unit test only.' }],
  })),
}
async function freshOptions(stock = 'InStock') {
  return {
    source, grant, permissionGate: syntheticPermissionGate,
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(
      '<script type="application/ld+json">' +
      JSON.stringify(syntheticProduct(stock)) + '</script>', {
        status: 200, headers: { 'content-type': 'text/html' },
      }),
  }
}
async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-price-capture-archive-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

test('one-call PLUS own-scraper path produces 0600 unreviewed archive without leaking a price in status', async t => {
  const dir = await temp(t)
  const output = join(dir, 'first-price.json')
  const result = await captureAndArchiveApprovedRetailerProduct(await freshOptions(), output)
  assert.equal(result.mode, 'private-one-product-capture-and-archive')
  assert.equal(result.archiveCreated, true)
  assert.equal(result.candidateCount, 1)
  assert.equal(result.priceCandidateStatus, 'candidate_needs_review')
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(result), /1\.49|149|test-771/)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  const archive = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(archive.entries[0].observation.currentPriceCents, 149)
  assert.equal(archive.entries[0].observation.pack.amount, 250)
  assert.equal(archive.productionEnabled, false)
})

test('real checked-in retailer rights stop the whole scraper→disk pipeline before any network or output', async t => {
  const dir = await temp(t)
  const output = join(dir, 'no-live.json')
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
    'utf8'))
  let calls = 0
  const options = await freshOptions()
  options.permissionGate = rights
  options.fetchFn = async () => { calls++; throw Error('NO RETAIL HTTP') }
  await assert.rejects(captureAndArchiveApprovedRetailerProduct(options, output),
    /Explicit retailer source permission required/)
  assert.equal(calls, 0)
  await assert.rejects(stat(output), { code: 'ENOENT' })
})

test('unavailable product is archived only as unresolved, not promoted to a price', async t => {
  const dir = await temp(t)
  const output = join(dir, 'unavailable.json')
  const result = await captureAndArchiveApprovedRetailerProduct(
    await freshOptions('OutOfStock'), output)
  assert.equal(result.priceCandidateStatus, 'review_required')
  assert.equal(result.candidateCount, 0)
  assert.equal(result.reviewRequiredCount, 1)
  const archive = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(archive.entries[0].observation, null)
  assert.equal(archive.entries[0].reason, 'availability_unverified')
})
