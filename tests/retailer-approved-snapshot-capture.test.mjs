import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'

const url = 'https://www.plus.nl/producten'
const source = { supermarket: 'plus', kind: 'catalog', url }
const gate = {
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-14',
  sources: [{
    supermarket: 'plus', technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/synthetic-no-real-license',
      finding: 'SYNTHETIC CI ONLY. Not a real permission document.',
    }],
  }, {
    supermarket: 'dekamarkt', technicalStatus: 'proven',
    permissionStatus: 'unresolved', productionEnabled: false,
    evidence: [{
      kind: 'official_terms',
      url: 'https://www.dekamarkt.nl/algemene-voorwaarden',
      finding: 'No production rights.',
    }],
  }],
}
const grant = {
  supermarket: 'plus', kind: 'catalog', sourceUrl: url,
  reviewed: true, termsReviewed: true, robotsReviewed: true,
  noAntiBotBypass: true,
}

test('synthetic approved fetch produces bounded hash-pinned local HTML for selector analysis, no publication', async () => {
  let called = 0
  const html = '<!doctype html><html><body><a href="/product/mock-123" class="product-card">Mock</a></body></html>'
  const captured = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    capturedAt: '2026-10-14T12:00:00.000Z',
    fetchFn: async (requested, options) => {
      called++
      assert.equal(requested, url)
      assert.equal(options.redirect, 'error')
      assert.equal(options.credentials, 'omit')
      assert.equal(options.cache, 'no-store')
      assert.equal(options.headers.accept, 'text/html')
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
  })
  assert.equal(called, 1)
  assert.equal(captured.html, html)
  assert.equal(captured.mode, 'authorized-one-page-capture-needs-review')
  assert.equal(captured.source.sha256, createHash('sha256').update(html).digest('hex'))
  assert.equal(captured.published, false)
  assert.equal(captured.normalized, false)
  assert.equal(captured.readyForIngestion, false)
  const selectors = proposeOfflineRetailerSelectors({
    html: captured.html,
    origin: { retailerId: captured.source.retailerId, url: captured.source.url,
      capturedAt: captured.source.capturedAt },
  })
  assert.equal(selectors.source.sha256, captured.source.sha256)
  assert.ok(selectors.selectors.some(x => x.selector === 'a[href^="/product/"]'))
  assert.equal(selectors.productionEnabled, false)
})

test('actual M1 permission statuses refuse access BEFORE any network transport', async () => {
  let called = false
  const fakeFetch = async () => { called = true; throw Error('must not fetch') }
  const realGate = structuredClone(gate)
  realGate.sources[0].permissionStatus = 'permission_required'
  realGate.sources[0].productionEnabled = false
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: realGate, grant, fetchFn: fakeFetch,
  }), /Explicit retailer source permission required/)
  assert.equal(called, false)
})

test('wrong origin, unsafe URL, unauthorized route and missing scope refuse before network', async () => {
  let called = false
  const fakeFetch = async () => { called = true; throw Error('must not fetch') }
  for (const invalidUrl of [
    'https://evil.example/producten',
    'https://www.plus.nl/producten?token=foo',
    'http://www.plus.nl/producten',
    'https://user:pass@www.plus.nl/producten',
    'https://www.plus.nl/admin',
    'https://www.plus.nl/producten#frag',
    'https://www.plus.nl:444/producten',
  ]) {
    await assert.rejects(captureApprovedRetailerPage({
      source: { ...source, url: invalidUrl }, permissionGate: gate,
      grant, fetchFn: fakeFetch,
    }), /outside exact approved HTTPS route/)
  }
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: gate,
    grant: { ...grant, reviewed: false }, fetchFn: fakeFetch,
  }), /Approved one-URL capture scope required/)
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: gate,
    grant: { ...grant, robotsReviewed: false }, fetchFn: fakeFetch,
  }), /Missing documented robots/)
  assert.equal(called, false)
})

test('HTTP 403/429, redirects, HTML errors, and oversized bodies cannot rotate to a proxy', async () => {
  for (const [response, expected] of [
    [new Response('', { status: 403 }), /refused or rate-limited/],
    [new Response('', { status: 429 }), /refused or rate-limited/],
    [new Response('away', { status: 302 }), /failed or redirected/],
    [new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), /did not return HTML/],
    [new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200, headers: { 'content-type': 'text/html' } }), /exceeds size budget/],
  ]) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant, fetchFn: async () => response,
    }), expected)
  }
})

test('missing injected network transport is fail-closed even with paper authorization', async () => {
  await assert.rejects(captureApprovedRetailerPage({ source, permissionGate: gate, grant }), /Approved fetch transport required/)
})

test('empty retailer product roots never become real product captures', async () => {
  const allowed = structuredClone(gate)
  allowed.sources[1].permissionStatus = 'permitted'
  allowed.sources[1].productionEnabled = true
  allowed.sources[1].evidence = [{ kind: 'written_permission',
    url: 'https://example.test/synthetic-grant',
    finding: 'SYNTHETIC CI only, not permission' }]
  let calls = 0
  const fetchFn = async () => {
    calls++
    return new Response('<html>SYNTHETIC</html>',
      { status: 200, headers: {'content-type': 'text/html'} })
  }
  const make = (store, path) => {
    const itemUrl = 'https://www.' + store + '.nl' + path
    return { source: {supermarket: store, kind: 'product', url: itemUrl},
      permissionGate: allowed, grant: {...grant, supermarket: store,
        kind: 'product', sourceUrl: itemUrl}, fetchFn }
  }
  for (const store of ['plus', 'dekamarkt']) {
    const root = store === 'plus' ? '/product/' : '/producten/'
    for (const path of [root, root + '/']) {
      await assert.rejects(captureApprovedRetailerPage(make(store, path)),
        /outside exact approved HTTPS route/)
    }
    const valid = await captureApprovedRetailerPage(
      make(store, root + 'synthetic-123'))
    assert.equal(valid.source.kind, 'product')
    assert.equal(valid.published, false)
  }
  assert.equal(calls, 2)
})

test('impossible Gregorian UTC provenance is rejected before fetch', async () => {
  let calls = 0
  const fetchFn = async () => {
    calls++
    return new Response('<html>SYNTHETIC</html>',
      {status: 200, headers: {'content-type': 'text/html'}})
  }
  for (const capturedAt of [
    '2026-02-30T12:00:00.000Z', '2025-02-29T12:00:00.000Z',
    '2026-04-31T12:00:00.000Z', '2026-01-01T24:00:00.000Z',
  ]) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant, fetchFn, capturedAt,
    }), /Invalid source capture clock/)
  }
  assert.equal(calls, 0)
  const valid = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant, fetchFn,
    capturedAt: '2024-02-29T12:00:00.000Z',
  })
  assert.equal(valid.source.capturedAt, '2024-02-29T12:00:00.000Z')
  assert.equal(valid.published, false)
  assert.equal(calls, 1)
})


test('bounded capture cancels oversized network stream and refuses empty successful HTML', async () => {
  let cancelled = 0
  let pulls = 0
  const body = new ReadableStream({
    pull(controller) {
      pulls++
      controller.enqueue(new Uint8Array(1024 * 1024))
    },
    cancel() { cancelled++ },
  })
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(body, {status: 200,
      headers: {'content-type': 'text/html'}}),
  }), /exceeds size budget/)
  assert.equal(cancelled, 1)
  assert.equal(pulls >= 3, true)
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response('', {status: 200,
      headers: {'content-type': 'text/html'}}),
  }), /Empty HTML capture refused/)
})
