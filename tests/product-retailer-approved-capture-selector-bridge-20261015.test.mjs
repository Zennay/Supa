import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureToPrivateSelectorReview } from
  '../scripts/retailer-approved-capture-selector-bridge.mjs'

// All permits below are SYNTHETIC TEST FIXTURES, NEVER real PLUS/Deka rights.
// Every mock fetch is in-memory Response: zero outbound HTTP.
const at = '2026-10-14T12:00:00.000Z'
const syntheticGate = () => ({
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-14',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket,
    technicalStatus: 'proven',
    permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/synthetic-test-authorization',
      finding: 'SYNTHETIC CI test only. NOT an actual retailer license.',
    }],
  })),
})
const consent = (supermarket, kind, sourceUrl) => ({
  supermarket, kind, sourceUrl,
  reviewed: true, termsReviewed: true,
  robotsReviewed: true, noAntiBotBypass: true,
})

test('bridge: simulated approved PLUS capture generates hash-linked selectors without price, URL or publication', async () => {
  const url = 'https://www.plus.nl/producten'
  const html = '<!doctype html><html><body><a class="product-card price-label" href="/product/fictional-123">Synthetic</a></body></html>'
  let calls = 0
  const result = await captureToPrivateSelectorReview({
    source: { supermarket: 'plus', kind: 'catalog', url },
    grant: consent('plus', 'catalog', url), permissionGate: syntheticGate(),
    capturedAt: at,
    fetchFn: async (target, settings) => {
      calls++
      assert.equal(target, url)
      assert.equal(settings.credentials, 'omit')
      assert.equal(settings.redirect, 'error')
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.source.sha256, createHash('sha256').update(html).digest('hex'))
  assert.equal(result.source.capturedAt, at)
  assert.equal(result.source.kind, 'catalog')
  assert.equal(result.source.retailerId, 'plus')
  assert.equal(result.actualTransportInvocations, 1)
  assert.equal(result.selectorProposals.some(s => s.selector === 'a[href^="/product/"]'), true)
  assert.equal(result.selectorProposals.every(s => s.status === 'needs-human-review'), true)
  assert.equal(result.approvedSelectors, 0)
  assert.equal(result.scopeCheckedForThisOneCapture, true)
  assert.equal(result.sourceRightsForPublicationVerified, false)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.scheduledFetchEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(result).includes('fictional-123'), false)
  assert.equal(JSON.stringify(result).includes(url), false)
  assert.equal(JSON.stringify(result).includes('Synthetic</a>'), false)
})

test('bridge: simulated Deka offers preserve Nuxt signal only, never promote extraction', async () => {
  const url = 'https://www.dekamarkt.nl/aanbiedingen'
  const html = '<html><body><script id="__NUXT_DATA__">[null]</script><div class="offer-card">Mock</div></body></html>'
  const result = await captureToPrivateSelectorReview({
    source: { supermarket: 'dekamarkt', kind: 'offers', url },
    grant: consent('dekamarkt', 'offers', url),
    permissionGate: syntheticGate(), capturedAt: at,
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  })
  assert.equal(result.source.retailerId, 'dekamarkt')
  assert.equal(result.source.kind, 'offers')
  assert.equal(result.structuredSignals.nuxtData, true)
  assert.equal(result.currentPricesExtracted, false)
  assert.equal(result.humanSelectorApprovalRequired, true)
})

test('bridge promotes only observed effective-base relative URL prefixes to private review', async () => {
  for (const [supermarket, host, prefix] of [
    ['plus', 'www.plus.nl', 'product/'],
    ['dekamarkt', 'www.dekamarkt.nl', 'producten/'],
  ]) {
    const url = 'https://' + host + '/aanbiedingen/week'
    const html = '<html><head><base href="/"></head><body>' +
      '<a href="' + prefix + 'synthetic-111">Mock product</a>' +
      '<a href="../' + prefix + 'synthetic-222">Mock product</a>' +
      '<a href="./' + prefix + 'synthetic-333">Mock product</a></body></html>'
    const result = await captureToPrivateSelectorReview({
      source: { supermarket, kind: 'offers', url },
      grant: consent(supermarket, 'offers', url),
      permissionGate: syntheticGate(), capturedAt: at,
      fetchFn: async () => new Response(html, {
        status: 200, headers: { 'content-type': 'text/html' },
      }),
    })
    assert.equal(result.actualTransportInvocations, 1)
    assert.equal(result.selectorProposals.filter(s=>s.field==='product').length,3)
    assert.ok(result.selectorProposals.some(s=>s.selector==='a[href^="../'+prefix+'"]'))
    assert.equal(result.approvedSelectors,0)
    assert.equal(result.productionEnabled,false)
    assert.equal(result.scheduledFetchEnabled,false)
    assert.doesNotMatch(JSON.stringify(result), /synthetic-111|synthetic-222|synthetic-333/)
  }
})

test('bridge: REAL checked-in rights refuse all injected transports before ANY invocation', async () => {
  const actual = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  let calls = 0
  for (const [supermarket, kind, url] of [
    ['plus', 'catalog', 'https://www.plus.nl/producten'],
    ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
  ]) {
    await assert.rejects(captureToPrivateSelectorReview({
      source: { supermarket, kind, url },
      grant: consent(supermarket, kind, url), permissionGate: actual,
      fetchFn: async () => { calls++; throw Error('MUST NOT RUN') },
      capturedAt: at,
    }), /Explicit retailer source permission required/)
  }
  assert.equal(calls, 0)
})

test('bridge: invalid scope and unapproved routes cannot reach mock network transport', async () => {
  const url = 'https://www.plus.nl/producten'
  let calls = 0
  const mock = async () => { calls++; return new Response('hi') }
  for (const request of [
    { source: { supermarket: 'plus', kind: 'catalog', url },
      grant: { ...consent('plus', 'catalog', url), robotsReviewed: false } },
    { source: { supermarket: 'plus', kind: 'catalog', url: 'https://www.plus.nl/admin' },
      grant: consent('plus', 'catalog', url) },
    { source: { supermarket: 'plus', kind: 'catalog', url: 'https://www.plus.nl/producten?secret=yes' },
      grant: consent('plus', 'catalog', url) },
  ]) {
    await assert.rejects(captureToPrivateSelectorReview({
      ...request, permissionGate: syntheticGate(), fetchFn: mock, capturedAt: at,
    }))
  }
  assert.equal(calls, 0)
})

test('bridge: HTTP rate limit is terminal; HTML selector uncertainty is terminal', async () => {
  const url = 'https://www.plus.nl/producten'
  const base = {
    source: { supermarket: 'plus', kind: 'catalog', url },
    grant: consent('plus', 'catalog', url), permissionGate: syntheticGate(),
    capturedAt: at,
  }
  let calls = 0
  await assert.rejects(captureToPrivateSelectorReview({
    ...base, fetchFn: async () => { calls++; return new Response('', { status: 429 }) },
  }), /refused or rate-limited/)
  assert.equal(calls, 1)
  await assert.rejects(captureToPrivateSelectorReview({
    ...base, fetchFn: async () => new Response('<!-- unclosed <div class="price-value">',
      { status: 200, headers: { 'content-type': 'text/html' } }),
  }), /Unterminated HTML comment/)
  await assert.rejects(captureToPrivateSelectorReview(base),
    /Approved fetch transport required/)
})

test('synthetic consent-scoped capture bridge returns reviewed-safe absolute item href hints, no SKU', async () => {
  const url = 'https://www.plus.nl/producten'
  const html = '<html><body>' +
    '<a href="https://www.plus.nl/product/synthetic-111">Canonical item</a>' +
    '<a href="//www.plus.nl/product/synthetic-222">Scheme relative item</a>' +
    '<a href="https://evil.example/product/synthetic-333">Foreign item</a>' +
    '</body></html>'
  const result = await captureToPrivateSelectorReview({
    source: {supermarket: 'plus', kind: 'catalog', url},
    permissionGate: syntheticGate(), grant: consent('plus', 'catalog', url),
    capturedAt: at,
    fetchFn: async () => new Response(html, {status: 200,
      headers: {'content-type': 'text/html'}}),
  })
  assert.equal(result.selectorProposals.length, 2)
  assert.equal(result.selectorProposals.some(s =>
    s.selector === 'a[href^="https://www.plus.nl/product/"]'), true)
  assert.equal(result.selectorProposals.some(s =>
    s.selector === 'a[href^="//www.plus.nl/product/"]'), true)
  assert.doesNotMatch(JSON.stringify(result), /synthetic-111|synthetic-222|synthetic-333|evil.example/)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.sourceRightsForPublicationVerified, false)
})

