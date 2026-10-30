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
      assert.equal(options.headers['accept-encoding'], 'identity')
      assert.equal(options.headers['want-content-digest'], 'sha-256=10, sha-512=9')
      assert.equal(options.headers['want-repr-digest'], 'sha-256=10, sha-512=9')
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

test('truncated/overlong identity HTML responses never become approved captures', async () => {
  const html = '<html><body>SYNTHETIC SOURCE ONLY</body></html>'
  let calls = 0
  for (const declared of [html.length - 1, html.length + 1, 0]) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => {
        calls++
        return new Response(html, {status: 200, headers: {
          'content-type': 'text/html',
          'content-length': String(declared),
        }})
      },
    }), /declared length mismatch/)
  }
  assert.equal(calls, 3)
  const admitted = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {status: 200, headers: {
      'content-type': 'text/html',
      'content-length': String(Buffer.byteLength(html)),
    }}),
  })
  assert.equal(admitted.html, html)
  assert.equal(admitted.source.sha256, createHash('sha256').update(html).digest('hex'))
  // Decoded HTTP streams can retain compressed *wire* Content-Length.
  const compressed = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {status: 200, headers: {
      'content-type': 'text/html',
      'content-encoding': 'gzip',
      'content-length': String(html.length - 4),
    }}),
  })
  assert.equal(compressed.source.sha256, admitted.source.sha256)
  assert.equal(compressed.published, false)
})

test('unbounded tiny HTTP chunks fail closed and cancel the stream', async () => {
  let chunks = 0
  let cancellations = 0
  const stream = new ReadableStream({
    pull(controller) {
      chunks++
      controller.enqueue(new Uint8Array([60]))
    },
    cancel() { cancellations++ },
  })
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(stream, {status: 200,
      headers: {'content-type': 'text/html'}}),
  }), /HTML stream segment budget exceeded/)
  assert.equal(cancellations, 1)
  assert.ok(chunks >= 8192 && chunks <= 8200)
})

test('denied status and non-HTML source responses cancel unread network streams', async () => {
  for (const [status, contentType, expected] of [
    [403, 'text/html', /refused or rate-limited/],
    [429, 'text/html', /refused or rate-limited/],
    [302, 'text/html', /failed or redirected/],
    [200, 'application/json', /did not return HTML/],
    [200, 'text/html', /Declared snapshot exceeds size budget/],
  ]) {
    let cancelled = 0
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array([60,62,60,62])) },
      cancel() { cancelled++ },
    })
    const response = new Response(stream, {status, headers: {
      'content-type': contentType,
      ...(status === 200 && contentType === 'text/html'
        ? {'content-length': '4000000'} : {}),
    }})
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => response,
    }), expected)
    assert.equal(cancelled, 1)
  }
})

test('source-identity capture refuses mismatched canonical/base and live refresh before archive', async () => {
  const scenarios = [
    ['<html><head><link rel="canonical" href="https://other.test/producten"></head><body>Fake</body></html>', /canonical/],
    ['<html><head><link rel="canonical" href="https://www.plus.nl/product/other-sku"></head><body>Fake</body></html>', /canonical/],
    ['<html><head><base href="//other.test/"></head><body>Fake</body></html>', /base/],
    ['<html><head><base href="&#47;&#47;other.test/"></head><body>Fake</body></html>', /base/],
    ['<html><head><base href="https&#58;//other.test/"></head><body>Fake</body></html>', /base/],
    ['<html><head><link rel="canonical" href="&#x2f;&#x2f;other.test/producten"></head><body>Fake</body></html>', /canonical/],
    ['<html><head><meta http-equiv="refresh" content="0;url=/product/other"></head><body>Fake</body></html>', /navigation/],
  ]
  for (const [html, pattern] of scenarios) {
    const fetchFn = async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant, fetchFn,
    }), pattern)
  }
  // Quotes inside inert comment/script data cannot forge page-level identity.
  const legitimate = '<html><head><base href="/producten/"><link rel="canonical" href="/producten"></head><body><!-- <base href="https://evil.test"> --><script>const s = "<meta http-equiv=refresh>";</script><a class="product-card" href="/product/mock">Mock</a></body></html>'
  const valid = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(legitimate, {
      headers: { 'content-type': 'text/html; charset="UTF-8"' },
    }),
  })
  assert.equal(valid.html, legitimate)
  assert.equal(valid.readyForIngestion, false)
})

