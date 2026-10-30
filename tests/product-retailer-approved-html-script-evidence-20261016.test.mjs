import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readAuthorizedHtmlScriptEvidence } from
  '../scripts/retailer-approved-html-script-evidence.mjs'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// All permission records below are fictional and used with in-memory Response.
const plusUrl = 'https://www.plus.nl/product/fictional-123'
const dekaFixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url),
  'utf8'))
const plusProduct = {
  '@type': 'Product', name: 'Fictional 500g', sku: '123', url: plusUrl,
  weight: { value: '500 g' },
  offers: { '@type': 'Offer', price: '1.99', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
}
const mockGrant = (supermarket, url) => ({
  supermarket, kind: 'product', sourceUrl: url,
  reviewed: true, termsReviewed: true, robotsReviewed: true,
  noAntiBotBypass: true,
})
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus','dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-only',
      finding: 'Synthetic in-memory test only. No real store permission.' }],
  })),
}
function run(supermarket, markup) {
  const url = supermarket === 'plus' ? plusUrl : dekaFixture.source.url
  return captureApprovedProductPriceCandidate({
    source: { supermarket, kind: 'product', url },
    permissionGate: gate, grant: mockGrant(supermarket, url),
    capturedAt: new Date(Date.now() - 60_000).toISOString(),
    fetchFn: async () => new Response(markup, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function script(attributes, contents) {
  return '<script ' + attributes + '>' + JSON.stringify(contents) + '</script>'
}
function dekaMarkup(attributes) {
  return script(attributes, dekaFixture.nuxtPayload) +
    script('type="application/ld+json"', dekaFixture.jsonLdProduct)
}

test('exact script type/id admit valid PLUS JSON-LD and Deka Nuxt, mixed attribute casing', () => {
  const plus = readAuthorizedHtmlScriptEvidence(
    script('TYPE="application/ld+json" data-type="text/plain"', plusProduct))
  assert.equal(plus.invalid, false)
  assert.equal(plus.jsonLdBlocks.length, 1)
  const deka = readAuthorizedHtmlScriptEvidence(dekaMarkup(
    'data-id="fake" ID="__NUXT_DATA__" type="application/json"'))
  assert.equal(deka.invalid, false)
  assert.deepEqual(deka.nuxtPayload, dekaFixture.nuxtPayload)
})

test('a data-type/aria-type alias must NOT impersonate an actual JSON-LD type', () => {
  for (const attr of ['data-type="application/ld+json"',
    'aria-type="application/ld+json"',
    'data-test="x type=application/ld+json"']) {
    const evidence = readAuthorizedHtmlScriptEvidence(script(attr, plusProduct))
    assert.equal(evidence.invalid, false)
    assert.equal(evidence.jsonLdBlocks.length, 0)
  }
})

test('data-id and quoted attribute text must NOT impersonate Nuxt id', () => {
  for (const attr of ['data-id="__NUXT_DATA__"',
    'aria-id="__NUXT_DATA__"',
    'data-note="x id=__NUXT_DATA__" type="application/json"']) {
    const evidence = readAuthorizedHtmlScriptEvidence(script(attr, dekaFixture.nuxtPayload))
    assert.equal(evidence.invalid, false)
    assert.equal(evidence.nuxtPayload, null)
  }
})

test('duplicate authoritative id or type attributes reject the entire script evidence', () => {
  for (const markup of [
    script('type="application/ld+json" TYPE="application/ld+json"', plusProduct),
    script('id="__NUXT_DATA__" id="other"', dekaFixture.nuxtPayload),
  ]) {
    const result = readAuthorizedHtmlScriptEvidence(markup)
    assert.equal(result.invalid, true)
    assert.deepEqual(result.jsonLdBlocks, [])
    assert.equal(result.nuxtPayload, null)
  }
})

test('PLUS live-bridge with synthetic permission refuses a data-type spoofed product', async () => {
  const result = await run('plus', script('data-type="application/ld+json"', plusProduct))
  assert.equal(result.status, 'review_required')
  assert.equal(result.reason, 'missing_or_invalid_jsonld')
  assert.equal(result.observation, null)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('Deka fallback refuses data-id spoofed Nuxt even with authentic capital-Price schema shape', async () => {
  const result = await run('dekamarkt',
    dekaMarkup('data-id="__NUXT_DATA__" type="application/json"'))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
  assert.equal(result.productionEnabled, false)
})

test('real script id and type remain valid after hardening', async () => {
  const plus = await run('plus', script('type="application/ld+json"', plusProduct))
  assert.equal(plus.status, 'candidate_needs_review')
  assert.equal(plus.observation.currentPriceCents, 199)
  const deka = await run('dekamarkt',
    dekaMarkup('id="__NUXT_DATA__" type="application/json"'))
  assert.equal(deka.status, 'candidate_needs_review')
  assert.equal(deka.observation.currentPriceCents, 85)
  assert.equal(deka.verifiedCurrentCheckoutPrice, false)
})

test('unparseable JSON-LD and Nuxt reject instead of returning a price', async () => {
  const plus = await run('plus',
    '<script type="application/ld+json">{BROKEN</script>')
  assert.equal(plus.status, 'review_required')
  const deka = await run('dekamarkt',
    '<script id="__NUXT_DATA__">[BAD</script>' +
    script('type="application/ld+json"', dekaFixture.jsonLdProduct))
  assert.equal(deka.status, 'review_required')
})

test('hidden comment/template/textarea/noscript scripts never supply product prices', async () => {
  const productMarkup = script('type="application/ld+json"', plusProduct)
  for (const hidden of [
    '<!--' + productMarkup + '-->',
    '<template>' + productMarkup + '</template>',
    '<noscript>' + productMarkup + '</noscript>',
    '<textarea>' + productMarkup + '</textarea>',
    '<svg>' + productMarkup + '</svg>',
  ]) {
    const evidence = readAuthorizedHtmlScriptEvidence(hidden)
    assert.equal(evidence.invalid, false)
    assert.equal(evidence.jsonLdBlocks.length, 0)
    const result = await run('plus', hidden)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
  }
  const safe = await run('plus', '<!--' +
    script('type="application/ld+json"', { ...plusProduct, name: 'fake cheap' }) +
    '-->' + productMarkup)
  assert.equal(safe.status, 'candidate_needs_review')
  assert.equal(safe.observation.currentPriceCents, 199)
})

test('unclosed inert markup and external script evidence fail closed', async () => {
  const valid = script('type="application/ld+json"', plusProduct)
  for (const malformed of [
    '<!--' + valid,
    '<template>' + valid,
    '<textarea>' + valid,
    '<script type="application/ld+json">{}',
    '<script src="/fake" type="application/ld+json"></script>' + valid,
    '<script src="/fake" id="__NUXT_DATA__"></script>' + valid,
  ]) {
    const read = readAuthorizedHtmlScriptEvidence(malformed)
    assert.equal(read.invalid, true)
    const result = await run('plus', malformed)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})

test('script-looking text in a quoted HTML attribute or inert style/title is not DOM evidence', async () => {
  const real = script('type="application/ld+json"', plusProduct)
  for (const markup of [
    '<div data-source-note=\'' + real + '\'>not an HTML script element</div>',
    '<style>' + real + '</style>',
    '<title>' + real + '</title>',
    '<xmp>' + real + '</xmp>',
    '<iframe>' + real + '</iframe>',
  ]) {
    const parsed = readAuthorizedHtmlScriptEvidence(markup)
    assert.equal(parsed.invalid, false)
    assert.equal(parsed.jsonLdBlocks.length, 0)
    const outcome = await run('plus', markup)
    assert.equal(outcome.status, 'review_required')
    assert.equal(outcome.observation, null)
  }
  const accepted = await run('plus', '<div data-source-note=\'' +
    real + '\'>not data</div>' + real)
  assert.equal(accepted.status, 'candidate_needs_review')
  assert.equal(accepted.observation.currentPriceCents, 199)
})
