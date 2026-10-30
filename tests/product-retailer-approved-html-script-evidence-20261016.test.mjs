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

test('private JSON-LD and Nuxt price evidence never bypasses the HTML archive directive gate', async () => {
  const realScript=script('type="application/ld+json"',plusProduct)
  const page=tag=>'<html><head>'+tag+'</head><body>'+realScript+'</body></html>'
  for (const meta of [
    '<meta http-equiv="Cache-Control" content="max-age=0; no-store">',
    '<meta name="robots" content="index, noarchive">',
    '<meta name="Googlebot" content="NOARCHIVE">',
    '<meta charset="windows-1252">',
  ]) {
    const direct=readAuthorizedHtmlScriptEvidence(page(meta),plusUrl)
    assert.equal(direct.invalid,true,meta)
    assert.deepEqual(direct.jsonLdBlocks,[])
    await assert.rejects(run('plus',page(meta)),
      /(?:HTML disallows snapshot archival|HTML charset)/,meta)
    const inert=readAuthorizedHtmlScriptEvidence(page('<template>'+meta+'</template>'),plusUrl)
    assert.equal(inert.invalid,false,meta)
    assert.equal(inert.jsonLdBlocks.length,1)
  }
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
    if (malformed.startsWith('<script src=')) {
      const result = await run('plus', malformed)
      assert.equal(result.status, 'review_required')
      assert.equal(result.observation, null)
      assert.equal(result.publicSavingsClaimEligible, false)
    } else {
      // Truncated markup is now rejected at transport, before any private
      // source snapshot/candidate can be created.
      await assert.rejects(run('plus', malformed),
        /Unterminated HTML comment|Unbalanced inert HTML element/)
    }
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

test('real PLUS and Deka evidence ignores HTML plaintext and legacy fallback markup', async () => {
  const plus = script('type="application/ld+json"', plusProduct)
  for (const tag of ['plaintext','noembed','noframes']) {
    const wrapped = `<${tag}>${plus}</${tag}>`
    const evidence = readAuthorizedHtmlScriptEvidence(wrapped)
    assert.deepEqual(evidence.jsonLdBlocks, [], tag)
    const candidate = await run('plus', wrapped)
    assert.equal(candidate.status, 'review_required', tag)
    assert.equal(candidate.observation, null, tag)
    assert.equal(candidate.published, false, tag)
  }
  for (const tag of ['noembed','noframes']) {
    const legitimate = `<${tag}>${plus}</${tag}>${plus}`
    const candidate = await run('plus', legitimate)
    assert.equal(candidate.status, 'candidate_needs_review', tag)
    assert.equal(candidate.observation.currentPriceCents, 199, tag)
  }
  const deka = script('type="application/ld+json"', dekaFixture.jsonLdProduct)
  const nuxt = script('id="__NUXT_DATA__" type="application/json"', dekaFixture.nuxtPayload)
  for (const tag of ['plaintext','noembed','noframes']) {
    const wrapped = `<${tag}>${nuxt}${deka}</${tag}>`
    const result = readAuthorizedHtmlScriptEvidence(wrapped)
    assert.equal(result.nuxtPayload, null, tag)
    assert.deepEqual(result.jsonLdBlocks, [], tag)
  }
})

test('Nuxt JSON must be an actual JSON script, not mislabeled JSON-LD', async () => {
  const tampered = dekaMarkup('id="__NUXT_DATA__" type="application/ld+json"')
  assert.equal(readAuthorizedHtmlScriptEvidence(tampered).invalid, true)
  const result = await run('dekamarkt', tampered)
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('invalid HTML start-tag whitespace or fake script closer cannot admit a Product price', async () => {
  const markup=script('type="application/ld+json"',plusProduct)
  const bogus='< script type="application/ld+json">'+JSON.stringify(plusProduct)+'</script>'
  const proof=readAuthorizedHtmlScriptEvidence(bogus)
  assert.equal(proof.jsonLdBlocks.length,0)
  assert.equal((await run('plus',bogus)).status,'review_required')
  const falseClosing='<script type="text/plain">ignore</ script>'+markup+'</script>'
  const report=readAuthorizedHtmlScriptEvidence(falseClosing)
  assert.equal(report.jsonLdBlocks.length,0)
  assert.equal((await run('plus',falseClosing)).status,'review_required')
  assert.equal((await run('plus',markup)).status,'candidate_needs_review')
})

test('quoted DOCTYPE/Product declaration cannot impersonate authorized JSON-LD evidence', async () => {
  const genuine=script('type="application/ld+json"',plusProduct)
  const header=`<!DOCTYPE html SYSTEM '${genuine}'>`
  const denied=await run('plus',header)
  assert.equal(denied.status,'review_required')
  assert.equal(denied.observation,null)
  const accepted=await run('plus',header+genuine)
  assert.equal(accepted.status,'candidate_needs_review')
  assert.equal(accepted.publicSavingsClaimEligible,false)
})

test('literal Schema.org Product/Offer IRIs support a real private PLUS candidate, not fake external hosts', async () => {
  const good=structuredClone(plusProduct)
  good['@type']='https://schema.org/Product'
  good.offers['@type']='https://schema.org/Offer'
  const markup=script('type="application/ld+json"',good)
  const parsed=readAuthorizedHtmlScriptEvidence(markup)
  assert.equal(parsed.invalid,false)
  assert.equal(parsed.jsonLdBlocks[0]['@type'],'Product')
  assert.equal(parsed.jsonLdBlocks[0].offers['@type'],'Offer')
  const review=await run('plus',markup)
  assert.equal(review.status,'candidate_needs_review')
  assert.equal(review.observation.currentPriceCents,199)
  assert.equal(review.published,false)
  const forged=structuredClone(good)
  forged['@type']='https://example.invalid/Product'
  const refused=await run('plus',script('type="application/ld+json"',forged))
  assert.equal(refused.status,'review_required')
  assert.equal(refused.observation,null)
  forged['@type']='https://schema.org/product' // URI path is case-sensitive.
  const wrongCase=await run('plus',script('type="application/ld+json"',forged))
  assert.equal(wrongCase.status,'review_required')
})

test('private Deka source accepts exact Schema.org IRIs only when independent Nuxt price corroborates', async () => {
  const ld=structuredClone(dekaFixture.jsonLdProduct)
  ld['@type']='http://schema.org/Product'
  ld.offers['@type']='https://schema.org/Offer'
  const markup=dekaMarkup('id="__NUXT_DATA__" type="application/json"').replace(
    JSON.stringify(dekaFixture.jsonLdProduct),JSON.stringify(ld))
  const accepted=await run('dekamarkt',markup)
  assert.equal(accepted.status,'candidate_needs_review')
  assert.equal(accepted.observation.currentPriceCents,85)
  assert.equal(accepted.published,false)
  ld.offers.Price=0.01
  const denied=await run('dekamarkt',dekaMarkup('id="__NUXT_DATA__" type="application/json"').replace(
    JSON.stringify(dekaFixture.jsonLdProduct),JSON.stringify(ld)))
  assert.equal(denied.status,'review_required')
})

test('captured PLUS JSON-LD refuses duplicated offer prices and escaped equivalent key aliases', async () => {
  const clean=JSON.stringify(plusProduct)
  for (const poisoned of [
    clean.replace('"price":"1.99"','"price":"0.01","price":"1.99"'),
    clean.replace('"price":"1.99"','"pr\\u0069ce":"0.01","price":"1.99"'),
    clean.replace('"@type":"Product"','"@type":"Thing","@type":"Product"'),
  ]) {
    const markup='<script type="application/ld+json">'+poisoned+'</script>'
    assert.equal(readAuthorizedHtmlScriptEvidence(markup).invalid,true)
    const result=await run('plus',markup)
    assert.equal(result.status,'review_required')
    assert.equal(result.observation,null)
    assert.equal(result.publicSavingsClaimEligible,false)
  }
  assert.equal((await run('plus',script('type="application/ld+json"',plusProduct))).status,'candidate_needs_review')
})

test('Deka Nuxt refuses duplicate nested keys even when final value corroborates JSON-LD', async () => {
  const original=JSON.stringify(dekaFixture.nuxtPayload)
  const poisoned=original.replace('"productId":','"productId":0,"productId":')
  assert.notEqual(original,poisoned)
  const html='<script id="__NUXT_DATA__" type="application/json">'+poisoned+'</script>'+script('type="application/ld+json"',dekaFixture.jsonLdProduct)
  assert.equal(readAuthorizedHtmlScriptEvidence(html).invalid,true)
  const result=await run('dekamarkt',html)
  assert.equal(result.status,'review_required')
  assert.equal(result.observation,null)
  assert.equal(result.published,false)
})

test('private PLUS parser accepts real JSON-LD from valid omitted head end-tag HTML', async () => {
  const source='<html><head>'+script('type="application/ld+json"',plusProduct)+
    '<body><article class="product-card">Synthetic</article></body></html>'
  const evidence=readAuthorizedHtmlScriptEvidence(source)
  assert.equal(evidence.invalid,false)
  assert.equal(evidence.jsonLdBlocks.length,1)
  const candidate=await run('plus',source)
  assert.equal(candidate.status,'candidate_needs_review')
  assert.equal(candidate.observation.currentPriceCents,199)
  assert.equal(candidate.published,false)
})

test('visible meta refresh prevents trusting JSON-LD prices even if markup contains a valid Product', () => {
  const markup='<html><head><meta http-equiv="refresh" content="0;url=https://outside.example">' +
    '<script type="application/ld+json">'+JSON.stringify({
      '@type':'Product',name:'Synthetic item',offers:{'@type':'Offer',price:'1.99',
        priceCurrency:'EUR'}
    })+'</script></head><body></body></html>'
  const rejected=readAuthorizedHtmlScriptEvidence(markup)
  assert.equal(rejected.invalid,true)
  assert.deepEqual(rejected.jsonLdBlocks,[])
  assert.equal(rejected.nuxtPayload,null)
  const safe=readAuthorizedHtmlScriptEvidence(markup.replace('http-equiv="refresh"',
    'data-http-equiv="refresh"'))
  assert.equal(safe.invalid,false)
  assert.equal(safe.jsonLdBlocks.length,1)
  const inert=readAuthorizedHtmlScriptEvidence(markup.replace('<meta http-equiv="refresh"',
    '<template><meta http-equiv="refresh"').replace('</head>','</template></head>'))
  assert.equal(inert.invalid,false)
  assert.equal(inert.jsonLdBlocks.length,0) // JSON-LD inside inert template is not executable
})

test('standalone script evidence requires provenance to verify declared page identity',()=>{
  const html='<html><head><link rel="canonical" href="'+plusUrl+'">' +
    '<script type="application/ld+json">'+JSON.stringify(plusProduct) +
    '</script></head><body></body></html>'
  assert.equal(readAuthorizedHtmlScriptEvidence(html).invalid,true)
  const linked=readAuthorizedHtmlScriptEvidence(html,plusUrl)
  assert.equal(linked.invalid,false)
  assert.equal(linked.jsonLdBlocks.length,1)
  assert.equal(readAuthorizedHtmlScriptEvidence(html,
    'https://www.dekamarkt.nl/producten/fictional-123').invalid,true)
  const noDeclared=html.replace('<link rel="canonical" href="'+plusUrl+'">','')
  assert.equal(readAuthorizedHtmlScriptEvidence(noDeclared).invalid,false)
})