test('source capture refuses ambiguous route bytes before any injected network', async () => {
  let called = 0
  for (const badPath of [
    '/product/a%2fb', '/product/a%5cb', '/product/a%2eb', '/product/a%252fb',
    '/product/a%00b', '/product/a%0ab', '/product/a%1fb', '/product/a%7fb',
  ]) {
    const targetUrl = 'https://www.plus.nl' + badPath
    await assert.rejects(captureApprovedRetailerPage({
      source: { supermarket: 'plus', kind: 'product', url: targetUrl },
      permissionGate: gate, grant: { ...grant, kind: 'product', sourceUrl: targetUrl },
      fetchFn: async () => { called++; throw Error('not allowed') },
    }), /Ambiguous retailer capture route/)
  }
  assert.equal(called, 0)
})

test('captured HTML requires unambiguous UTF-8 charset before trusting price provenance', async () => {
  for (const contentType of [
    'text/html; charset=iso-8859-1',
    'text/html; charset=UTF-8; charset=windows-1252',
  ]) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response('<html>synthetic</html>', {
        headers: { 'content-type': contentType },
      }),
    }), /charset/)
  }
})

test('transport refuses BOM and NUL HTML whose decoded DOM could differ from SHA bytes', async () => {
  const badBodies = [
    Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('<html>synthetic</html>')]),
    Buffer.from('<html>before\u0000after</html>', 'utf8'),
  ]
  for (const body of badBodies) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(body, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    }), /Ambiguous HTML/)
  }
  const html = '<html><body>legitimate Unicode café</body></html>'
  const allowed = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  })
  assert.equal(allowed.source.sha256, createHash('sha256').update(html).digest('hex'))
})

test('streamed capture snapshots chunks before a transport reuses its Uint8Array', async () => {
  const parts = ['<html>','<body>','SYNTHET','IC</body>','</html>']
  const shared = new Uint8Array(16)
  let index = 0
  const expected = parts.join('')
  const captured = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => ({
      status: 200, ok: true, url,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(expected)) }),
      body: { getReader: () => ({
        read: async () => {
          if (index === parts.length) return { done: true }
          const part = Buffer.from(parts[index++])
          shared.set(part)
          return { done: false, value: shared.subarray(0, part.length) }
        },
        releaseLock() {}, cancel: async () => {},
      }) },
    }),
  })
  assert.equal(captured.html, expected)
  assert.equal(captured.source.sha256, createHash('sha256').update(expected).digest('hex'))
  assert.equal(captured.readyForIngestion, false)
})

test('HTTP 200 Refresh and Content-Location cannot rebind one-page capture', async () => {
  for (const [headers, expected] of [
    [{ refresh: '0; url=https://another.example/product' }, /navigation/],
    [{ 'content-location': 'https://another.example/producten' }, /identity/],
    [{ 'content-location': '/product/another-item' }, /identity/],
    [{ 'content-location': '/producten?shop=another' }, /identity/],
  ]) {
    let cancelled = 0
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('<html>MOCK</html>')) },
      cancel() { cancelled++ },
    })
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(stream, {
        headers: { 'content-type': 'text/html', ...headers },
      }),
    }), expected)
    assert.equal(cancelled, 1)
  }
  const body = '<html><body>Only synthetic data</body></html>'
  const accepted = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(body, {
      headers: { 'content-type': 'text/html', 'content-location': '/producten/' },
    }),
  })
  assert.equal(accepted.source.sha256, createHash('sha256').update(body).digest('hex'))
  assert.equal(accepted.readyForIngestion, false)
})