test('actual consent-injected capture refuses cross-origin live HTML base before returning source hints', async () => {
  const url='https://www.plus.nl/producten'
  const request={
    source:{supermarket:'plus',kind:'catalog',url},
    permissionGate:syntheticGate(),
    grant:consent('plus','catalog',url),capturedAt:at,
  }
  let calls=0
  const bad='<html><head><base href="https://foreign.example/"></head><body>' +
    '<a href="/product/synthetic-123">Misleading product</a></body></html>'
  await assert.rejects(captureToPrivateSelectorReview({...request,
    fetchFn: async()=>{calls++;return new Response(bad,{status:200,
      headers:{'content-type':'text/html'}})}}),
    /Untrusted HTML base URL/)
  assert.equal(calls,1)
  const good=bad.replace('https://foreign.example/','https://www.plus.nl/')
  const admitted=await captureToPrivateSelectorReview({...request,
    fetchFn:async()=>{calls++;return new Response(good,{status:200,
      headers:{'content-type':'text/html'}})}})
  assert.equal(calls,2)
  assert.equal(admitted.selectorProposals.some(s=>
    s.selector==='a[href^="/product/"]'),true)
  assert.equal(admitted.readyForIngestion,false)
  assert.doesNotMatch(JSON.stringify(admitted),/synthetic-123|foreign.example/)
})

