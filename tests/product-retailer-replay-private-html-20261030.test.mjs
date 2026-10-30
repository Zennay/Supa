import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as download } from '../scripts/retailer-download-reviewed-source.mjs'
import { replayPrivateProductHtmlSnapshot, savePrivateOfflineProductReview, compareArchivedPrivateProductSnapshots, savePrivateOfflineReviewBatch, savePrivateOfflineDriftReview, replayPrivateSelectorHtmlSnapshot, comparePrivateSelectorHtmlSnapshots, savePrivateSelectorHtmlReview, savePrivateSelectorDriftReview, savePrivateSelectorStabilityArchive } from '../scripts/retailer-replay-private-html-product.mjs'

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
  assert.equal(replay.reviewReason, null)
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
  assert.equal(summary.created, true)
  assert.equal(summary.status, 'candidate_for_human_review')
  assert.equal(summary.humanReviewRequired, true)
  assert.equal(summary.published, false)
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.archiveSha256,
    createHash('sha256').update(await readFile(filename)).digest('hex'))
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
  assert.equal(summary.archiveSha256,
    createHash('sha256').update(await readFile(output)).digest('hex'))
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
  assert.equal(summary.reviewReasonCounts.availability_unconfirmed, 1)
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
  assert.equal(historical.reviewReason, 'stale_capture')
  assert.equal(historical.observation, null)
  assert.ok(historical.selectorProposals.length > 0)
  assert.equal(historical.permissionVerifiedForThisReplay, false)
  assert.equal(historical.published, false)
})


test('private archive refuses world-visible staging directory without writing a review', async t => {
  const { mkdir } = await import('node:fs/promises')
  const source = await capture(t)
  const publicDir = source.replace('captured.html', 'public-staging')
  await mkdir(publicDir, { mode: 0o755 })
  await chmod(publicDir, 0o755) // VPS umask may be 077
  const out = join(publicDir, 'review.json')
  await assert.rejects(savePrivateOfflineProductReview(source, out), /refused/)
  await assert.rejects(stat(out), /ENOENT/)
  const batchOut = join(publicDir, 'batch-review.json')
  await assert.rejects(savePrivateOfflineReviewBatch([source], batchOut), /refused/)
  await assert.rejects(stat(batchOut), /ENOENT/)
})


test('independent SHA-pinned offline selector drift is saved mode 0600 without product price or URL', async t => {
  const first = await capture(t)
  const later = await capture(t, page.replace('class="product-card"', 'class="item-card"')
    .replace('"price":"3.25"', '"price":"3.99"'))
  const output = first.replace('captured.html', 'drift-review.json')
  const summary = await savePrivateOfflineDriftReview(first, later, output)
  assert.equal(summary.created, true)
  assert.equal(summary.archiveSha256,
    createHash('sha256').update(await readFile(output)).digest('hex'))
  assert.equal(summary.humanReviewRequired, true)
  assert.equal(summary.published, false)
  const saved = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(saved.alert.privateProductEvidence.priceChangeCount, 1)
  assert.ok(saved.alert.missingSelectorCandidates > 0)
  assert.ok(saved.alert.newSelectorCandidates > 0)
  assert.equal(saved.before.sha256, createHash('sha256').update(page).digest('hex'))
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  assert.doesNotMatch(JSON.stringify(saved), /www\.plus\.nl|Synthetic flour|3\.99|3\.25/)
  await assert.rejects(savePrivateOfflineDriftReview(first, later, output), /refused/)
})

test('CLI --drift-save emits only a private review completion status', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const first = await capture(t)
  const next = await capture(t, page.replace('class="product-card"', 'class="item-card"'))
  const out = first.replace('captured.html', 'drift-cli.json')
  const script = new URL('../scripts/retailer-replay-private-html-product.mjs', import.meta.url).pathname
  const { stdout } = await run(process.execPath,
    ['--experimental-strip-types', script, '--drift-save', first, next, out])
  assert.equal(JSON.parse(stdout).created, true)
  assert.doesNotMatch(stdout, /fictional|www\.plus|product-card|item-card|captured\.html/i)
  assert.equal((await stat(out)).mode & 0o777, 0o600)
})