test('HTTP canonical Link header cannot silently reattribute a 200 HTML snapshot', async () => {
  const invalid = [
    '<https://foreign.example/product/123>; rel="canonical"',
    '</product/different>; rel=canonical',
    '<https://www.plus.nl/producten?site=other>; rel="canonical"',
    '<https://www.plus.nl/product/different>; rel="alternate canonical"; title="wrong"',
    '<https://www.plus.nl/producten>; rel="canonical',
  ]
  for (const link of invalid) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response('<html>MOCK</html>', {
        headers: { 'content-type': 'text/html', link },
      }),
    }), /response navigation\/source identity refused/)
  }
  const html = '<html><body>SYNTHETIC</body></html>'
  const allowed = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {
      headers: { 'content-type': 'text/html',
        link: '</styles.css>; rel=preload, <https://www.plus.nl/producten/>; rel="canonical"' },
    }),
  })
  assert.equal(allowed.source.sha256, createHash('sha256').update(html).digest('hex'))
  assert.equal(allowed.readyForIngestion, false)
})

test('HTTP Age/Date cannot launder stale price HTML into a fresh snapshot', async () => {
  const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000).toUTCString()
  const futureDate = new Date(Date.now() + 20 * 60 * 1000).toUTCString()
  for (const headers of [
    { age: '86400' }, { age: '100000' }, { age: '-1' }, { age: 'not-a-number' },
    { date: oldDate }, { date: futureDate }, { date: 'not-a-date' },
  ]) {
    let cancelled = 0
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('<html>MOCK</html>')) },
      cancel() { cancelled++ },
    })
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(stream, {
        headers: { 'content-type': 'text/html', ...headers },
      }),
    }), /Stale or malformed retailer HTTP representation refused/)
    assert.equal(cancelled, 1)
  }
  const recent = '<html><body>SYNTHETIC</body></html>'
  const admitted = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(recent, {
      headers: { 'content-type': 'text/html', age: '22',
        date: new Date(Date.now() - 30 * 1000).toUTCString() },
    }),
  })
  assert.equal(admitted.source.sha256,
    createHash('sha256').update(recent).digest('hex'))
  assert.equal(admitted.readyForIngestion, false)
})

test('HTTP no-store and attachment HTML cannot enter a SHA-pinned snapshot archive', async () => {
  const html='<html><article class="product-card">SYNTHETIC</article></html>'
  for (const headers of [
    { 'cache-control': 'max-age=30, no-store' },
    { 'cache-control': 'NO-STORE' },
    { 'cache-control': 'max-age=30; no-store' },
    { 'x-robots-tag': 'noarchive' },
    { 'x-robots-tag': 'googlebot: noarchive' },
    { 'x-robots-tag': 'index, follow, noarchive' },
    { 'content-disposition': 'attachment; filename="export.html"' },
  ]) {
    let cancelled = false
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(html)) },
      cancel() { cancelled = true },
    })
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(stream, { status:200,
        headers: { 'content-type':'text/html', ...headers } }),
    }), /disallows snapshot archival/)
    assert.equal(cancelled, true)
  }
  const allowed = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {status:200,
      headers: { 'content-type':'text/html',
        'cache-control':'private, max-age=30',
        'content-disposition':'inline' } }),
  })
  assert.equal(allowed.html, html)
  assert.equal(allowed.published, false)
})

test('live HTML meta no-store refuses archival without header no-store', async () => {
  const meta='<meta http-equiv="Cache-Control" content="max-age=0, no-store">'
  const page=tag=>'<html><head>'+tag+'</head><body><a href="/product/synthetic-1">SYNTHETIC</a></body></html>'
  const fetchFn=html=>async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}})
  await assert.rejects(captureApprovedRetailerPage({
    source,permissionGate:gate,grant,fetchFn:fetchFn(page(meta)),
  }),/HTML disallows snapshot archival/)
  const allowed=await captureApprovedRetailerPage({
    source,permissionGate:gate,grant,fetchFn:fetchFn(page('<template>'+meta+'</template>')),
  })
  assert.equal(allowed.published,false)
  assert.equal(allowed.readyForIngestion,false)
})