test('injected one-URL capture never returns cross-store canonical selector candidates',async()=>{
  const url='https://www.plus.nl/producten'
  const request={source:{supermarket:'plus',kind:'catalog',url},
    grant:consent('plus','catalog',url),permissionGate:syntheticGate(),
    capturedAt:at}
  const page='<html><head><link rel="canonical" href="https://www.dekamarkt.nl/producten"></head>' +
    '<body><a href="/product/synthetic-123">Private mock</a></body></html>'
  await assert.rejects(captureToPrivateSelectorReview({...request,
    fetchFn:async()=>new Response(page,{status:200,headers:{'content-type':'text/html'}})}),
    /Untrusted HTML canonical source URL/)
  const corrected=page.replace('https://www.dekamarkt.nl/producten','https://www.plus.nl/producten')
  const accepted=await captureToPrivateSelectorReview({...request,
    fetchFn:async()=>new Response(corrected,{status:200,headers:{'content-type':'text/html'}})})
  assert.ok(accepted.selectorProposals.some(x=>x.selector==='a[href^="/product/"]'))
  assert.equal(accepted.humanSelectorApprovalRequired,true)
  assert.equal(accepted.readyForIngestion,false)
  assert.doesNotMatch(JSON.stringify(accepted),/synthetic-123|www.dekamarkt.nl/)
})

test('approved one-capture bridge preserves only observed safe Schema.org and generic test-id selectors for PLUS/Deka', async () => {
  for (const [supermarket, root, host] of [
    ['plus', '/product/', 'www.plus.nl'],
    ['dekamarkt', '/producten/', 'www.dekamarkt.nl'],
  ]) {
    const url = `https://${host}${root}synthetic-fixture-123`
    const html = `<article itemscope itemtype="https://schema.org/Product" class="product-card">` +
      `<a href="${root}synthetic-fixture-123"><span itemprop="name" data-testid="product-name">Private example</span></a>` +
      `<meta itemprop="price" content="2.49"><span data-testid="pack-size">300 ml</span>` +
      `<span data-testid="customer-987-price-2-49">Private token</span></article>`
    const review = await captureToPrivateSelectorReview({
      source: {supermarket,kind:'product',url},
      grant: consent(supermarket,'product',url), permissionGate:syntheticGate(), capturedAt:at,
      fetchFn:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}}),
    })
    for (const selector of [
      'article[itemtype="https://schema.org/Product"]',
      'span[itemprop="name"]', 'meta[itemprop="price"]',
      'span[data-testid="product-name"]', 'span[data-testid="pack-size"]',
    ]) assert.ok(review.selectorProposals.some(row=>row.selector===selector), `${supermarket}: ${selector}`)
    assert.equal(review.selectorProposals.some(row=>row.selector.includes('customer-987')),false)
    assert.doesNotMatch(JSON.stringify(review), /2\.49|Private example|synthetic-fixture-123|customer-987/)
    assert.equal(review.productionEnabled,false)
    assert.equal(review.currentPricesExtracted,false)
  }
})

