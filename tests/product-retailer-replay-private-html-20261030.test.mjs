import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as download } from '../scripts/retailer-download-reviewed-source.mjs'
import { replayPrivateProductHtmlSnapshot, savePrivateOfflineProductReview, compareArchivedPrivateProductSnapshots, savePrivateOfflineReviewBatch } from '../scripts/retailer-replay-private-html-product.mjs'

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

async function capture(t, markup = page, sourceUrl = url) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-replay-fixture-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const input = join(dir, 'synthetic-grant.json'), output = join(dir, 'captured.html')
  await writeFile(input, JSON.stringify({ ...grant, sourceUrl }), { mode: 0o600 })
  let calls = 0
  await download([input, output], {
    testGateDocument: gate,
    fetchFn: async () => { calls++; return new Response(markup,
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
  await assert.rejects(replayPrivateProductHtmlSnapshot(output), /refused/)
  await writeFile(manifestPath, original)
  const duplicate = original.replace('"schemaVersion": 1,',
    '"schemaVersion": 1,\n  "schemaVersion": 1,')
  await writeFile(manifestPath, duplicate)
  await assert.rejects(replayPrivateProductHtmlSnapshot(output), /refused/)
  await writeFile(manifestPath, original)
  await chmod(output, 0o644)
  await assert.rejects(replayPrivateProductHtmlSnapshot(output), /refused/)
})


test('offline review is durably written mode 0600, never overwrites or publishes', async t => {
  const output = await capture(t)
  const filename = output.replace('captured.html', 'operator-review.json')
  const summary = await savePrivateOfflineProductReview(output, filename)
  assert.deepEqual(summary, { created: true, status: 'candidate_for_human_review',
    humanReviewRequired: true, published: false, productionEnabled: false })
  const saved = JSON.parse(await readFile(filename, 'utf8'))
  assert.equal((await stat(filename)).mode & 0o777, 0o600)
  assert.equal(saved.observation.currentPriceCents, 325)
  assert.equal(saved.permissionVerifiedForThisReplay, false)
  assert.equal(saved.readyForIngestion, false)
  await assert.rejects(savePrivateOfflineProductReview(output, filename), /refused/)
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).source.sha256,
    createHash('sha256').update(page).digest('hex'))
})

test('second supermarket: offline archived Deka Nuxt+JSON-LD is corroborated, never released', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-deka-replay-fixture-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fixture = JSON.parse(await readFile(new URL(
    '../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url), 'utf8'))
  const dekaUrl = fixture.source.url
  // Only the historical STRUCTURE is reused. This HTML is entirely synthetic.
  const markup = '<html><head><script id="__NUXT_DATA__">' +
    JSON.stringify(fixture.nuxtPayload) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify(fixture.jsonLdProduct) +
    '</script></head><body>SYNTHETIC historical form</body></html>'
  const scoped = { ...grant, supermarket: 'dekamarkt', sourceUrl: dekaUrl }
  const grantFile = join(dir, 'synthetic-deka-grant.json'), output = join(dir, 'deka.html')
  await writeFile(grantFile, JSON.stringify(scoped), { mode: 0o600 })
  const syntheticGate = structuredClone(gate)
  syntheticGate.sources[1].permissionStatus = 'permitted'
  syntheticGate.sources[1].productionEnabled = true
  await download([grantFile, output], { testGateDocument: syntheticGate,
    fetchFn: async () => new Response(markup, { status: 200,
      headers: { 'content-type': 'text/html' } }), writeOutput() {} })
  const replay = await replayPrivateProductHtmlSnapshot(output)
  assert.equal(replay.status, 'candidate_for_human_review')
  assert.equal(replay.observation.currentPriceCents, 85)
  assert.equal(replay.observation.sourceProductId, '115873')
  assert.equal(replay.permissionVerifiedForThisReplay, false)
  assert.equal(replay.verifiedCurrentCheckoutPrice, false)
})


test('two separately SHA-pinned private product snapshots yield count-only selector drift', async t => {
  const before = await capture(t)
  const changed = page.replace('class="product-card"', 'class="item-card"')
  const after = await capture(t, changed)
  const report = await compareArchivedPrivateProductSnapshots(before, after)
  assert.equal(report.mode, 'private-offline-selector-drift-alert')
  assert.equal(report.htmlBytesDiffer, true)
  assert.ok(report.newSelectorCandidates > 0)
  assert.ok(report.missingSelectorCandidates > 0)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(report), /Synthetic flour|www\.plus\.nl|product-card|item-card|3\.25/)
  const same = await compareArchivedPrivateProductSnapshots(before, before)
  assert.equal(same.htmlBytesDiffer, false)
  assert.equal(same.newSelectorCandidates, 0)
})

test('operator CLI writes private candidate review and emits redacted drift counts only', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const script = new URL('../scripts/retailer-replay-private-html-product.mjs', import.meta.url).pathname
  const first = await capture(t)
  const second = await capture(t, page.replace('class="product-card"', 'class="item-card"'))
  const { stdout: drift } = await run(process.execPath,
    ['--experimental-strip-types', script, '--drift', first, second])
  const report = JSON.parse(drift)
  assert.equal(report.mode, 'private-offline-selector-drift-alert')
  assert.ok(report.newSelectorCandidates > 0 && report.missingSelectorCandidates > 0)
  assert.doesNotMatch(drift, /fictional-flour|product-card|item-card|3\.25|www\.plus\.nl/i)
  const reviewPath = first.replace('captured.html', 'new-operator-review.json')
  const { stdout: summary } = await run(process.execPath,
    ['--experimental-strip-types', script, first, reviewPath])
  assert.equal(JSON.parse(summary).created, true)
  assert.doesNotMatch(summary, /fictional-flour|3\.25|www\.plus\.nl/i)
  assert.equal((await stat(reviewPath)).mode & 0o777, 0o600)
})