test('real capture path refuses semicolon cache no-store and robots noarchive, but not inert copy', async () => {
  const page=tag=>'<html><head>'+tag+'</head><body><a href="/product/synthetic-1">SYNTHETIC</a></body></html>'
  const fetchFn=html=>async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}})
  for (const meta of [
    '<meta http-equiv="Cache-Control" content="private; no-store">',
    '<meta name="robots" content="index, noarchive, follow">',
    '<meta name="Googlebot" content="NOARCHIVE">',
  ]) {
    await assert.rejects(captureApprovedRetailerPage({
      source,permissionGate:gate,grant,fetchFn:fetchFn(page(meta)),
    }),/HTML disallows snapshot archival/,meta)
    const allowed=await captureApprovedRetailerPage({
      source,permissionGate:gate,grant,fetchFn:fetchFn(page('<template>'+meta+'</template>')),
    })
    assert.equal(allowed.readyForIngestion,false)
  }
})

test('source capture refuses HTML entity-encoded robots and cache directives before archival', async () => {
  const page=meta=>'<html><head>'+meta+'</head><body><a href="/product/synthetic-12">SYNTHETIC</a></body></html>'
  for (const meta of [
    '<meta name="ro&#98;ots" content="no&#97;rchive">',
    '<meta http-equiv="Cache&#45;Control" content="no&#45;store">',
  ]) await assert.rejects(captureApprovedRetailerPage({
    source,permissionGate:gate,grant,
    fetchFn:async()=>new Response(page(meta),{status:200,headers:{'content-type':'text/html'}}),
  }),/HTML disallows snapshot archival/,meta)
})

test('HTTP 200 Content-Range cannot launder a partial document into a complete snapshot', async () => {
  let cancelled=false
  const fragment='<html><body>PARTIAL SYNTHETIC'
  const stream=new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(fragment)) },
    cancel() { cancelled=true },
  })
  await assert.rejects(captureApprovedRetailerPage({
    source,permissionGate:gate,grant,
    fetchFn:async()=>new Response(stream,{status:200,headers:{
      'content-type':'text/html',
      'content-range':'bytes 0-27/999',
    }}),
  }),/Partial retailer HTML representation refused/)
  assert.equal(cancelled,true)
})

test('live HTML charset declarations cannot contradict the UTF-8 source byte identity', async () => {
  const item='<a href="/product/synthetic-111">SYNTHETIC café</a>'
  const page=meta=>'<html><head>'+meta+'</head><body>'+item+'</body></html>'
  for(const meta of [
    '<meta charset="windows-1252">',
    '<meta charset="ISO-8859-1">',
    '<meta http-equiv="Content-Type" content="text/html; charset=latin1">',
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8; charset=latin1">',
  ]) {
    await assert.rejects(captureApprovedRetailerPage({
      source,permissionGate:gate,grant,
      fetchFn:async()=>new Response(page(meta),{status:200,
        headers:{'content-type':'text/html'}}),
    }),/Untrusted retailer HTML charset/)
  }
  const allowed=await captureApprovedRetailerPage({
    source,permissionGate:gate,grant,
    fetchFn:async()=>new Response(page('<meta charset="UTF-8">'),{status:200,
      headers:{'content-type':'text/html'}}),
  })
  assert.equal(allowed.published,false)
  assert.equal(allowed.readyForIngestion,false)
})

test('entity-encoded canonical rel cannot launder the wrong captured retailer page',async()=>{
  const html='<html><head><link rel="canon&#105;cal" href="https://other.test/producten"></head><body>synthetic</body></html>'
  await assert.rejects(captureApprovedRetailerPage({source,permissionGate:gate,grant,
    fetchFn:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}}),
  }),/canonical/)
})