test('hardlinked private HTML or manifest cannot impersonate a second source capture', async t => {
  const { link } = await import('node:fs/promises')
  const original = await capture(t)
  const sameHtmlAlias = original.replace('captured.html', 'other-hardlink.html')
  await link(original, sameHtmlAlias)
  await assert.rejects(replayPrivateProductHtmlSnapshot(original), /refused/)
  await rm(sameHtmlAlias)
  const manifest = original + '.manifest.json'
  const alias = original.replace('captured.html', 'other-manifest-hardlink.json')
  await link(manifest, alias)
  await assert.rejects(replayPrivateProductHtmlSnapshot(original), /refused/)
  await rm(alias)
  assert.equal((await replayPrivateProductHtmlSnapshot(original)).status,
    'candidate_for_human_review')
})

test('replay refuses source HTML in publicly listable parent directories', async t => {
  const original = await capture(t)
  const parent = original.slice(0, original.lastIndexOf('/'))
  await chmod(parent, 0o755)
  await assert.rejects(replayPrivateProductHtmlSnapshot(original), /refused/)
})

test('archived Deka HTML never trusts parseable JSON-LD over contradictory Nuxt price', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-deka-conflict-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fixture = JSON.parse(await readFile(new URL(
    '../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url), 'utf8'))
  const dekaUrl = fixture.source.url
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.weight = { value: '1 liter' }
  ld.offers.Price = 0.99
  ld.offers.price = '0.99'
  const markup = '<html><script id="__NUXT_DATA__">' +
    JSON.stringify(fixture.nuxtPayload) + '</script><script type="application/ld+json">' +
    JSON.stringify(ld) + '</script></html>'
  const grantFile = join(dir, 'fictitious-grant.json')
  const output = join(dir, 'snapshot.html')
  const fake = structuredClone(gate)
  fake.sources[1].permissionStatus = 'permitted'
  fake.sources[1].productionEnabled = true
  await writeFile(grantFile, JSON.stringify({
    ...grant, supermarket: 'dekamarkt', sourceUrl: dekaUrl,
  }), { mode: 0o600 })
  await download([grantFile, output], {
    testGateDocument: fake, fetchFn: async () => new Response(markup, {
      status: 200, headers: { 'content-type': 'text/html' },
    }), writeOutput() {},
  })
  const replay = await replayPrivateProductHtmlSnapshot(output)
  assert.equal(replay.status, 'unverified_product')
  assert.equal(replay.reviewReason, 'missing_or_conflicting_product_evidence')
  assert.equal(replay.observation, null)
  assert.equal(replay.sourceRightsForPublicationVerified, false)
  assert.equal(replay.published, false)
})


test('missing physical pack becomes an actionable private review reason', async t => {
  const incomplete = page.replace('"weight":{"value":"500 g"}',
    '"weight":{"value":"unspecified bag"}')
  const file = await capture(t, incomplete)
  const review = await replayPrivateProductHtmlSnapshot(file)
  assert.equal(review.status, 'unverified_product')
  assert.equal(review.reviewReason, 'price_or_physical_pack_missing')
  assert.equal(review.observation, null)
  assert.equal(review.permissionVerifiedForThisReplay, false)
})

async function archivedSelectorPage(t, supermarket, kind, sourceUrl, markup) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-offline-selector-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const grantPath = join(dir, 'fictional-grant.json')
  const htmlPath = join(dir, 'captured.html')
  const fictional = structuredClone(gate)
  fictional.sources.find(x => x.supermarket === supermarket).permissionStatus = 'permitted'
  fictional.sources.find(x => x.supermarket === supermarket).productionEnabled = true
  await writeFile(grantPath, JSON.stringify({
    supermarket, kind, sourceUrl, reviewed: true,
    termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true,
  }), { mode: 0o600 })
  await download([grantPath, htmlPath], {
    testGateDocument: fictional, writeOutput() {},
    fetchFn: async () => new Response(markup, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
  return htmlPath
}

test('PLUS catalog HTML can be SHA-replayed into a private selector review without price claims', async t => {
  const html = '<html><article class="product-card"><h3 class="product-name">Synthetic product</h3>' +
    '<span class="offer-price">3,25</span></article></html>'
  const file = await archivedSelectorPage(t, 'plus', 'catalog',
    'https://www.plus.nl/producten', html)
  const record = await replayPrivateSelectorHtmlSnapshot(file)
  assert.equal(record.status, 'human-selector-review-required')
  assert.equal(record.source.kind, 'catalog')
  assert.equal(record.proposals.source.sha256, createHash('sha256').update(html).digest('hex'))
  assert.ok(record.proposals.selectors.some(x => x.selector === 'article.product-card'))
  assert.equal(record.priceExtractionEnabled, false)
  assert.equal(record.automatedSelectorPromotion, false)
  assert.equal(record.published, false)
  assert.doesNotMatch(JSON.stringify(record), /www\.plus\.nl|Synthetic product|3,25/)
  await assert.rejects(replayPrivateProductHtmlSnapshot(file), /refused/)
  const review = file.replace('captured.html', 'private-catalog-review.json')
  const summary = await savePrivateSelectorHtmlReview(file, review)
  assert.equal(summary.created, true)
  assert.equal((await stat(review)).mode & 0o777, 0o600)
  assert.equal(summary.archiveSha256,
    createHash('sha256').update(await readFile(review)).digest('hex'))
})

test('Deka offers and PLUS catalog selectors support offline drift but reject mixed URLs/kinds', async t => {
  const dekaUrl = 'https://www.dekamarkt.nl/aanbiedingen'
  const beforeMarkup = '<html><article class="offer-card"><span class="offer-price">1.99</span></article></html>'
  const afterMarkup = '<html><article class="deal-card"><span class="offer-price">2.29</span></article></html>'
  const before = await archivedSelectorPage(t, 'dekamarkt', 'offers', dekaUrl, beforeMarkup)
  const after = await archivedSelectorPage(t, 'dekamarkt', 'offers', dekaUrl, afterMarkup)
  const offer = await replayPrivateSelectorHtmlSnapshot(before)
  assert.equal(offer.source.retailerId, 'dekamarkt')
  assert.equal(offer.source.kind, 'offers')
  assert.equal(offer.priceExtractionEnabled, false)
  const drift = await comparePrivateSelectorHtmlSnapshots(before, after)
  assert.equal(drift.mode, 'private-offline-selector-drift-alert')
  assert.equal(drift.htmlBytesDiffer, true)
  assert.ok(drift.missingSelectorCandidates > 0)
  assert.equal(drift.automatedSelectorPromotion, false)
  assert.doesNotMatch(JSON.stringify(drift), /www\.dekamarkt\.nl|1\.99|2\.29|offer-card/)
  const other = await archivedSelectorPage(t, 'dekamarkt', 'offers',
    'https://www.dekamarkt.nl/aanbiedingen/week', afterMarkup)
  await assert.rejects(comparePrivateSelectorHtmlSnapshots(before, other), /refused/)
  const catalog = await archivedSelectorPage(t, 'plus', 'catalog',
    'https://www.plus.nl/producten', beforeMarkup)
  await assert.rejects(comparePrivateSelectorHtmlSnapshots(before, catalog), /refused/)
})

test('catalog/offer CLI records redacted private selectors and compare-only drift', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const url = 'https://www.dekamarkt.nl/aanbiedingen'
  const before = await archivedSelectorPage(t, 'dekamarkt', 'offers', url,
    '<article class="offer-card">Synthetic 1.99</article>')
  const after = await archivedSelectorPage(t, 'dekamarkt', 'offers', url,
    '<article class="deal-card">Synthetic 2.29</article>')
  const tool = new URL('../scripts/retailer-replay-private-html-product.mjs', import.meta.url).pathname
  const privateFile = before.replace('captured.html', 'selector-review.json')
  const { stdout: saved } = await run(process.execPath,
    ['--experimental-strip-types', tool, '--selectors', before, privateFile])
  const receipt = JSON.parse(saved)
  assert.equal(receipt.created, true)
  assert.equal(receipt.archiveSha256,
    createHash('sha256').update(await readFile(privateFile)).digest('hex'))
  const { stdout: reportText } = await run(process.execPath,
    ['--experimental-strip-types', tool, '--selector-drift', before, after])
  const report = JSON.parse(reportText)
  assert.equal(report.htmlBytesDiffer, true)
  assert.ok(report.newSelectorCandidates > 0)
  assert.doesNotMatch(saved + reportText, /Synthetic|www\.dekamarkt|offer-card|deal-card|1\.99|2\.29/)
})


test('catalog/offer drift-save persists private immutable aggregate alert with provenance', async t => {
  const source = 'https://www.plus.nl/producten'
  const before = await archivedSelectorPage(t, 'plus', 'catalog', source,
    '<article class="product-card">Synthetic first</article>')
  const after = await archivedSelectorPage(t, 'plus', 'catalog', source,
    '<article class="item-card">Synthetic next</article>')
  const target = before.replace('captured.html', 'catalog-drift.json')
  const saved = await savePrivateSelectorDriftReview(before, after, target)
  assert.equal(saved.created, true)
  assert.equal(saved.published, false)
  const archive = JSON.parse(await readFile(target, 'utf8'))
  assert.equal(archive.mode, 'private-catalog-offer-selector-drift-review')
  assert.equal(archive.source.kind, 'catalog')
  assert.ok(archive.alert.newSelectorCandidates > 0)
  assert.equal(archive.priceExtractionEnabled, false)
  assert.equal(archive.automatedSelectorPromotion, false)
  assert.equal(saved.archiveSha256,
    createHash('sha256').update(await readFile(target)).digest('hex'))
  assert.doesNotMatch(JSON.stringify(archive), /Synthetic|www\.plus\.nl|product-card|item-card/)
  await assert.rejects(savePrivateSelectorDriftReview(before, after, target), /refused/)
})

test('canonical PLUS catalog and Deka offers rights prevent network capture', async t => {
  const cases = [
    ['plus', 'catalog', 'https://www.plus.nl/producten'],
    ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
  ]
  for (const [supermarket, kind, sourceUrl] of cases) {
    const dir = await mkdtemp(join(tmpdir(), 'supa-denied-catalog-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const input = join(dir, 'fictional-grant.json')
    const output = join(dir, 'must-not-exist.html')
    await writeFile(input, JSON.stringify({
      supermarket, kind, sourceUrl, reviewed: true,
      termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true,
    }), { mode: 0o600 })
    let networkCalls = 0
    await assert.rejects(download([input, output], {
      fetchFn: async () => { networkCalls++; throw Error('unexpected network') },
      writeOutput() {},
    }), /Explicit retailer source permission required/)
    assert.equal(networkCalls, 0)
    await assert.rejects(stat(output), /ENOENT/)
  }
})

test('CLI selector drift archive refuses overwrite and prints no retailer evidence', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const source = 'https://www.plus.nl/producten'
  const before = await archivedSelectorPage(t, 'plus', 'catalog', source,
    '<article class="product-card">Synthetic</article>')
  const after = await archivedSelectorPage(t, 'plus', 'catalog', source,
    '<article class="item-card">Synthetic</article>')
  const file = before.replace('captured.html', 'selectors-drift-cli.json')
  const tool = new URL('../scripts/retailer-replay-private-html-product.mjs', import.meta.url).pathname
  const args = ['--experimental-strip-types', tool, '--selector-drift-save', before, after, file]
  const { stdout } = await run(process.execPath, args)
  assert.equal(JSON.parse(stdout).created, true)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.doesNotMatch(stdout, /Synthetic|www\.plus|product-card|item-card/)
  await assert.rejects(run(process.execPath, args))
})

test('two PLUS catalog snapshots derive stable selectors only from real supplied HTML bytes', async t => {
  const source = 'https://www.plus.nl/producten'
  const original = await archivedSelectorPage(t,'plus','catalog',source,
    '<article class="product-card"><span class="price-value">SECRET 2,39</span></article>')
  const variant = await archivedSelectorPage(t,'plus','catalog',source,
    '<article class="product-card"><span class="price-value">SECRET 2,59</span><h3 class="product-name">Synthetic</h3></article>')
  const out = original.replace('captured.html','stable-selector-review.json')
  const summary = await savePrivateSelectorStabilityArchive([original,variant],out)
  assert.equal(summary.sampleCount,2)
  assert.equal(summary.stableCandidateCount,2)
  assert.equal(summary.unstableCandidateCount,2)
  assert.equal(summary.published,false)
  assert.equal((await stat(out)).mode & 0o777,0o600)
  assert.doesNotMatch(JSON.stringify(summary),/price-value|SECRET|www\.plus\.nl|captured\.html/)
  const saved = JSON.parse(await readFile(out,'utf8'))
  assert.equal(saved.mode,'offline-private-selector-stability')
  assert.deepEqual(saved.stableCandidates.map(x=>x.selector).sort(),
    ['article.product-card','span.price-value'].sort())
  assert.equal(saved.samples.length,2)
  assert.equal(saved.unstableCandidates.length,2)
  assert.deepEqual(saved.unstableCandidates.map(x=>x.field).sort(),['name','product'])
  assert.deepEqual(saved.fieldCoverage.price,{observedCandidates:1,stableCandidates:1})
  assert.deepEqual(saved.fieldCoverage.pack,{observedCandidates:0,stableCandidates:0})
  assert.ok(saved.samples.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)))
  assert.equal(saved.automatedSelectorPromotion,false)
  assert.equal(saved.sourceRightsForPublicationVerified,false)
  assert.equal(saved.priceExtractionEnabled,false)
  await assert.rejects(savePrivateSelectorStabilityArchive([original,variant],out),/refused/)
  await assert.rejects(savePrivateSelectorStabilityArchive([original,original],
    original.replace('captured.html','duplicate.json')),/refused/)
  const deka = await archivedSelectorPage(t,'dekamarkt','offers',
    'https://www.dekamarkt.nl/aanbiedingen','<article class="offer-card"></article>')
  await assert.rejects(savePrivateSelectorStabilityArchive([original,deka],
    original.replace('captured.html','mixed-store.json')),/refused/)
})

test('offline Deka offers selector stability CLI publishes only counts and a 0600 digest receipt', async t => {
  const url = 'https://www.dekamarkt.nl/aanbiedingen'
  const a = await archivedSelectorPage(t,'dekamarkt','offers',url,
    '<article class="offer-card"><span class="price-value">SYNTHETIC 1.99</span></article>')
  const b = await archivedSelectorPage(t,'dekamarkt','offers',url,
    '<article class="offer-card"><span class="price-value">SYNTHETIC 2.29</span></article>')
  const archive = a.replace('captured.html','stable-offers.json')
  const {execFile}=await import('node:child_process')
  const {promisify}=await import('node:util')
  const run=promisify(execFile)
  const tool=new URL('../scripts/retailer-replay-private-html-product.mjs',import.meta.url).pathname
  const {stdout}=await run(process.execPath,
    ['--experimental-strip-types',tool,'--selector-stability',archive,a,b])
  const receipt=JSON.parse(stdout)
  assert.equal(receipt.stableCandidateCount,3)
  assert.equal(receipt.published,false)
  assert.doesNotMatch(stdout,/offer-card|price-value|SYNTHETIC|dekamarkt\.nl|captured\.html|stable-offers/)
  assert.equal((await stat(archive)).mode & 0o777,0o600)
  assert.equal(receipt.archiveSha256,createHash('sha256').update(await readFile(archive)).digest('hex'))
})

test('portable class review detects a real reused class after HTML tag changes', async t => {
  const url = 'https://www.plus.nl/producten'
  const first = await archivedSelectorPage(t,'plus','catalog',url,
    '<article class="product-card"><span class="price-value">SYNTHETIC</span></article>')
  const second = await archivedSelectorPage(t,'plus','catalog',url,
    '<div class="product-card"><p class="price-value">SYNTHETIC</p></div>')
  const file = first.replace('captured.html','portable-selector-review.json')
  const receipt = await savePrivateSelectorStabilityArchive([first,second],file)
  assert.equal(receipt.stableCandidateCount,0)
  assert.equal(receipt.stablePortableClassCandidateCount,2)
  assert.doesNotMatch(JSON.stringify(receipt),/product-card|price-value|www\.plus\.nl|captured\.html/)
  const archived = JSON.parse(await readFile(file,'utf8'))
  assert.deepEqual(archived.stablePortableClassCandidates.map(row=>row.selector).sort(),
    ['.price-value','.product-card'])
  assert.ok(archived.stablePortableClassCandidates.every(row=>
    row.status==='needs-human-review' && row.derivedFromActualClassTokens))
  assert.equal(archived.automatedSelectorPromotion,false)
  assert.equal(archived.readyForIngestion,false)
  assert.equal((await stat(file)).mode & 0o777,0o600)
})
