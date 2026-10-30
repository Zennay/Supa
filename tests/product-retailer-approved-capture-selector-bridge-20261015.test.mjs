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