test('unsupported or multiple HTTP content encodings never excuse incomplete HTML source bytes', async () => {
  const html = '<!doctype html><html><body>SYNTHETIC ENCODING EVIDENCE</body></html>'
  for (const unsupported of ['unknown-transport', 'gzip, br', 'identity, gzip', 'x-gzip', 'gzip; level=1', ' ']) {
    let cancelled = 0
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(html)) },
      cancel() { cancelled++ },
    }), { status: 200, headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': unsupported,
      'content-length': '1',
    } })
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant, fetchFn: async () => response,
    }), /Unsupported or ambiguous retailer Content-Encoding/)
    assert.equal(cancelled, 1, 'a rejected response body must be cancelled: ' + unsupported)
  }
  for (const supported of ['identity', 'IDENTITY', 'gzip', 'br', 'deflate']) {
    const compressed = !/^identity$/i.test(supported)
    const row = await captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(html, { status: 200, headers: {
        'content-type': 'text/html',
        'content-encoding': supported,
        'content-length': String(compressed ? 3 : Buffer.byteLength(html)),
      } }),
    })
    assert.equal(row.source.sha256, createHash('sha256').update(html).digest('hex'))
    assert.equal(row.published, false)
  }
})

test('only a canonical RFC HTTP Date can give source HTML a fresh capture clock', async () => {
  const html = '<html><body>FICTIONAL DATE HEADER</body></html>'
  const fresh = new Date(Date.now() - 45_000).toUTCString()
  const wrongWeekday = fresh.replace(/^[A-Za-z]{3}/,
    fresh.startsWith('Mon') ? 'Tue' : 'Mon')
  const untrusted = [
    new Date(Date.now() - 45_000).toISOString(),
    wrongWeekday,
    fresh.replace(' GMT', ' PST'),
    new Date(Date.now() - 45_000).toUTCString().replace(', ', ' '),
  ]
  for (const date of untrusted) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(html, {
        status: 200, headers: { 'content-type': 'text/html', date },
      }),
    }), /Stale or malformed retailer HTTP representation refused/)
  }
  const accepted = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html', date: fresh },
    }),
  })
  assert.equal(accepted.source.sha256,
    createHash('sha256').update(html).digest('hex'))
  assert.equal(accepted.published, false)
})

test('RFC 9530 Content-Digest is checked against exact UTF-8 source bytes before archiving', async () => {
  // Real non-ASCII UTF-8 ensures hash is over transport bytes, not JS code units.
  const html = '<!doctype html><html lang="nl"><body>SYNTHETIC melk € 2,49</body></html>'
  const digest = createHash('sha256').update(Buffer.from(html)).digest('base64')
  const good = await captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {status: 200, headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-digest': 'sha-256=:' + digest + ':',
      'content-length': String(Buffer.byteLength(html)),
    }}),
  })
  assert.equal(good.source.sha256, createHash('sha256').update(html).digest('hex'))
  assert.equal(good.published, false)
  const falseDigest = createHash('sha256').update('different bytes').digest('base64')
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {status: 200, headers: {
      'content-type': 'text/html',
      'content-digest': 'sha-256=:' + falseDigest + ':',
    }}),
  }), /Content-Digest mismatch/)
})

test('ambiguous or uncheckable Content-Digest is refused before downloading upstream HTML', async () => {
  const valid = createHash('sha256').update('synthetic').digest('base64')
  for (const [digest, encoding] of [
    ['sha-256=:invalid:', null],
    ['sha-512=:abc:', null],
    ['sha-256=:' + valid + ':, sha-512=:abc:', null],
    ['sha-256=:' + valid + ':', 'gzip'],
  ]) {
    let cancelled = 0
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('private upstream bytes')) },
      cancel() { cancelled++ },
    })
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(stream, {status: 200, headers: {
        'content-type': 'text/html',
        'content-digest': digest,
        ...(encoding ? {'content-encoding': encoding} : {}),
      }}),
    }), /Unsupported or ambiguous retailer Content-Digest/)
    assert.equal(cancelled, 1)
  }
})