test('M1 two-store captured web-component selectors remain reviewable without leaking identifier-bearing tags',async()=>{
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen'],
  ]) {
    const html='<retailer-product-card class="product-card" data-testid="product-card">'+
      '<retailer-price-label data-testid="price-value">PRIVATE_PRICE_299</retailer-price-label>'+
      '<retailer-pack-size class="pack-size" data-testid="pack-size">PRIVATE_PACK_300</retailer-pack-size>'+
      '<retailer-product-991-card class="product-card">PRIVATE_SKU_991</retailer-product-991-card>'+
      '<customer-secret-name-card data-testid="price-value">PRIVATE_ID</customer-secret-name-card>'+
      '</retailer-product-card>'
    const reviewed=await captureToPrivateSelectorReview({
      source:{supermarket,kind,url},grant:consent(supermarket,kind,url),
      permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}}),
    })
    for(const selector of [
      'retailer-product-card.product-card',
      'retailer-product-card[data-testid="product-card"]',
      'retailer-price-label[data-testid="price-value"]',
      'retailer-pack-size[data-testid="pack-size"]',
      'retailer-pack-size.pack-size',
    ]) assert.ok(reviewed.selectorProposals.some(x=>x.selector===selector),supermarket+': '+selector)
    assert.doesNotMatch(JSON.stringify(reviewed),/retailer-product-991|customer-secret-name|PRIVATE_PRICE_299|PRIVATE_PACK_300|PRIVATE_SKU_991|PRIVATE_ID/)
    assert.equal(reviewed.readyForIngestion,false)
    assert.equal(reviewed.sourceRightsForPublicationVerified,false)
  }
})

test('one approved synthetic capture preserves h1/h4/h5/h6 source markup only as private review hints', async()=>{
  for(const [supermarket,url] of [
    ['plus','https://www.plus.nl/producten'],
    ['dekamarkt','https://www.dekamarkt.nl/aanbiedingen']]){
    const kind=supermarket==='plus'?'catalog':'offers'
    const html='<article itemscope itemtype="https://schema.org/Product">' +
      '<h1 itemprop="name">PRIVATE_SHOP_ITEM</h1>' +
      '<h4 class="price-value">PRIVATE_12.34</h4>' +
      '<h5 data-testid="pack-size">PRIVATE_500ml</h5>' +
      '<h6 itemprop="availability">PRIVATE_AVAILABLE</h6></article>'
    let calls=0
    const review=await captureToPrivateSelectorReview({
      source:{supermarket,kind,url},grant:consent(supermarket,kind,url),
      permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>{calls++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})},
    })
    assert.equal(calls,1)
    for(const selector of ['h1[itemprop="name"]','h4.price-value',
      'h5[data-testid="pack-size"]','h6[itemprop="availability"]'])
      assert.ok(review.selectorProposals.some(row=>row.selector===selector),supermarket+' '+selector)
    assert.equal(review.source.sha256,createHash('sha256').update(html).digest('hex'))
    assert.doesNotMatch(JSON.stringify(review),/PRIVATE_SHOP_ITEM|PRIVATE_12\.34|PRIVATE_500ml|PRIVATE_AVAILABLE/)
    assert.equal(review.readyForIngestion,false)
    assert.equal(review.productionEnabled,false)
  }
})

