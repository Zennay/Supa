import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as download } from '../scripts/retailer-download-reviewed-source.mjs'
import { replayPrivateProductHtmlSnapshot } from '../scripts/retailer-replay-private-html-product.mjs'

const url = 'https://www.plus.nl/product/fictional-flour-123'
const grant = { supermarket: 'plus', kind: 'product', sourceUrl: url,
  reviewed: true, termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true }
const gate = { version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-29',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: supermarket === 'plus' ? 'permitted' : 'unresolved',
    productionEnabled: supermarket === 'plus',
    evidence: [{ kind: 'written_permission', url: 'https://example.test/fake',
      finding: 'SYNTHETIC ONLY. No real supermarket permission.' }],
  })) }
const page = '<html><body><div class="product-card">Synthetic only</div>' +
  '<script type="application/ld+json">' +
  JSON.stringify({ '@type': 'Product', name: 'Synthetic flour', url,
    sku: 'fictional-flour-123', weight: { value: '500 g' },
    offers: { '@type': 'Offer', price: '3.25', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' } }) + '</script></body></html>'

async function capture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-replay-fixture-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const input = join(dir, 'synthetic-grant.json'), output = join(dir, 'captured.html')
  await writeFile(input, JSON.stringify(grant), { mode: 0o600 })
  let calls = 0
  await download([input, output], {
    testGateDocument: gate,
    fetchFn: async () => { calls++; return new Response(page,
      { status: 200, headers: { 'content-type': 'text/html' } }) },
    writeOutput() {},
  })
  assert.equal(calls, 1)
  return output
}

test('real archived HTML+manifest path replays offline pack-price and selectors without publishing', async t => {
  const output = await capture(t)
  const replay = await replayPrivateProductHtmlSnapshot(output)
  assert.equal(replay.status, 'candidate_for_human_review')
  assert.equal(replay.observation.currentPriceCents, 325)
  assert.equal(replay.observation.pack.amount, 500)
  assert.equal(replay.observation.provenance.sha256, createHash('sha256').update(page).digest('hex'))
  assert.ok(replay.selectorProposals.some(s => s.selector === 'div.product-card'))
  for (const key of ['permissionVerifiedForThisReplay', 'readyForIngestion',
    'verifiedCurrentCheckoutPrice', 'productionEnabled', 'published',
    'publicSavingsClaimEligible']) assert.equal(replay[key], false)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
})

test('tampered source, source URL mismatch and exposed private files cannot become trusted prices', async t => {
  const output = await capture(t), manifestPath = output + '.manifest.json'
  const original = await readFile(manifestPath, 'utf8')
  await writeFile(output, page.replace('3.25', '0.01'))
  await assert.rejects(replayPrivateProductHtmlSnapshot(output), /refused/)
  await writeFile(output, page)
  const forged = JSON.parse(original)
  forged.source.url = 'https://www.plus.nl/product/other'
  await writeFile(manifestPath, JSON.stringify(forged))
  const mismatched = await replayPrivateProductHtmlSnapshot(output)
  assert.equal(mismatched.status, 'unverified_product')
  assert.equal(mismatched.observation, null)
  await writeFile(manifestPath, original)
  await chmod(output, 0o644)
  await assert.rejects(replayPrivateProductHtmlSnapshot(output), /refused/)
})