test('RFC 9530 SHA-512 and dual-algorithm Content-Digest evidence are fully checked', async () => {
  const html = '<html><body>SYNTHETIC BOTH-ALGORITHMS</body></html>'
  const sha256 = createHash('sha256').update(html).digest('base64')
  const sha512 = createHash('sha512').update(html).digest('base64')
  const valid = [
    'sha-512=:' + sha512 + ':',
    'sha-256=:' + sha256 + ':, sha-512=:' + sha512 + ':',
    'sha-512=:' + sha512 + ':, sha-256=:' + sha256 + ':',
  ]
  for (const digest of valid) {
    const record = await captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(html, {status: 200, headers: {
        'content-type': 'text/html', 'content-digest': digest,
      }}),
    })
    assert.equal(record.source.sha256,
      createHash('sha256').update(html).digest('hex'))
    assert.equal(record.published, false)
  }
  const bad512 = createHash('sha512').update('different representation').digest('base64')
  for (const header of [
    'sha-512=:' + bad512 + ':',
    'sha-256=:' + sha256 + ':, sha-512=:' + bad512 + ':',
    'sha-256=:' + sha256 + ':, sha-256=:' + sha256 + ':',
  ]) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(html, {status: 200, headers: {
        'content-type': 'text/html', 'content-digest': header,
      }}),
    }), /Content-Digest/)
  }
})

test('RFC 9530 representation digests are validated for complete identity-encoded retailer HTML', async () => {
  const html = '<html><body>SYNTHETIC representation integrity</body></html>'
  const sha256 = createHash('sha256').update(html).digest('base64')
  const sha512 = createHash('sha512').update(html).digest('base64')
  const wrong = createHash('sha512').update('NOT THE REPRESENTATION').digest('base64')
  for (const headers of [
    { 'repr-digest': 'sha-256=:' + sha256 + ':' },
    { 'repr-digest': 'sha-512=:' + sha512 + ':' },
    { 'repr-digest': 'sha-256=:' + sha256 + ':, sha-512=:' + sha512 + ':',
      'content-digest': 'sha-512=:' + sha512 + ':' },
  ]) {
    const record = await captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(html, {
        status: 200, headers: {'content-type':'text/html',...headers},
      }),
    })
    assert.equal(record.source.sha256, createHash('sha256').update(html).digest('hex'))
    assert.equal(record.published, false)
  }
  // Never ignore a bad representation checksum merely because Content-Digest passed.
  await assert.rejects(captureApprovedRetailerPage({
    source, permissionGate: gate, grant,
    fetchFn: async () => new Response(html, {status: 200,headers:{
      'content-type':'text/html',
      'content-digest':'sha-256=:' + sha256 + ':',
      'repr-digest':'sha-512=:' + wrong + ':',
    }}),
  }), /Digest mismatch/)
})

test('uncheckable compressed or malformed representation checksums fail before stream read', async () => {
  const hash = createHash('sha256').update('fake representation').digest('base64')
  for(const headers of [
    {'repr-digest':'sha-256=:' + hash + ':','content-encoding':'br'},
    {'repr-digest':'sha-256=:not-valid:'},
    {'repr-digest':'sha-256=:' + hash + ':, sha-256=:' + hash + ':'},
  ]) {
    let cancelled=0
    const stream=new ReadableStream({
      pull(controller){controller.enqueue(new TextEncoder().encode('untrusted'))},
      cancel(){cancelled++},
    })
    await assert.rejects(captureApprovedRetailerPage({
      source,permissionGate:gate,grant,
      fetchFn:async()=>new Response(stream,{status:200,headers:{
        'content-type':'text/html',...headers,
      }}),
    }), /Unsupported or ambiguous retailer Repr-Digest/)
    assert.equal(cancelled,1)
  }
})