test('single synthetic approved PLUS/Deka capture retains observed sale/price/pack element selectors without any price publication',async()=>{
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<article itemscope itemtype="https://schema.org/Product">' +
      '<ins itemprop="price">PRIVATE_2.49</ins>' +
      '<del class="offer-label">PRIVATE_3.99</del>' +
      '<small data-testid="pack-size">PRIVATE_500_ML</small></article>'
    let calls=0
    const review=await captureToPrivateSelectorReview({
      source:{supermarket,kind,url},grant:consent(supermarket,kind,url),
      permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>{calls++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})},
    })
    assert.equal(calls,1)
    for(const selector of ['ins[itemprop="price"]','del.offer-label','small[data-testid="pack-size"]'])
      assert.ok(review.selectorProposals.some(row=>row.selector===selector),supermarket+': '+selector)
    assert.equal(review.source.sha256,createHash('sha256').update(html).digest('hex'))
    assert.doesNotMatch(JSON.stringify(review),/PRIVATE_2\.49|PRIVATE_3\.99|PRIVATE_500_ML/)
    assert.equal(review.currentPricesExtracted,false)
    assert.equal(review.readyForIngestion,false)
    assert.equal(review.publicSavingsClaimEligible,false)
  }
})

test('observed struck-through price is only an offer review hint in both-store injected capture',async()=>{
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<article><del class="price-value" itemprop="price">PRIVATE_9.99</del>'+
      '<ins class="price-value" itemprop="price">PRIVATE_7.99</ins></article>'
    const review=await captureToPrivateSelectorReview({source:{supermarket,kind,url},
      grant:consent(supermarket,kind,url),permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}}),
    })
    for(const selector of ['del.price-value','del[itemprop="price"]'])
      assert.equal(review.selectorProposals.find(x=>x.selector===selector)?.field,'offer',selector)
    for(const selector of ['ins.price-value','ins[itemprop="price"]'])
      assert.equal(review.selectorProposals.find(x=>x.selector===selector)?.field,'price',selector)
    assert.equal(review.currentPricesExtracted,false)
    assert.doesNotMatch(JSON.stringify(review),/PRIVATE_9\.99|PRIVATE_7\.99/)
  }
})

test('product title and price child tokens cannot inflate retailer product-card count',async()=>{
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<section class="product-card">'+
      '<span class="product-name" data-testid="product-title">PRIVATE_NAME</span>'+
      '<span class="product-price" data-testid="product-price">PRIVATE_PRICE</span></section>'
    const result=await captureToPrivateSelectorReview({source:{supermarket,kind,url},
      permissionGate:syntheticGate(),grant:consent(supermarket,kind,url),
      capturedAt:at,fetchFn:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}})})
    for(const [selector,field] of [
      ['section.product-card','product'],['span.product-name','name'],
      ['span[data-testid="product-title"]','name'],
      ['span.product-price','price'],
      ['span[data-testid="product-price"]','price']])
      assert.deepEqual(result.selectorProposals.filter(x=>x.selector===selector).map(x=>x.field),[field],supermarket+' '+selector)
    assert.equal(result.selectorProposals.filter(x=>x.field==='product').length,1)
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_NAME|PRIVATE_PRICE/)
    assert.equal(result.productionEnabled,false)
  }
})

test('PLUS/Deka single captured HTML keeps <s>/<strike> old prices as offer hints, never current price',async()=>{
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<article class="product-card">'+
      '<s class="price-value" itemprop="price">PRIVATE_OLD_4.99</s>'+
      '<strike data-testid="price-value">PRIVATE_OLD_5.99</strike>'+
      '<ins class="price-value">PRIVATE_NEW_3.49</ins></article>'
    let calls=0
    const review=await captureToPrivateSelectorReview({
      source:{supermarket,kind,url},grant:consent(supermarket,kind,url),
      permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>{calls++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})},
    })
    assert.equal(calls,1)
    for(const selector of ['s.price-value','s[itemprop="price"]','strike[data-testid="price-value"]'])
      assert.equal(review.selectorProposals.find(x=>x.selector===selector)?.field,'offer',supermarket+': '+selector)
    assert.equal(review.selectorProposals.find(x=>x.selector==='ins.price-value')?.field,'price')
    assert.equal(review.currentPricesExtracted,false)
    assert.equal(review.readyForIngestion,false)
    assert.equal(review.sourceRightsForPublicationVerified,false)
    assert.doesNotMatch(JSON.stringify(review),/PRIVATE_OLD|PRIVATE_NEW/)
  }
})