test('private drift refuses comparing different SKUs even at the same store', async t => {
  const before = await capture(t)
  const secondUrl = 'https://www.plus.nl/product/fictional-flour-999'
  const second = await capture(t, page.replaceAll(url, secondUrl), secondUrl)
  const one = await replayPrivateProductHtmlSnapshot(before)
  const two = await replayPrivateProductHtmlSnapshot(second)
  assert.notEqual(one.source.productUrlSha256, two.source.productUrlSha256)
  assert.doesNotMatch(JSON.stringify(one.source), /fictional-flour|www\.plus\.nl/)
  await assert.rejects(compareArchivedPrivateProductSnapshots(before, second), /refused/)
})


test('same-product price drift is count-only, while unverified evidence remains unknown', async t => {
  const first = await capture(t)
  const changedPrice = await capture(t, page.replace('"price":"3.25"', '"price":"3.49"'))
  const price = await compareArchivedPrivateProductSnapshots(first, changedPrice)
  assert.equal(price.privateProductEvidence.priceChangeCount, 1)
  assert.equal(price.privateProductEvidence.packChangeCount, 0)
  assert.equal(price.privateProductEvidence.identityChangedCount, 0)
  assert.equal(price.privateProductEvidence.currentCheckoutVerified, false)
  assert.doesNotMatch(JSON.stringify(price), /3\.49|3\.25|Synthetic flour|www\.plus\.nl/)
  const changedPack = await capture(t, page.replace('500 g', '750 g'))
  const pack = await compareArchivedPrivateProductSnapshots(first, changedPack)
  assert.equal(pack.privateProductEvidence.priceChangeCount, 0)
  assert.equal(pack.privateProductEvidence.packChangeCount, 1)
  const unavailable = await capture(t, page.replace('InStock', 'OutOfStock'))
  const unknown = await compareArchivedPrivateProductSnapshots(first, unavailable)
  assert.equal(unknown.privateProductEvidence.priceChangeCount, null)
  assert.equal(unknown.privateProductEvidence.packChangeCount, null)
  assert.equal(unknown.privateProductEvidence.humanReviewRequired, true)
})


test('same URL with changed product name cannot masquerade as comparable price', async t => {
  const before = await capture(t)
  const swappedName = await capture(t, page.replace('Synthetic flour', 'Different synthetic flour')
    .replace('"price":"3.25"', '"price":"0.01"'))
  const report = await compareArchivedPrivateProductSnapshots(before, swappedName)
  assert.equal(report.privateProductEvidence.identityChangedCount, 1)
  assert.equal(report.privateProductEvidence.priceChangeCount, null)
  assert.equal(report.privateProductEvidence.packChangeCount, null)
  assert.doesNotMatch(JSON.stringify(report), /Different synthetic flour|0\.01/)
})


test('offline two-product batch writes independent historical review without public quotes', async t => {
  const first = await capture(t)
  const secondUrl = 'https://www.plus.nl/product/fictional-flour-999'
  const second = await capture(t, page.replaceAll(url, secondUrl), secondUrl)
  const output = first.replace('captured.html', 'batch-review.json')
  const summary = await savePrivateOfflineReviewBatch([first, second], output)
  assert.equal(summary.count, 2)
  assert.equal(summary.candidateCount, 2)
  assert.equal(summary.unverifiedCount, 0)
  assert.equal(summary.published, false)
  assert.deepEqual(summary.retailerCounts, {
    plus: { candidates: 2, unverified: 0 }, dekamarkt: { candidates: 0, unverified: 0 },
  })
  const disk = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(disk.mode, 'offline-private-product-review-batch')
  assert.equal(disk.verifiedCurrentCheckoutPrices, 0)
  assert.equal(disk.entries.length, 2)
  assert.equal(new Set(disk.entries.map(x => x.source.productUrlSha256)).size, 2)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  await assert.rejects(savePrivateOfflineReviewBatch([first, second], output), /refused/)
  await assert.rejects(savePrivateOfflineReviewBatch([first, first],
    output.replace('batch-review.json', 'duplicate.json')), /refused/)
})