test('encoded dot/percent source aliases cannot rebind a 200 HTML capture to the requested page', async () => {
  const html='<html><body>FICTIONAL encoded source identity</body></html>'
  // WHATWG URL normalizes encoded dot segments; evaluating only the resolved
  // target would silently accept an ambiguous response source identity.
  for(const alias of [
    '/producten/%2e%2e/producten',
    '/producten/%2E%2E/producten',
    '/producten/%252e%252e/producten',
  ]) {
    const inputs=[
      {headers:{'content-location':alias}, body:html},
      {headers:{link:'<'+alias+'>; rel="canonical"'}, body:html},
      {headers:{},body:'<html><head><link rel="canonical" href="'+alias+'"></head><body>SYNTHETIC</body></html>'},
      {headers:{},body:'<html><head><base href="'+alias+'"></head><body>SYNTHETIC</body></html>'},
    ]
    for (const input of inputs) {
      await assert.rejects(captureApprovedRetailerPage({
        source,permissionGate:gate,grant,
        fetchFn:async()=>new Response(input.body,{status:200,headers:{
          'content-type':'text/html',...input.headers,
        }}),
      }),/Untrusted HTML|response navigation\/source identity refused/)
    }
  }
})


test('a same-host HTML base cannot silently rebase reviewed product links to a different page', async () => {
  const cases = [
    '/product/unrelated-sku',
    '/producten?shop=unreviewed',
    '/producten/#unreviewed',
    '/unreviewed-assets/',
  ]
  for (const href of cases) {
    await assert.rejects(captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response(
        '<html><head><base href="' + href + '"></head><body><a href="sku">SYNTHETIC</a></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    }), /Untrusted HTML base URL/, 'must reject base ' + href)
  }
  for (const href of ['/', '/producten/', '/producten']) {
    const proof = await captureApprovedRetailerPage({
      source, permissionGate: gate, grant,
      fetchFn: async () => new Response('<html><head><base href="' + href + '"></head><body>SYNTHETIC</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }),
    })
    assert.equal(proof.published, false)
  }
})


test('raw source authority must not be rewritten by URL hostname percent or IDNA normalization', async () => {
  const aliases = [
    'https://%77ww.plus.nl/producten',
    'https://www.%70lus.nl/producten',
    'https://www．plus.nl/producten',
    '//%77ww.plus.nl/producten',
  ]
  for (const alias of aliases) {
    assert.equal(new URL(alias, url).origin, new URL(url).origin)
    const variants = [
      { headers: { 'content-location': alias }, html: '<html>SYNTHETIC</html>' },
      { headers: { link: '<' + alias + '>; rel=canonical' }, html: '<html>SYNTHETIC</html>' },
      { headers: {}, html: '<html><head><base href="' + alias + '"></head><body>SYNTHETIC</body></html>' },
      { headers: {}, html: '<html><head><link rel="canonical" href="' + alias + '"></head><body>SYNTHETIC</body></html>' },
    ]
    for (const variant of variants) {
      // Fetch Headers are ByteString-only; the Unicode host alias is a
      // browser-DOM case rather than a valid raw HTTP header value.
      if (alias.includes('．') && Object.keys(variant.headers).length) continue
      await assert.rejects(captureApprovedRetailerPage({
        source, permissionGate: gate, grant,
        fetchFn: async () => new Response(variant.html, { status: 200,
          headers: { 'content-type': 'text/html', ...variant.headers } }),
      }), /source identity refused|Untrusted HTML/, alias)
    }
  }
})


test('raw HTML source URLs cannot launder control-byte aliases through URL normalization', async () => {
  const aliases = [
    'https:\t//www.plus.nl/producten',
    'https://www.plus.\tnl/producten',
    '/producten\n',
    'https://www.plus.nl/producten\r',
  ]
  for (const alias of aliases) {
    assert.equal(new URL(alias, url).href, url)
    for (const tag of ['base', 'link rel="canonical"']) {
      const html = '<html><head><' + tag + ' href="' + alias + '"></head><body>SYNTHETIC</body></html>'
      await assert.rejects(captureApprovedRetailerPage({
        source, permissionGate: gate, grant,
        fetchFn: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
      }), /Untrusted HTML/, JSON.stringify(alias))
    }
  }
})