test('captured old/was price class tokens stay offer-only for PLUS and Deka and never publish price evidence',async()=>{
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<article class="product-card">'+
      '<span class="old-price" data-testid="price-before">PRIVATE_OLD_3.99</span>'+
      '<span class="price-old">PRIVATE_OLD_4.99</span>'+
      '<ins class="product-price">PRIVATE_NEW_2.49</ins></article>'
    let calls=0
    const review=await captureToPrivateSelectorReview({source:{supermarket,kind,url},
      grant:consent(supermarket,kind,url),permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>{calls++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})}})
    assert.equal(calls,1)
    for(const selector of ['span.old-price','span[data-testid="price-before"]','span.price-old'])
      assert.deepEqual(review.selectorProposals.filter(x=>x.selector===selector).map(x=>x.field),['offer'],supermarket+': '+selector)
    assert.equal(review.selectorProposals.find(x=>x.selector==='ins.product-price')?.field,'price')
    assert.equal(review.currentPricesExtracted,false)
    assert.equal(review.readyForIngestion,false)
    assert.equal(review.sourceRightsForPublicationVerified,false)
    assert.doesNotMatch(JSON.stringify(review),/PRIVATE_OLD|PRIVATE_NEW/)
  }
})

test('private PLUS/Deka capture refuses generic price hints shared by historical and current shelf prices',async()=>{
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<article class="product-card">'+
      '<span class="old-price price-value" data-testid="price-value" itemprop="price">PRIVATE_PRIOR</span>'+
      '<span class="product-price" itemprop="price">PRIVATE_CURRENT</span></article>'
    let calls=0
    const review=await captureToPrivateSelectorReview({source:{supermarket,kind,url},
      grant:consent(supermarket,kind,url),permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>{calls++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})}})
    assert.equal(calls,1)
    for(const selector of ['span[itemprop="price"]','span.price-value','span[data-testid="price-value"]'])
      assert.equal(review.selectorProposals.some(x=>x.selector===selector),false,supermarket+': '+selector)
    assert.equal(review.selectorProposals.find(x=>x.selector==='span.old-price')?.field,'offer')
    assert.equal(review.selectorProposals.find(x=>x.selector==='span.product-price')?.field,'price')
    assert.equal(review.currentPricesExtracted,false)
    assert.equal(review.readyForIngestion,false)
    assert.doesNotMatch(JSON.stringify(review),/PRIVATE_PRIOR|PRIVATE_CURRENT/)
  }
})

test('one-shot PLUS/Deka private capture prioritizes six real semantic fields despite hundreds of noisy CSS selectors',async()=>{
  const noise=Array.from({length:80},(_,i)=>
    '<span class="price-noise-'+i+' stock-noise-'+i+'">PRIVATE_NOISE</span>').join('')
  for(const [supermarket,kind,url] of [
    ['plus','catalog','https://www.plus.nl/producten'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<article class="product-card">'+noise+
      '<h2 class="product-title">PRIVATE_NAME</h2>'+
      '<span class="price-value">PRIVATE_PRICE</span>'+
      '<span class="pack-size">PRIVATE_PACK</span>'+
      '<span class="offer-label">PRIVATE_OFFER</span>'+
      '<span class="stock-label">PRIVATE_STOCK</span></article>'
    let requests=0
    const receipt=await captureToPrivateSelectorReview({
      source:{supermarket,kind,url},grant:consent(supermarket,kind,url),
      permissionGate:syntheticGate(),capturedAt:at,
      fetchFn:async()=>{requests++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})},
    })
    assert.equal(requests,1)
    for(const [field,selector] of [
      ['product','article.product-card'],['name','h2.product-title'],
      ['price','span.price-value'],['pack','span.pack-size'],
      ['offer','span.offer-label'],['availability','span.stock-label']])
      assert.ok(receipt.selectorProposals.some(row=>row.field===field&&row.selector===selector),supermarket+': '+field)
    assert.ok(receipt.selectorProposals.length<=24)
    assert.equal(receipt.readyForIngestion,false)
    assert.equal(receipt.currentPricesExtracted,false)
    assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_NOISE|PRIVATE_NAME|PRIVATE_PRICE|PRIVATE_PACK|PRIVATE_OFFER|PRIVATE_STOCK|price-noise-/)
  }
})