test('offline review batch CLI never exposes SKU, source URL or price', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const first = await capture(t)
  const secondUrl = 'https://www.plus.nl/product/fictional-flour-999'
  const second = await capture(t, page.replaceAll(url, secondUrl), secondUrl)
  const script = new URL('../scripts/retailer-replay-private-html-product.mjs', import.meta.url).pathname
  const output = first.replace('captured.html', 'batch-cli.json')
  const { stdout } = await run(process.execPath,
    ['--experimental-strip-types', script, '--batch', output, first, second])
  assert.equal(JSON.parse(stdout).count, 2)
  assert.doesNotMatch(stdout, /fictional-flour|www\.plus\.nl|3\.25|captured\.html/i)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
})


test('batch never counts an out-of-stock SKU as price; still retains review evidence', async t => {
  const first = await capture(t)
  const secondUrl = 'https://www.plus.nl/product/fictional-out-of-stock-999'
  const noStock = page.replaceAll(url, secondUrl).replace('InStock', 'OutOfStock')
  const second = await capture(t, noStock, secondUrl)
  const output = first.replace('captured.html', 'out-of-stock-batch.json')
  const summary = await savePrivateOfflineReviewBatch([first, second], output)
  assert.equal(summary.candidateCount, 1)
  assert.equal(summary.unverifiedCount, 1)
  assert.equal(summary.retailerCounts.plus.unverified, 1)
  const archived = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(archived.entries[1].observation, null)
  assert.equal(archived.entries[1].status, 'unverified_product')
  assert.equal(archived.verifiedCurrentCheckoutPrices, 0)
})

test('mixed offline pilot batch processes independently attributed PLUS and Deka evidence', async t => {
  const plus = await capture(t)
  const dir = await mkdtemp(join(tmpdir(), 'supa-deka-batch-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fixture = JSON.parse(await readFile(new URL(
    '../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url), 'utf8'))
  const sourceUrl = fixture.source.url
  const markup = '<html><script id="__NUXT_DATA__">' +
    JSON.stringify(fixture.nuxtPayload) + '</script><script type="application/ld+json">' +
    JSON.stringify(fixture.jsonLdProduct) + '</script></html>'
  const grantFile = join(dir, 'fictional-deka-grant.json')
  const deka = join(dir, 'deka.html')
  const synthetic = structuredClone(gate)
  synthetic.sources[1].permissionStatus = 'permitted'
  synthetic.sources[1].productionEnabled = true
  await writeFile(grantFile, JSON.stringify({
    ...grant, supermarket: 'dekamarkt', sourceUrl,
  }), { mode: 0o600 })
  await download([grantFile, deka], {
    testGateDocument: synthetic,
    fetchFn: async () => new Response(markup, {
      headers: { 'content-type': 'text/html' }, status: 200,
    }), writeOutput() {},
  })
  const review = plus.replace('captured.html', 'mixed-pilot-review.json')
  const result = await savePrivateOfflineReviewBatch([plus, deka], review)
  assert.deepEqual(result.retailerCounts, {
    plus: { candidates: 1, unverified: 0 },
    dekamarkt: { candidates: 1, unverified: 0 },
  })
  const archive = JSON.parse(await readFile(review, 'utf8'))
  assert.deepEqual(archive.entries.map(x => x.source.retailerId), ['plus', 'dekamarkt'])
  assert.equal(archive.entries[1].observation.currentPriceCents, 85)
  assert.equal(archive.published, false)
  assert.equal(archive.sourceRightsForPublicationVerified, false)
})


test('historical HTML remains inspectable but is not a fresh price candidate', async t => {
  const output = await capture(t)
  const manifestPath = output + '.manifest.json'
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.source.capturedAt = new Date(Date.now() - 25 * 3600_000).toISOString()
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const historical = await replayPrivateProductHtmlSnapshot(output)
  assert.equal(historical.status, 'unverified_product')
  assert.equal(historical.observation, null)
  assert.ok(historical.selectorProposals.length > 0)
  assert.equal(historical.permissionVerifiedForThisReplay, false)
  assert.equal(historical.published, false)
})
