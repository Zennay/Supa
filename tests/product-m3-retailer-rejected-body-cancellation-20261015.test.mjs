import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAuthorizedRetailerHtml } from '../scripts/retailer-authorized-fetch.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Every transport and licence assertion in this file is FICTIONAL.
// No production retailer network request, rights grant, or pricing evidence.
const source = SOURCES.find((entry) => entry.id === 'plus-product-halfvolle-melk')
const permissionDocument = {
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-15',
  sources: ['plus', 'dekamarkt'].map((supermarket) => ({
    supermarket,
    technicalStatus: 'proven',
    permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.org/fictional-unit-test-only',
      finding: 'SYNTHETIC TEST RIGHTS; never use for live retailer capture',
    }],
  })),
}
const at = Date.parse('2026-10-15T10:00:00Z')

function makeResponse(overrides = {}) {
  let cancels = 0
  const stream = overrides.unreadableBody
    ? { cancel() { cancels++; return Promise.resolve() } }
    : new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        if (overrides.complete) controller.close()
      },
      cancel() {
        cancels++
        if (overrides.cancelThrows) throw new Error('synthetic cancel failed')
      },
    })
  return {
    response: {
      url: overrides.finalUrl ?? source.url,
      ok: overrides.ok ?? true,
      status: overrides.status ?? 200,
      headers: {
        get(header) {
          if (header === 'content-type') return overrides.mime ?? 'text/html'
          if (header === 'content-length') return overrides.length ?? null
          return null
        },
      },
      body: stream,
    },
    cancelled: () => cancels,
  }
}

async function fetchMock(response, overrides = {}) {
  let calls = 0
  const request = fetchAuthorizedRetailerHtml({
    sourceId: source.id,
    enableLive: true,
    permissionDocument,
    capturedAtMs: at,
    maxBytes: 10,
    fetchImpl: async (url, options) => {
      calls++
      assert.equal(url, source.url)
      assert.equal(options.redirect, 'error')
      assert.equal(options.credentials, 'omit')
      return response
    },
    ...overrides,
  })
  return { request, getCalls: () => calls }
}

const cases = [
  {
    label: '403 retailer access rejected',
    overrides: { status: 403, ok: false },
    message: /response unavailable/,
  },
  {
    label: '429 retailer throttle rejected without retry',
    overrides: { status: 429, ok: false },
    message: /response unavailable/,
  },
  {
    label: 'redirected final URL fails origin binding',
    overrides: { finalUrl: 'https://other.example/fake-product' },
    message: /response unavailable/,
  },
  {
    label: 'non-HTML content-type rejects before getReader',
    overrides: { mime: 'application/json' },
    message: /not HTML/,
  },
  {
    label: 'declared byte limit rejects before getReader',
    overrides: { length: '11' },
    message: /byte limit/,
  },
  {
    label: 'malformed content-length rejects before getReader',
    overrides: { length: '1e8' },
    message: /byte limit/,
  },
  {
    label: 'missing bounded reader still cancels a cancelable body',
    overrides: { unreadableBody: true },
    message: /streaming is required/,
  },
]

for (const { label, overrides, message } of cases) {
  test('M3 early rejected retailer response cancels body: ' + label, async () => {
    const mocked = makeResponse(overrides)
    const { request, getCalls } = await fetchMock(mocked.response)
    await assert.rejects(request, message)
    assert.equal(getCalls(), 1, 'never retry or contact a fallback service')
    assert.equal(mocked.cancelled(), 1, 'stop unread response transport')
  })
}

test('failed cancellation does not mask the original rejected MIME', async () => {
  const mocked = makeResponse({ mime: 'image/png', cancelThrows: true })
  const { request, getCalls } = await fetchMock(mocked.response)
  await assert.rejects(request, /Authorized response is not HTML/)
  assert.equal(getCalls(), 1)
  assert.equal(mocked.cancelled(), 1)
})

test('fully read approved mock HTML at exactly the byte limit is not cancelled', async () => {
  const mocked = makeResponse({ complete: true, length: '3' })
  const { request, getCalls } = await fetchMock(mocked.response, { maxBytes: 3 })
  const result = await request
  assert.equal(result.bytes, 3)
  assert.deepEqual([...Buffer.from(result.html, 'utf8')], [1, 2, 3])
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(getCalls(), 1)
  assert.equal(mocked.cancelled(), 0, 'do not abort a successful complete capture')
})
