import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, symlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureAndArchiveApprovedSourceReview as archive } from
  '../scripts/retailer-approved-source-review-archive.mjs'

// All rights, URLs, pages and product facts below are explicitly SYNTHETIC.
// No test contacts PLUS or DekaMarkt or creates permission evidence.
const targets = {
  plus: 'https://www.plus.nl/product/fictional-771',
  dekamarkt: 'https://www.dekamarkt.nl/producten/fictional-992',
}
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus','dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/SYNTHETIC-NOT-REAL',
      finding: 'IN-MEMORY TEST ONLY, not a retailer grant',
    }],
  })),
}
function markup(store, availability = 'InStock') {
  const product = {
    '@context': 'https://schema.org', '@type': 'Product',
    url: targets[store], sku: 'FICTIONAL-771', name: 'Synthetic test milk',
    weight: { value: '500 g' },
    offers: { '@type': 'Offer', price: '2.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/' + availability },
  }
  return '<!doctype html><html><head><script type="application/ld+json">' +
    JSON.stringify(product) + '</script></head><body>' +
    '<div class="product-card"><span class="price-value">PRIVATE-HTML-MARKER</span>' +
    '<i class="product-771-private">do not persist</i></div></body></html>'
}
function options(store, html = markup(store), extras = {}) {
  const url = targets[store]
  return {
    source: { supermarket: store, kind: 'product', url },
    permissionGate: gate,
    grant: { supermarket: store, kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30000).toISOString(),
    fetchFn: async () => new Response(html, { status: 200,
      headers: { 'content-type': 'text/html;charset=utf-8' } }),
    ...extras,
  }
}
async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-one-source-review-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
test('PLUS + Deka one-fetch private 0600 SHA-pinned price and selector archive', async t => {
  for (const store of ['plus', 'dekamarkt']) {
    const dir = await folder(t)
    const body = markup(store)
    const file = join(dir, 'source-review.json')
    let calls = 0
    const result = await archive(options(store, body, {
      fetchFn: async () => { calls++; return new Response(body, {
        status: 200, headers: { 'content-type': 'text/html' } }) },
    }), file)
    assert.equal(calls, 1)
    assert.equal(result.actualTransportInvocations, 1)
    assert.equal(result.archiveCreated, true)
    assert.equal(result.candidateCount, 1)
    assert.ok(result.selectorCount >= 2)
    assert.equal(result.approvedSelectors, 0)
    assert.equal(result.published, false)
    assert.equal(result.productionEnabled, false)
    assert.doesNotMatch(JSON.stringify(result), /Synthetic test milk|2\.49|771|992|\.html|source-review\.json/)
    const info = await stat(file)
    assert.equal(info.mode & 0o777, 0o600)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.source.url, targets[store])
    assert.equal(saved.source.sha256, createHash('sha256').update(body).digest('hex'))
    assert.equal(saved.priceReview.observation.currentPriceCents, 249)
    assert.ok(saved.selectorReview.proposals.some(x => x.selector === 'div.product-card'))
    assert.ok(saved.selectorReview.proposals.some(x => x.selector === 'span.price-value'))
    assert.ok(saved.selectorReview.proposals.every(x => x.status === 'needs-human-review'))
    assert.equal(saved.selectorReview.approvedSelectors, 0)
    assert.equal(saved.readyForIngestion, false)
    assert.equal(saved.published, false)
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE-HTML-MARKER|product-771-private/)
  }
})
test('unavailable, forged context Product is captured as unpriced human review', async t => {
  for (const [store, body, expected] of [
    ['plus', markup('plus', 'OutOfStock'), 'availability_unverified'],
    ['dekamarkt', markup('dekamarkt').replace('"@context":"https://schema.org",', ''),
      'unverified_schema_context'],
  ]) {
    const file = join(await folder(t), 'unpriced-review.json')
    const result = await archive(options(store, body), file)
    assert.equal(result.candidateCount, 0)
    assert.equal(result.reviewRequiredCount, 1)
    const record = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(record.priceReview.reason, expected)
    assert.equal(record.priceReview.observation, null)
    assert.ok(record.selectorReview.proposals.length > 0)
    assert.equal(record.published, false)
  }
})
test('catalog PLUS and offers Deka save actual observed structure, never a fabricated Product price', async t => {
  for (const [store, kind, url] of [
    ['plus', 'catalog', 'https://www.plus.nl/producten'],
    ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
  ]) {
    const file = join(await folder(t), 'structural-review.json')
    const request = options(store, markup(store), {
      source: { supermarket: store, kind, url },
      grant: { supermarket: store, kind, sourceUrl: url,
        reviewed: true, termsReviewed: true, robotsReviewed: true,
        noAntiBotBypass: true },
    })
    const status = await archive(request, file)
    assert.equal(status.sourceKind, kind)
    assert.equal(status.candidateCount, 0)
    assert.equal(status.reviewRequiredCount, 0)
    const record = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(record.priceReview, null)
    assert.ok(record.selectorReview.proposals.length > 0)
    assert.equal(record.approvedSelectors, undefined)
    assert.equal(record.published, false)
  }
})
test('actual checked-in source rights block retailer transport and disk for both stores', async t => {
  const production = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
    'utf8'))
  let calls = 0
  for (const store of ['plus','dekamarkt']) {
    const file = join(await folder(t), 'unapproved.json')
    await assert.rejects(archive(options(store, markup(store), {
      permissionGate: production, fetchFn: async () => {
        calls++; throw new Error('UNAUTHORIZED RETAILER HTTP')
      },
    }), file), /Explicit retailer source permission required/)
    await assert.rejects(stat(file), { code: 'ENOENT' })
  }
  assert.equal(calls, 0)
})
test('unsafe or occupied private destination fails before the first network request', async t => {
  const dir = await folder(t)
  const file = join(dir, 'existing.json')
  await writeFile(file, 'KEEP THE EXISTING EVIDENCE')
  const world = await folder(t)
  await chmod(world, 0o755)
  const link = join(dir, 'aliased')
  await symlink(world, link)
  let calls = 0
  const config = options('plus', markup('plus'), { fetchFn: async () => {
    calls++; throw Error('unexpected HTTP')
  } })
  for (const bad of [file, join(world, 'public.json'),
    join(link, 'symlinked.json'), '/tmp/../tmp/unsafe-source.json',
    join(dir, 'invalid name.json')]) {
    await assert.rejects(archive(config, bad))
  }
  assert.equal(calls, 0)
  assert.equal(await readFile(file, 'utf8'), 'KEEP THE EXISTING EVIDENCE')
})
