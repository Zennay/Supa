import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fetchAuthorizedRetailerHtml } from '../scripts/retailer-authorized-fetch.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

/** QA-only real streaming boundary; all permission evidence and network
 * transports are fictional mocks, never a real retailer request. */
const source = SOURCES.find(x => x.id === 'plus-product-halfvolle-melk')
const permission = {
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
      url: 'https://example.org/qa-only-fake-license',
      finding: 'FICTIONAL MOCK; no retailer permission exists',
    }],
  })),
}
const at = Date.parse('2026-10-15T10:00:00.000Z')

function mockResponse(options = {}) {
  const raw = options.bytes ?? new TextEncoder().encode('<html>fictional</html>')
  const parts = options.parts ?? [raw]
  return {
    url: options.finalUrl ?? source.url,
    status: options.status ?? 200,
    ok: options.ok ?? true,
    headers: { get(name) {
      if (name === 'content-type') return options.contentType ?? 'text/html; charset=utf-8'
      if (name === 'content-length') return options.length ?? null
      return null
    } },
    body: new ReadableStream({
      start(c) {
        for (const chunk of parts) c.enqueue(chunk)
        c.close()
      },
    }),
  }
}

function call(fetchImpl, overrides = {}) {
  return fetchAuthorizedRetailerHtml({
    sourceId: source.id,
    permissionDocument: permission,
    enableLive: true,
    capturedAtMs: at,
    fetchImpl,
    ...overrides,
  })
}

test('real fetch boundary uses only allowlisted URL, explicit no-cookie/no-redirect transport and exact bytes SHA', async () => {
  const bytes = new TextEncoder().encode('<html>één & tweë</html>')
  let calls = 0
  const out = await call(async (url, opts) => {
    calls++
    assert.equal(url, source.url)
    assert.equal(opts.redirect, 'error')
    assert.equal(opts.credentials, 'omit')
    assert.equal(opts.headers.accept, 'text/html')
    assert.equal(opts.headers.cookie, undefined)
    assert.equal(opts.headers.authorization, undefined)
    assert.equal(opts.body, undefined)
    assert.equal(opts.method, undefined)
    assert.ok(opts.signal instanceof AbortSignal)
    return mockResponse({ bytes, parts: [bytes.subarray(0, 10), bytes.subarray(10)] })
  })
  assert.equal(calls, 1)
  assert.equal(out.bytes, bytes.byteLength)
  assert.equal(out.html, '<html>één & tweë</html>')
  assert.equal(out.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(out.capturedAt, '2026-10-15T10:00:00.000Z')
  assert.equal(out.source.id, source.id)
})

test('wrong final URL or redirected response never gets accepted as original retailer provenance', async () => {
  for (const finalUrl of ['https://other.example/product', 'https://www.plus.nl/other', 'http://www.plus.nl/product']) {
    let calls = 0
    await assert.rejects(call(async () => {
      calls++
      return mockResponse({ finalUrl })
    }), /unavailable/)
    assert.equal(calls, 1)
  }
})

test('403 and 429 stop immediately, without retries or falling back to proxies', async () => {
  for (const status of [403, 429]) {
    let calls = 0
    await assert.rejects(call(async () => {
      calls++
      return mockResponse({ status, ok: false })
    }), /unavailable/)
    assert.equal(calls, 1)
  }
})

test('declared oversized or malformed content length is refused before streaming', async () => {
  for (const length of ['12', '-1', 'oops']) {
    let calls = 0
    await assert.rejects(call(async () => {
      calls++
      return mockResponse({ length })
    }, { maxBytes: 10 }), /byte limit/)
    assert.equal(calls, 1)
  }
})

test('non-HTML MIME, absent bounded reader, and non-byte stream chunks refuse all output', async () => {
  await assert.rejects(call(async () =>
    mockResponse({ contentType: 'application/json' })), /not HTML/)
  await assert.rejects(call(async () =>
    ({ ...mockResponse(), body: undefined })), /streaming/)
  await assert.rejects(call(async () =>
    mockResponse({ parts: ['not bytes'] })), /Invalid HTML bytes/)
})

test('blocked permission cannot be disguised by a valid sample source', async () => {
  const denied = structuredClone(permission)
  denied.sources[0].productionEnabled = false
  denied.sources[0].permissionStatus = 'permission_required'
  let called = 0
  await assert.rejects(call(async () => {
    called++
    throw Error('mock must never be called')
  }, { permissionDocument: denied }), /permission/)
  assert.equal(called, 0)
})

test('EXPECTED RED: oversized streaming body cancels reader to stop unbounded download', async () => {
  let cancelled = 0
  const bytes = new Uint8Array(11)
  const fetchImpl = async () => ({
    url: source.url, status: 200, ok: true,
    headers: { get(name) { return name === 'content-type' ? 'text/html' : null } },
    body: new ReadableStream({
      start(c) { c.enqueue(bytes) },
      cancel() { cancelled++ },
    }),
  })
  await assert.rejects(call(fetchImpl, { maxBytes: 10 }), /byte limit/)
  assert.equal(cancelled, 1,
    'refuse and cancel oversized HTTP stream; releaseLock alone cannot cancel download')
})
